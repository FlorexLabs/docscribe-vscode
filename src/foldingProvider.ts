import * as vscode from 'vscode';

const COMMENT_RE = /^\s*#/;

function isCommentLine(text: string): boolean {
  return COMMENT_RE.test(text);
}

export function getCommentBlockStartLines(doc: vscode.TextDocument): number[] {
  const lines: number[] = [];
  let i = 0;
  while (i < doc.lineCount) {
    const line = doc.lineAt(i);
    if (!isCommentLine(line.text)) {
      i++;
      continue;
    }

    let end = i;
    while (end + 1 < doc.lineCount && isCommentLine(doc.lineAt(end + 1).text)) {
      end++;
    }

    if (end - i + 1 >= 3) {
      lines.push(i);
    }
    i = end + 1;
  }
  return lines;
}

export class DocscribeFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken,
  ): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const startLines = getCommentBlockStartLines(document);

    for (const start of startLines) {
      let end = start;
      while (end + 1 < document.lineCount && isCommentLine(document.lineAt(end + 1).text)) {
        end++;
      }
      ranges.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Comment));
    }

    return ranges;
  }
}
