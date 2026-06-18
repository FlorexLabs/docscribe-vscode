import * as vscode from 'vscode';
import { runDocscribe, findProjectRoot, type RunResult } from './docscribeRunner';
import * as path from 'path';
import { minimatch } from 'minimatch';

interface JsonOffense {
  severity: string;
  cop_name: string;
  message: string;
  corrected: boolean;
  correctable: boolean;
  location: {
    start_line: number;
    start_column: number;
    last_line: number;
    last_column: number;
  };
}

interface JsonFileEntry {
  path: string;
  offenses: JsonOffense[];
}

interface JsonOutput {
  metadata: {
    docscribe_version: string;
    ruby_version: string;
  };
  files: JsonFileEntry[];
  summary: {
    offense_count: number;
    target_file_count: number;
    inspected_file_count: number;
    error_count: number;
  };
}

interface FileDiagnostics {
  issues: { line: number; message: string; severity: string; copName: string }[];
  error: boolean;
}

export function parseJsonOutput(output: string): Map<string, FileDiagnostics> {
  const files = new Map<string, FileDiagnostics>();

  let parsed: JsonOutput;
  try {
    parsed = JSON.parse(output) as JsonOutput;
  } catch {
    return files;
  }

  if (!parsed.files || !Array.isArray(parsed.files)) {
    return files;
  }

  for (const file of parsed.files) {
    if (!file.offenses || file.offenses.length === 0) continue;

    const issues = file.offenses.map((o) => ({
      line: o.location.start_line,
      message: o.message,
      severity: o.severity,
      copName: o.cop_name,
    }));

    files.set(file.path, { issues, error: false });
  }

  return files;
}

const collection = vscode.languages.createDiagnosticCollection('docscribe');

function isIgnored(filePath: string): boolean {
  const config = vscode.workspace.getConfiguration('docscribe');
  const patterns = config.get<string[]>('ignorePatterns', []);
  if (patterns.length === 0) return false;
  return patterns.some((p) => minimatch(filePath, p, { dot: true }));
}

export async function checkDocument(document: vscode.TextDocument): Promise<RunResult | null> {
  const uri = document.uri;

  if (!['ruby', 'rake'].includes(document.languageId)) {
    collection.delete(uri);
    return null;
  }

  if (isIgnored(uri.fsPath)) {
    collection.delete(uri);
    return null;
  }

  const root = findProjectRoot(uri.fsPath);
  if (!root) {
    collection.delete(uri);
    return null;
  }

  const result = await runDocscribe({
    file: uri.fsPath,
    strategy: 'check',
    json: true,
  });

  if (!result.success && !result.stdout) {
    collection.delete(uri);
    return result;
  }

  const files = parseJsonOutput(result.stdout);
  const fileKey = path.relative(root, uri.fsPath);
  const fileDiagnostics = files.get(fileKey) || files.get(uri.fsPath);

  if (!fileDiagnostics || fileDiagnostics.error) {
    collection.delete(uri);
    return result;
  }

  const diagnostics: vscode.Diagnostic[] = fileDiagnostics.issues.map((issue) => {
    const line = Math.max(0, issue.line - 1);
    const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
    const severity =
      issue.severity === 'fatal'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;
    const diag = new vscode.Diagnostic(range, issue.message, severity);
    diag.source = 'docscribe';
    diag.code = issue.copName;
    return diag;
  });

  collection.set(uri, diagnostics);
  return result;
}

export function createDiagnosticProvider(
  onCheckResult?: (result: RunResult) => void,
): vscode.Disposable {
  const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
    const config = vscode.workspace.getConfiguration('docscribe');
    if (!config.get<boolean>('runOnSave', true)) return;
    const result = await checkDocument(doc);
    if (result && onCheckResult) onCheckResult(result);
  });

  const onOpen = vscode.workspace.onDidOpenTextDocument(async (doc) => {
    if (!['ruby', 'rake'].includes(doc.languageId)) return;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'DocScribe' },
      () => checkDocument(doc),
    );
    if (result && onCheckResult) onCheckResult(result);
  });

  return vscode.Disposable.from(collection, onSave, onOpen);
}
