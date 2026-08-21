import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { setSocketPathForTesting } from '../../docscribeClient';

function workspaceRoot(): string | undefined {
  const first = vscode.workspace.workspaceFolders?.[0];
  return first ? first.uri.fsPath : undefined;
}

function hasValidGem(projectRoot: string): boolean {
  if (!projectRoot || !fs.existsSync(path.join(projectRoot, 'Gemfile'))) return false;
  return fs.existsSync(path.join(projectRoot, 'Gemfile.lock'));
}

function waitForDiagnostics(
  uri: vscode.Uri,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<vscode.Diagnostic[]> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const diagnostics = vscode.languages.getDiagnostics(uri);
      if (diagnostics.length > 0) {
        clearInterval(timer);
        resolve(diagnostics);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for docscribe diagnostics'));
      }
    }, intervalMs);
  });
}

suite('DocScribe onOpen diagnostics (integration)', function () {
  this.timeout(180000);

  let root: string | undefined;

  suiteSetup(function () {
    root = workspaceRoot();
    if (!root || !hasValidGem(root)) {
      // eslint-disable-next-line no-console
      console.log('Skipping integration tests: no Gemfile/Gemfile.lock in workspace root');
      this.skip();
    }
  });

  suiteTeardown(() => {
    setSocketPathForTesting(null);
  });

  test('opening a ruby file reports a missing-docs diagnostic', async () => {
    assert.ok(root, 'workspace root required');

    const filePath = path.join(root, 'e2e-under-doc.rb');
    fs.writeFileSync(
      filePath,
      ['class E2EUnderDoc', '  def ping', '    :pong', '  end', 'end', ''].join('\n'),
    );

    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    try {
      const diagnostics = await waitForDiagnostics(uri, 150000);
      assert.strictEqual(doc.languageId, 'ruby');
      const missingDoc = diagnostics.find(
        (d) =>
          d.code === 'Docscribe/MissingDocBlock' || d.code === 'DocScribe/MissingDocumentation',
      );
      assert.ok(
        missingDoc,
        `expected missing-doc diagnostic, got: ${JSON.stringify(diagnostics.map((d) => ({ code: d.code, message: d.message })))}`,
      );
      if (missingDoc) {
        assert.strictEqual(missingDoc.range.start.line, 1);
      }
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
  });

  test('docscribe commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'docscribe.checkFile',
      'docscribe.checkWorkspace',
      'docscribe.safeFix',
      'docscribe.aggressiveFix',
      'docscribe.applyFix',
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });
});
