import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as runner from '../../docscribeRunner';
import * as client from '../../docscribeClient';
import { DocscribeCodeActionProvider, applyFix } from '../../codeActionProvider';
import type { RunResult } from '../../docscribeRunner';

const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'suite', 'fixtures');
const templatePath = path.join(fixturesDir, 'qa482-two-methods.rb');

const COP = 'DocScribe/MissingDocumentation';
const ADD_BLOCK = [
  '  # Adds two numbers.',
  '  # @param a [Integer] first number',
  '  # @param b [Integer] second number',
  '  # @return [Integer] sum',
].join('\n');
const SUBTRACT_BLOCK = [
  '  # Subtracts two numbers.',
  '  # @param a [Integer] first number',
  '  # @param b [Integer] second number',
  '  # @return [Integer] difference',
].join('\n');

function noToken(): vscode.CancellationToken {
  return {} as vscode.CancellationToken;
}

function diagFor(line: number, message: string): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(
    new vscode.Range(line, 0, line, 20),
    message,
    vscode.DiagnosticSeverity.Warning,
  );
  diag.source = 'docscribe';
  diag.code = COP;
  return diag;
}

function emptyCheckResult(): RunResult {
  const stdout = JSON.stringify({
    metadata: { docscribe_version: '9.9.9', ruby_version: '3.2.0' },
    files: [],
    summary: { offense_count: 0, target_file_count: 0, inspected_file_count: 0, error_count: 0 },
  });
  return { success: true, hasIssues: false, exitCode: 0, stdout, stderr: '', output: stdout };
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

suite('quickfix apply (QA 2C)', function () {
  this.timeout(60000);

  const scratches: string[] = [];
  let sandbox: sinon.SinonSandbox;
  let runStub: sinon.SinonStub;
  let template: string;
  let fixedAddOnly: string;
  let fixedBoth: string;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('unurgunite.docscribe-vscode');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    template = fs.readFileSync(templatePath, 'utf8');
    fixedAddOnly = template.replace('  def add(a, b)\n', `${ADD_BLOCK}\n  def add(a, b)\n`);
    fixedBoth = fixedAddOnly.replace(
      '  def subtract(a, b)\n',
      `${SUBTRACT_BLOCK}\n  def subtract(a, b)\n`,
    );
    // Keep auto-diagnostics hermetic: no real gem calls on open.
    runStub = sinon.stub(runner, 'runDocscribe').resolves(emptyCheckResult());
  });

  suiteTeardown(async () => {
    runStub.restore();
    await closeAllEditors();
  });

  setup(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(client, 'ensureServerRunning').resolves(true);
  });

  teardown(async () => {
    sandbox.restore();
    await closeAllEditors();
    for (const file of scratches.splice(0)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  });

  async function openScratch(
    content: string,
  ): Promise<{ doc: vscode.TextDocument; uri: vscode.Uri }> {
    const filePath = path.join(fixturesDir, `qa482-scratch-${Date.now()}-${scratches.length}.rb`);
    fs.writeFileSync(filePath, content);
    scratches.push(filePath);
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    return { doc, uri };
  }

  test('provideCodeActions returns per-method plus fix-all actions', async () => {
    const { doc, uri } = await openScratch(template);
    const provider = new DocscribeCodeActionProvider();
    // `def add` is 0-indexed line 1 in the template.
    const diag = diagFor(1, 'Missing YARD documentation for `add`');
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diag.range, context, noToken());

    assert.ok(actions);
    assert.strictEqual(actions.length, 3);
    assert.ok(actions[0].title.includes('Missing YARD documentation for `add`'));
    assert.strictEqual(actions[0].command?.command, 'docscribe.applyFix');
    assert.strictEqual((actions[0].command?.arguments?.[0] as vscode.Uri).fsPath, uri.fsPath);
    assert.strictEqual(actions[0].command?.arguments?.[1], diag);
    assert.strictEqual(actions[1].title, 'DocScribe: fix all in file (safe)');
    assert.strictEqual(actions[1].command?.command, 'docscribe.applyFix');
    assert.strictEqual((actions[1].command?.arguments?.[0] as vscode.Uri).fsPath, uri.fsPath);
    assert.strictEqual(actions[1].command?.arguments?.[2], 'safe');
    assert.strictEqual(actions[2].title, 'DocScribe: fix all in file (aggressive)');
    assert.strictEqual(actions[2].command?.arguments?.[2], 'aggressive');
  });

  test('per-method fix changes only the target method', async () => {
    sandbox.stub(client, 'applyFixViaServer').resolves(fixedAddOnly);
    const { doc, uri } = await openScratch(template);

    await applyFix(uri, diagFor(1, 'Missing YARD documentation for `add`'), 'safe');

    const text = doc.getText();
    assert.ok(text.includes('# Adds two numbers.'), 'target method should be documented');
    assert.ok(
      text.includes('  def subtract(a, b)\n    a - b\n  end'),
      'other method should stay untouched',
    );
    assert.ok(!text.includes('Subtracts'), 'other method must gain no docs');
  });

  test('fix-all replaces the whole file', async () => {
    sandbox.stub(client, 'applyFixViaServer').resolves(fixedBoth);
    const { doc, uri } = await openScratch(template);

    await applyFix(uri, undefined, 'safe');

    assert.strictEqual(doc.getText(), fixedBoth);
  });

  test('no-fix line leaves the document unchanged', async () => {
    sandbox.stub(client, 'applyFixViaServer').resolves(fixedAddOnly);
    const { doc, uri } = await openScratch(template);

    await applyFix(uri, diagFor(0, 'Missing YARD documentation for `Qa482Calculator`'), 'safe');

    assert.strictEqual(doc.getText(), template);
  });

  test('no docscribe diagnostics yields no actions', async () => {
    const { doc } = await openScratch(template);
    const provider = new DocscribeCodeActionProvider();
    const context = { diagnostics: [] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(
      doc,
      new vscode.Range(0, 0, 0, 1),
      context,
      noToken(),
    );

    assert.strictEqual(actions, undefined);
  });
});
