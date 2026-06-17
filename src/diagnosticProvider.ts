import * as vscode from 'vscode';
import { runDocscribe, findProjectRoot } from './docscribeRunner';
import * as path from 'path';

/**
 * A single offense from docscribe's JSON output (RuboCop-compatible format).
 */
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

/**
 * A file entry in docscribe's JSON output.
 */
interface JsonFileEntry {
  path: string;
  offenses: JsonOffense[];
}

/**
 * Top-level docscribe JSON output structure.
 */
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

/**
 * Diagnostics grouped per file.
 */
interface FileDiagnostics {
  /** List of issues found in the file. */
  issues: { line: number; message: string; severity: string; copName: string }[];
  /** Whether docscribe reported an error for this file. */
  error: boolean;
}

/**
 * Parses docscribe `--format json` output into a per-file map of issues.
 *
 * The JSON format (docscribe ≥ 1.5.0) is RuboCop-compatible:
 * ```json
 * {
 *   "metadata": { ... },
 *   "files": [{
 *     "path": "path/to/file.rb",
 *     "offenses": [{
 *       "severity": "convention",
 *       "cop_name": "Docscribe/MissingParam",
 *       "message": "missing @param for name at line 10",
 *       "location": { "start_line": 10, ... }
 *     }]
 *   }],
 *   "summary": { ... }
 * }
 * ```
 *
 * @param output - Raw stdout from `docscribe --format json`.
 * @returns A map of relative file paths to their diagnostics.
 */
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

/** Global diagnostic collection shared across all documents. */
const collection = vscode.languages.createDiagnosticCollection('docscribe');

/**
 * Checks a Ruby file for undocumented methods and updates VS Code diagnostics.
 *
 * Runs docscribe in check + explain mode, parses the output,
 * and sets diagnostics on the document URI. Clears diagnostics
 * for non-Ruby files or when no project root is found.
 *
 * @param document - The text document to check.
 */
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
    json: true,
  });

  if (!result.success && !result.stdout) {
    collection.delete(uri);
    return;
  }

  const files = parseJsonOutput(result.stdout);
  const fileKey = path.relative(root, uri.fsPath);
  const fileDiagnostics = files.get(fileKey) || files.get(uri.fsPath);

  if (!fileDiagnostics || fileDiagnostics.error) {
    collection.delete(uri);
    return;
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
}

/**
 * Creates the diagnostic provider that listens to document save/open events.
 *
 * On save: checks if `docscribe.runOnSave` is enabled and runs diagnostics.
 * On open: runs diagnostics for Ruby files immediately.
 *
 * @returns A disposable that cleans up the collection and event listeners.
 */
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
