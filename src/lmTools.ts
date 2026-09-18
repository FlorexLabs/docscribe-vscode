import * as vscode from 'vscode';
import * as path from 'path';
import { runDocscribe, findProjectRoot, type RunResult } from './docscribeRunner';
import { buildDoctorReport } from './doctorReport';

/**
 * Language-model tools (`languageModelTools`, card 469).
 *
 * Thin wrappers over the existing `RunOptions`/daemon paths — no new
 * execution logic. Mirrors the RubyMine `DocScribeMcpToolset`
 * (check file/workspace, safe/aggressive fix, update types, doctor).
 */

/** Tool input with a required file path. */
export interface LmFileInput {
  filePath: string;
}

/** Dependencies of the tools (injectable for tests). */
export interface LmToolDeps {
  runCheck: (filePath: string) => Promise<RunResult>;
  runWorkspaceCheck: () => Promise<RunResult>;
  runFix: (filePath: string, mode: 'safe' | 'aggressive') => Promise<RunResult>;
  runUpdateTypes: (filePath: string) => Promise<RunResult>;
  runDoctor: () => Promise<string>;
}

function trimOutput(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…(truncated ${text.length - limit} chars)`;
}

function formatResult(result: RunResult): string {
  return JSON.stringify({
    success: result.success,
    hasIssues: result.hasIssues,
    exitCode: result.exitCode,
    stdout: trimOutput(result.stdout, 4000),
    stderr: trimOutput(result.stderr, 1000),
  });
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function requiredFilePath(input: unknown): string {
  const filePath =
    typeof input === 'object' && input !== null
      ? ((input as Record<string, unknown>)['filePath'] as unknown)
      : undefined;
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('Missing required input: filePath');
  }
  return filePath;
}

/** Default dependencies wired to the real runner. */
export const defaultLmDeps: LmToolDeps = {
  runCheck: (filePath) => runDocscribe({ file: filePath, strategy: 'check' }),
  runWorkspaceCheck: () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return Promise.reject(new Error('No workspace folder open'));
    }
    const root = findProjectRoot(folders[0].uri.fsPath);
    if (!root) {
      return Promise.reject(new Error('No Gemfile found in workspace'));
    }
    // Point at the Gemfile so runDocscribe resolves the project root;
    // `workspace: true` keeps the whole-project CLI scan.
    return runDocscribe({
      file: path.join(root, 'Gemfile'),
      strategy: 'check',
      workspace: true,
    });
  },
  runFix: (filePath, mode) => runDocscribe({ file: filePath, strategy: mode }),
  runUpdateTypes: (filePath: string) => runDocscribe({ file: filePath, strategy: 'updateTypes' }),
  runDoctor: () => buildDoctorReport(),
};

/** A tool name plus its implementation. */
export interface LmToolDef {
  name: string;
  tool: vscode.LanguageModelTool<Record<string, unknown>>;
}

/**
 * Create the six DocScribe language-model tools.
 *
 * @param deps - Execution dependencies (defaults to the real runner).
 */
export function createLmTools(deps: LmToolDeps = defaultLmDeps): LmToolDef[] {
  return [
    {
      name: 'docscribe_check_file',
      tool: {
        invoke: async (options) =>
          textResult(formatResult(await deps.runCheck(requiredFilePath(options.input)))),
      },
    },
    {
      name: 'docscribe_check_workspace',
      tool: {
        invoke: async () => textResult(formatResult(await deps.runWorkspaceCheck())),
      },
    },
    {
      name: 'docscribe_safe_fix',
      tool: {
        invoke: async (options) =>
          textResult(formatResult(await deps.runFix(requiredFilePath(options.input), 'safe'))),
      },
    },
    {
      name: 'docscribe_aggressive_fix',
      tool: {
        invoke: async (options) =>
          textResult(
            formatResult(await deps.runFix(requiredFilePath(options.input), 'aggressive')),
          ),
      },
    },
    {
      name: 'docscribe_update_types',
      tool: {
        invoke: async (options) =>
          textResult(formatResult(await deps.runUpdateTypes(requiredFilePath(options.input)))),
      },
    },
    {
      name: 'docscribe_doctor',
      tool: {
        invoke: async () => textResult(await deps.runDoctor()),
      },
    },
  ];
}

/**
 * Register all DocScribe tools with the language-model tool host.
 *
 * @param context - Extension context (disposables are pushed to subscriptions).
 */
export function registerLmTools(context: vscode.ExtensionContext): void {
  for (const { name, tool } of createLmTools()) {
    context.subscriptions.push(vscode.lm.registerTool(name, tool));
  }
}
