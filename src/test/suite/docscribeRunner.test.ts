import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { findProjectRoot, runDocscribe } from '../../docscribeRunner';

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
      fs.writeFileSync(path.join(tmpDir, 'Gemfile'), '');
      const result = findProjectRoot(path.join(tmpDir, 'subdir'));
      assert.strictEqual(result, tmpDir);
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
      assert.strictEqual(result, tmpDir);
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
    let execFileStub: sinon.SinonStub;
    let testFile: string;

    setup(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docscribe-test-'));
      fs.writeFileSync(path.join(tmpDir, 'Gemfile'), '');
      testFile = path.join(tmpDir, 'test.rb');
      fs.writeFileSync(testFile, 'class Foo; end');

      execFileStub = sinon.stub(cp, 'execFile');
    });

    teardown(() => {
      sinon.restore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('runs bundle exec docscribe with explain flags', async () => {
      const configStub = sinon.stub(vscode.workspace, 'getConfiguration');
      configStub.returns({
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'useBundleExec') return true;
          if (key === 'commandPath') return 'docscribe';
          return defaultValue;
        },
      } as unknown as vscode.WorkspaceConfiguration);

      execFileStub.yields(null, 'docscribed output', '');

      const result = await runDocscribe({ file: testFile, strategy: 'check', explain: true });

      assert.ok(result.success);
      assert.strictEqual(result.output, 'docscribed output');
      assert.ok(execFileStub.calledOnce);
      assert.strictEqual(execFileStub.firstCall.args[0], 'bundle');
      const cmdArgs = execFileStub.firstCall.args[1];
      assert.ok(cmdArgs.includes('exec'));
      assert.ok(cmdArgs.includes('docscribe'));
      assert.ok(cmdArgs.includes('--explain'));
      assert.ok(cmdArgs.includes('--verbose'));
    });

    test('uses global docscribe when useBundleExec is false', async () => {
      const configStub = sinon.stub(vscode.workspace, 'getConfiguration');
      configStub.returns({
        get: (key: string) => {
          if (key === 'useBundleExec') return false;
          if (key === 'commandPath') return 'docscribe';
          return undefined;
        },
      } as unknown as vscode.WorkspaceConfiguration);

      execFileStub.yields(null, 'output', '');

      await runDocscribe({ file: testFile, strategy: 'check' });

      assert.strictEqual(execFileStub.firstCall.args[0], 'docscribe');
    });

    test('handles command failure', async () => {
      const configStub = sinon.stub(vscode.workspace, 'getConfiguration');
      configStub.returns({
        get: () => true,
      } as unknown as vscode.WorkspaceConfiguration);

      execFileStub.yields(new Error('command failed'), '', 'error output');

      const result = await runDocscribe({ file: testFile, strategy: 'check' });

      assert.strictEqual(result.success, false);
      assert.ok(result.output.length > 0);
    });

    test('returns error when no Gemfile found', async () => {
      const noGemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docscribe-nogem-'));
      const noGemFile = path.join(noGemDir, 'test.rb');
      fs.writeFileSync(noGemFile, '');

      const configStub = sinon.stub(vscode.workspace, 'getConfiguration');
      configStub.returns({
        get: () => true,
      } as unknown as vscode.WorkspaceConfiguration);

      const result = await runDocscribe({ file: noGemFile, strategy: 'check' });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.output, 'No Gemfile found in project tree');
      assert.ok(execFileStub.notCalled);

      fs.rmSync(noGemDir, { recursive: true, force: true });
    });
  });
});
