import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('DocScribe');
  context.subscriptions.push(outputChannel);

  const checkFileCmd = vscode.commands.registerCommand('docscribe.checkFile', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'ruby') {
      vscode.window.showWarningMessage('Open a Ruby file first');
      return;
    }
    outputChannel.appendLine(`[check] ${editor.document.fileName}`);
    outputChannel.show();
  });

  const checkWorkspaceCmd = vscode.commands.registerCommand('docscribe.checkWorkspace', () => {
    outputChannel.appendLine('[check] workspace');
    outputChannel.show();
  });

  const safeFixCmd = vscode.commands.registerCommand('docscribe.safeFix', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'ruby') {
      vscode.window.showWarningMessage('Open a Ruby file first');
      return;
    }
    outputChannel.appendLine(`[safe fix] ${editor.document.fileName}`);
    outputChannel.show();
  });

  const aggressiveFixCmd = vscode.commands.registerCommand('docscribe.aggressiveFix', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'ruby') {
      vscode.window.showWarningMessage('Open a Ruby file first');
      return;
    }
    outputChannel.appendLine(`[aggressive fix] ${editor.document.fileName}`);
    outputChannel.show();
  });

  context.subscriptions.push(checkFileCmd, checkWorkspaceCmd, safeFixCmd, aggressiveFixCmd);
}

export function deactivate() {}
