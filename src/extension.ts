import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  runDocscribe,
  findProjectRoot,
  ensureFreshCapabilities,
  checkGemInstalled,
  collectWorkspaceFiles,
  chunkArray,
  resolveRbsContext,
  gemfileHasRbs,
  ensureRbsGemLine,
  type RunResult,
} from './docscribeRunner';
import { createDiagnosticProvider, checkDocument } from './diagnosticProvider';
import { DocscribeCodeActionProvider, applyFix } from './codeActionProvider';
import { DocscribeFoldingRangeProvider, getCommentBlockStartLines } from './foldingProvider';
import { ensureServerRunning, stopServer, checkBatchViaServer } from './docscribeClient';
import { buildDoctorReport } from './doctorReport';
import { registerLmTools } from './lmTools';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let gemChecked = false;
let gemInstalled = true;
let rbsBalloonShown = false;

/** Reset the once-per-session RBS balloon flag. Exported for tests only. */
export function resetRbsBalloonForTesting(): void {
  rbsBalloonShown = false;
}

// Missing-`rbs` balloon (card 466): `useRbs` on but no `rbs` gem —
// unlike the docscribe-missing balloon this one is opt-in UX noise,
// so it shows once per session and offers a one-click Gemfile fix.
// Module-level (not nested in activate) so tests can drive it directly
// without a fake ExtensionContext.
export function checkMissingRbsGem(workspaceRoot: string): void {
  if (rbsBalloonShown) return;
  const config = vscode.workspace.getConfiguration('docscribe');
  if (!config.get<boolean>('useRbs', false)) return;
  const projectRoot = findProjectRoot(workspaceRoot) ?? workspaceRoot;
  const gemfilePath = path.join(projectRoot, 'Gemfile');
  if (gemfileHasRbs(gemfilePath)) return;
  rbsBalloonShown = true;
  vscode.window
    .showWarningMessage(
      'DocScribe: RBS type inference is enabled but the `rbs` gem is missing.',
      'Add rbs to Gemfile',
    )
    .then((selection) => {
      if (selection !== 'Add rbs to Gemfile') return;
      let content: string;
      try {
        content = fs.readFileSync(gemfilePath, 'utf8');
      } catch {
        vscode.window.showErrorMessage('DocScribe: cannot read Gemfile');
        return;
      }
      const updated = ensureRbsGemLine(content);
      if (updated === null) return;
      try {
        fs.writeFileSync(gemfilePath, updated);
      } catch {
        vscode.window.showErrorMessage('DocScribe: cannot write Gemfile');
        return;
      }
      vscode.window.showInformationMessage(
        'DocScribe: `gem "rbs"` added to Gemfile. Run `bundle install` to apply.',
      );
    });
}

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

  // Fire-and-forget server startup (only if gem supports server mode)
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const root = findProjectRoot(workspaceFolders[0].uri.fsPath);
    if (root) {
      ensureFreshCapabilities(root).then((caps) => {
        if (caps?.hasServerMode) ensureServerRunning(root);
      });
    }
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'docscribe.checkFile';
  updateStatusBar(null);
  statusBarItem.show();

  context.subscriptions.push(outputChannel, statusBarItem);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    checkGemInstalled(workspaceRoot).then((installed) => {
      gemChecked = true;
      gemInstalled = installed;
      if (!installed) {
        const gemfilePath = path.join(workspaceRoot, 'Gemfile');
        vscode.window
          .showWarningMessage(
            "DocScribe: gem 'docscribe' not found. Add it to your Gemfile and run bundle install.",
            'Open Gemfile',
          )
          .then((selection) => {
            if (selection === 'Open Gemfile') {
              vscode.commands.executeCommand('vscode.open', vscode.Uri.file(gemfilePath));
            }
          });
      } else {
        checkMissingRbsGem(workspaceRoot);
      }
    });
  }

  // Missing-`rbs` balloon (card 466): see module-level checkMissingRbsGem.

  function ensureGemInstalled(): boolean {
    if (gemChecked && !gemInstalled) {
      vscode.window.showErrorMessage(
        "DocScribe: gem 'docscribe' not found. Add it to your Gemfile and run bundle install.",
      );
      return false;
    }
    return true;
  }

  const checkFileCmd = vscode.commands.registerCommand('docscribe.checkFile', async () => {
    if (!requireRubyFile() || !ensureGemInstalled()) return;
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
      if (!ensureGemInstalled()) return;
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'DocScribe: checking workspace...',
          cancellable: true,
        },
        async (progress, token) => {
          // Try server batch mode (check_batch) when available
          try {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
              const projectRoot = findProjectRoot(folders[0].uri.fsPath);
              if (projectRoot) {
                const caps = await ensureFreshCapabilities(projectRoot);
                const useServer = vscode.workspace
                  .getConfiguration('docscribe')
                  .get<boolean>('useServer', true);
                if (caps?.hasBatchMode && useServer) {
                  const serverRunning = await ensureServerRunning(projectRoot);
                  if (serverRunning && !token.isCancellationRequested) {
                    const allFiles = collectWorkspaceFiles(projectRoot);
                    if (allFiles.length === 0) {
                      const empty = JSON.stringify({
                        metadata: { docscribe_version: caps.version },
                        files: [],
                        summary: {
                          offense_count: 0,
                          target_file_count: 0,
                          inspected_file_count: 0,
                          error_count: 0,
                        },
                      });
                      return {
                        success: true,
                        hasIssues: false,
                        exitCode: 0,
                        stdout: empty,
                        stderr: '',
                        output: empty,
                      } as RunResult;
                    }
                    const chunks = chunkArray(allFiles, 32);
                    const rbs = resolveRbsContext(projectRoot, caps);
                    let totalOffense = 0;
                    let totalTarget = 0;
                    let totalInspected = 0;
                    let totalError = 0;
                    const allFileEntries: unknown[] = [];
                    for (let i = 0; i < chunks.length; i++) {
                      if (token.isCancellationRequested) break;
                      const chunk = chunks[i];
                      progress.report({
                        message: `${Math.min((i + 1) * 32, allFiles.length)}/${allFiles.length} files`,
                        increment: (1 / chunks.length) * 100,
                      });
                      try {
                        const json = await checkBatchViaServer(chunk, rbs.overrides);
                        const parsed = JSON.parse(json) as {
                          files: unknown[];
                          summary: {
                            offense_count: number;
                            target_file_count: number;
                            inspected_file_count: number;
                            error_count: number;
                          };
                        };
                        allFileEntries.push(...parsed.files);
                        totalOffense += parsed.summary.offense_count || 0;
                        totalTarget += parsed.summary.target_file_count || chunk.length;
                        totalInspected += parsed.summary.inspected_file_count || 0;
                        totalError += parsed.summary.error_count || 0;
                      } catch {
                        // Batch chunk failed — fallback to CLI for whole workspace
                        return runDocscribe({ strategy: 'check', workspace: true });
                      }
                    }
                    const aggregated = {
                      metadata: { docscribe_version: caps.version },
                      files: allFileEntries,
                      summary: {
                        offense_count: totalOffense,
                        target_file_count: totalTarget,
                        inspected_file_count: totalInspected,
                        error_count: totalError,
                      },
                    };
                    const stdout = JSON.stringify(aggregated);
                    return {
                      success: true,
                      hasIssues: totalOffense > 0,
                      exitCode: totalOffense > 0 || totalError > 0 ? 1 : 0,
                      stdout,
                      stderr: '',
                      output: stdout,
                    } as RunResult;
                  }
                }
              }
            }
          } catch {
            // Fall through to CLI on any batch error
          }
          return runDocscribe({ strategy: 'check', workspace: true });
        },
      );
      showResult(result);
    },
  );

  const safeFixCmd = vscode.commands.registerCommand('docscribe.safeFix', async () => {
    if (!requireRubyFile() || !ensureGemInstalled()) return;
    const result = await withProgress('DocScribe: applying safe fixes...', () =>
      runDocscribe({ strategy: 'safe' }),
    );
    showResult(result);
  });

  const aggressiveFixCmd = vscode.commands.registerCommand('docscribe.aggressiveFix', async () => {
    if (!requireRubyFile() || !ensureGemInstalled()) return;
    const result = await withProgress('DocScribe: applying aggressive fixes...', () =>
      runDocscribe({ strategy: 'aggressive' }),
    );
    showResult(result);
  });

  const diagProvider = createDiagnosticProvider(updateStatusBar);

  for (const doc of vscode.workspace.textDocuments) {
    if (['ruby', 'rake'].includes(doc.languageId)) {
      checkDocument(doc);
    }
  }

  const fixCmd = vscode.commands.registerCommand(
    'docscribe.applyFix',
    async (uri: vscode.Uri, diagnostic?: vscode.Diagnostic, mode?: 'safe' | 'aggressive') => {
      if (!ensureGemInstalled()) return;
      await applyFix(uri, diagnostic, mode);
    },
  );

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

  const updateTypesCmd = vscode.commands.registerCommand('docscribe.updateTypes', async () => {
    if (!ensureGemInstalled()) return;
    const result = await withProgress('DocScribe: updating types from RBS...', () =>
      runDocscribe({ strategy: 'updateTypes' }),
    );
    showResult(result);
    await refreshOpenRubyDocuments();
  });

  // Internal command for the RBS QuickFix (lightbulb only, no palette entry):
  // update types for a single file, then refresh its diagnostics.
  const updateTypesForFileCmd = vscode.commands.registerCommand(
    'docscribe.updateTypesForFile',
    async (uri: vscode.Uri) => {
      if (!ensureGemInstalled() || !uri) return;
      const result = await withProgress('DocScribe: updating types from RBS...', () =>
        runDocscribe({ file: uri.fsPath, strategy: 'updateTypes' }),
      );
      showResult(result);
      await refreshOpenRubyDocuments();
    },
  );

  // update_types writes files on disk (daemon and CLI alike) — re-check
  // open Ruby documents so diagnostics reflect the new contents.
  async function refreshOpenRubyDocuments(): Promise<void> {
    for (const doc of vscode.workspace.textDocuments) {
      if (['ruby', 'rake'].includes(doc.languageId)) {
        await checkDocument(doc);
      }
    }
  }

  const doctorCmd = vscode.commands.registerCommand('docscribe.doctor', async () => {
    const channel = vscode.window.createOutputChannel('DocScribe Doctor');
    channel.clear();
    channel.appendLine(await buildDoctorReport());
    channel.show();
  });

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
    updateTypesCmd,
    updateTypesForFileCmd,
    doctorCmd,
  );

  // Language-model tools for AI agents (card 469).
  registerLmTools(context);
}

export function deactivate(): void {
  stopServer();
}
