import * as vscode from 'vscode';
import { runDocscribe, type RunResult } from './docscribeRunner';
import { createDiagnosticProvider, checkDocument } from './diagnosticProvider';
import { DocscribeCodeActionProvider, applyFix } from './codeActionProvider';
import { DocscribeFoldingRangeProvider, getCommentBlockStartLines } from './foldingProvider';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export function updateStatusBar(result: RunResult | null): void {
  if (!result) {
    statusBarItem.text = '$(symbol-ruler) DocScribe';
    statusBarItem.tooltip = 'Click to check current file';
    return;
  }
  if (result.hasIssues) {
    statusBarItem.text = '$(warning) DocScribe: issues found';
    statusBarItem.tooltip = 'Click to re-check current file';
  } else if (result.success) {
    statusBarItem.text = '$(check) DocScribe: OK';
    statusBarItem.tooltip = 'Click to check current file';
  } else {
    statusBarItem.text = '$(error) DocScribe: error';
    statusBarItem.tooltip = 'Click to check current file';
  }
}

async function withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    task,
  );
}

function requireRubyFile(): boolean {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !['ruby', 'rake'].includes(editor.document.languageId)) {
    vscode.window.showWarningMessage('Open a Ruby or Rake file first');
    return false;
  }
  return true;
}

function showResult(result: RunResult): void {
  outputChannel.clear();
  if (result.stdout) outputChannel.appendLine(result.stdout);
  if (result.stderr) outputChannel.appendLine(result.stderr);
  if (result.stdout || result.stderr) {
    outputChannel.show();
  }

  updateStatusBar(result);

  if (!result.success && !result.hasIssues) {
    vscode.window.showErrorMessage('DocScribe: see output for details');
  }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('DocScribe');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'docscribe.checkFile';
  updateStatusBar(null);
  statusBarItem.show();

  context.subscriptions.push(outputChannel, statusBarItem);

  const checkFileCmd = vscode.commands.registerCommand('docscribe.checkFile', async () => {
    if (!requireRubyFile()) return;
    const editor = vscode.window.activeTextEditor;
    const result = await withProgress('DocScribe: checking file...', () =>
      runDocscribe({ strategy: 'check' }),
    );
    showResult(result);
    if (editor) {
      await checkDocument(editor.document);
    }
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

  const diagProvider = createDiagnosticProvider(updateStatusBar);

  const fixCmd = vscode.commands.registerCommand('docscribe.applyFix', (uri: vscode.Uri) => {
    applyFix(uri);
  });

  const codeActionProviders = [
    vscode.languages.registerCodeActionsProvider(
      { language: 'ruby' },
      new DocscribeCodeActionProvider(),
      { providedCodeActionKinds: DocscribeCodeActionProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { pattern: '**/*.rake' },
      new DocscribeCodeActionProvider(),
      { providedCodeActionKinds: DocscribeCodeActionProvider.providedCodeActionKinds },
    ),
  ];

  const foldingProvider = vscode.languages.registerFoldingRangeProvider(
    [{ language: 'ruby' }, { pattern: '**/*.rake' }],
    new DocscribeFoldingRangeProvider(),
  );

  async function foldCommentBlocks(editor: vscode.TextEditor): Promise<void> {
    const startLines = getCommentBlockStartLines(editor.document);
    if (startLines.length === 0) return;

    const originalSelection = editor.selection;
    for (const line of startLines) {
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      await vscode.commands.executeCommand('editor.fold');
    }
    editor.selection = originalSelection;
  }

  const autoFoldedDocs = new Set<string>();

  const editorListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor || !['ruby', 'rake'].includes(editor.document.languageId)) return;
    if (autoFoldedDocs.has(editor.document.uri.toString())) return;

    const config = vscode.workspace.getConfiguration('docscribe');
    if (!config.get<boolean>('foldComments', false)) return;

    autoFoldedDocs.add(editor.document.uri.toString());
    setTimeout(() => foldCommentBlocks(editor), 200);
  });

  const toggleFoldCmd = vscode.commands.registerCommand(
    'docscribe.toggleFoldComments',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !['ruby', 'rake'].includes(editor.document.languageId)) return;
      await foldCommentBlocks(editor);
    },
  );

  context.subscriptions.push(
    checkFileCmd,
    checkWorkspaceCmd,
    safeFixCmd,
    aggressiveFixCmd,
    diagProvider,
    fixCmd,
    ...codeActionProviders,
    foldingProvider,
    editorListener,
    toggleFoldCmd,
  );
}
