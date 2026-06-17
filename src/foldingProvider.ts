import * as vscode from 'vscode';

const COMMENT_RE = /^\s*#/;
const EMPTY_OR_CODE_RE = /^\s*$/;

function isCommentLine(text: string): boolean {
  return COMMENT_RE.test(text);
}

function isYardDocBlock(lines: string[]): boolean {
  return lines.some((l) => /@\w+/.test(l));
}

export class DocscribeFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken,
  ): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const config = vscode.workspace.getConfiguration('docscribe');
    const foldComments = config.get<boolean>('foldComments', false);
    const lineCount = document.lineCount;

    let i = 0;
    while (i < lineCount) {
      const line = document.lineAt(i);
      if (!isCommentLine(line.text) || EMPTY_OR_CODE_RE.test(line.text.trim())) {
        i++;
        continue;
      }

      let end = i;
      while (end + 1 < lineCount && isCommentLine(document.lineAt(end + 1).text)) {
        end++;
      }

      const blockLines: string[] = [];
      for (let j = i; j <= end; j++) {
        blockLines.push(document.lineAt(j).text);
      }

      const length = end - i + 1;
      if (length >= 3 && isYardDocBlock(blockLines) && i + 1 < lineCount) {
        const fr = new vscode.FoldingRange(i, end, vscode.FoldingRangeKind.Comment);
        if (foldComments) {
          Object.assign(fr, { collapsed: true });
        }
        ranges.push(fr);
      }
      i = end + 1;
    }

    return ranges;
  }
}
