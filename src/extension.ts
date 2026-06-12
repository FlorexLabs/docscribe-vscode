import * as vscode from 'vscode';
import { runDocscribe } from './docscribeRunner';
import { createDiagnosticProvider } from './diagnosticProvider';
import { DocscribeCodeActionProvider, applyFix } from './codeActionProvider';

let outputChannel: vscode.OutputChannel;

async function withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    task,
  );
}

function requireRubyFile(): boolean {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'ruby') {
    vscode.window.showWarningMessage('Open a Ruby file first');
    return false;
  }
  return true;
}

function showResult(result: { success: boolean; output: string }): void {
  outputChannel.clear();
  outputChannel.appendLine(result.output);
  outputChannel.show();

  if (result.success) {
    vscode.window.setStatusBarMessage('$(check) DocScribe: done', 3000);
  } else {
    vscode.window.showErrorMessage('DocScribe: see output for details');
  }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('DocScribe');
  context.subscriptions.push(outputChannel);

  const checkFileCmd = vscode.commands.registerCommand('docscribe.checkFile', async () => {
    if (!requireRubyFile()) return;
    const result = await withProgress('DocScribe: checking file...', () =>
      runDocscribe({ strategy: 'check' }),
    );
    showResult(result);
  });

  const checkWorkspaceCmd = vscode.commands.registerCommand(
    'docscribe.checkWorkspace',
    async () => {
      const result = await withProgress('DocScribe: checking workspace...', () =>
        runDocscribe({ strategy: 'check', workspace: true }),
      );
      showResult(result);
    },
  );

  const safeFixCmd = vscode.commands.registerCommand('docscribe.safeFix', async () => {
    if (!requireRubyFile()) return;
    const result = await withProgress('DocScribe: applying safe fixes...', () =>
      runDocscribe({ strategy: 'safe' }),
    );
    showResult(result);
  });

  const aggressiveFixCmd = vscode.commands.registerCommand('docscribe.aggressiveFix', async () => {
    if (!requireRubyFile()) return;
    const result = await withProgress('DocScribe: applying aggressive fixes...', () =>
      runDocscribe({ strategy: 'aggressive' }),
    );
    showResult(result);
  });

  const diagProvider = createDiagnosticProvider();

  const fixCmd = vscode.commands.registerCommand('docscribe.applyFix', (uri: vscode.Uri) => {
    applyFix(uri);
  });

  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { language: 'ruby' },
    new DocscribeCodeActionProvider(),
    { providedCodeActionKinds: DocscribeCodeActionProvider.providedCodeActionKinds },
  );

  context.subscriptions.push(
    checkFileCmd,
    checkWorkspaceCmd,
    safeFixCmd,
    aggressiveFixCmd,
    diagProvider,
    fixCmd,
    codeActionProvider,
  );
}
