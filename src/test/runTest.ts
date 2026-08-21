import { runTests } from '@vscode/test-electron';
import * as path from 'path';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

    const vsCodeVersionIndex = process.argv.indexOf('--vscode-version');
    const version = vsCodeVersionIndex >= 0 ? process.argv[vsCodeVersionIndex + 1] : undefined;

    const workspaceIndex = process.argv.indexOf('--workspace');
    const workspace = workspaceIndex >= 0 ? process.argv[workspaceIndex + 1] : undefined;

    const exitCode = await runTests({
      version,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: workspace ? [workspace] : [],
    });

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } catch (err) {
    console.error('Failed to run tests:', err); // eslint-disable-line no-console
    process.exit(1);
  }
}

main();
