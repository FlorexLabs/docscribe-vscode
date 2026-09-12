import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { buildDoctorReport } from '../../doctorReport';
import {
  applyFixViaServer,
  checkBatchViaServer,
  checkFileViaServer,
  setSocketPathForTesting,
  updateTypesViaServer,
} from '../../docscribeClient';
import { checkMissingRbsGem, resetRbsBalloonForTesting } from '../../extension';
import {
  buildRbsCliOverrides,
  gemfileHasRbs,
  hasRbsInLock,
  hasSigFiles,
  readExplicitRbsEnabled,
  shouldUseRbs,
} from '../../rbsDetector';
import {
  clearCachedCapabilitiesForTesting,
  clearServerModeWarningForTesting,
  ensureFreshCapabilities,
  parseCapabilities,
  resolveRbsContext,
  runDocscribe,
  serverModeWarning,
} from '../../docscribeRunner';
import runnerReal = require('../../docscribeRunner'); // eslint-disable-line @typescript-eslint/no-require-imports -- shared exports object for stubbing
import childProcess = require('child_process'); // eslint-disable-line @typescript-eslint/no-require-imports -- shared exports object for stubbing

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ds-dr-'));
}

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function stubConfig(values: Record<string, unknown>): void {
  const stub = sinon.stub(vscode.workspace, 'getConfiguration') as unknown as sinon.SinonStub;
  stub.callsFake((...args: unknown[]) => {
    void args;
    return {
      get: (key: string, def?: unknown): unknown =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : def,
    };
  });
}

function stubDoctorConfig(over: Record<string, unknown> = {}): void {
  stubConfig({
    runOnSave: true,
    useBundleExec: false,
    useRbs: true,
    validateTypes: true,
    useServer: true,
    commandPath: 'docscribe',
    ignorePatterns: [],
    foldComments: false,
    omitBoilerplate: false,
    rubyPath: 'ruby',
    bundlePath: 'bundle',
    ...over,
  });
}

interface CapturedCall {
  cmd: string;
  args: string[];
}

function stubExec(opts: {
  version: string | null | (() => string | null);
  mainStdout: string;
  captured: CapturedCall[];
}): void {
  const stub = sinon.stub(childProcess, 'execFile') as unknown as sinon.SinonStub;
  stub.callsFake((...raw: unknown[]) => {
    const [cmd, args, third, fourth] = raw as [unknown, unknown, unknown, unknown];
    const cb = (typeof third === 'function' ? third : fourth) as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const argList = Array.isArray(args) ? (args as string[]) : [];
    if (argList.includes('--version')) {
      const v = typeof opts.version === 'function' ? opts.version() : opts.version;
      if (v === null) {
        cb(Object.assign(new Error('command failed'), { code: 2 }), '', 'error');
      } else {
        cb(null, `${v}\n`, '');
      }
    } else {
      opts.captured.push({ cmd: String(cmd), args: argList });
      cb(null, opts.mainStdout, '');
    }
    return {
      stdin: {
        write(): void {
          /* noop */
        },
        end(): void {
          /* noop */
        },
      },
    };
  });
}

