import * as vscode from 'vscode';
import * as fs from 'fs';
import { findProjectRoot, ensureFreshCapabilities, resolveRbsContext } from './docscribeRunner';
import { execFile } from './execAsync';
import { getSocketPath, readPid, isProcessAlive } from './docscribeClient';

/**
 * Build the Doctor diagnostics report as plain text.
 *
 * Shared by the `docscribe.doctor` command (shown in the
 * `DocScribe Doctor` output channel) and the `docscribe_doctor`
 * language-model tool (returned as text to the agent).
 *
 * @returns Multi-line report: Ruby, project root, gem version,
 * capabilities (server/batch/RBS/exit codes/validate/update-RPC),
 * backend, socket, daemon PID, locale, RBS effect and settings.
 */
export async function buildDoctorReport(): Promise<string> {
  const lines: string[] = ['=== DocScribe Doctor ===', ''];

  try {
    const rubyResult = await new Promise<string>((resolve) => {
      execFile('ruby', ['--version'], (err: Error | null, stdout: string) => {
        resolve(err ? 'Not found' : stdout.trim());
      });
    });
    lines.push(`Ruby: ${rubyResult}`);
  } catch {
    lines.push('Ruby: Not found');
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const projectRoot = findProjectRoot(rootPath);
    lines.push(`Project root: ${projectRoot || 'Not found (no Gemfile)'}`);

    if (projectRoot) {
      const caps = await ensureFreshCapabilities(projectRoot);
      if (caps) {
        lines.push(`DocScribe version: ${caps.version}`);
        lines.push(
          `  Server mode: ${caps.hasServerMode ? 'Available' : 'Not available (requires >=1.5.1)'}`,
        );
        lines.push(
          `  Batch mode (check_batch): ${caps.hasBatchMode ? 'Available' : 'Not available (requires >=1.5.2)'}`,
        );
        lines.push(`  RBS collection: ${caps.hasRbsCollection ? 'Available' : 'Not available'}`);
        lines.push(
          `  Exit code semantics: ${caps.hasExitCodeSemantics ? 'Available' : 'Not available'}`,
        );
        const useServer = vscode.workspace
          .getConfiguration('docscribe')
          .get<boolean>('useServer', true);
        const backend = useServer && caps.hasServerMode ? 'server' : 'CLI';
        const reason = !caps.hasServerMode
          ? ' (fallback — gem <1.5.1)'
          : !useServer
            ? ' (disabled in settings)'
            : '';
        lines.push(`  Backend: ${backend}${reason}`);
        // RBS effect + validate-types + full capabilities dump (card 464)
        const rbsCtx = resolveRbsContext(projectRoot, caps);
        lines.push(
          `  RBS: ${rbsCtx.useRbs ? 'enabled' : 'disabled'}${
            rbsCtx.useRbs
              ? rbsCtx.collection
                ? ' (rbs_collection.lock.yaml found)'
                : ' (heuristic inference, no collection)'
              : ''
          }`,
        );
        lines.push(
          `  Validate types: ${
            rbsCtx.validateTypes === true
              ? 'on'
              : rbsCtx.validateTypes === false
                ? 'off'
                : 'unknown (gem version undetected)'
          }`,
        );
        lines.push(`  Capabilities: ${JSON.stringify(caps)}`);
        // Server socket / PID / locale diagnostics (feat/doctor-server-details)
        const sock = getSocketPath();
        if (sock) {
          const exists = fs.existsSync(sock);
          lines.push(`  Socket: ${sock} (exists: ${exists ? 'yes' : 'no'})`);
          const pid = readPid(sock);
          if (pid !== null) {
            const alive = isProcessAlive(pid);
            lines.push(`  Daemon PID: ${pid} (alive: ${alive ? 'yes' : 'no'})`);
          } else {
            lines.push('  Daemon PID: not found (.pid missing)');
          }
        } else {
          lines.push('  Socket: not determined (daemon not started yet)');
          lines.push('  Daemon PID: unknown');
        }
        const lang = process.env.LANG || '(unset)';
        const lcAll = process.env.LC_ALL || '(unset)';
        const localeNote =
          !process.env.LANG || !process.env.LANG.trim() ? ' → plugin will use en_US.UTF-8' : '';
        lines.push(`  Locale: LANG=${lang} LC_ALL=${lcAll}${localeNote}`);
      } else {
        lines.push('DocScribe version: Not detected');
        lines.push('');
        lines.push('Troubleshooting:');
        lines.push('  1. Ensure docscribe gem is installed: gem list docscribe');
        lines.push('  2. Add to Gemfile: gem "docscribe"');
        lines.push('  3. Run: bundle install');
      }
    }
  }

  const config = vscode.workspace.getConfiguration('docscribe');
  lines.push('');
  lines.push('Settings:');
  lines.push(`  runOnSave: ${config.get('runOnSave')}`);
  lines.push(`  useBundleExec: ${config.get('useBundleExec')}`);
  lines.push(`  useRbs: ${config.get('useRbs')}`);
  lines.push(`  validateTypes: ${config.get('validateTypes')}`);
  lines.push(`  useServer: ${config.get('useServer')}`);
  lines.push(`  commandPath: ${config.get('commandPath')}`);
  lines.push(`  ignorePatterns: ${JSON.stringify(config.get('ignorePatterns'))}`);
  lines.push(`  foldComments: ${config.get('foldComments')}`);
  lines.push(`  omitBoilerplate: ${config.get('omitBoilerplate')}`);

  return lines.join('\n');
}
