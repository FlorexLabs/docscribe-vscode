import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import { findProjectRoot, execCommand } from '../../docscribeRunner';

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
      fs.writeFileSync(path.join(tmpDir, 'Gemfile'), '');
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
      fs.writeFileSync(path.join(tmpDir, 'Gemfile'), '');
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
});
