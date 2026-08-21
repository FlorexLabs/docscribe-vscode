import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { execFile } from './execAsync';

/**
 * JSON-RPC request sent over the Unix socket.
 *
 * `params` is a JSON object (the daemon reads `params['file']`,
 * `params['strategy']`, etc.), never an array.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * The real socket path of the docscribe daemon for the current project.
 *
 * The daemon derives it from the project root and environment files
 * (`Gemfile.lock`, `rbs_collection.lock.yaml`), so it cannot be computed
 * by the extension. It is captured from the daemon process stdout.
 */
let socketPath: string | null = null;

/**
 * The current daemon socket path discovered from stdout, or `null`.
 */
export function getSocketPath(): string | null {
  return socketPath;
}

/**
 * Override the socket path (used by tests).
 */
export function setSocketPathForTesting(value: string | null): void {
  socketPath = value;
}

/**
 * The Ruby snippet used to start the daemon and print its socket path.
 *
 * Runs `ensure_running!` (which forks the daemon and returns) and then
 * prints the real socket path (`{SOCKET_DIR}/docscribe-<md5>.sock`) as the
 * first line of stdout.
 */
export function serverStartScript(): string {
  return (
    "require 'docscribe/server'; " +
    'Docscribe::Server.ensure_running!(daemonize: false, timeout: 15); ' +
    'puts Docscribe::Server.socket_path'
  );
}

/**
 * Environment for the daemon child process.
 *
 * macOS GUI-launched processes often have no `LANG` set, which makes Ruby
 * read source files as US-ASCII and fail on non-ASCII content. Fall back
 * to `en_US.UTF-8` and pin both `LANG` and `LC_ALL`. The rest of the
 * current environment (PATH, GEM_HOME, rbenv, ...) must be preserved —
 * `execFile` replaces the entire environment when `env` is given.
 */
export function localeEnv(): Record<string, string | undefined> {
  const lang = process.env.LANG && process.env.LANG.trim() ? process.env.LANG : 'en_US.UTF-8';
  return { ...process.env, LANG: lang, LC_ALL: lang };
}

/**
 * Sends a JSON-RPC request to the daemon over the discovered Unix socket.
 *
 * @param method - RPC method (`ping`, `check`, `fix`, `check_batch`, `shutdown`).
 * @param params - Object-form parameters (must not be an array).
 * @returns The `result` field of the response.
 */
function sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (!socketPath) {
    return Promise.reject(new Error('DocScribe server socket path is not set'));
  }
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const id = Date.now();

    let data = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error('Socket request timeout'))),
      30000,
    );

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };

    client.connect(socketPath as string, () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      data += chunk.toString();
      try {
        const response: JsonRpcResponse = JSON.parse(data);
        if (response.id !== id) return;
        if (response.error) {
          finish(() => reject(new Error(response.error?.message || 'RPC error')));
        } else {
          finish(() => resolve(response.result));
        }
      } catch {
        // incomplete JSON, wait for more data
      }
    });

    client.on('error', (err) => finish(() => reject(err)));
  });
}

/**
 * Extract the daemon socket path from the startup process stdout.
 *
 * The daemon prints `puts Docscribe::Server.socket_path` as the first
 * line; any preceding warnings must be skipped, so the first line that
 * looks like an absolute path wins.
 *
 * @param stdout - Full stdout of the startup process.
 * @returns The socket path (absolute), or `null` if none found.
 */
export function parseSocketPath(stdout: string): string | null {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('/'));
  return line ?? null;
}

/**
 * Path to the pid file for a given socket.
 *
 * The daemon writes `${socket}.pid` with its PID (see `Daemon#write_pid`
 * in the gem). Used to detect stale sockets.
 *
 * @param socket - Absolute socket path.
 * @returns Absolute pid file path.
 */
export function pidPath(socket: string): string {
  return `${socket}.pid`;
}

/**
 * Read PID from the pid file.
 *
 * @param socket - Absolute socket path.
 * @returns PID as number, or `null` if missing/unreadable.
 */
