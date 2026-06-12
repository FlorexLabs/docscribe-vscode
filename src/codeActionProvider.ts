import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { findProjectRoot } from './docscribeRunner';

export class DocscribeCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] | undefined {
    const relevantDiags = context.diagnostics.filter(d => d.source === 'docscribe');
    if (relevantDiags.length === 0) return undefined;

    return relevantDiags.map(diag => {
      const action = new vscode.CodeAction(
        `DocScribe: ${diag.message}`,
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: 'docscribe.applyFix',
        title: 'Apply docscribe fix',
        arguments: [document.uri],
      };
      action.diagnostics = [diag];
      action.isPreferred = true;
      return action;
    });
  }
}

export async function applyFix(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const root = findProjectRoot(uri.fsPath);
  if (!root) {
    vscode.window.showErrorMessage('No Gemfile found in project tree');
    return;
  }

  const code = doc.getText();

  const config = vscode.workspace.getConfiguration('docscribe');
  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const commandPath = config.get<string>('commandPath', 'docscribe');

  const cmd = useBundleExec ? 'bundle' : commandPath;
  const cmdArgs = useBundleExec ? ['exec', commandPath, '-a', '--stdin'] : ['-a', '--stdin'];

  const result = await new Promise<{ output: string; code: number | null }>((resolve) => {
    const child = execFile(cmd, cmdArgs, { cwd: root, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ output: stdout || stderr, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
    });
    if (child.stdin) {
      child.stdin.write(code);
      child.stdin.end();
    }
  });

  if (result.code !== 0 || !result.output) {
    vscode.window.showErrorMessage('DocScribe: failed to apply fix');
    return;
  }

  const lastLine = doc.lineCount - 1;
  const lastCol = doc.lineAt(lastLine).text.length;
  const fullRange = new vscode.Range(0, 0, lastLine, lastCol);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, fullRange, result.output);

  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    vscode.window.setStatusBarMessage('$(check) DocScribe: fix applied', 3000);
  }
}
