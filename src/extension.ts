import * as vscode from 'vscode';
import { runDocscribe, type RunResult } from './docscribeRunner';
import { createDiagnosticProvider, checkDocument } from './diagnosticProvider';
import { DocscribeCodeActionProvider, applyFix } from './codeActionProvider';

let outputChannel: vscode.OutputChannel;

/**
 * Wraps a task in a VS Code progress notification.
 *
 * @typeParam T - The return type of the task.
 * @param title - Title shown in the progress notification.
 * @param task - Async function to execute.
 * @returns The result of the task.
 */
async function withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    task,
  );
}

/**
 * Checks that the active editor has a Ruby or Rake file open.
 *
 * Shows a warning and returns `false` if the active editor
 * is missing or the language is neither Ruby nor Rake.
 *
 * @returns `true` if a Ruby/Rake file is active, `false` otherwise.
 */
function requireRubyFile(): boolean {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !['ruby', 'rake'].includes(editor.document.languageId)) {
    vscode.window.showWarningMessage('Open a Ruby or Rake file first');
    return false;
  }
  return true;
}

/**
 * Displays the docscribe result in the output channel and status bar.
 *
 * Clears the channel, writes stdout + stderr, shows it in the output panel,
 * and sets a brief status bar message.
 *
 * @param result - The result from a docscribe command.
 */
function showResult(result: RunResult): void {
  outputChannel.clear();
  if (result.stdout) outputChannel.appendLine(result.stdout);
  if (result.stderr) outputChannel.appendLine(result.stderr);
  outputChannel.show();

  if (result.hasIssues) {
    vscode.window.setStatusBarMessage('$(warning) DocScribe: issues found', 5000);
  } else if (result.success) {
    vscode.window.setStatusBarMessage('$(check) DocScribe: done', 3000);
  } else {
    vscode.window.showErrorMessage('DocScribe: see output for details');
  }
}

/**
 * Activates the DocScribe extension.
 *
 * Registers four docscribe commands:
 * - `docscribe.checkFile`
 * - `docscribe.checkWorkspace`
 * - `docscribe.safeFix`
 * - `docscribe.aggressiveFix`
 * - `docscribe.applyFix`
 *
 * Also registers the diagnostic provider (for Ruby and Rake files)
 * and code action providers (ruby language and Rake file pattern).
 * All disposables are added to `context.subscriptions`.
 *
 * @param context - The extension context provided by VS Code on activation.
 */
export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('DocScribe');
  context.subscriptions.push(outputChannel);

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

  const diagProvider = createDiagnosticProvider();

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

  context.subscriptions.push(
    checkFileCmd,
    checkWorkspaceCmd,
    safeFixCmd,
    aggressiveFixCmd,
    diagProvider,
    fixCmd,
    ...codeActionProviders,
  );
}