export function readPid(socket: string): number | null {
  try {
    const raw = fs.readFileSync(pidPath(socket), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Check if a process with given PID is alive.
 *
 * Uses `process.kill(pid, 0)` — does not send signal, just checks existence.
 * `EPERM` means process exists but no permission → alive.
 *
 * @param pid - Process identifier.
 * @returns `true` if process is alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ESRCH = no such process, EPERM = exists but not permitted
    if (code === 'ESRCH') return false;
    return code === 'EPERM';
  }
}

/**
 * Remove stale socket and pid files (best-effort).
 *
 * @param socket - Absolute socket path to clean.
 */
export function cleanSocketFiles(socket: string): void {
  try {
    fs.unlinkSync(socket);
  } catch {
    // ignore — may not exist
  }
  try {
    fs.unlinkSync(pidPath(socket));
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handle `ECONNREFUSED` on a socket.
 *
 * Mirrors the gem logic (`Server.handle_stale_socket?`):
 * if PID is alive → daemon is starting, don't clean;
 * if PID dead/missing → clean stale files.
 *
 * @param socket - Absolute socket path that refused connection.
 * @returns `true` if files were cleaned, `false` if left intact (process alive).
 */
export function handleStaleSocket(socket: string): boolean {
  const pid = readPid(socket);
  if (pid !== null && isProcessAlive(pid)) {
    return false;
  }
  cleanSocketFiles(socket);
  return true;
}

/**
 * Ensure the docscribe daemon is running for a project.
 *
 * 1. If a socket path was already discovered and `ping` succeeds, done.
 * 2. Otherwise spawns Ruby with {@link serverStartScript} in the project
 *    root and reads the real socket path from the first stdout line.
 *
 * @param projectRoot - Working directory (project root) for the daemon.
 * @returns `true` if the daemon is reachable.
 */
export async function ensureServerRunning(projectRoot: string): Promise<boolean> {
  if (socketPath) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sendRequest('ping');
        return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'ECONNREFUSED') {
          const cleaned = handleStaleSocket(socketPath);
          if (!cleaned) {
            // Daemon is starting (PID alive) — wait and retry
            if (attempt < 2) {
              await sleep(500);
              continue;
            }
            return false;
          }
          break;
        }
        if (code === 'ENOENT' || code === 'ENOTSOCK') {
          cleanSocketFiles(socketPath);
          break;
        }
        // Timeout or other transient error — retry a couple times
        if (attempt < 2) {
          await sleep(500);
          continue;
        }
        // Last attempt failed — treat stale and break to restart
        if (code === undefined) {
          // For timeout (no code) we don't clean aggressively
          break;
        }
        cleanSocketFiles(socketPath);
        break;
      }
    }
  }

  const config = vscode.workspace.getConfiguration('docscribe');
  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const bundlePath = config.get<string>('bundlePath', 'bundle');
  const rubyPath = config.get<string>('rubyPath', 'ruby');
  const script = serverStartScript();

  const run = (): Promise<string | null> =>
    new Promise((resolve) => {
      execFile(
        useBundleExec ? bundlePath : rubyPath,
        useBundleExec ? ['exec', 'ruby', '-e', script] : ['-e', script],
        { cwd: projectRoot, env: localeEnv() },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          resolve(parseSocketPath(stdout));
        },
      );
    });

  const discovered = await run();
  if (!discovered) return false;

  socketPath = discovered;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sendRequest('ping');
      return true;
    } catch {
      if (attempt < 2) {
        await sleep(500);
        continue;
      }
      socketPath = null;
      return false;
    }
  }
  socketPath = null;
  return false;
}

/**
 * Gracefully stop the daemon (shutdown RPC + best-effort file cleanup).
 *
 * The daemon itself removes socket/pid on `shutdown` (`Daemon#cleanup`);
 * we clean again as a safeguard for stale leftovers.
 */
export async function stopServer(): Promise<void> {
  const target = socketPath;
  try {
    await sendRequest('shutdown');
  } catch {
    // ignore
  }
  if (target) {
    cleanSocketFiles(target);
    if (socketPath === target) {
      socketPath = null;
    }
  }
}

/**
 * Convert a daemon `changes` list into the CLI `--format json` shape.
 *
 * The daemon `check` response is `{ status, changed, changes }` where each
 * change entry carries a `line`. The CLI JSON output uses files/offenses
 * with a `summary.offense_count`, which consumers (status bar, runner)
 * already parse.
 *
 * @param filePath - The file the changes belong to.
 * @param changes - Entries from the daemon response.
 * @returns A JSON string in CLI `--format json` format.
 */
export function changesToCheckJson(filePath: string, changes: unknown): string {
  const offenses = (Array.isArray(changes) ? changes : []).map((change) => {
    const line =
      typeof change === 'object' &&
      change !== null &&
      typeof (change as Record<string, unknown>)['line'] === 'number'
        ? ((change as Record<string, unknown>)['line'] as number)
        : 1;
    return {
      severity: 'convention',
      cop_name: 'DocScribe/MissingDocumentation',
      message: 'Missing YARD documentation',
      corrected: false,
      correctable: true,
      location: {
        start_line: line,
        start_column: 1,
        last_line: line,
        last_column: 1,
      },
    };
  });
  return JSON.stringify({
    files: [{ path: filePath, offenses }],
    summary: {
      offense_count: offenses.length,
      target_file_count: 1,
      inspected_file_count: 1,
      error_count: 0,
    },
  });
}

