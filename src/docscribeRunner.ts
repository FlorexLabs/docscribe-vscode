import * as vscode from 'vscode';
import * as proc from './execAsync';
import * as path from 'path';
import * as fs from 'fs';
import { minimatch } from 'minimatch';
import {
  ensureServerRunning,
  checkFileViaServer,
  updateTypesViaServer,
  type CliOverrides,
} from './docscribeClient';
import {
  gemfileHasRbs as gemfileListsRbs,
  shouldUseRbs,
  hasCollection,
  buildRbsCliOverrides,
  findDocscribeYml,
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
  /**
   * AbortSignal wired to the VS Code progress Cancel button (card 497).
   * When aborted, the child process is killed and the result is marked
   * `cancelled` instead of surfacing as an error.
   */
  signal?: AbortSignal;
}

/**
 * Checks whether the docscribe gem is installed in the current project.
 *
 * Runs `bundle exec docscribe --version` and requires a clean exit (code 0)
 * plus a version number on stdout. A bare `success` check is not enough:
 * bundler exits 1 with "not currently included" when the gem is missing,
 * and exit 1 means "issues found" (still successful) for docscribe runs —
 * so exit 1 here must count as *missing* (card 495).
 *
 * @param cwd - Working directory (project root) to run the check in.
 * @param execFn - Function used to spawn the process (default: `proc.execFile`).
 * @returns true if the gem reports its version cleanly.
 */
export async function checkGemInstalled(
  cwd: string,
  execFn: ExecFunction = proc.execFile,
): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('docscribe');
  const bundlePath = config.get<string>('bundlePath', 'bundle');
  const result = await execCommand(bundlePath, ['exec', 'docscribe', '--version'], cwd, execFn);
  return result.exitCode === 0 && /^\d+\.\d+\.\d+/.test(result.stdout.trim());
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
  /** True when the run was cancelled via {@link RunOptions.signal} (card 497). */
  cancelled: boolean;
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
 * Include/exclude file patterns (`filter.files` semantics).
 */
export interface FileFilterPatterns {
  include: string[];
  exclude: string[];
}

/**
 * Normalize one raw pattern (mirror gem `normalize_file_patterns`):
 * drop empties, expand `dir/` and existing-directory shorthands to `dir/**`.
 *
 * @param pattern - Raw pattern from config.
 * @param projectRoot - Absolute project root (for directory probing).
 * @returns Zero or more normalized patterns.
 */
