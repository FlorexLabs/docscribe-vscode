import * as assert from 'assert';
import * as vscode from 'vscode';
import { createLmTools, type LmToolDeps, type LmToolDef } from '../../lmTools';
import type { RunResult } from '../../docscribeRunner';
import { buildDoctorReport } from '../../doctorReport';

function fakeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    success: true,
    hasIssues: false,
    cancelled: false,
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

const JSON_TOOLS = [
  'docscribe_check_file',
  'docscribe_check_workspace',
  'docscribe_safe_fix',
  'docscribe_aggressive_fix',
  'docscribe_update_types',
] as const;

const FILE_TOOLS = [
  'docscribe_check_file',
  'docscribe_safe_fix',
  'docscribe_aggressive_fix',
  'docscribe_update_types',
] as const;

function fileInput(): Record<string, unknown> {
  return { filePath: '/tmp/a.rb' };
}

suite('lmTools QA 2I', () => {
  suite('all six tools via agent-host entry (createLmTools invoke)', () => {
    test('every tool invokes and returns text', async () => {
      const defs = createLmTools(fakeDeps());
      assert.strictEqual(defs.length, 6);
      for (const name of [...JSON_TOOLS, 'docscribe_doctor' as const]) {
        const def = byName(defs, name);
        const input =
          name === 'docscribe_doctor' || name === 'docscribe_check_workspace' ? {} : fileInput();
        const result = await def.tool.invoke(invokeOptions(input), noToken());
        assert.ok(textOf(result).length > 0, `${name} returns text`);
      }
    });

    test('JSON tools preserve result JSON shape', async () => {
      const defs = createLmTools(fakeDeps());
      for (const name of JSON_TOOLS) {
        const input = name === 'docscribe_check_workspace' ? {} : fileInput();
        const parsed = JSON.parse(
          textOf(await byName(defs, name).tool.invoke(invokeOptions(input), noToken())),
        ) as Record<string, unknown>;
        assert.deepStrictEqual(Object.keys(parsed).sort(), [
          'exitCode',
          'hasIssues',
          'stderr',
          'stdout',
          'success',
        ]);
        assert.strictEqual(typeof parsed['success'], 'boolean');
        assert.strictEqual(typeof parsed['hasIssues'], 'boolean');
        assert.strictEqual(typeof parsed['exitCode'], 'number');
        assert.strictEqual(typeof parsed['stdout'], 'string');
        assert.strictEqual(typeof parsed['stderr'], 'string');
        assert.ok((parsed['stdout'] as string).length <= 4000 + 64, `${name} stdout bounded`);
        assert.ok((parsed['stderr'] as string).length <= 1000 + 64, `${name} stderr bounded`);
      }
    });

    test('short output is not truncated', async () => {
      const deps = fakeDeps();
      deps.runCheck = async () => fakeResult({ stdout: 'ok', stderr: '' });
      const defs = createLmTools(deps);
      const parsed = JSON.parse(
        textOf(
          await byName(defs, 'docscribe_check_file').tool.invoke(
            invokeOptions(fileInput()),
            noToken(),
          ),
        ),
      );
      assert.strictEqual(parsed.stdout, 'ok');
      assert.strictEqual(parsed.stderr, '');
    });

    test('long stdout/stderr carry truncation marker', async () => {
      const longStdout = 'x'.repeat(5000);
      const longStderr = 'y'.repeat(1500);
      const deps = fakeDeps();
      deps.runCheck = async () => fakeResult({ stdout: longStdout, stderr: longStderr });
      const defs = createLmTools(deps);
      const parsed = JSON.parse(
        textOf(
          await byName(defs, 'docscribe_check_file').tool.invoke(
            invokeOptions(fileInput()),
            noToken(),
          ),
        ),
      ) as { stdout: string; stderr: string };
      assert.ok(parsed.stdout.includes('…(truncated'), 'stdout marker');
      assert.ok(parsed.stdout.startsWith('x'.repeat(4000)), 'stdout keeps first 4000 chars');
      assert.ok(parsed.stdout.length < longStdout.length, 'stdout bounded');
      assert.ok(parsed.stderr.includes('…(truncated'), 'stderr marker');
      assert.ok(parsed.stderr.startsWith('y'.repeat(1000)), 'stderr keeps first 1000 chars');
      assert.ok(parsed.stderr.length < longStderr.length, 'stderr bounded');
    });

    test('boundary: exactly at limit stays intact, one over truncates', async () => {
      const deps = fakeDeps();
      deps.runCheck = async () =>
        fakeResult({ stdout: 's'.repeat(4000), stderr: 'e'.repeat(1000) });
      let parsed = JSON.parse(
        textOf(
          await byName(createLmTools(deps), 'docscribe_check_file').tool.invoke(
            invokeOptions(fileInput()),
            noToken(),
          ),
        ),
      ) as { stdout: string; stderr: string };
      assert.strictEqual(parsed.stdout, 's'.repeat(4000));
      assert.strictEqual(parsed.stderr, 'e'.repeat(1000));

      deps.runCheck = async () =>
        fakeResult({ stdout: 's'.repeat(4001), stderr: 'e'.repeat(1001) });
      parsed = JSON.parse(
        textOf(
          await byName(createLmTools(deps), 'docscribe_check_file').tool.invoke(
            invokeOptions(fileInput()),
            noToken(),
          ),
        ),
      ) as { stdout: string; stderr: string };
      assert.ok(parsed.stdout.includes('…(truncated'));
      assert.ok(parsed.stderr.includes('…(truncated'));
    });
  });

  suite('Missing required input: filePath', () => {
    for (const name of FILE_TOOLS) {
      test(`${name} rejects missing filePath`, async () => {
        const defs = createLmTools(fakeDeps());
        await assert.rejects(async () => {
          await byName(defs, name).tool.invoke(invokeOptions({}), noToken());
        }, /Missing required input: filePath/);
      });
    }

    test('rejects empty / wrong-type filePath', async () => {
      const defs = createLmTools(fakeDeps());
      const def = byName(defs, 'docscribe_check_file');
      for (const bad of [{ filePath: '' }, { filePath: 123 }, { filePath: null }, {}]) {
        await assert.rejects(async () => {
          await def.tool.invoke(invokeOptions(bad), noToken());
        }, /Missing required input: filePath/);
      }
    });

    test('workspace and doctor do not require filePath', async () => {
      const defs = createLmTools(fakeDeps());
      const workspace = textOf(
        await byName(defs, 'docscribe_check_workspace').tool.invoke(invokeOptions({}), noToken()),
      );
      assert.ok(workspace.includes('workspace-ok'));
      const doctor = textOf(
        await byName(defs, 'docscribe_doctor').tool.invoke(invokeOptions({}), noToken()),
      );
      assert.strictEqual(doctor, 'doctor-report');
    });
  });

  suite('doctor equals panel builder output', () => {
    test('doctor tool returns runDoctor text verbatim (not JSON)', async () => {
      const expected = await buildDoctorReport();
      const deps = fakeDeps();
      deps.runDoctor = async () => expected;
      const defs = createLmTools(deps);
      const actual = textOf(
        await byName(defs, 'docscribe_doctor').tool.invoke(invokeOptions({}), noToken()),
      );
      assert.strictEqual(actual, expected);
      assert.ok(actual.includes('=== DocScribe Doctor ==='));
    });
  });
});
