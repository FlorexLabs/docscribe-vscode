import * as vscode from 'vscode';
import { runDocscribe, findProjectRoot } from './docscribeRunner';
import * as path from 'path';

interface ParsedIssue {
  line: number;
  message: string;
}

interface FileDiagnostics {
  issues: ParsedIssue[];
  error: boolean;
}

export function parseExplainOutput(output: string): Map<string, FileDiagnostics> {
  const files = new Map<string, FileDiagnostics>();
  let currentFile: string | null = null;
  let currentIssues: ParsedIssue[] = [];

  const lineRe = /at line (\d+)/;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd();

    if (line.startsWith('OK ') || line.startsWith('FAIL ') || line.startsWith('ERR ')) {
      if (currentFile) {
        files.set(currentFile, { issues: currentIssues, error: false });
      }

      const sep = line.indexOf(' ');
      const status = line.substring(0, sep);
      currentFile = line.substring(sep + 1);
      currentIssues = [];
      const isErr = status === 'ERR';

      if (isErr) {
        files.set(currentFile, { issues: [], error: true });
        currentFile = null;
      }
    } else if (currentFile && line.startsWith('  - ')) {
      const match = line.match(lineRe);
      if (match) {
        currentIssues.push({
          line: parseInt(match[1], 10),
          message: line.replace(/^\s*-\s*/, ''),
        });
      }
    }
  }

  if (currentFile) {
    files.set(currentFile, { issues: currentIssues, error: false });
  }

  return files;
}

const collection = vscode.languages.createDiagnosticCollection('docscribe');

export async function checkDocument(document: vscode.TextDocument): Promise<void> {
  const uri = document.uri;

  if (document.languageId !== 'ruby') {
    collection.delete(uri);
    return;
  }

  const root = findProjectRoot(uri.fsPath);
  if (!root) {
    collection.delete(uri);
    return;
  }

  const result = await runDocscribe({
    file: uri.fsPath,
    strategy: 'check',
    explain: true,
  });

  if (!result.success && !result.output) {
    collection.delete(uri);
    return;
  }

  const files = parseExplainOutput(result.output);
  const fileKey = path.relative(root, uri.fsPath);
  const fileDiagnostics = files.get(fileKey) || files.get(uri.fsPath);

  if (!fileDiagnostics || fileDiagnostics.error) {
    collection.delete(uri);
    return;
  }

  const diagnostics: vscode.Diagnostic[] = fileDiagnostics.issues.map((issue) => {
    const line = Math.max(0, issue.line - 1);
    const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
    const diag = new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Warning);
    diag.source = 'docscribe';
    return diag;
  });

  collection.set(uri, diagnostics);
}

export function createDiagnosticProvider(): vscode.Disposable {
  const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
    const config = vscode.workspace.getConfiguration('docscribe');
    if (!config.get<boolean>('runOnSave', true)) return;
    await checkDocument(doc);
  });

  const onOpen = vscode.workspace.onDidOpenTextDocument(async (doc) => {
    if (doc.languageId === 'ruby') {
      await checkDocument(doc);
    }
  });

  return vscode.Disposable.from(collection, onSave, onOpen);
}