export function normalizeFilePattern(pattern: string, projectRoot: string): string[] {
  const pat = pattern.trim();
  if (!pat) return [];
  if (pat.endsWith('/')) return [`${pat}**/*`];
  if (!/[*?\[{]/.test(pat)) {
    try {
      if (fs.statSync(path.join(projectRoot, pat)).isDirectory()) return [`${pat}/**/*`];
    } catch {
      // not a directory — keep as is
    }
  }
  return [pat];
}

/**
 * Match a relative file path against one filter pattern.
 *
 * Mirror gem `file_match_pattern?`: `/regex/` is a regexp, otherwise a
 * glob (a recursive segment is also tried collapsed to one slash),
 * dotfiles included.
 *
 * @param pattern - Normalized pattern.
 * @param relPath - Project-relative path with `/` separators.
 */
export function matchFilePattern(pattern: string, relPath: string): boolean {
  if (pattern.length >= 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(relPath);
    } catch {
      return false;
    }
  }
  const candidates = [pattern];
  if (pattern.includes('/**/')) candidates.push(pattern.replace(/\/\*\*\//g, '/'));
  return candidates.some((c) => minimatch(relPath, c, { dot: true }));
}

/**
 * Decide whether a file passes include/exclude patterns.
 *
 * Mirror gem `process_file?`: exclude wins; empty include means all.
 *
 * @param relPath - Project-relative path with `/` separators.
 * @param include - Include patterns (empty = everything).
 * @param exclude - Exclude patterns.
 */
export function processFileByFilter(
  relPath: string,
  include: string[],
  exclude: string[],
): boolean {
  if (exclude.some((p) => matchFilePattern(p, relPath))) return false;
  if (include.length === 0) return true;
  return include.some((p) => matchFilePattern(p, relPath));
}

function stripYamlScalar(value: string): string {
  let v = value.trim();
  const hashIndex = v.search(/\s+#/);
  if (hashIndex >= 0) v = v.slice(0, hashIndex).trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function parseInlineList(value: string): string[] {
  const inner = value.trim();
  if (!inner.startsWith('[')) return [];
  const body = inner.slice(1, inner.lastIndexOf(']'));
  if (!body.trim()) return [];
  return body
    .split(',')
    .map((item) => stripYamlScalar(item))
    .filter((item) => item.length > 0);
}

/**
 * Parse `filter.files.include/exclude` from a docscribe.yml text.
 *
 * Supports inline (`include: [a, b]`) and dash-list forms under
 * `filter:` → `files:`. Anything else is ignored (tolerant subset).
 *
 * @param yml - Raw config text.
 * @param projectRoot - Absolute project root (for shorthand probing).
 */
export function parseFilterFilesSection(yml: string, projectRoot: string): FileFilterPatterns {
  const include: string[] = [];
  const exclude: string[] = [];
  const lines = yml.split('\n');
  let inFilter = false;
  let filterIndent = -1;
  let inFiles = false;
  let filesIndent = -1;
  let current: string[] | null = null;
  let currentIndent = -1;

  const indentOf = (line: string): number => line.length - line.trimStart().length;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);

    if (/^filter\s*:\s*$/.test(trimmed) && indent === 0) {
      inFilter = true;
      filterIndent = 0;
      inFiles = false;
      current = null;
      continue;
    }
    if (!inFilter) continue;
    if (indent <= filterIndent && !/^filter\s*:/.test(trimmed)) {
      inFilter = false;
      inFiles = false;
      current = null;
      continue;
    }
    if (/^files\s*:\s*$/.test(trimmed)) {
      inFiles = true;
      filesIndent = indent;
      current = null;
      continue;
    }
    if (!inFiles) continue;
    if (indent <= filesIndent) {
      inFiles = false;
      current = null;
      continue;
    }
    const keyMatch = trimmed.match(/^(include|exclude)\s*:\s*(.*)$/);
    if (keyMatch && indent > filesIndent) {
      current = keyMatch[1] === 'include' ? include : exclude;
      currentIndent = indent;
      const rest = keyMatch[2].trim();
      if (rest.startsWith('[')) {
        for (const item of parseInlineList(rest)) {
          current.push(...normalizeFilePattern(item, projectRoot));
        }
        current = null;
      }
      continue;
    }
    if (current && indent > currentIndent) {
      const dashMatch = trimmed.match(/^-\s+(.*)$/);
      if (dashMatch) {
        const item = stripYamlScalar(dashMatch[1]);
        if (item) current.push(...normalizeFilePattern(item, projectRoot));
        continue;
      }
    }
    if (indent <= currentIndent) current = null;
  }

  return { include, exclude };
}

/**
 * Load file filter patterns for a project.
 *
 * `docscribe.yml` (`filter.files`) wins; without config (or without
 * patterns) falls back to `exclude: ['spec']` like the RubyMine plugin.
 * Empty exclude always defaults to `['spec']`; empty include means all.
 *
 * @param projectRoot - Absolute project root.
 */
export function loadFileFilterPatterns(projectRoot: string): FileFilterPatterns {
  // Fallback goes through the same normalization so a present `spec/`
  // dir becomes `spec/**/*` (bare `spec` would match nothing).
  const fallback = normalizeFilePattern('spec', projectRoot);
  const ymlPath = findDocscribeYml(projectRoot);
  if (!ymlPath) return { include: [], exclude: fallback };
  let content: string;
  try {
    content = fs.readFileSync(ymlPath, 'utf8');
  } catch {
    return { include: [], exclude: fallback };
  }
  const parsed = parseFilterFilesSection(content, projectRoot);
  return {
    include: parsed.include,
    exclude: parsed.exclude.length > 0 ? parsed.exclude : fallback,
  };
}

/**
 * `.gitignore` patterns of the project root (best-effort subset).
 */
export interface GitignorePatterns {
  ignore: string[];
  negate: string[];
}

/**
 * Load root `.gitignore` (comments/blank lines skipped, `!` = negation,
 * `dir/` expanded to `dir/**`). Nested gitignores are not read.
 *
 * @param projectRoot - Absolute project root.
 */
export function loadGitignorePatterns(projectRoot: string): GitignorePatterns {
  const ignore: string[] = [];
  const negate: string[] = [];
  let content: string;
  try {
    content = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
  } catch {
    return { ignore, negate };
  }
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const isNegate = line.startsWith('!');
    const body = (isNegate ? line.slice(1) : line).trim();
    if (!body) continue;
    const normalized = body.replace(/^\//, '');
    const patterns = normalized.endsWith('/')
      ? [`${normalized}**/*`]
      : [normalized, `${normalized}/**/*`];
    (isNegate ? negate : ignore).push(...patterns);
  }
  return { ignore, negate };
}

/**
 * Collect Ruby source files in a workspace for `check_batch`.
 *
 * Walks the project tree and returns absolute paths for `*.rb`, `*.rake`,
 * and `Rakefile`. Applies `docscribe.yml` `filter.files` (exclude wins,
 * empty include = all) and root `.gitignore`; a fixed `excludeDirs` set
 * stays as a safety net. Skips hidden and symlinked dirs.
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
  const { include, exclude } = loadFileFilterPatterns(projectRoot);
  const gitignore = loadGitignorePatterns(projectRoot);
  const toPosix = (p: string): string => path.relative(projectRoot, p).split(path.sep).join('/');
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
          const rel = toPosix(fullPath);
          if (gitignore.ignore.some((p) => matchFilePattern(p, rel))) {
            if (!gitignore.negate.some((p) => matchFilePattern(p, rel))) continue;
          }
          if (!processFileByFilter(rel, include, exclude)) continue;
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
 * Append `gem "rbs"` to Gemfile contents unless already present.
 *
 * Pure helper for the missing-RBS balloon action (card 466).
 *
 * @param gemfileContent - Raw Gemfile text.
 * @returns Updated text, or `null` when the `rbs` gem is already listed.
 */
export function ensureRbsGemLine(gemfileContent: string): string | null {
  if (/gem\s+['"]rbs['"]/.test(gemfileContent)) return null;
  const normalized = gemfileContent.endsWith('\n') ? gemfileContent : `${gemfileContent}\n`;
  return `${normalized}gem "rbs"\n`;
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
 * When `opts.signal` aborts, the child is killed and the result carries
 * `cancelled: true` (exit code is whatever the abort produced, usually 2).
 *
 * @param cmd - Command to execute.
 * @param args - Command-line arguments.
 * @param cwd - Working directory for the process.
 * @param execFn - Function used to spawn the process (default: `proc.execFile`).
 * @param opts - Optional AbortSignal to kill the child on cancellation.
 * @returns A promise resolving to a {@link RunResult}.
 */
export function execCommand(
  cmd: string,
  args: string[],
  cwd: string,
  execFn: ExecFunction = proc.execFile,
  opts?: { signal?: AbortSignal },
): Promise<RunResult> {
  return new Promise((resolve) => {
    // NB: the signal may already be aborted before we subscribe.
    let cancelled = opts?.signal?.aborted ?? false;
    const onAbort = (): void => {
      cancelled = true;
    };
    opts?.signal?.addEventListener('abort', onAbort, { once: true });
    const execOptions: Record<string, unknown> = { cwd, maxBuffer: 10 * 1024 * 1024 };
    if (opts?.signal) execOptions.signal = opts.signal;
    execFn(cmd, args, execOptions, (err, stdout, stderr) => {
      opts?.signal?.removeEventListener('abort', onAbort);
      const output = stderr ? `${stdout}\n${stderr}` : stdout;
      const exitCode = toExitCode(err);
      resolve({
        success: exitCode < 2 && !cancelled,
        hasIssues: exitCode === 1 && !cancelled,
        cancelled,
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
      cancelled: false,
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
      cancelled: false,
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
      cancelled: false,
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
          cancelled: false,
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

  // Single-file update_types goes through the daemon when available
  // (gem >= 1.6.2); workspace scope stays on CLI. The daemon writes the
  // file — callers must refresh open documents afterwards.
  const canUseUpdateTypesRpc = canUseServer && (caps ? caps.hasUpdateTypesRpc : false);
  if (canUseUpdateTypesRpc && strategy === 'updateTypes' && !options.workspace) {
    try {
      const serverRunning = await ensureServerRunning(projectRoot);
      if (serverRunning) {
        const ut = await updateTypesViaServer({ file: filePath }, rbs.overrides);
        const ok = ut.exit_code === 0;
        const stdout = `update_types: ${ut.status} (${ut.dir})`;
        return {
          success: ok,
          hasIssues: !ok,
          cancelled: false,
          exitCode: ut.exit_code,
          stdout,
          stderr: '',
          output: stdout,
        };
      }
    } catch {
      // Fallback to CLI (also covers -32601 unknown method on old daemons)
    }
  }

  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const commandPath = config.get<string>('commandPath', 'docscribe');
  const bundlePath = config.get<string>('bundlePath', 'bundle');

  if (useBundleExec) {
    return execCommand(bundlePath, ['exec', commandPath, ...args], projectRoot, proc.execFile, {
      signal: options.signal,
    });
  }
  return execCommand(commandPath, args, projectRoot, proc.execFile, { signal: options.signal });
}
