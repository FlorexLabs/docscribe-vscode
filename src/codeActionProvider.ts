import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { findProjectRoot, gemfileHasRbs } from './docscribeRunner';

interface DiffHunk {
  originalStart: number;
  originalEnd: number;
  newLines: string[];
}

function diffLines(
  original: string[],
  fixed: string[],
): { type: '=' | '+' | '-'; line?: number; text?: string }[] {
  const m = original.length;
  const n = fixed.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (original[i - 1] === fixed[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: { type: '=' | '+' | '-'; line?: number; text?: string }[] = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && original[i - 1] === fixed[j - 1]) {
      result.push({ type: '=', line: i - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: '+', text: fixed[j - 1] });
      j--;
    } else {
      result.push({ type: '-', line: i - 1 });
      i--;
    }
  }
  return result.reverse();
}

function getHunks(original: string, fixed: string): DiffHunk[] {
  const oLines = original.split('\n');
  const fLines = fixed.split('\n');
  const ops = diffLines(oLines, fLines);
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oi = 0;

  for (const op of ops) {
    if (op.type === '=') {
      if (current) {
        current.originalEnd = oi;
        hunks.push(current);
        current = null;
      }
      oi++;
    } else if (op.type === '+') {
      if (!current) {
        current = { originalStart: oi, originalEnd: oi, newLines: [] };
      }
      current.newLines.push(op.text as string);
    } else {
      if (!current) {
        current = { originalStart: oi, originalEnd: oi, newLines: [] };
      }
      current.originalEnd = oi + 1;
      oi++;
    }
  }
  if (current) {
    current.originalEnd = oi;
    hunks.push(current);
  }
  return hunks;
}

export class DocscribeCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] | undefined {
    const relevantDiags = context.diagnostics.filter((d) => d.source === 'docscribe');
    if (relevantDiags.length === 0) return undefined;

    const actions = relevantDiags.map((diag) => {
      const action = new vscode.CodeAction(
        `DocScribe: ${diag.message}`,
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: 'docscribe.applyFix',
        title: 'Apply docscribe fix',
        arguments: [document.uri, diag],
      };
      action.diagnostics = [diag];
      action.isPreferred = true;
      return action;
    });

    const fixAllSafe = new vscode.CodeAction(
      'DocScribe: fix all in file (safe)',
      vscode.CodeActionKind.QuickFix,
    );
    fixAllSafe.command = {
      command: 'docscribe.applyFix',
      title: 'Fix all in file (safe)',
      arguments: [document.uri, undefined, 'safe'],
    };
    actions.push(fixAllSafe);

    const fixAllAggressive = new vscode.CodeAction(
      'DocScribe: fix all in file (aggressive)',
      vscode.CodeActionKind.QuickFix,
    );
    fixAllAggressive.command = {
      command: 'docscribe.applyFix',
      title: 'Fix all in file (aggressive)',
      arguments: [document.uri, undefined, 'aggressive'],
    };
    actions.push(fixAllAggressive);

    return actions;
  }
}

export async function applyFix(
  uri: vscode.Uri,
  diagnostic?: vscode.Diagnostic,
  mode: 'safe' | 'aggressive' = 'safe',
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const root = findProjectRoot(uri.fsPath);
  if (!root) {
    vscode.window.showErrorMessage('No Gemfile found in project tree');
    return;
  }

  const code = doc.getText();

  const config = vscode.workspace.getConfiguration('docscribe');
  const useBundleExec = config.get<boolean>('useBundleExec', true);
  const commandPath = config.get<string>('commandPath', 'docscribe');
  const rbsEnabled = config.get<boolean>('useRbs', false);
  const useRbs = rbsEnabled && gemfileHasRbs(path.join(root, 'Gemfile'));

  const fixFlags = mode === 'aggressive' ? ['-A', '-k'] : ['-a'];
  const omitBoilerplate = config.get<boolean>('omitBoilerplate', false);
  if (omitBoilerplate) fixFlags.push('-B');

  const cmd = useBundleExec ? 'bundle' : commandPath;
  const cmdArgs = useBundleExec
    ? ['exec', commandPath, ...fixFlags, '--stdin', ...(useRbs ? ['--rbs-collection'] : [])]
    : [...fixFlags, '--stdin', ...(useRbs ? ['--rbs-collection'] : [])];

  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve) => {
      const child = execFile(
        cmd,
        cmdArgs,
        { cwd: root, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            code: err ? (typeof err.code === 'number' ? err.code : 2) : 0,
          });
        },
      );
      if (child.stdin) {
        child.stdin.write(code);
        child.stdin.end();
      }
    },
  );

  if ((result.code ?? 2) >= 2 || (!result.stdout && !result.stderr)) {
    vscode.window.showErrorMessage('DocScribe: failed to apply fix');
    return;
  }

  const fixedCode = result.stdout || result.stderr;

  if (diagnostic) {
    try {
      const hunks = getHunks(code, fixedCode);
      const dLine = diagnostic.range.start.line;
      const overlappingHunks = hunks.filter((h) => {
        if (h.originalStart === h.originalEnd) {
          return dLine >= h.originalStart && dLine <= h.originalStart + 5;
        }
        return h.originalStart <= dLine && h.originalEnd > dLine;
      });
      if (overlappingHunks.length === 0) {
        vscode.window.setStatusBarMessage('$(warning) DocScribe: no fix found for this line', 3000);
        return;
      }

      const sorted = [...overlappingHunks].sort((a, b) => b.originalStart - a.originalStart);
      const edit = new vscode.WorkspaceEdit();
      for (const hunk of sorted) {
        const range = new vscode.Range(hunk.originalStart, 0, hunk.originalEnd, 0);
        edit.replace(uri, range, hunk.newLines.join('\n') + '\n');
      }

      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        vscode.window.setStatusBarMessage('$(check) DocScribe: fix applied', 3000);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`DocScribe: fix failed - ${e}`);
    }
  } else {
    const lastLine = doc.lineCount - 1;
    const lastCol = doc.lineAt(lastLine).text.length;
    const fullRange = new vscode.Range(0, 0, lastLine, lastCol);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, fixedCode);

    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      vscode.window.setStatusBarMessage('$(check) DocScribe: fix applied', 3000);
    }
  }
}
