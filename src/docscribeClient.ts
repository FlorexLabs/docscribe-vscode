import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { execFile } from './execAsync';

const SOCKET_DIR = path.join(os.tmpdir(), 'docscribe');
const SOCKET_PATH = path.join(SOCKET_DIR, 'docscribe.sock');

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown[];
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export function getSocketPath(): string {
  return SOCKET_PATH;
}

function sendRequest(method: string, params?: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const id = Date.now();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    let data = '';
    client.connect(SOCKET_PATH, () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      data += chunk.toString();
      try {
        const response: JsonRpcResponse = JSON.parse(data);
        if (response.id !== id) return;
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
        client.destroy();
      } catch {
        // incomplete JSON, wait for more data
      }
    });

    client.on('error', (err) => {
      client.destroy();
      reject(err);
    });

    setTimeout(() => {
      client.destroy();
      reject(new Error('Socket request timeout'));
    }, 30000);
  });
}

export async function ensureServerRunning(projectRoot: string): Promise<boolean> {
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      await sendRequest('ping');
      return true;
    } catch {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {}
    }
  }

  try {
    fs.mkdirSync(SOCKET_DIR, { recursive: true });
  } catch {}

  const config = vscode.workspace.getConfiguration('docscribe');
  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const bundlePath = config.get<string>('bundlePath', 'bundle');
  const rubyPath = config.get<string>('rubyPath', 'ruby');

  const serverCmd = `${rubyPath} -e "require 'docscribe/server'; Docscribe::Server.ensure_running!"`;

  return new Promise((resolve) => {
    const child = useBundleExec
      ? execFile(bundlePath, ['exec', 'ruby', '-e', serverCmd], { cwd: projectRoot })
      : execFile(rubyPath, ['-e', serverCmd], { cwd: projectRoot });

    setTimeout(() => {
      if (fs.existsSync(SOCKET_PATH)) {
        resolve(true);
      } else {
        resolve(false);
      }
    }, 3000);

    child.on('error', () => resolve(false));
  });
}

export async function stopServer(): Promise<void> {
  try {
    await sendRequest('shutdown');
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}
}

export async function checkFileViaServer(filePath: string, useRbs: boolean): Promise<string> {
  const result = await sendRequest('check', [{ file: filePath, rbs: useRbs }]);
  return JSON.stringify(result);
}

export async function applyFixViaServer(
  code: string,
  mode: 'safe' | 'aggressive',
  useRbs: boolean,
): Promise<string> {
  const result = await sendRequest('fix', [{ code, mode, rbs: useRbs }]);
  return result as string;
}

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
