import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface RunOptions {
  file?: string;
  workspace?: boolean;
  strategy?: 'check' | 'safe' | 'aggressive';
}

export interface RunResult {
  success: boolean;
  output: string;
}

function findProjectRoot(startPath: string): string | null {
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

function getCommandArgs(strategy: string, filePath?: string): string[] {
  const args: string[] = [];
  if (strategy === 'safe') {
    args.push('-a');
  } else if (strategy === 'aggressive') {
    args.push('-A');
  }
  if (filePath) {
    args.push(filePath);
  }
  return args;
}

function execCommand(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = stderr ? `${stdout}\n${stderr}` : stdout;
      if (err) {
        resolve({ success: false, output });
      } else {
        resolve({ success: true, output });
      }
    });
  });
}

export async function runDocscribe(options: RunOptions): Promise<RunResult> {
  const editor = vscode.window.activeTextEditor;
  if (!options.workspace && !editor) {
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
  const args = getCommandArgs(strategy, options.workspace ? undefined : filePath);

  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const commandPath = config.get<string>('commandPath', 'docscribe');

  if (useBundleExec) {
    return execCommand('bundle', ['exec', commandPath, ...args], projectRoot);
  }
  return execCommand(commandPath, args, projectRoot);
}
