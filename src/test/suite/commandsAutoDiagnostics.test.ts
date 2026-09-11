import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as runner from '../../docscribeRunner';
import type { RunOptions, RunResult } from '../../docscribeRunner';
import { checkDocument, createDiagnosticProvider } from '../../diagnosticProvider';
import { updateStatusBar } from '../../extension';

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
  });
});
