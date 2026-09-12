import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Screenshot-on-failure helper (card 486).
 *
 * Wired once as a Mocha root hook in `index.ts` — no per-file
 * `afterEach` needed. On test failure captures the headed host
 * screen via `screencapture -x` (macOS only, no-op elsewhere)
 * into gitignored `test-results/` and prints the PNG path.
 */

/** Make a test title safe for a filename. */
export function sanitizeTestName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '');
  return (clean || 'test').slice(0, 120);
}

/** PNG path for a failed test (repo-root `test-results/`). */
export function failureScreenshotPath(testTitle: string, now: Date = new Date()): string {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(repoRoot, 'test-results', `${stamp}_${sanitizeTestName(testTitle)}.png`);
}

/**
 * Capture a failure screenshot. Returns the PNG path or `null`
 * when skipped (non-macOS) or when capture fails.
 */
export function captureFailureScreenshot(testTitle: string): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const png = failureScreenshotPath(testTitle);
    fs.mkdirSync(path.dirname(png), { recursive: true });
    childProcess.execFileSync('screencapture', ['-x', png], { stdio: 'ignore' });
    // eslint-disable-next-line no-console
    console.log(`[failure-screenshot] ${png}`);
    return png;
  } catch {
    return null;
  }
}

/** Mocha root hooks — registered once in `index.ts`. */
export const failureScreenshotHooks = {
  afterEach(this: Mocha.Context): void {
    const current = this.currentTest as Mocha.Test | undefined;
    if (current?.state === 'failed') {
      const title =
        typeof current.fullTitle === 'function' && current.fullTitle()
          ? current.fullTitle()
          : current.title || 'unknown-test';
      captureFailureScreenshot(title);
    }
  },
};
