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
      assert.strictEqual(result.output, 'output text');
    });

    test('resolves with failure on exec error', async () => {
      const mockExec = sinon.stub().yields(new Error('fail'), '', 'stderr text');
      const result = await execCommand('docscribe', ['--check', 'file.rb'], '/tmp', mockExec);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.output, '\nstderr text');
    });

    test('merges stderr into output', async () => {
      const mockExec = sinon.stub().yields(null, 'stdout', 'stderr');
      const result = await execCommand('bundle', ['exec', 'docscribe'], '/tmp', mockExec);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.output, 'stdout\nstderr');
    });
  });
});