function setWorkspaceProp(prop: string, value: unknown): () => void {
  const target = vscode.workspace as unknown as Record<string, unknown>;
  const prevDesc = Object.getOwnPropertyDescriptor(target, prop);
  try {
    Object.defineProperty(target, prop, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  } catch {
    target[prop] = value;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    try {
      if (prevDesc) Object.defineProperty(target, prop, prevDesc);
      else Reflect.deleteProperty(target, prop);
    } catch {
      // ignore restore errors on exotic hosts
    }
  };
}

function setWorkspaceFolders(folders: unknown): () => void {
  return setWorkspaceProp('workspaceFolders', folders);
}

function fakeWorkspace(root: string): () => void {
  return setWorkspaceFolders([{ uri: vscode.Uri.file(root), name: 'proj', index: 0 }]);
}

interface SeenRequest {
  method: string;
  params: Record<string, unknown>;
}

async function withFakeDaemon(
  respond: (method: string, params: Record<string, unknown>) => unknown,
  body: (sock: string, seen: SeenRequest[]) => Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-fake-'));
  const sock = path.join(dir, 'daemon.sock');
  const seen: SeenRequest[] = [];
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) {
          const req = JSON.parse(line) as {
            id: number;
            method: string;
            params?: Record<string, unknown>;
          };
          const params = req.params ?? {};
          seen.push({ method: req.method, params });
          const result = respond(req.method, params);
          conn.write(`${JSON.stringify({ jsonrpc: '2.0', id: req.id, result })}\n`);
        }
        idx = buf.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(sock, () => resolve()));
  setSocketPathForTesting(sock);
  try {
    await body(sock, seen);
  } finally {
    setSocketPathForTesting(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

suite('doctorRbsMatrix (QA 2D/2E/2H)', () => {
  setup(() => {
    clearCachedCapabilitiesForTesting();
    clearServerModeWarningForTesting();
  });

  teardown(() => {
    sinon.restore();
    setSocketPathForTesting(null);
    clearCachedCapabilitiesForTesting();
    clearServerModeWarningForTesting();
  });

  suite('RbsDetector priority', () => {
    test('explicit yml wins over every signal', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'sig/app/user.rbs', 'class User end');
        writeFile(root, 'Gemfile.lock', 'GEM\n  specs:\n    rbs (3.4.0)\n');
        writeFile(root, 'Gemfile', 'gem "rbs"\n');
        assert.strictEqual(hasSigFiles(root), true);
        assert.strictEqual(hasRbsInLock(root), true);
        assert.strictEqual(gemfileHasRbs(path.join(root, 'Gemfile')), true);
        writeFile(root, 'docscribe.yml', 'rbs:\n  enabled: false\n');
        assert.strictEqual(readExplicitRbsEnabled(root), false);
        assert.strictEqual(shouldUseRbs(root, true), false);
        writeFile(root, 'docscribe.yml', 'rbs:\n  enabled: true\n');
        fs.rmSync(path.join(root, 'sig'), { recursive: true, force: true });
        fs.rmSync(path.join(root, 'Gemfile.lock'), { force: true });
        assert.strictEqual(shouldUseRbs(root, false), true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('sig beats lock beats Gemfile', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'sig/app/user.rbs', 'class User end');
        writeFile(root, 'Gemfile.lock', 'GEM\n  specs:\n    rbs (3.4.0)\n');
        assert.strictEqual(shouldUseRbs(root, true), true);
        fs.rmSync(path.join(root, 'sig'), { recursive: true, force: true });
        assert.strictEqual(hasSigFiles(root), false);
        assert.strictEqual(shouldUseRbs(root, false), true);
        fs.rmSync(path.join(root, 'Gemfile.lock'), { force: true });
        assert.strictEqual(hasRbsInLock(root), false);
        assert.strictEqual(shouldUseRbs(root, true), true);
        assert.strictEqual(shouldUseRbs(root, false), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('dotted config name wins too', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'sig/app/user.rbs', 'class User end');
        writeFile(root, '.docscribe.yml', 'rbs:\n  enabled: false\n');
        assert.strictEqual(readExplicitRbsEnabled(root), false);
        assert.strictEqual(shouldUseRbs(root, true), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('no signal means off', () => {
      const root = makeRoot();
      try {
        assert.strictEqual(readExplicitRbsEnabled(root), null);
        assert.strictEqual(shouldUseRbs(root, false), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('buildRbsCliOverrides', () => {
    test('omitted when empty', () => {
      assert.strictEqual(buildRbsCliOverrides(false, false, false), undefined);
      assert.strictEqual(buildRbsCliOverrides(false, true, false), undefined);
    });

    test('forwards the full matrix', () => {
      assert.deepStrictEqual(buildRbsCliOverrides(true, false, false), { rbs: true });
      assert.deepStrictEqual(buildRbsCliOverrides(true, true, false), {
        rbs: true,
        rbs_collection: true,
      });
      assert.deepStrictEqual(buildRbsCliOverrides(true, false, true), {
        rbs: true,
        validate_types: true,
      });
      assert.deepStrictEqual(buildRbsCliOverrides(true, true, true), {
        rbs: true,
        rbs_collection: true,
        validate_types: true,
      });
      assert.deepStrictEqual(buildRbsCliOverrides(false, false, true), {
        validate_types: true,
      });
      assert.deepStrictEqual(buildRbsCliOverrides(false, true, true), {
        validate_types: true,
      });
    });
  });

  suite('resolveRbsContext', () => {
    test('validateTypes on with setting and gem support', () => {
      const root = makeRoot();
      try {
        const caps = parseCapabilities('1.6.2');
        assert.ok(caps);
        stubDoctorConfig({ useRbs: false, validateTypes: true });
        assert.strictEqual(resolveRbsContext(root, caps).validateTypes, true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('validateTypes off when setting disabled', () => {
      const root = makeRoot();
      try {
        const caps = parseCapabilities('1.6.2');
        assert.ok(caps);
        stubConfig({ useRbs: false, validateTypes: false });
        assert.strictEqual(resolveRbsContext(root, caps).validateTypes, false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('validateTypes undefined when version unknown, false on old gems', () => {
      const root = makeRoot();
      try {
        stubDoctorConfig({ useRbs: false, validateTypes: true });
        assert.strictEqual(resolveRbsContext(root, null).validateTypes, undefined);
        const old = parseCapabilities('1.5.2');
        assert.ok(old);
        assert.strictEqual(resolveRbsContext(root, old).validateTypes, false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('overrides undefined when empty', () => {
      const root = makeRoot();
      try {
        stubDoctorConfig({ useRbs: false, validateTypes: false });
        const empty = resolveRbsContext(root, parseCapabilities('1.6.2'));
        assert.strictEqual(empty.useRbs, false);
        assert.strictEqual(empty.overrides, undefined);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('overrides carry rbs, collection and validate', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'sig/app/user.rbs', 'class User end');
        writeFile(root, 'rbs_collection.lock.yaml', 'sources: []\n');
        stubDoctorConfig({ useRbs: true, validateTypes: true });
        const full = resolveRbsContext(root, parseCapabilities('1.6.2'));
        assert.deepStrictEqual(full.overrides, {
          rbs: true,
          rbs_collection: true,
          validate_types: true,
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('validateTypes CLI flags via runDocscribe', () => {
    function makeProject(): { root: string; file: string } {
      const root = makeRoot();
      writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
      const file = path.join(root, 'lib', 'a.rb');
      writeFile(root, path.join('lib', 'a.rb'), 'class A end\n');
      return { root, file };
    }

    function emptyCheckJson(): string {
      return JSON.stringify({
        files: [],
        summary: {
          offense_count: 0,
          target_file_count: 1,
          inspected_file_count: 1,
          error_count: 0,
        },
      });
    }

    test('--validate-types when enabled and supported', async () => {
      const { root, file } = makeProject();
      try {
        stubDoctorConfig({ useRbs: false, validateTypes: true, useServer: false });
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: emptyCheckJson(), captured });
        await runDocscribe({ file, strategy: 'check', json: true });
        assert.strictEqual(captured.length, 1);
        assert.ok(captured[0].args.includes('--validate-types'));
        assert.ok(!captured[0].args.includes('--no-validate-types'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('--no-validate-types when disabled', async () => {
      const { root, file } = makeProject();
      try {
        stubDoctorConfig({ useRbs: false, validateTypes: false, useServer: false });
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: emptyCheckJson(), captured });
        await runDocscribe({ file, strategy: 'check', json: true });
        assert.strictEqual(captured.length, 1);
        assert.ok(captured[0].args.includes('--no-validate-types'));
        assert.ok(!captured[0].args.includes('--validate-types'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('no validate flag when version undetected', async () => {
      const { root, file } = makeProject();
      try {
        stubDoctorConfig({ useRbs: false, validateTypes: true, useServer: false });
        const captured: CapturedCall[] = [];
        stubExec({ version: null, mainStdout: emptyCheckJson(), captured });
        await runDocscribe({ file, strategy: 'check', json: true });
        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0].args, ['--format', 'json', file]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('cli_overrides over the daemon socket', () => {
    test('check forwards overrides, omits when empty', async () => {
      await withFakeDaemon(
        (method) => {
          if (method === 'ping') return 'pong';
          return { status: 'ok', changed: false, changes: [{ line: 3 }] };
        },
        async (_sock, seen) => {
          const withOv = JSON.parse(await checkFileViaServer('/tmp/a.rb', { rbs: true }));
          assert.strictEqual(withOv.files[0].offenses[0].location.start_line, 3);
          await checkFileViaServer('/tmp/a.rb');
          const checkSeen = seen.filter((s) => s.method === 'check');
          assert.strictEqual(checkSeen.length, 2);
          assert.deepStrictEqual(checkSeen[0].params['cli_overrides'], { rbs: true });
          assert.ok(!('cli_overrides' in checkSeen[1].params));
        },
      );
    });

    test('check_batch forwards overrides, omits when empty', async () => {
      await withFakeDaemon(
        (method) => {
          if (method === 'ping') return 'pong';
          return { results: [{ file: '/tmp/a.rb', status: 'ok', changes: [{ line: 2 }] }] };
        },
        async (_sock, seen) => {
          const json = JSON.parse(
            await checkBatchViaServer(['/tmp/a.rb'], { validate_types: true }),
          );
          assert.strictEqual(json.files[0].offenses[0].location.start_line, 2);
          await checkBatchViaServer(['/tmp/a.rb']);
          const batchSeen = seen.filter((s) => s.method === 'check_batch');
          assert.strictEqual(batchSeen.length, 2);
          assert.deepStrictEqual(batchSeen[0].params['cli_overrides'], { validate_types: true });
          assert.ok(!('cli_overrides' in batchSeen[1].params));
        },
      );
    });

    test('fix forwards overrides, omits when empty, honors changed', async () => {
      await withFakeDaemon(
        (method, params) => {
          if (method === 'ping') return 'pong';
          if (method === 'fix') {
            const target = params['file'];
            if (
              typeof target === 'string' &&
              params['strategy'] === 'safe' &&
              params['cli_overrides'] !== undefined
            ) {
              fs.appendFileSync(target, '# fixed-by-daemon\n');
              return { changed: true };
            }
            return { changed: false };
          }
          return null;
        },
        async (_sock, seen) => {
          const fixed = await applyFixViaServer('original\n', 'safe', { rbs: true });
          assert.ok(fixed.includes('# fixed-by-daemon'));
          const same = await applyFixViaServer('original\n', 'safe');
          assert.strictEqual(same, 'original\n');
          const fixSeen = seen.filter((s) => s.method === 'fix');
          assert.strictEqual(fixSeen.length, 2);
          assert.deepStrictEqual(fixSeen[0].params['cli_overrides'], { rbs: true });
          assert.ok(!('cli_overrides' in fixSeen[1].params));
        },
      );
    });

    test('update_types forwards overrides, omits when empty', async () => {
      await withFakeDaemon(
        (method) => {
          if (method === 'ping') return 'pong';
          return { status: 'ok', dir: '/tmp/proj', exit_code: 0 };
        },
        async (_sock, seen) => {
          const res = await updateTypesViaServer({ file: '/tmp/a.rb' }, { rbs: true });
          assert.deepStrictEqual(res, { status: 'ok', dir: '/tmp/proj', exit_code: 0 });
          await updateTypesViaServer({ file: '/tmp/a.rb' });
          const utSeen = seen.filter((s) => s.method === 'update_types');
          assert.strictEqual(utSeen.length, 2);
          assert.deepStrictEqual(utSeen[0].params['cli_overrides'], { rbs: true });
          assert.ok(!('cli_overrides' in utSeen[1].params));
        },
      );
    });

    test('runDocscribe check via server forwards resolved overrides', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const file = path.join(root, 'lib', 'a.rb');
        writeFile(root, path.join('lib', 'a.rb'), 'class A end\n');
        stubDoctorConfig({ useRbs: false, validateTypes: true, useServer: true });
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: '{}', captured });
        await withFakeDaemon(
          (method) => {
            if (method === 'ping') return 'pong';
            return { status: 'ok', changed: false, changes: [{ line: 4 }] };
          },
          async (_sock, seen) => {
            const result = await runDocscribe({ file, strategy: 'check', json: true });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.hasIssues, true);
            assert.strictEqual(result.exitCode, 1);
            const parsed = JSON.parse(result.stdout) as {
              files: { offenses: { location: { start_line: number } }[] }[];
            };
            assert.strictEqual(parsed.files[0].offenses[0].location.start_line, 4);
            const checkSeen = seen.filter((s) => s.method === 'check');
            assert.strictEqual(checkSeen.length, 1);
            assert.deepStrictEqual(checkSeen[0].params['cli_overrides'], {
              validate_types: true,
            });
            assert.strictEqual(captured.length, 0);
          },
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('runDocscribe check via server omits empty overrides', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const file = path.join(root, 'lib', 'a.rb');
        writeFile(root, path.join('lib', 'a.rb'), 'class A end\n');
        stubDoctorConfig({ useRbs: false, validateTypes: false, useServer: true });
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: '{}', captured });
        await withFakeDaemon(
          (method) => {
            if (method === 'ping') return 'pong';
            return { status: 'ok', changed: false, changes: [] };
          },
          async (_sock, seen) => {
            const result = await runDocscribe({ file, strategy: 'check', json: true });
            assert.strictEqual(result.success, true);
            const checkSeen = seen.filter((s) => s.method === 'check');
            assert.strictEqual(checkSeen.length, 1);
            assert.ok(!('cli_overrides' in checkSeen[0].params));
          },
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('capability gates incl Gemfile.lock mtime re-probe', () => {
    test('re-probes when Gemfile.lock changes, else serves cache', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const lock = path.join(root, 'Gemfile.lock');
        writeFile(root, 'Gemfile.lock', 'GEM\n');
        stubConfig({ commandPath: 'docscribe', useBundleExec: false, bundlePath: 'bundle' });
        let version: string | null = '1.5.1';
        const captured: CapturedCall[] = [];
        stubExec({ version: () => version, mainStdout: '{}', captured });
        const first = await ensureFreshCapabilities(root);
        assert.ok(first);
        assert.strictEqual(first.version, '1.5.1');
        assert.strictEqual(first.hasServerMode, true);
        assert.strictEqual(first.hasBatchMode, false);
        version = '1.6.2';
        const cached = await ensureFreshCapabilities(root);
        assert.strictEqual(cached?.version, '1.5.1');
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(lock, later, later);
        const fresh = await ensureFreshCapabilities(root);
        assert.ok(fresh);
        assert.strictEqual(fresh.version, '1.6.2');
        assert.strictEqual(fresh.hasBatchMode, true);
        version = '1.7.0';
        fs.rmSync(lock, { force: true });
        const pinned = await ensureFreshCapabilities(root);
        assert.strictEqual(pinned?.version, '1.6.2');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('Doctor rows', () => {
    test('without workspace: Ruby not found path plus settings block', async () => {
      const restoreFolders = setWorkspaceFolders(undefined);
      try {
        stubConfig({
          runOnSave: true,
          useBundleExec: false,
          useRbs: false,
          validateTypes: false,
          useServer: true,
          commandPath: 'custom-docscribe',
          ignorePatterns: ['gen/**'],
          foldComments: true,
          omitBoilerplate: true,
        });
        const captured: CapturedCall[] = [];
        stubExec({ version: null, mainStdout: '{}', captured });
        const report = await buildDoctorReport();
        assert.ok(report.includes('=== DocScribe Doctor ==='));
        assert.ok(report.includes('Ruby: Not found'));
        assert.ok(!report.includes('Project root:'));
        assert.ok(report.includes('Settings:'));
        assert.ok(report.includes('  runOnSave: true'));
        assert.ok(report.includes('  useBundleExec: false'));
        assert.ok(report.includes('  useRbs: false'));
        assert.ok(report.includes('  validateTypes: false'));
        assert.ok(report.includes('  useServer: true'));
        assert.ok(report.includes('  commandPath: custom-docscribe'));
        assert.ok(report.includes('  ignorePatterns: ["gen/**"]'));
        assert.ok(report.includes('  foldComments: true'));
        assert.ok(report.includes('  omitBoilerplate: true'));
      } finally {
        restoreFolders();
      }
    });

    test('full rows with heuristic RBS, server backend, socket alive', async () => {
      const root = makeRoot();
      const restoreFolders = fakeWorkspace(root);
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        writeFile(root, 'sig/app/user.rbs', 'class User end');
        stubDoctorConfig({ useRbs: true, validateTypes: true, useServer: true });
        const captured: CapturedCall[] = [];
        stubExec({ version: 'ruby 3.2.0 (test)', mainStdout: '{}', captured });
        const caps = parseCapabilities('1.6.2');
        assert.ok(caps);
        (sinon.stub(runnerReal, 'ensureFreshCapabilities') as unknown as sinon.SinonStub).resolves(
          caps,
        );
        const sock = path.join(root, 'daemon.sock');
        fs.writeFileSync(sock, '');
        fs.writeFileSync(`${sock}.pid`, `${process.pid}\n`);
        setSocketPathForTesting(sock);
        const savedLang = process.env.LANG;
        const savedLc = process.env.LC_ALL;
        process.env.LANG = 'en_US.UTF-8';
        process.env.LC_ALL = 'en_US.UTF-8';
        try {
          const report = await buildDoctorReport();
          assert.ok(report.includes('Ruby: ruby 3.2.0 (test)'));
          assert.ok(report.includes(`Project root: ${fs.realpathSync(root)}`));
          assert.ok(report.includes('DocScribe version: 1.6.2'));
          assert.ok(report.includes('  Server mode: Available'));
          assert.ok(report.includes('  Batch mode (check_batch): Available'));
          assert.ok(report.includes('  RBS collection: Available'));
          assert.ok(report.includes('  Exit code semantics: Available'));
          assert.ok(report.includes('  Backend: server'));
          assert.ok(!report.includes('fallback'));
          assert.ok(report.includes('  RBS: enabled (heuristic inference, no collection)'));
          assert.ok(report.includes('  Validate types: on'));
          assert.ok(report.includes('"version":"1.6.2"'));
          assert.ok(report.includes('"hasUpdateTypesRpc":true'));
          assert.ok(report.includes(`  Socket: ${sock} (exists: yes)`));
          assert.ok(report.includes(`  Daemon PID: ${process.pid} (alive: yes)`));
          assert.ok(report.includes('  Locale: LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8'));
          assert.ok(!report.includes('plugin will use'));
          assert.ok(report.includes('Settings:'));
        } finally {
          if (savedLang === undefined) delete process.env.LANG;
          else process.env.LANG = savedLang;
          if (savedLc === undefined) delete process.env.LC_ALL;
          else process.env.LC_ALL = savedLc;
          setSocketPathForTesting(null);
        }
      } finally {
        restoreFolders();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('disabled RBS bare string with CLI fallback backend', async () => {
      const root = makeRoot();
      const restoreFolders = fakeWorkspace(root);
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        stubDoctorConfig({ useRbs: false, validateTypes: true, useServer: true });
        const captured: CapturedCall[] = [];
        stubExec({ version: 'ruby 3.2.0 (test)', mainStdout: '{}', captured });
        const caps = parseCapabilities('1.4.9');
        assert.ok(caps);
        (sinon.stub(runnerReal, 'ensureFreshCapabilities') as unknown as sinon.SinonStub).resolves(
          caps,
        );
        setSocketPathForTesting(null);
        const report = await buildDoctorReport();
        assert.ok(report.includes('  Server mode: Not available (requires >=1.5.1)'));
        assert.ok(report.includes('  Batch mode (check_batch): Not available (requires >=1.5.2)'));
        assert.ok(report.includes('  Backend: CLI (fallback — gem <1.5.1)'));
        const rbsLine = report.split('\n').find((l) => l.startsWith('  RBS:'));
        assert.strictEqual(rbsLine, '  RBS: disabled');
        assert.ok(report.includes('  Validate types: off'));
        assert.ok(report.includes('  Socket: not determined (daemon not started yet)'));
        assert.ok(report.includes('  Daemon PID: unknown'));
      } finally {
        restoreFolders();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('collection RBS string with settings-disabled backend and missing pid', async () => {
      const root = makeRoot();
      const restoreFolders = fakeWorkspace(root);
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        writeFile(root, 'sig/app/user.rbs', 'class User end');
        writeFile(root, 'rbs_collection.lock.yaml', 'sources: []\n');
        stubDoctorConfig({ useRbs: true, validateTypes: false, useServer: false });
        const captured: CapturedCall[] = [];
        stubExec({ version: 'ruby 3.2.0 (test)', mainStdout: '{}', captured });
        const caps = parseCapabilities('1.6.2');
        assert.ok(caps);
        (sinon.stub(runnerReal, 'ensureFreshCapabilities') as unknown as sinon.SinonStub).resolves(
          caps,
        );
        const sock = path.join(root, 'daemon.sock');
        fs.writeFileSync(sock, '');
        setSocketPathForTesting(sock);
        try {
          const report = await buildDoctorReport();
          assert.ok(report.includes('  RBS: enabled (rbs_collection.lock.yaml found)'));
          assert.ok(report.includes('  Backend: CLI (disabled in settings)'));
          assert.ok(report.includes('  Validate types: off'));
          assert.ok(report.includes(`  Socket: ${sock} (exists: yes)`));
          assert.ok(report.includes('  Daemon PID: not found (.pid missing)'));
        } finally {
          setSocketPathForTesting(null);
        }
      } finally {
        restoreFolders();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('locale note when LANG unset', async () => {
      const root = makeRoot();
      const restoreFolders = fakeWorkspace(root);
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        stubDoctorConfig({ useRbs: false, validateTypes: false, useServer: true });
        const captured: CapturedCall[] = [];
        stubExec({ version: 'ruby 3.2.0 (test)', mainStdout: '{}', captured });
        const caps = parseCapabilities('1.6.2');
        assert.ok(caps);
        (sinon.stub(runnerReal, 'ensureFreshCapabilities') as unknown as sinon.SinonStub).resolves(
          caps,
        );
        const savedLang = process.env.LANG;
        const savedLc = process.env.LC_ALL;
        delete process.env.LANG;
        delete process.env.LC_ALL;
        try {
          const report = await buildDoctorReport();
          assert.ok(report.includes('  Locale: LANG=(unset) LC_ALL=(unset)'));
          assert.ok(report.includes('plugin will use en_US.UTF-8'));
        } finally {
          if (savedLang === undefined) delete process.env.LANG;
          else process.env.LANG = savedLang;
          if (savedLc === undefined) delete process.env.LC_ALL;
          else process.env.LC_ALL = savedLc;
        }
      } finally {
        restoreFolders();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('version undetected shows troubleshooting', async () => {
      const root = makeRoot();
      const restoreFolders = fakeWorkspace(root);
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        stubDoctorConfig({});
        const captured: CapturedCall[] = [];
        stubExec({ version: 'ruby 3.2.0 (test)', mainStdout: '{}', captured });
        (sinon.stub(runnerReal, 'ensureFreshCapabilities') as unknown as sinon.SinonStub).resolves(
          null,
        );
        const report = await buildDoctorReport();
        assert.ok(report.includes('DocScribe version: Not detected'));
        assert.ok(report.includes('Troubleshooting:'));
        assert.ok(report.includes('gem list docscribe'));
        assert.ok(report.includes('bundle install'));
        assert.ok(report.includes('Settings:'));
      } finally {
        restoreFolders();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('missing-rbs balloon', () => {
    test('exact text, once per session, appends gem to Gemfile', async () => {
      const root = makeRoot();
      const gemfile = path.join(root, 'Gemfile');
      fs.writeFileSync(gemfile, 'source "https://rubygems.org"\ngem "docscribe"\n');
      stubConfig({
        useRbs: true,
        useBundleExec: true,
        bundlePath: 'bundle',
        commandPath: 'docscribe',
        useServer: false,
      });
      const restoreFolders = fakeWorkspace(root);
      const restoreDocs = setWorkspaceProp('textDocuments', []);
      try {
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.4.9', mainStdout: '{}', captured });
        // NOTE: drive the exported check directly — never call real activate()
        // with a fake context here: activate() pushes the shared diagnostic
        // collection and output channel into subscriptions, and disposing them
        // would brick diagnostics/commands for every later suite.
        const warn = sinon.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub;
        warn.resolves('Add rbs to Gemfile');
        const info = sinon.stub(
          vscode.window,
          'showInformationMessage',
        ) as unknown as sinon.SinonStub;
        info.resolves(undefined);
        resetRbsBalloonForTesting();
        checkMissingRbsGem(root);
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        assert.strictEqual(warn.callCount, 1);
        assert.strictEqual(
          warn.firstCall.args[0],
          'DocScribe: RBS type inference is enabled but the `rbs` gem is missing.',
        );
        assert.strictEqual(warn.firstCall.args[1], 'Add rbs to Gemfile');
        assert.ok(fs.readFileSync(gemfile, 'utf8').includes('gem "rbs"'));
        assert.strictEqual(info.callCount, 1);
        assert.ok(String(info.firstCall.args[0]).includes('bundle install'));
        fs.writeFileSync(gemfile, 'source "https://rubygems.org"\ngem "docscribe"\n');
        warn.resetHistory();
        info.resetHistory();
        checkMissingRbsGem(root);
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        assert.strictEqual(warn.callCount, 0);
      } finally {
        restoreDocs();
        restoreFolders();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('capability gates (card 521, QA 2D.2–2D.4/2D.6)', () => {
    test('parse matrix across gem generations', () => {
      const old = parseCapabilities('1.4.0');
      assert.ok(old);
      assert.strictEqual(old.hasServerMode, false);
      const mid = parseCapabilities('1.5.1');
      assert.ok(mid);
      assert.strictEqual(mid.hasServerMode, true);
      assert.strictEqual(mid.hasBatchMode, false);
      assert.strictEqual(mid.hasValidateTypes, false);
      const late = parseCapabilities('1.6.0');
      assert.ok(late);
      assert.strictEqual(late.hasBatchMode, true);
      assert.strictEqual(late.hasValidateTypes, false);
      assert.strictEqual(late.hasUpdateTypesRpc, false);
      const cur = parseCapabilities('1.6.2');
      assert.ok(cur);
      assert.strictEqual(cur.hasValidateTypes, true);
      assert.strictEqual(cur.hasUpdateTypesRpc, true);
    });

    test('serverModeWarning: old gem, ruby4 batch, missing validate-types, clean', () => {
      assert.ok(
        String(serverModeWarning(parseCapabilities('1.4.0'), '')).includes('requires >=1.5.1'),
      );
      assert.ok(
        String(serverModeWarning(parseCapabilities('1.5.1'), 'ruby 4.0.6')).includes('check_batch'),
      );
      assert.ok(
        String(serverModeWarning(parseCapabilities('1.5.1'), 'ruby 3.4.5')).includes(
          'requires >=1.6.2',
        ),
      );
      assert.ok(
        String(serverModeWarning(parseCapabilities('1.6.0'), '')).includes('requires >=1.6.2'),
      );
      assert.strictEqual(serverModeWarning(parseCapabilities('1.6.2'), ''), null);
      assert.strictEqual(serverModeWarning(null, ''), null);
    });

    test('ensureFreshCapabilities re-probes when Gemfile.lock changes (2D.6)', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'gem "docscribe"\n');
        writeFile(root, 'Gemfile.lock', 'v1');
        let version: string | null = '1.6.2';
        stubExec({ version: () => version, mainStdout: '{}', captured: [] });
        const first = await ensureFreshCapabilities(root);
        assert.strictEqual(first?.version, '1.6.2');
        version = '1.6.3';
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(path.join(root, 'Gemfile.lock'), later, later);
        const fresh = await ensureFreshCapabilities(root);
        assert.strictEqual(fresh?.version, '1.6.3');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