/**
 * Convert a `check_batch` results array into the CLI `--format json` shape.
 *
 * Mirrors `DocscribeDaemon.buildBatchCheckJson` in the RubyMine plugin:
 * each result with `status: "ok"|"fail"` becomes a file entry with offenses
 * derived from `changes`; results with `status: "error"` count toward
 * `error_count` and are not added to `files`.
 *
 * @param results - The `results` array from `check_batch` response.
 * @returns A JSON string in CLI `--format json` format.
 */
export function batchResultsToJson(results: unknown): string {
  const list = Array.isArray(results) ? results : [];
  const files: Record<string, unknown>[] = [];
  let offenseCount = 0;
  let errorCount = 0;
  let targetCount = 0;

  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const filePath = rec['file'];
    if (typeof filePath !== 'string' || !filePath) continue;
    targetCount++;
    const status = typeof rec['status'] === 'string' ? rec['status'] : 'error';
    if (status === 'error') {
      errorCount++;
      continue;
    }
    const changes = rec['changes'];
    const offenses = (Array.isArray(changes) ? changes : []).map((change) => {
      const line =
        typeof change === 'object' &&
        change !== null &&
        typeof (change as Record<string, unknown>)['line'] === 'number'
          ? ((change as Record<string, unknown>)['line'] as number)
          : 1;
      return {
        severity: 'convention',
        cop_name: 'DocScribe/MissingDocumentation',
        message: 'Missing YARD documentation',
        corrected: false,
        correctable: true,
        location: {
          start_line: line,
          start_column: 1,
          last_line: line,
          last_column: 1,
        },
      };
    });
    offenseCount += offenses.length;
    files.push({ path: filePath, offenses });
  }

  return JSON.stringify({
    metadata: { docscribe_version: '1.5.1' },
    files,
    summary: {
      offense_count: offenseCount,
      target_file_count: targetCount,
      inspected_file_count: files.length,
      error_count: errorCount,
    },
  });
}

/**
 * Run a multi-file check through the daemon (`check_batch`).
 *
 * @param files - Absolute paths of files to check.
 * @returns The CLI `--format json`-shaped output as a string.
 */
export async function checkBatchViaServer(files: string[]): Promise<string> {
  const result = (await sendRequest('check_batch', { files })) as Record<string, unknown>;
  const results = result?.['results'];
  return batchResultsToJson(results);
}

/**
 * Run a single-file check through the daemon.
 *
 * @param filePath - Absolute path of the file to check (dry-run).
 * @returns The CLI `--format json`-shaped output as a string.
 */
export async function checkFileViaServer(filePath: string): Promise<string> {
  const result = (await sendRequest('check', { file: filePath })) as Record<string, unknown>;
  return changesToCheckJson(filePath, result?.['changes']);
}

/**
 * Fix a file contents through the daemon.
 *
 * The daemon `fix` RPC accepts `{ file, strategy }` and writes the result
 * to disk. The extension works with unsaved editor contents, so the code
 * is staged in a temp file first and read back after the RPC.
 *
 * @param code - Current editor contents (possibly unsaved).
 * @param mode - Fix strategy (`safe` or `aggressive`).
 * @returns The fixed code, or the original input when nothing changed.
 */
export async function applyFixViaServer(
  code: string,
  mode: 'safe' | 'aggressive',
): Promise<string> {
  const tmp = path.join(
    os.tmpdir(),
    `docscribe-fix-${Date.now()}-${Math.random().toString(36).slice(2)}.rb`,
  );
  fs.writeFileSync(tmp, code);
  try {
    const result = (await sendRequest('fix', { file: tmp, strategy: mode })) as Record<
      string,
      unknown
    >;
    if (result?.['changed']) {
      return fs.readFileSync(tmp, 'utf8');
    }
    return code;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

/**
 * Whether server mode is usable for a project (starts the daemon if needed).
 *
 * @param projectRoot - Working directory (project root) for the daemon.
 * @returns `true` if the daemon answers `ping`.
 */
export async function checkServerCapability(projectRoot: string): Promise<boolean> {
  const running = await ensureServerRunning(projectRoot);
  if (!running) return false;
  try {
    await sendRequest('ping');
    return true;
  } catch {
    return false;
  }
}
