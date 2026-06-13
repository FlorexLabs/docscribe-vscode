import * as vscode from 'vscode';
import * as proc from './execAsync';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Options for the docscribe runner.
 */
export interface RunOptions {
  /** Path to a specific Ruby file to check. If omitted, uses the active editor. */
  file?: string;
  /** If true, checks all Ruby files in the project instead of a single file. */
  workspace?: boolean;
  /**
   * Fixing strategy:
   * - `check` — only report missing docs
   * - `safe` — add docs only to undocumented methods
   * - `aggressive` — replace all existing YARD docs
   */
  strategy?: 'check' | 'safe' | 'aggressive';
  /** If true, passes --explain --verbose for detailed per-method output. */
  explain?: boolean;
}

/**
 * Result of a docscribe command execution.
 */
export interface RunResult {
  /** Whether the command exited successfully. */
  success: boolean;
  /** Combined stdout + stderr output. */
  output: string;
}

/**
 * Crawls up the directory tree from a file path to find a Gemfile.
 *
 * Walks at most 20 levels up. Returns the first directory containing
 * a `Gemfile`, or `null` if none is found.
 *
 * @param startPath - Absolute path to start searching from (typically a Ruby file).
 * @returns The project root directory path, or `null` if no Gemfile is found.
 */
export function findProjectRoot(startPath: string): string | null {
  let current = fs.realpathSync(startPath);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(current, 'Gemfile'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Checks whether a project's Gemfile lists the `rbs` gem.
 *
 * Reads the file synchronously and tests for a line matching
 * `gem "rbs"` or `gem 'rbs'`.
 *
 * @param gemfilePath - Absolute path to the Gemfile.
 * @returns `true` if `gem "rbs"` is found, `false` otherwise or on read error.
 */
export function gemfileHasRbs(gemfilePath: string): boolean {
  try {
    const content = fs.readFileSync(gemfilePath, 'utf8');
    return /gem\s+['"]rbs['"]/.test(content);
  } catch {
    return false;
  }
}

/**
 * Builds the argument list for the docscribe CLI based on strategy and flags.
 *
 * @param strategy - Fixing strategy (`check`, `safe`, `aggressive`).
 * @param explain - Whether to include explain/verbose flags.
 * @param useRbs - Whether to pass `--rbs-collection`.
 * @param filePath - Optional file path to pass as the last argument.
 * @returns An array of CLI argument strings.
 */
function getCommandArgs(
  strategy: string,
  explain: boolean,
  useRbs: boolean,
  filePath?: string,
): string[] {
  const args: string[] = [];
  if (strategy === 'safe') {
    args.push('-a');
  } else if (strategy === 'aggressive') {
    args.push('-A');
  }
  if (explain) {
    args.push('--explain', '--verbose');
  }
  if (useRbs) {
    args.push('--rbs-collection');
  }
  if (filePath) {
    args.push(filePath);
  }
  return args;
}

/**
 * Callback signature used by Node's `child_process.execFile`.
 * Defined here so tests can provide a matching mock.
 */
type ExecFunction = (
  cmd: string,
  args: string[],
  options: object,
  callback: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

/**
 * Wraps `child_process.execFile` in a Promise.
 *
 * The optional `execFn` parameter allows dependency injection for testing.
 *
 * @param cmd - Command to execute.
 * @param args - Command-line arguments.
 * @param cwd - Working directory for the process.
 * @param execFn - Function used to spawn the process (default: `proc.execFile`).
 * @returns A promise resolving to a {@link RunResult}.
 */
export function execCommand(
  cmd: string,
  args: string[],
  cwd: string,
  execFn: ExecFunction = proc.execFile,
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFn(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = stderr ? `${stdout}\n${stderr}` : stdout;
      if (err) {
        resolve({ success: false, output });
      } else {
        resolve({ success: true, output });
      }
    });
  });
}

/**
 * Runs docscribe on the current file or the whole workspace.
 *
 * Determines the project root via {@link findProjectRoot}, reads VS Code
 * configuration for bundle-exec and RBS settings, and delegates to
 * {@link execCommand}.
 *
 * @param options - Execution options (file path, strategy, explain, etc.).
 * @returns A promise resolving to a {@link RunResult}.
 */
export async function runDocscribe(options: RunOptions): Promise<RunResult> {
  const editor = vscode.window.activeTextEditor;
  if (!options.workspace && !options.file && !editor) {
    return { success: false, output: 'No active editor' };
  }

  const filePath = options.file || editor?.document.uri.fsPath;
  if (!filePath) {
    return { success: false, output: 'No file path' };
  }

  const projectRoot = findProjectRoot(filePath);
  if (!projectRoot) {
    return { success: false, output: 'No Gemfile found in project tree' };
  }

  const config = vscode.workspace.getConfiguration('docscribe');
  const strategy = options.strategy || 'check';
  const explain = options.explain ?? false;
  const rbsEnabled = config.get<boolean>('useRbs', false);
  const useRbs = rbsEnabled && gemfileHasRbs(path.join(projectRoot, 'Gemfile'));
  const args = getCommandArgs(strategy, explain, useRbs, options.workspace ? undefined : filePath);

  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const commandPath = config.get<string>('commandPath', 'docscribe');

  if (useBundleExec) {
    return execCommand('bundle', ['exec', commandPath, ...args], projectRoot);
  }
  return execCommand(commandPath, args, projectRoot);
}
