import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { createLmTools, type LmToolDeps, type LmToolDef } from '../../lmTools';
import type { RunResult } from '../../docscribeRunner';
import { buildDoctorReport } from '../../doctorReport';

function fakeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    success: true,
    hasIssues: false,
    exitCode: 0,
    stdout: '',
    stderr: '',
    output: '',
    ...overrides,
  };
}

function fakeDeps(): LmToolDeps {
  return {
    runCheck: async (filePath: string) => fakeResult({ stdout: `checked:${filePath}` }),
    runWorkspaceCheck: async () => fakeResult({ stdout: 'workspace-ok' }),
    runFix: async (filePath: string, mode: string) =>
      fakeResult({ stdout: `fixed:${mode}:${filePath}` }),
    runUpdateTypes: async (filePath: string) => fakeResult({ stdout: `types:${filePath}` }),
    runDoctor: async () => 'doctor-report',
  };
}

function invokeOptions(
  input: unknown,
): vscode.LanguageModelToolInvocationOptions<Record<string, unknown>> {
  return { input: input as Record<string, unknown> } as vscode.LanguageModelToolInvocationOptions<
    Record<string, unknown>
  >;
}

function noToken(): vscode.CancellationToken {
  return {} as vscode.CancellationToken;
}

function textOf(result: vscode.ProviderResult<vscode.LanguageModelToolResult>): string {
  assert.ok(result instanceof vscode.LanguageModelToolResult);
  const part = result.content[0] as vscode.LanguageModelTextPart;
  assert.ok(part instanceof vscode.LanguageModelTextPart);
  return part.value;
}

function byName(defs: LmToolDef[], name: string): LmToolDef {
  const found = defs.find((d) => d.name === name);
  assert.ok(found, `tool ${name} registered`);
  return found as LmToolDef;
}

suite('lmTools', () => {
  suite('createLmTools', () => {
    test('registers six tools with expected names', () => {
      const names = createLmTools(fakeDeps()).map((d) => d.name);
      assert.deepStrictEqual(names, [
        'docscribe_check_file',
        'docscribe_check_workspace',
        'docscribe_safe_fix',
        'docscribe_aggressive_fix',
        'docscribe_update_types',
        'docscribe_doctor',
      ]);
    });

    test('check_file returns formatted result', async () => {
      const defs = createLmTools(fakeDeps());
      const result = await byName(defs, 'docscribe_check_file').tool.invoke(
        invokeOptions({ filePath: '/tmp/a.rb' }),
        noToken(),
      );
      const parsed = JSON.parse(textOf(result));
      assert.strictEqual(parsed.success, true);
      assert.ok((parsed.stdout as string).includes('checked:/tmp/a.rb'));
    });

    test('check_file rejects missing filePath', async () => {
      const defs = createLmTools(fakeDeps());
      await assert.rejects(async () => {
        await byName(defs, 'docscribe_check_file').tool.invoke(invokeOptions({}), noToken());
      }, /filePath/);
    });

    test('fix tools pass the right strategy', async () => {
      const defs = createLmTools(fakeDeps());
      const safe = JSON.parse(
        textOf(
          await byName(defs, 'docscribe_safe_fix').tool.invoke(
            invokeOptions({ filePath: '/tmp/a.rb' }),
            noToken(),
          ),
        ),
      );
      const aggressive = JSON.parse(
        textOf(
          await byName(defs, 'docscribe_aggressive_fix').tool.invoke(
            invokeOptions({ filePath: '/tmp/a.rb' }),
            noToken(),
          ),
        ),
      );
      assert.ok((safe.stdout as string).includes('fixed:safe:'));
      assert.ok((aggressive.stdout as string).includes('fixed:aggressive:'));
    });

    test('update_types and workspace and doctor return text', async () => {
      const defs = createLmTools(fakeDeps());
      const update = textOf(
        await byName(defs, 'docscribe_update_types').tool.invoke(
          invokeOptions({ filePath: '/tmp/a.rb' }),
          noToken(),
        ),
      );
      assert.ok(update.includes('types:/tmp/a.rb'));
      const workspace = textOf(
        await byName(defs, 'docscribe_check_workspace').tool.invoke(invokeOptions({}), noToken()),
      );
      assert.ok(workspace.includes('workspace-ok'));
      const doctor = textOf(
        await byName(defs, 'docscribe_doctor').tool.invoke(invokeOptions({}), noToken()),
      );
      assert.strictEqual(doctor, 'doctor-report');
    });

    test('failing dependency result is preserved, not thrown', async () => {
      const deps = fakeDeps();
      deps.runCheck = async () => fakeResult({ success: false, exitCode: 2, stderr: 'boom' });
      const defs = createLmTools(deps);
      const parsed = JSON.parse(
        textOf(
          await byName(defs, 'docscribe_check_file').tool.invoke(
            invokeOptions({ filePath: '/tmp/a.rb' }),
            noToken(),
          ),
        ),
      );
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.stderr, 'boom');
    });
  });

  suite('package nls parity', () => {
    test('every %key% in package.json exists in both nls files', () => {
      const root = path.resolve(__dirname, '..', '..', '..');
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
        contributes?: {
          commands?: { title?: string }[];
          languageModelTools?: { displayName?: string; modelDescription?: string }[];
        };
        description?: string;
      };
      const en = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8')) as Record<
        string,
        string
      >;
      const ru = JSON.parse(
        fs.readFileSync(path.join(root, 'package.nls.ru.json'), 'utf8'),
      ) as Record<string, string>;
      const keys = new Set<string>();
      const collect = (value: unknown): void => {
        if (typeof value === 'string') {
          for (const match of value.matchAll(/%([a-zA-Z0-9_.]+)%/g)) keys.add(match[1]);
        } else if (Array.isArray(value)) {
          value.forEach(collect);
        } else if (typeof value === 'object' && value !== null) {
          Object.values(value).forEach(collect);
        }
      };
      collect(pkg.description);
      collect(pkg.contributes?.commands);
      collect(pkg.contributes?.languageModelTools);
      assert.ok(keys.size > 20, `expected many nls keys, got ${keys.size}`);
      for (const key of keys) {
        assert.ok(typeof en[key] === 'string' && en[key].length > 0, `missing en key ${key}`);
        assert.ok(typeof ru[key] === 'string' && ru[key].length > 0, `missing ru key ${key}`);
      }
    });
  });

  suite('buildDoctorReport', () => {
    test('returns header and settings without workspace', async () => {
      const report = await buildDoctorReport();
      assert.ok(report.includes('=== DocScribe Doctor ==='));
      assert.ok(report.includes('Settings:'));
    });
  });
});
