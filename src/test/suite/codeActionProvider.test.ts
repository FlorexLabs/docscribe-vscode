import * as assert from 'assert';
import * as vscode from 'vscode';
import { DocscribeCodeActionProvider } from '../../codeActionProvider';

suite('codeActionProvider', () => {
  let provider: DocscribeCodeActionProvider;

  setup(() => {
    provider = new DocscribeCodeActionProvider();
  });

  suite('provideCodeActions', () => {
    test('returns undefined when no docscribe diagnostics', () => {
      const context = {
        diagnostics: [],
      } as unknown as vscode.CodeActionContext;

      const result = provider.provideCodeActions(
        {} as unknown as vscode.TextDocument,
        {} as unknown as vscode.Range,
        context,
        {} as unknown as vscode.CancellationToken,
      );

      assert.strictEqual(result, undefined);
    });

    test('returns undefined when diagnostics are from other sources', () => {
      const context = {
        diagnostics: [
          {
            source: 'eslint',
            message: 'some eslint error',
          },
          {
            source: 'ruby',
            message: 'some ruby error',
          },
        ],
      } as unknown as vscode.CodeActionContext;

      const result = provider.provideCodeActions(
        {} as unknown as vscode.TextDocument,
        {} as unknown as vscode.Range,
        context,
        {} as unknown as vscode.CancellationToken,
      );

      assert.strictEqual(result, undefined);
    });

    test('returns CodeAction for docscribe diagnostic', () => {
      const diag = {
        source: 'docscribe',
        message: 'Missing documentation at line 15',
      } as unknown as vscode.Diagnostic;

      const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;

      const result = provider.provideCodeActions(
        { uri: { fsPath: '/test.rb' } } as unknown as vscode.TextDocument,
        {} as unknown as vscode.Range,
        context,
        {} as unknown as vscode.CancellationToken,
      );

      assert.ok(result);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].title, 'DocScribe: Missing documentation at line 15');
      assert.strictEqual(result[0].kind, vscode.CodeActionKind.QuickFix);
      assert.ok(result[0].isPreferred);
      assert.strictEqual(result[0].command?.command, 'docscribe.applyFix');
      assert.strictEqual(result[0].diagnostics?.length, 1);
      assert.strictEqual(result[1].title, 'DocScribe: fix all in file (safe)');
      assert.strictEqual(result[1].command?.command, 'docscribe.applyFix');
      assert.strictEqual(result[1].diagnostics, undefined);
      assert.strictEqual(result[2].title, 'DocScribe: fix all in file (aggressive)');
      assert.strictEqual(result[2].command?.command, 'docscribe.applyFix');
      assert.strictEqual(result[2].diagnostics, undefined);
    });

    test('returns multiple CodeActions for multiple docscribe diagnostics', () => {
      const diag1 = { source: 'docscribe', message: 'Issue 1' } as unknown as vscode.Diagnostic;
      const diag2 = { source: 'docscribe', message: 'Issue 2' } as unknown as vscode.Diagnostic;
      const diag3 = { source: 'ruby', message: 'Ruby issue' } as unknown as vscode.Diagnostic;

      const context = { diagnostics: [diag1, diag2, diag3] } as unknown as vscode.CodeActionContext;

      const result = provider.provideCodeActions(
        {} as unknown as vscode.TextDocument,
        {} as unknown as vscode.Range,
        context,
        {} as unknown as vscode.CancellationToken,
      );

      assert.ok(result);
      assert.strictEqual(result.length, 4);
      assert.strictEqual(result[0].title, 'DocScribe: Issue 1');
      assert.strictEqual(result[1].title, 'DocScribe: Issue 2');
      assert.strictEqual(result[2].title, 'DocScribe: fix all in file (safe)');
      assert.strictEqual(result[3].title, 'DocScribe: fix all in file (aggressive)');
    });
  });
});
