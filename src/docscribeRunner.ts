import * as vscode from 'vscode';
import * as proc from './execAsync';
import * as path from 'path';
import * as fs from 'fs';
import { ensureServerRunning, checkFileViaServer, type CliOverrides } from './docscribeClient';
import {
  gemfileHasRbs as gemfileListsRbs,
  shouldUseRbs,
  hasCollection,
  buildRbsCliOverrides,
} from './rbsDetector';

let docscribeLog: vscode.OutputChannel | undefined;

function logInfo(message: string): void {
  if (!docscribeLog) {
    docscribeLog = vscode.window.createOutputChannel('DocScribe');
  }
  docscribeLog.appendLine(message);
}

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
   * - `updateTypes` — two-pass: aggressive then safe, updates types from RBS
   */
  strategy?: 'check' | 'safe' | 'aggressive' | 'updateTypes';
  /** If true (default), uses `--format json` for machine-readable output. */
  json?: boolean;
}

/**
 * Checks whether the docscribe gem is installed in the current project.
 *
 * @param cwd - Working directory (project root) to run the check in.
 * @returns true if `bundle exec docscribe --version` succeeds.
 */
export async function checkGemInstalled(cwd: string): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('docscribe');
  const bundlePath = config.get<string>('bundlePath', 'bundle');
  const result = await execCommand(bundlePath, ['exec', 'docscribe', '--version'], cwd);
  return result.success;
}

/**
 * Result of a docscribe command execution.
 *
 * Exit codes (docscribe ≥ 1.5.0):
 * - 0 = OK (no issues found)
 * - 1 = issues found (undocumented methods, type mismatches, etc.)
 * - 2 = error (file read failure, config error, etc.)
 */
export interface RunResult {
  /** Whether docscribe ran without errors (exit code 0 or 1). */
  success: boolean;
  /** Whether docscribe found issues (exit code 1). */
  hasIssues: boolean;
  /** Exit code from the process. */
  exitCode: number;
  /** Standard output (JSON when `--format json`). */
  stdout: string;
  /** Standard error (progress markers, errors). */
  stderr: string;
  /** Combined stdout + stderr (backwards compat). */
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
 * `gem "rbs"` or `gem 'rbs'`. Kept for backwards compatibility;
 * new code should use {@link shouldUseRbs} from `rbsDetector`
 * (which also checks `sig/`, `Gemfile.lock` and `docscribe.yml`).
 *
 * @param gemfilePath - Absolute path to the Gemfile.
 * @returns `true` if `gem "rbs"` is found, `false` otherwise or on read error.
 */
export function gemfileHasRbs(gemfilePath: string): boolean {
  return gemfileListsRbs(gemfilePath);
}

/**
 * Collect Ruby source files in a workspace for `check_batch`.
 *
 * Walks the project tree and returns absolute paths for `*.rb`, `*.rake`,
 * and `Rakefile`. Skips common non-source directories
 * (`.git`, `node_modules`, `vendor`, `out`, etc.) and hidden dirs.
 * Does not read `.gitignore` — uses a fixed exclude set matching the
 * RubyMine plugin's `WorkspaceCheckChunking.kt`.
 *
 * @param projectRoot - Absolute project root (contains `Gemfile`).
 * @param maxFiles - Hard limit to avoid pathological walks.
 * @returns Sorted list of absolute file paths.
 */
export function collectWorkspaceFiles(projectRoot: string, maxFiles = 5000): string[] {
  const files: string[] = [];
  const excludeDirs = new Set([
    '.git',
    'node_modules',
    'vendor',
    '.vscode-test',
    'out',
    'dist',
    'build',
    'tmp',
    '.tmp-e2e',
    '.idea',
    '.vscode',
    'coverage',
    'log',
    '.ruby-lsp',
  ]);
  const walk = (dir: string): void => {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        // Avoid following symlinked dirs to prevent cycles
        try {
          if (entry.isSymbolicLink()) continue;
        } catch {
          // ignore
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (
          entry.name.endsWith('.rb') ||
          entry.name.endsWith('.rake') ||
          entry.name === 'Rakefile'
        ) {
          files.push(fullPath);
        }
      }
    }
  };
  walk(projectRoot);
  files.sort();
  return files;
}

