import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as runner from '../../docscribeRunner';
import type { RunOptions, RunResult } from '../../docscribeRunner';
import { checkDocument, createDiagnosticProvider } from '../../diagnosticProvider';
import { updateStatusBar, showResult, getStatusBarTextForTesting } from '../../extension';

const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'suite', 'fixtures');
const fixture481 = path.join(fixturesDir, 'qa481-undocumented.rb');

const COP = 'DocScribe/MissingDocumentation';
const MESSAGE = 'Missing YARD documentation for `render`';
// 1-indexed `def render` line inside qa481-undocumented.rb.
const METHOD_LINE = 2;

function okResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    success: true,
    hasIssues: false,
    cancelled: false,
    exitCode: 0,
    stdout: '',
    stderr: '',
    output: '',
    ...overrides,
  };
}

function checkJsonFor(targetFile: string): string {
  const root = runner.findProjectRoot(targetFile) ?? fixturesDir;
  const rel = path.relative(root, targetFile);
  return JSON.stringify({
    metadata: { docscribe_version: '9.9.9', ruby_version: '3.2.0' },
    files: [
      {
        path: rel,
        offenses: [
          {
            severity: 'convention',
            cop_name: COP,
            message: MESSAGE,
            corrected: false,
            correctable: true,
            location: {
              start_line: METHOD_LINE,
              start_column: 1,
              last_line: METHOD_LINE,
              last_column: 1,
            },
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
}

/** Stubbed `runDocscribe`: check → offense JSON, workspace/fix → canned result. */
function stubRunner(): sinon.SinonStub {
  return sinon.stub(runner, 'runDocscribe').callsFake(async (options: RunOptions) => {
    if (options.workspace) {
      return okResult({ stdout: '{"files":[]}', output: '{"files":[]}' });
    }
    const target =
      options.file ?? vscode.window.activeTextEditor?.document.uri.fsPath ?? fixture481;
    return okResult({
      hasIssues: true,
      exitCode: 1,
      stdout: checkJsonFor(target),
      output: checkJsonFor(target),
    });
  });
}

async function waitForDiag(uri: vscode.Uri, timeoutMs = 15000): Promise<vscode.Diagnostic[]> {
  const start = Date.now();
  let diags = vscode.languages.getDiagnostics(uri);
  while (diags.length === 0 && Date.now() - start <= timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    diags = vscode.languages.getDiagnostics(uri);
  }
  if (diags.length === 0) {
    throw new Error('timed out waiting for docscribe diagnostics');
  }
  return diags;
}

function assertMissingRender(diags: vscode.Diagnostic[]): void {
  const found = diags.find((d) => d.code === COP);
  assert.ok(found, `expected ${COP}, got: ${JSON.stringify(diags.map((d) => d.code))}`);
  assert.ok(found.message.includes('render'), `message should name method: ${found.message}`);
  assert.ok(found.message.includes('Missing'), `message text: ${found.message}`);
  assert.strictEqual(found.range.start.line, METHOD_LINE - 1);
  assert.strictEqual(found.range.end.line, METHOD_LINE - 1);
  assert.strictEqual(found.severity, vscode.DiagnosticSeverity.Warning);
  assert.strictEqual(found.source, 'docscribe');
  assert.strictEqual(found.code, COP);
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

suite('commands + auto-diagnostics (QA 2A/2B)', function () {
  this.timeout(60000);

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('unurgunite.docscribe-vscode');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  suiteTeardown(async () => {
    await closeAllEditors();
  });

  suite('auto-check on open', () => {
    let runStub: sinon.SinonStub | undefined;
    const scratches: string[] = [];

    teardown(async () => {
      runStub?.restore();
      runStub = undefined;
      await closeAllEditors();
      for (const file of scratches.splice(0)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore
        }
      }
    });

    test('opening a fixture .rb runs auto-check and reports the method line', async () => {
      runStub = stubRunner();
      const seen: RunResult[] = [];
      // NOTE: intentionally never disposed — the provider wraps only
      // listeners, but other suites must not depend on test-run order
      // for shared extension state.
      createDiagnosticProvider((result) => {
        seen.push(result);
      });
      const scratch = path.join(fixturesDir, `qa481-open-${Date.now()}.rb`);
      fs.copyFileSync(fixture481, scratch);
      scratches.push(scratch);
      const uri = vscode.Uri.file(scratch);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      const diags = await waitForDiag(uri);
      assertMissingRender(diags);

      const start = Date.now();
      while (seen.length === 0 && Date.now() - start <= 15000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(seen.length > 0, 'status-bar callback should receive the check result');
      assert.strictEqual(seen[seen.length - 1].hasIssues, true);
    });

    test('updateStatusBar handles null/ok/issues/error without throwing', () => {
      assert.doesNotThrow(() => {
        updateStatusBar(null);
        updateStatusBar(okResult({ hasIssues: true, exitCode: 1 }));
        updateStatusBar(okResult());
        updateStatusBar(okResult({ success: false, exitCode: 2, stderr: 'boom' }));
      });
    });
  });

  suite('runOnSave:false disables auto-check, manual check still works', () => {
    let runStub: sinon.SinonStub;
    let scratch = '';
    let prevRunOnSave = true;

    setup(async () => {
      runStub = stubRunner();
      prevRunOnSave = vscode.workspace
        .getConfiguration('docscribe')
        .get<boolean>('runOnSave', true);
      await vscode.workspace
        .getConfiguration('docscribe')
        .update('runOnSave', true, vscode.ConfigurationTarget.Global);
      scratch = path.join(fixturesDir, `qa481-save-${Date.now()}.rb`);
      fs.copyFileSync(fixture481, scratch);
    });

    teardown(async () => {
      try {
        await vscode.workspace
          .getConfiguration('docscribe')
          .update('runOnSave', prevRunOnSave, vscode.ConfigurationTarget.Global);
      } catch {
        // ignore
      }
      runStub.restore();
      await closeAllEditors();
      if (scratch) {
        try {
          fs.unlinkSync(scratch);
        } catch {
          // ignore
        }
        scratch = '';
      }
    });

    test('save triggers no check when disabled; checkDocument still reports', async () => {
      const uri = vscode.Uri.file(scratch);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      await waitForDiag(uri);
      const afterOpen = runStub.callCount;
      assert.ok(afterOpen > 0, 'open should have checked');

      await vscode.workspace
        .getConfiguration('docscribe')
        .update('runOnSave', false, vscode.ConfigurationTarget.Global);
      await editor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), '# probe\n');
      });
      await doc.save();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.strictEqual(runStub.callCount, afterOpen, 'save must not check when disabled');

      const manual = await checkDocument(doc);
      assert.ok(manual, 'manual checkDocument should return a result');
      assert.strictEqual(manual.hasIssues, true);
      assertMissingRender(vscode.languages.getDiagnostics(uri));
    });

    test('save triggers a check when enabled', async () => {
      const uri = vscode.Uri.file(scratch);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      await waitForDiag(uri);
      const afterOpen = runStub.callCount;

      await editor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), '# probe\n');
      });
      await doc.save();
      const start = Date.now();
      while (runStub.callCount <= afterOpen && Date.now() - start <= 10000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(runStub.callCount > afterOpen, 'save should check when enabled');
    });
  });

  suite('commands via executeCommand', () => {
    let runStub: sinon.SinonStub;
    let uri: vscode.Uri;

    setup(async () => {
      runStub = stubRunner();
      uri = vscode.Uri.file(fixture481);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    });

    teardown(async () => {
      runStub.restore();
      await closeAllEditors();
    });

    test('checkFile reports diagnostics for the method line', async () => {
      await vscode.commands.executeCommand('docscribe.checkFile');
      assert.ok(
        runStub.calledWith(sinon.match({ strategy: 'check' })),
        'checkFile should run a check',
      );
      assertMissingRender(vscode.languages.getDiagnostics(uri));
    });

    test('checkWorkspace runs a workspace check', async () => {
      await vscode.commands.executeCommand('docscribe.checkWorkspace');
      assert.ok(
        runStub.calledWith(sinon.match({ strategy: 'check', workspace: true })),
        'checkWorkspace should run with workspace:true',
      );
    });

    test('safeFix runs with the safe strategy', async () => {
      await vscode.commands.executeCommand('docscribe.safeFix');
      assert.ok(
        runStub.calledWith(sinon.match({ strategy: 'safe' })),
        'safeFix should run with strategy safe',
      );
    });

    test('aggressiveFix runs with the aggressive strategy', async () => {
      await vscode.commands.executeCommand('docscribe.aggressiveFix');
      assert.ok(
        runStub.calledWith(sinon.match({ strategy: 'aggressive' })),
        'aggressiveFix should run with strategy aggressive',
      );
    });

    test('checkFile on a non-Ruby file warns and does not run (card 509)', async () => {
      const callsBefore = runStub.callCount;
      const warnStub = sinon.stub(
        vscode.window,
        'showWarningMessage',
      ) as unknown as sinon.SinonStub;
      warnStub.resolves(undefined);
      const jsPath = path.join(fixturesDir, `qa509-note-${Date.now()}.js`);
      fs.writeFileSync(jsPath, 'const x = 1;\n');
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(jsPath));
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('docscribe.checkFile');
        assert.ok(
          warnStub.calledWith('Open a Ruby or Rake file first'),
          'should warn about Ruby/Rake first',
        );
        assert.strictEqual(runStub.callCount, callsBefore, 'check must not run on .js');
      } finally {
        warnStub.restore();
        await closeAllEditors();
        fs.unlinkSync(jsPath);
      }
    });

    test('checkFile failure surfaces the error toast (card 509)', async () => {
      const errStub = sinon.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
      errStub.resolves(undefined);
      runStub.resetBehavior();
      runStub.resolves(okResult({ success: false, exitCode: 2, stderr: 'boom', output: 'boom' }));
      try {
        await vscode.commands.executeCommand('docscribe.checkFile');
        assert.ok(
          errStub.calledWith('DocScribe: see output for details'),
          'should point at Output on error',
        );
        assert.ok(
          getStatusBarTextForTesting().includes('error'),
          `status should be error, got: ${getStatusBarTextForTesting()}`,
        );
      } finally {
        errStub.restore();
      }
    });

    test('checkFile with issues reflects them in the status bar (card 511)', async () => {
      await vscode.commands.executeCommand('docscribe.checkFile');
      assert.ok(
        getStatusBarTextForTesting().includes('issues found'),
        `status should report issues, got: ${getStatusBarTextForTesting()}`,
      );
    });
  });

  suite('showResult (card 510)', () => {
    test('error result shows the error toast', () => {
      const errStub = sinon.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
      errStub.resolves(undefined);
      try {
        showResult(okResult({ success: false, exitCode: 2, stderr: 'boom', output: 'boom' }));
        assert.ok(errStub.calledWith('DocScribe: see output for details'));
      } finally {
        errStub.restore();
      }
    });

    test('cancelled result shows info toast and idle status, no error', () => {
      const errStub = sinon.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
      errStub.resolves(undefined);
      const infoStub = sinon.stub(
        vscode.window,
        'showInformationMessage',
      ) as unknown as sinon.SinonStub;
      infoStub.resolves(undefined);
      try {
        showResult(okResult({ success: false, cancelled: true, exitCode: 2, stderr: 'Cancelled' }));
        assert.ok(infoStub.calledWith('DocScribe: cancelled'));
        assert.strictEqual(errStub.callCount, 0, 'no error toast on cancel');
        assert.ok(
          !getStatusBarTextForTesting().includes('error'),
          `status should be idle, got: ${getStatusBarTextForTesting()}`,
        );
      } finally {
        errStub.restore();
        infoStub.restore();
      }
    });
  });

  suite('updateStatusBar text (card 511)', () => {
    test('null/ok/issues/error map to distinct texts', () => {
      updateStatusBar(null);
      assert.ok(!getStatusBarTextForTesting().includes('issues'));
      updateStatusBar(okResult({ hasIssues: true, exitCode: 1 }));
      assert.ok(getStatusBarTextForTesting().includes('issues found'));
      updateStatusBar(okResult());
      assert.ok(getStatusBarTextForTesting().includes('OK'));
      updateStatusBar(okResult({ success: false, exitCode: 2, stderr: 'boom' }));
      assert.ok(getStatusBarTextForTesting().includes('error'));
    });
  });
});
