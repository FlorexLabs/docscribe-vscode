import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { applyFix } from '../../codeActionProvider';
import { checkDocument, parseJsonOutput } from '../../diagnosticProvider';
import {
  clearCachedCapabilitiesForTesting,
  clearServerModeWarningForTesting,
  collectWorkspaceFiles,
  runDocscribe,
} from '../../docscribeRunner';
import clientReal = require('../../docscribeClient'); // eslint-disable-line @typescript-eslint/no-require-imports -- shared exports object for stubbing
import runnerReal = require('../../docscribeRunner'); // eslint-disable-line @typescript-eslint/no-require-imports -- shared exports object for stubbing
import childProcess = require('child_process'); // eslint-disable-line @typescript-eslint/no-require-imports -- shared exports object for stubbing
import * as pkg from '../../../package.json';

const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'suite', 'fixtures');

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ws-'));
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

interface CapturedCall {
  cmd: string;
  args: string[];
}

function stubExec(opts: {
  version: string | null;
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
      if (opts.version === null) {
        cb(Object.assign(new Error('command failed'), { code: 2 }), '', 'error');
      } else {
        cb(null, `${opts.version}\n`, '');
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

function emptyCheckJson(): string {
  return JSON.stringify({
    files: [],
    summary: { offense_count: 0, target_file_count: 1, inspected_file_count: 1, error_count: 0 },
  });
}

suite('workspaceFilters (QA 2G)', () => {
  setup(() => {
    clearCachedCapabilitiesForTesting();
    clearServerModeWarningForTesting();
  });

  teardown(() => {
    sinon.restore();
    clearCachedCapabilitiesForTesting();
    clearServerModeWarningForTesting();
  });

  suite('collectWorkspaceFiles honors filter.files', () => {
    test('exclude wins over include', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'lib/a.rb', '');
        writeFile(root, 'lib/internal/b.rb', '');
        writeFile(root, 'app/c.rb', '');
        fs.copyFileSync(
          path.join(fixturesDir, 'docscribe-filter-sample.yml'),
          path.join(root, 'docscribe.yml'),
        );
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(!files.includes(path.join(root, 'lib', 'internal', 'b.rb')));
        assert.ok(!files.includes(path.join(root, 'app', 'c.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('empty include means all (only exclude applies)', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'lib/a.rb', '');
        writeFile(root, 'app/c.rb', '');
        writeFile(root, 'spec/a_spec.rb', '');
        writeFile(root, 'docscribe.yml', 'filter:\n  files:\n    exclude:\n      - spec/\n');
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(files.includes(path.join(root, 'app', 'c.rb')));
        assert.ok(!files.includes(path.join(root, 'spec', 'a_spec.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('falls back to spec exclude without yml', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'lib/a.rb', '');
        writeFile(root, 'spec/a_spec.rb', '');
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(!files.includes(path.join(root, 'spec', 'a_spec.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('falls back to spec exclude when yml has no filter section', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'lib/a.rb', '');
        writeFile(root, 'spec/a_spec.rb', '');
        writeFile(root, 'docscribe.yml', 'other:\n  x: 1\n');
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(!files.includes(path.join(root, 'spec', 'a_spec.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('include narrows the workspace', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'lib/a.rb', '');
        writeFile(root, 'app/c.rb', '');
        writeFile(root, 'docscribe.yml', 'filter:\n  files:\n    include:\n      - lib/\n');
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(!files.includes(path.join(root, 'app', 'c.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('root .gitignore', () => {
    test('honors ignores with ! negations', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'artifacts/a.rb', '');
        writeFile(root, 'artifacts/keep.rb', '');
        writeFile(root, 'top.rb', '');
        writeFile(root, '.gitignore', 'artifacts/\n!artifacts/keep.rb\n');
        const files = collectWorkspaceFiles(root);
        assert.ok(!files.includes(path.join(root, 'artifacts', 'a.rb')));
        assert.ok(files.includes(path.join(root, 'artifacts', 'keep.rb')));
        assert.ok(files.includes(path.join(root, 'top.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('skips comments and blank lines', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'artifacts/a.rb', '');
        writeFile(root, 'top.rb', '');
        writeFile(root, '.gitignore', '# generated output\n\nartifacts/\n');
        const files = collectWorkspaceFiles(root);
        assert.ok(!files.includes(path.join(root, 'artifacts', 'a.rb')));
        assert.ok(files.includes(path.join(root, 'top.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('excludeDirs safety net', () => {
    test('skips every safety-net dir at any depth', () => {
      const root = makeRoot();
      try {
        const dirs = [
          '.git',
          'node_modules',
          'vendor',
          '.vscode-test',
          'out',
          'dist',
          'build',
          'tmp',
          '.tmp-e2e',
          '.idea',
          '.vscode',
          'coverage',
          'log',
          '.ruby-lsp',
        ];
        for (const dir of dirs) writeFile(root, `${dir}/evil.rb`, '');
        writeFile(root, 'lib/vendor/nested.rb', '');
        writeFile(root, 'top.rb', '');
        const files = collectWorkspaceFiles(root);
        assert.deepStrictEqual(files, [path.join(root, 'top.rb')]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('skips hidden dirs', () => {
      const root = makeRoot();
      try {
        writeFile(root, '.hidden/secret.rb', '');
        writeFile(root, 'top.rb', '');
        const files = collectWorkspaceFiles(root);
        assert.ok(!files.includes(path.join(root, '.hidden', 'secret.rb')));
        assert.ok(files.includes(path.join(root, 'top.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('ruby file kinds', () => {
    test('collects .rb, .rake and Rakefile, sorted, skips the rest', () => {
      const root = makeRoot();
      try {
        writeFile(root, 'z.rb', '');
        writeFile(root, 'a.rb', '');
        fs.copyFileSync(path.join(fixturesDir, 'tasks.rake'), path.join(root, 'tasks.rake'));
        fs.copyFileSync(path.join(fixturesDir, 'Rakefile'), path.join(root, 'Rakefile'));
        writeFile(root, 'README.md', '');
        writeFile(root, 'notes.txt', '');
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'a.rb')));
        assert.ok(files.includes(path.join(root, 'z.rb')));
        assert.ok(files.includes(path.join(root, 'tasks.rake')));
        assert.ok(files.includes(path.join(root, 'Rakefile')));
        assert.ok(!files.includes(path.join(root, 'README.md')));
        assert.deepStrictEqual(files, [...files].sort());
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('parseJsonOutput treats Rakefile like .rb', () => {
      const output = JSON.stringify({
        metadata: { docscribe_version: '1.5.0', ruby_version: '3.2.0' },
        files: [
          {
            path: 'Rakefile',
            offenses: [
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingParam',
                message: 'missing @param',
                corrected: false,
                correctable: true,
                location: { start_line: 3, start_column: 1, last_line: 3, last_column: 1 },
              },
            ],
          },
        ],
        summary: {
          offense_count: 1,
          target_file_count: 1,
          inspected_file_count: 1,
          error_count: 0,
        },
      });
      const result = parseJsonOutput(output);
      assert.strictEqual(result.size, 1);
      assert.strictEqual(result.get('Rakefile')?.issues[0].line, 3);
    });
  });

  suite('ignorePatterns gate (diagnostics)', () => {
    function fakeDoc(filePath: string, languageId: string): vscode.TextDocument {
      return { uri: vscode.Uri.file(filePath), languageId } as unknown as vscode.TextDocument;
    }

    test('ignored file returns null without running docscribe', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const file = path.join(root, 'generated', 'a.rb');
        writeFile(root, path.join('generated', 'a.rb'), 'class A end\n');
        stubConfig({ ignorePatterns: ['**/generated/**'] });
        const runStub = (
          sinon.stub(runnerReal, 'runDocscribe') as unknown as sinon.SinonStub
        ).resolves({
          success: true,
          hasIssues: false,
          exitCode: 0,
          stdout: emptyCheckJson(),
          stderr: '',
          output: '',
        });
        const result = await checkDocument(fakeDoc(file, 'ruby'));
        assert.strictEqual(result, null);
        assert.strictEqual(runStub.callCount, 0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('non-matching file proceeds to docscribe', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const file = path.join(root, 'lib', 'a.rb');
        writeFile(root, path.join('lib', 'a.rb'), 'class A end\n');
        stubConfig({ ignorePatterns: ['**/generated/**'] });
        const runStub = (
          sinon.stub(runnerReal, 'runDocscribe') as unknown as sinon.SinonStub
        ).resolves({
          success: true,
          hasIssues: false,
          exitCode: 0,
          stdout: emptyCheckJson(),
          stderr: '',
          output: '',
        });
        const result = await checkDocument(fakeDoc(file, 'ruby'));
        assert.ok(result);
        assert.strictEqual(runStub.callCount, 1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('empty ignorePatterns never ignores', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const file = path.join(root, 'generated', 'a.rb');
        writeFile(root, path.join('generated', 'a.rb'), 'class A end\n');
        stubConfig({ ignorePatterns: [] });
        const runStub = (
          sinon.stub(runnerReal, 'runDocscribe') as unknown as sinon.SinonStub
        ).resolves({
          success: true,
          hasIssues: false,
          exitCode: 0,
          stdout: emptyCheckJson(),
          stderr: '',
          output: '',
        });
        const result = await checkDocument(fakeDoc(file, 'ruby'));
        assert.ok(result);
        assert.strictEqual(runStub.callCount, 1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('.rake treated as ruby', () => {
    function fakeDoc(filePath: string, languageId: string): vscode.TextDocument {
      return { uri: vscode.Uri.file(filePath), languageId } as unknown as vscode.TextDocument;
    }

    test('checkDocument accepts rake languageId', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const file = path.join(root, 'tasks.rake');
        writeFile(root, 'tasks.rake', 'task :x do\nend\n');
        stubConfig({ ignorePatterns: [] });
        const runStub = (
          sinon.stub(runnerReal, 'runDocscribe') as unknown as sinon.SinonStub
        ).resolves({
          success: true,
          hasIssues: false,
          exitCode: 0,
          stdout: emptyCheckJson(),
          stderr: '',
          output: '',
        });
        const result = await checkDocument(fakeDoc(file, 'rake'));
        assert.ok(result);
        assert.strictEqual(runStub.callCount, 1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('checkDocument rejects non-ruby languageId', async () => {
      const root = makeRoot();
      try {
        writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
        const file = path.join(root, 'app.js');
        writeFile(root, 'app.js', 'console.log(1);\n');
        stubConfig({ ignorePatterns: [] });
        const runStub = (
          sinon.stub(runnerReal, 'runDocscribe') as unknown as sinon.SinonStub
        ).resolves({
          success: true,
          hasIssues: false,
          exitCode: 0,
          stdout: emptyCheckJson(),
          stderr: '',
          output: '',
        });
        const result = await checkDocument(fakeDoc(file, 'plaintext'));
        assert.strictEqual(result, null);
        assert.strictEqual(runStub.callCount, 0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('extension wires ruby + rake providers and activation', () => {
      const extSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', '..', 'src', 'extension.ts'),
        'utf8',
      );
      assert.ok(extSrc.includes("{ language: 'ruby' }"));
      assert.ok(extSrc.includes("{ pattern: '**/*.rake' }"));
      assert.ok(extSrc.includes("['ruby', 'rake'].includes("));
      const activationEvents = (pkg as unknown as { activationEvents: string[] }).activationEvents;
      assert.ok(activationEvents.includes('onLanguage:ruby'));
      assert.ok(activationEvents.includes('onLanguage:rake'));
      assert.ok(activationEvents.includes('workspaceContains:**/Gemfile'));
    });
  });

  suite('settings defaults (QA 2I)', () => {
    test('all 11 settings ship documented defaults', () => {
      const props = (
        pkg as unknown as {
          contributes: {
            configuration: { properties: Record<string, { type: string; default: unknown }> };
          };
        }
      ).contributes.configuration.properties;
      const expected: Record<string, { type: string; default: unknown }> = {
        'docscribe.commandPath': { type: 'string', default: 'docscribe' },
        'docscribe.useBundleExec': { type: 'boolean', default: true },
        'docscribe.runOnSave': { type: 'boolean', default: true },
        'docscribe.useRbs': { type: 'boolean', default: true },
        'docscribe.validateTypes': { type: 'boolean', default: true },
        'docscribe.ignorePatterns': { type: 'array', default: [] },
        'docscribe.foldComments': { type: 'boolean', default: false },
        'docscribe.omitBoilerplate': { type: 'boolean', default: false },
        'docscribe.rubyPath': { type: 'string', default: 'ruby' },
        'docscribe.bundlePath': { type: 'string', default: 'bundle' },
        'docscribe.useServer': { type: 'boolean', default: true },
      };
      assert.strictEqual(Object.keys(props).length, 11);
      for (const [key, want] of Object.entries(expected)) {
        assert.ok(props[key], `missing setting ${key}`);
        assert.strictEqual(props[key].type, want.type, `type of ${key}`);
        assert.deepStrictEqual(props[key].default, want.default, `default of ${key}`);
      }
    });
  });

  suite('omitBoilerplate passes -B', () => {
    function makeProject(): { root: string; file: string } {
      const root = makeRoot();
      writeFile(root, 'Gemfile', 'source "https://rubygems.org"\n');
      const file = path.join(root, 'lib', 'a.rb');
      writeFile(root, path.join('lib', 'a.rb'), 'class A end\n');
      return { root, file };
    }

    function checkConfig(omitBoilerplate: boolean): void {
      stubConfig({
        commandPath: 'docscribe',
        useBundleExec: false,
        bundlePath: 'bundle',
        useServer: false,
        useRbs: false,
        validateTypes: false,
        omitBoilerplate,
        rubyPath: 'ruby',
      });
    }

    test('check path adds -B when enabled (exact argv)', async () => {
      const { root, file } = makeProject();
      try {
        checkConfig(true);
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: emptyCheckJson(), captured });
        const result = await runDocscribe({ file, strategy: 'check', json: true });
        assert.strictEqual(result.success, true);
        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0].args, [
          '--format',
          'json',
          '--no-validate-types',
          '-B',
          file,
        ]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('check path omits -B by default', async () => {
      const { root, file } = makeProject();
      try {
        checkConfig(false);
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: emptyCheckJson(), captured });
        await runDocscribe({ file, strategy: 'check', json: true });
        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0].args, ['--format', 'json', '--no-validate-types', file]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('fix path adds -B in safe mode when enabled', async () => {
      const { root, file } = makeProject();
      try {
        stubConfig({
          commandPath: 'docscribe',
          useBundleExec: false,
          bundlePath: 'bundle',
          useServer: true,
          useRbs: false,
          validateTypes: true,
          omitBoilerplate: true,
          rubyPath: 'ruby',
        });
        (sinon.stub(clientReal, 'ensureServerRunning') as unknown as sinon.SinonStub).resolves(
          false,
        );
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: 'fixed', captured });
        const openStub = sinon.stub(
          vscode.workspace,
          'openTextDocument',
        ) as unknown as sinon.SinonStub;
        openStub.resolves({
          getText: (): string => 'class A end\n',
          lineCount: 1,
          lineAt: (): { text: string } => ({ text: 'class A end' }),
        });
        const editStub = sinon.stub(vscode.workspace, 'applyEdit') as unknown as sinon.SinonStub;
        editStub.resolves(true);
        const statusStub = sinon.stub(
          vscode.window,
          'setStatusBarMessage',
        ) as unknown as sinon.SinonStub;
        statusStub.returns({
          dispose(): void {
            /* noop */
          },
        });
        const errStub = sinon.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
        await applyFix(vscode.Uri.file(file), undefined, 'safe');
        assert.strictEqual(errStub.callCount, 0);
        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0].args, ['-a', '-B', '--stdin']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('fix path omits -B when disabled', async () => {
      const { root, file } = makeProject();
      try {
        stubConfig({
          commandPath: 'docscribe',
          useBundleExec: false,
          bundlePath: 'bundle',
          useServer: true,
          useRbs: false,
          validateTypes: true,
          omitBoilerplate: false,
          rubyPath: 'ruby',
        });
        (sinon.stub(clientReal, 'ensureServerRunning') as unknown as sinon.SinonStub).resolves(
          false,
        );
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: 'fixed', captured });
        const openStub = sinon.stub(
          vscode.workspace,
          'openTextDocument',
        ) as unknown as sinon.SinonStub;
        openStub.resolves({
          getText: (): string => 'class A end\n',
          lineCount: 1,
          lineAt: (): { text: string } => ({ text: 'class A end' }),
        });
        const editStub = sinon.stub(vscode.workspace, 'applyEdit') as unknown as sinon.SinonStub;
        editStub.resolves(true);
        const statusStub = sinon.stub(
          vscode.window,
          'setStatusBarMessage',
        ) as unknown as sinon.SinonStub;
        statusStub.returns({
          dispose(): void {
            /* noop */
          },
        });
        await applyFix(vscode.Uri.file(file), undefined, 'safe');
        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0].args, ['-a', '--stdin']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('fix path adds -B in aggressive mode when enabled', async () => {
      const { root, file } = makeProject();
      try {
        stubConfig({
          commandPath: 'docscribe',
          useBundleExec: false,
          bundlePath: 'bundle',
          useServer: false,
          useRbs: false,
          validateTypes: true,
          omitBoilerplate: true,
          rubyPath: 'ruby',
        });
        const captured: CapturedCall[] = [];
        stubExec({ version: '1.6.2', mainStdout: 'fixed', captured });
        const openStub = sinon.stub(
          vscode.workspace,
          'openTextDocument',
        ) as unknown as sinon.SinonStub;
        openStub.resolves({
          getText: (): string => 'class A end\n',
          lineCount: 1,
          lineAt: (): { text: string } => ({ text: 'class A end' }),
        });
        const editStub = sinon.stub(vscode.workspace, 'applyEdit') as unknown as sinon.SinonStub;
        editStub.resolves(true);
        const statusStub = sinon.stub(
          vscode.window,
          'setStatusBarMessage',
        ) as unknown as sinon.SinonStub;
        statusStub.returns({
          dispose(): void {
            /* noop */
          },
        });
        await applyFix(vscode.Uri.file(file), undefined, 'aggressive');
        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0].args, ['-A', '-k', '-B', '--stdin']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