/**
 * Split an array into chunks of given size.
 *
 * @param arr - Input array.
 * @param size - Chunk size (must be >0).
 * @returns Array of chunks.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr.slice()];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export interface Capabilities {
  version: string;
  hasServerMode: boolean;
  hasBatchMode: boolean;
  hasRbsCollection: boolean;
  hasExitCodeSemantics: boolean;
  /** `--validate-types` / `Docscribe/InvalidType` (gem >= 1.6.2). */
  hasValidateTypes: boolean;
  /** `update_types` daemon RPC + `changes[].source` (gem >= 1.6.2). */
  hasUpdateTypesRpc: boolean;
}

let cachedCapabilities: Capabilities | null = null;
const capabilitiesLockMtime = new Map<string, number>();

export function getCachedCapabilities(): Capabilities | null {
  return cachedCapabilities;
}

export function clearCachedCapabilitiesForTesting(): void {
  cachedCapabilities = null;
  capabilitiesLockMtime.clear();
}

function gemfileLockMtime(projectRoot: string): number | null {
  try {
    return fs.statSync(path.join(projectRoot, 'Gemfile.lock')).mtimeMs;
  } catch {
    return null;
  }
}

let serverModeWarningShown = false;

export function clearServerModeWarningForTesting(): void {
  serverModeWarningShown = false;
}

export async function detectCapabilities(projectRoot: string): Promise<Capabilities | null> {
  const config = vscode.workspace.getConfiguration('docscribe');
  const commandPath = config.get<string>('commandPath', 'docscribe');
  const useBundleExec = config.get<boolean>('useBundleExec', true);

  const cmd = useBundleExec ? 'bundle' : commandPath;
  const args = useBundleExec ? ['exec', commandPath, '--version'] : ['--version'];

  try {
    const result = await execCommand(cmd, args, projectRoot);
    if (!result.success) return null;
    const version = result.stdout.trim();
    cachedCapabilities = parseCapabilities(version);
    const lockMtime = gemfileLockMtime(projectRoot);
    if (lockMtime !== null) capabilitiesLockMtime.set(projectRoot, lockMtime);
    return cachedCapabilities;
  } catch {
    return null;
  }
}

/**
 * Cached capabilities, re-probed when `Gemfile.lock` changed.
 *
 * Mirrors RubyMine `performGemCheck` mtime guard: a `bundle update`
 * mid-session must not leave a stale version gate behind.
 *
 * @param projectRoot - Absolute project root.
 * @returns Fresh or cached capabilities, `null` when undetectable.
 */
export async function ensureFreshCapabilities(projectRoot: string): Promise<Capabilities | null> {
  const lockMtime = gemfileLockMtime(projectRoot);
  const recorded = capabilitiesLockMtime.get(projectRoot);
  if (
    cachedCapabilities &&
    lockMtime !== null &&
    recorded !== undefined &&
    lockMtime !== recorded
  ) {
    cachedCapabilities = null;
    serverModeWarningShown = false;
  }
  if (cachedCapabilities) return cachedCapabilities;
  return detectCapabilities(projectRoot);
}

export function parseCapabilities(version: string): Capabilities | null {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10);
  const atLeast = (tMajor: number, tMinor: number, tPatch: number): boolean =>
    major > tMajor ||
    (major === tMajor && minor > tMinor) ||
    (major === tMajor && minor === tMinor && patch >= tPatch);
  // Server mode introduced in 1.5.1, batch mode (check_batch) in 1.5.2,
  // validate-types + update_types RPC + change source in 1.6.2.
  return {
    version: `${major}.${minor}.${patch}`,
    hasServerMode: atLeast(1, 5, 1),
    hasBatchMode: atLeast(1, 5, 2),
    hasRbsCollection: atLeast(1, 4, 0),
    hasExitCodeSemantics: atLeast(1, 5, 0),
    hasValidateTypes: atLeast(1, 6, 2),
    hasUpdateTypesRpc: atLeast(1, 6, 2),
  };
}

/**
 * Resolved RBS/validate context for a project.
 */
export interface RbsContext {
  /** Effective RBS flag (setting AND auto-detect). */
  useRbs: boolean;
  /** Whether `rbs_collection.lock.yaml` exists. */
  collection: boolean;
  /**
   * Effective validate flag, or `undefined` when the gem version is
   * unknown (callers must omit the CLI flag then — old gems reject it).
   */
  validateTypes: boolean | undefined;
  /** Daemon `cli_overrides` (undefined when empty). */
  overrides: CliOverrides | undefined;
}

