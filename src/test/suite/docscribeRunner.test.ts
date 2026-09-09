import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import {
  findProjectRoot,
  execCommand,
  parseCapabilities,
  clearCachedCapabilitiesForTesting,
  clearServerModeWarningForTesting,
  collectWorkspaceFiles,
  chunkArray,
} from '../../docscribeRunner';

const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'suite', 'fixtures');

suite('docscribeRunner', () => {
  let tmpDir: string;

  suite('findProjectRoot', () => {
    setup(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docscribe-test-'));
    });

    teardown(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('returns directory containing Gemfile', () => {
      fs.mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });
      fs.copyFileSync(path.join(fixturesDir, 'Gemfile'), path.join(tmpDir, 'Gemfile'));
      const result = findProjectRoot(path.join(tmpDir, 'subdir'));
      assert.strictEqual(result, fs.realpathSync(tmpDir));
    });

    test('returns null when no Gemfile found', () => {
      const result = findProjectRoot(tmpDir);
      assert.strictEqual(result, null);
    });

    test('walks up directories to find Gemfile', () => {
      const subdir = path.join(tmpDir, 'a', 'b', 'c');
      fs.mkdirSync(subdir, { recursive: true });
      fs.copyFileSync(path.join(fixturesDir, 'Gemfile'), path.join(tmpDir, 'Gemfile'));
      const result = findProjectRoot(subdir);
      assert.strictEqual(result, fs.realpathSync(tmpDir));
    });

    test('returns null for nested dirs without Gemfile', () => {
      const subdir = path.join(tmpDir, 'a', 'b', 'c');
      fs.mkdirSync(subdir, { recursive: true });
      const result = findProjectRoot(subdir);
      assert.strictEqual(result, null);
    });

    test('stops at filesystem root', () => {
      const result = findProjectRoot('/');
      assert.strictEqual(result, null);
    });

    test('detects Gemfile in the fixtures directory', () => {
      const result = findProjectRoot(fixturesDir);
      assert.strictEqual(result, fs.realpathSync(fixturesDir));
    });
  });

  suite('runDocscribe', () => {
    test('returns error when no Gemfile found', async () => {
      const noGemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docscribe-nogem-'));
      const noGemFile = path.join(noGemDir, 'test.rb');
      fs.writeFileSync(noGemFile, '');
      const { runDocscribe } = await import('../../docscribeRunner');
      const result = await runDocscribe({ file: noGemFile, strategy: 'check' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.output, 'No Gemfile found in project tree');
      fs.rmSync(noGemDir, { recursive: true, force: true });
    });
  });

  suite('execCommand', () => {
    test('resolves with success on clean exec', async () => {
      const mockExec = sinon.stub().yields(null, 'output text', '');
      const result = await execCommand(
        'bundle',
        ['exec', 'docscribe', 'file.rb'],
        '/tmp',
        mockExec,
      );
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.hasIssues, false);
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, 'output text');
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(result.output, 'output text');
    });

    test('resolves with success but hasIssues on exit code 1', async () => {
      const err = Object.assign(new Error('issues found'), { code: 1 });
      const mockExec = sinon.stub().yields(err, 'json output', 'F');
      const result = await execCommand(
        'docscribe',
        ['--format', 'json', 'file.rb'],
        '/tmp',
        mockExec,
      );
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.hasIssues, true);
      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.stdout, 'json output');
    });

    test('resolves with failure on exec error (exit code 2+)', async () => {
      const err = Object.assign(new Error('fail'), { code: 2 });
      const mockExec = sinon.stub().yields(err, '', 'stderr text');
      const result = await execCommand('docscribe', ['file.rb'], '/tmp', mockExec);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.hasIssues, false);
      assert.strictEqual(result.exitCode, 2);
      assert.strictEqual(result.stderr, 'stderr text');
    });

    test('merges stderr into output', async () => {
      const mockExec = sinon.stub().yields(null, 'stdout', 'stderr');
      const result = await execCommand('bundle', ['exec', 'docscribe'], '/tmp', mockExec);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.stdout, 'stdout');
      assert.strictEqual(result.stderr, 'stderr');
      assert.strictEqual(result.output, 'stdout\nstderr');
    });
  });

  suite('parseCapabilities', () => {
    teardown(() => {
      clearCachedCapabilitiesForTesting();
      clearServerModeWarningForTesting();
    });

    test('returns null for empty string', () => {
      assert.strictEqual(parseCapabilities(''), null);
    });

    test('returns null for non-version string', () => {
      assert.strictEqual(parseCapabilities('not-a-version'), null);
    });

    test('parses 1.4.9 — no server, no batch', () => {
      const caps = parseCapabilities('1.4.9');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.4.9');
      assert.strictEqual(caps.hasServerMode, false);
      assert.strictEqual(caps.hasBatchMode, false);
      assert.strictEqual(caps.hasRbsCollection, true);
      assert.strictEqual(caps.hasExitCodeSemantics, false);
    });

    test('parses 1.5.0 — no server', () => {
      const caps = parseCapabilities('1.5.0');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, false);
      assert.strictEqual(caps.hasBatchMode, false);
      assert.strictEqual(caps.hasExitCodeSemantics, true);
    });

    test('parses 1.5.1 — server yes, batch no', () => {
      const caps = parseCapabilities('1.5.1');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.5.1');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, false);
    });

    test('parses 1.5.2 — server and batch', () => {
      const caps = parseCapabilities('1.5.2');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
    });

    test('parses 1.6.1 — server and batch, no 1.6.2 features', () => {
      const caps = parseCapabilities('1.6.1');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
      assert.strictEqual(caps.hasValidateTypes, false);
      assert.strictEqual(caps.hasUpdateTypesRpc, false);
    });

    test('parses 1.6.2 — validate-types and update_types RPC', () => {
      const caps = parseCapabilities('1.6.2');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.6.2');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
      assert.strictEqual(caps.hasValidateTypes, true);
      assert.strictEqual(caps.hasUpdateTypesRpc, true);
    });

    test('parses 2.0.0 — server and batch', () => {
      const caps = parseCapabilities('2.0.0');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
    });

    test('handles version with surrounding text', () => {
      const caps = parseCapabilities('docscribe 1.6.1');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.6.1');
      assert.strictEqual(caps.hasServerMode, true);
    });

    test('handles version with newline', () => {
      const caps = parseCapabilities('1.5.1\n');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.5.1');
      assert.strictEqual(caps.hasServerMode, true);
    });
  });

  suite('collectWorkspaceFiles', () => {
    test('finds rb and rake files and excludes node_modules', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-collect-'));
      try {
        fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(root, '.git'), { recursive: true });
        fs.writeFileSync(path.join(root, 'lib', 'a.rb'), '');
        fs.writeFileSync(path.join(root, 'lib', 'b.rake'), '');
        fs.writeFileSync(path.join(root, 'Rakefile'), '');
        fs.writeFileSync(path.join(root, 'node_modules', 'c.rb'), '');
        fs.writeFileSync(path.join(root, '.git', 'd.rb'), '');
        fs.writeFileSync(path.join(root, 'README.md'), '');
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(files.includes(path.join(root, 'lib', 'b.rake')));
        assert.ok(files.includes(path.join(root, 'Rakefile')));
        assert.ok(!files.includes(path.join(root, 'node_modules', 'c.rb')));
        assert.ok(!files.includes(path.join(root, '.git', 'd.rb')));
        assert.ok(!files.includes(path.join(root, 'README.md')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns sorted list', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-collect-'));
      try {
        fs.writeFileSync(path.join(root, 'z.rb'), '');
        fs.writeFileSync(path.join(root, 'a.rb'), '');
        const files = collectWorkspaceFiles(root);
        const sorted = [...files].sort();
        assert.deepStrictEqual(files, sorted);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('chunkArray', () => {
    test('splits array into chunks', () => {
      assert.deepStrictEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    });

    test('returns single chunk if size larger than array', () => {
      assert.deepStrictEqual(chunkArray([1, 2], 10), [[1, 2]]);
    });

    test('handles empty array', () => {
      assert.deepStrictEqual(chunkArray([], 32), []);
    });
  });
});