/**
 * Resolve RBS/validate settings + auto-detect for a project.
 *
 * Single choke point used by the check path, the fix path and the
 * workspace batch path so CLI flags and daemon overrides stay in sync.
 *
 * @param projectRoot - Absolute project root.
 * @param caps - Detected capabilities (`null` when version unknown).
 */
export function resolveRbsContext(projectRoot: string, caps: Capabilities | null): RbsContext {
  const config = vscode.workspace.getConfiguration('docscribe');
  const rbsEnabled = config.get<boolean>('useRbs', false);
  const useRbs =
    rbsEnabled && shouldUseRbs(projectRoot, gemfileHasRbs(path.join(projectRoot, 'Gemfile')));
  const collection = hasCollection(projectRoot);
  const validateTypesEnabled = config.get<boolean>('validateTypes', true);
  const validateTypes = caps ? validateTypesEnabled && caps.hasValidateTypes : undefined;
  return {
    useRbs,
    collection,
    validateTypes,
    overrides: buildRbsCliOverrides(useRbs, collection, validateTypes === true),
  };
}

/**
 * Builds the argument list for the docscribe CLI based on strategy and flags.
 *
 * For check mode (≥ 1.5.0):
 * - Uses `--format json` for machine-readable output instead of `--explain --verbose`
 * - Exit code 0 = clean, 1 = issues found, 2 = error
 *
 * For write modes (`safe`/`aggressive`):
 * - Uses `-a`/`-A` as before
 * - `--stdin` is added separately in codeActionProvider
 *
 * @param strategy - Fixing strategy (`check`, `safe`, `aggressive`).
 * @param json - If true, adds `--format json` (for check mode).
 * @param useRbs - Whether to pass `--rbs` (+ `--rbs-collection` when available).
 * @param omitBoilerplate - Whether to pass `-B` to omit boilerplate text.
 * @param filePath - Optional file path to pass as the last argument.
 * @param validateTypes - Whether to pass `--validate-types` (`undefined` omits
 *   the flag entirely — old gems reject unknown flags).
 * @param hasCollection - Whether `rbs_collection.lock.yaml` exists.
 * @returns An array of CLI argument strings.
 */
function getCommandArgs(
  strategy: string,
  json: boolean,
  useRbs: boolean,
  omitBoilerplate: boolean,
  filePath?: string,
  validateTypes?: boolean,
  hasCollection?: boolean,
): string[] {
  const args: string[] = [];
  if (strategy === 'safe') {
    // RBS types only update in aggressive mode — mirror RubyMine CLI parity
    if (useRbs) args.push('-A', '-k');
    else args.push('-a');
  } else if (strategy === 'aggressive') {
    args.push('-A', '-k');
  } else if (strategy === 'updateTypes') {
    args.push('update_types', '-A', '-k');
  }
  if (json && (strategy === 'check' || strategy === 'updateTypes')) {
    args.push('--format', 'json');
  }
  if (useRbs) {
    args.push('--rbs');
    if (hasCollection) args.push('--rbs-collection');
  }
  if (validateTypes === true) args.push('--validate-types');
  else if (validateTypes === false) args.push('--no-validate-types');
  if (omitBoilerplate) {
    args.push('-B');
  }
  if (filePath) {
    args.push(filePath);
  }
  return args;
}

/** Error from child_process.execFile with an optional numeric exit code. */
interface ExecError extends Error {
  code?: number;
}

/** Narrow an Error to ExecError if it looks like one. */
function toExitCode(err: Error | null): number {
  if (!err) return 0;
  if (typeof (err as ExecError).code === 'number') return (err as ExecError).code as number;
  return 2;
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
 * Exit codes (docscribe ≥ 1.5.0):
 * - 0 = no issues
 * - 1 = issues found (still a "successful" run for the extension)
 * - 2+ = error (process error, file error, etc.)
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
      const exitCode = toExitCode(err);
      resolve({
        success: exitCode < 2,
        hasIssues: exitCode === 1,
        exitCode,
        stdout,
        stderr,
        output,
      });
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
 * When `strategy === 'check'` (default), passes `--format json` for
 * machine-readable output. Fix modes (`safe`/`aggressive`) do not
 * use JSON output.
 *
 * @param options - Execution options (file path, strategy, json, etc.).
 * @returns A promise resolving to a {@link RunResult}.
 */
export async function runDocscribe(options: RunOptions): Promise<RunResult> {
  const editor = vscode.window.activeTextEditor;
  if (!options.workspace && !options.file && !editor) {
    return {
      success: false,
      hasIssues: false,
      exitCode: 1,
      stdout: '',
      stderr: 'No active editor',
      output: 'No active editor',
    };
  }

  const filePath = options.file || editor?.document.uri.fsPath;
  if (!filePath) {
    return {
      success: false,
      hasIssues: false,
      exitCode: 1,
      stdout: '',
      stderr: 'No file path',
      output: 'No file path',
    };
  }

  const projectRoot = findProjectRoot(filePath);
  if (!projectRoot) {
    return {
      success: false,
      hasIssues: false,
      exitCode: 1,
      stdout: '',
      stderr: 'No Gemfile found in project tree',
      output: 'No Gemfile found in project tree',
    };
  }

  const caps = await detectCapabilities(projectRoot);
  if (caps) {
    logInfo(`DocScribe: detected docscribe v${caps.version}`);
    if (!caps.hasServerMode && !serverModeWarningShown) {
      serverModeWarningShown = true;
      vscode.window.showWarningMessage(
        `DocScribe gem ${caps.version} does not support server mode (requires >=1.5.1). Using CLI. Please upgrade: bundle update docscribe`,
      );
    } else if (caps.hasServerMode && !caps.hasBatchMode && !serverModeWarningShown) {
      // 1.5.1 has server but check_batch buggy on Ruby 4.0 — warn once
      try {
        const rubyVersion = await new Promise<string>((resolve) => {
          proc.execFile('ruby', ['--version'], {}, (err: Error | null, stdout: string) => {
            resolve(err ? '' : stdout);
          });
        });
        if (rubyVersion.includes('ruby 4.')) {
          serverModeWarningShown = true;
          vscode.window.showWarningMessage(
            `DocScribe ${caps.version} has known check_batch issue on Ruby 4.0. Upgrade to >=1.6.1`,
          );
        }
      } catch {
        // ignore
      }
    } else if (caps.hasServerMode && !caps.hasValidateTypes && !serverModeWarningShown) {
      serverModeWarningShown = true;
      vscode.window.showWarningMessage(
        `DocScribe ${caps.version} does not support validate-types and file-scoped update_types (requires >=1.6.2). Please upgrade: bundle update docscribe`,
      );
    }
  }

  const config = vscode.workspace.getConfiguration('docscribe');
  const strategy = options.strategy || 'check';
  const json = options.json ?? true;
  const rbs = resolveRbsContext(projectRoot, caps);
  const omitBoilerplate = config.get<boolean>('omitBoilerplate', false);
  const args = getCommandArgs(
    strategy,
    json,
    rbs.useRbs,
    omitBoilerplate,
    options.workspace ? undefined : filePath,
    rbs.validateTypes,
    rbs.collection,
  );

  const useServer = config.get<boolean>('useServer', true);
  const canUseServer = useServer && (caps ? caps.hasServerMode : true);
  if (canUseServer && strategy === 'check' && !options.workspace) {
    try {
      const serverRunning = await ensureServerRunning(projectRoot);
      if (serverRunning) {
        const result = await checkFileViaServer(filePath, rbs.overrides);
        const parsed = JSON.parse(result);
        const offenseCount = parsed?.summary?.offense_count || 0;
        return {
          success: true,
          hasIssues: offenseCount > 0,
          exitCode: offenseCount > 0 ? 1 : 0,
          stdout: result,
          stderr: '',
          output: result,
        };
      }
    } catch {
      // Fallback to CLI
    }
  }

  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const commandPath = config.get<string>('commandPath', 'docscribe');
  const bundlePath = config.get<string>('bundlePath', 'bundle');

  if (useBundleExec) {
    return execCommand(bundlePath, ['exec', commandPath, ...args], projectRoot);
  }
  return execCommand(commandPath, args, projectRoot);
}
