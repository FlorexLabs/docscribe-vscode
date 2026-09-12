import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import {
  findProjectRoot,
  execCommand,
  checkGemInstalled,
  parseCapabilities,
  clearCachedCapabilitiesForTesting,
  clearServerModeWarningForTesting,
  collectWorkspaceFiles,
  chunkArray,
  normalizeFilePattern,
  matchFilePattern,
  processFileByFilter,
  parseFilterFilesSection,
  loadFileFilterPatterns,
  loadGitignorePatterns,
  ensureRbsGemLine,
} from '../../docscribeRunner';

const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'suite', 'fixtures');

suite('docscribeRunner', () => {
  let tmpDir: string;

  suite('findProjectRoot', () => {
    setup(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docscribe-test-'));
    });

    teardown(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('returns directory containing Gemfile', () => {
      fs.mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });
      fs.copyFileSync(path.join(fixturesDir, 'Gemfile'), path.join(tmpDir, 'Gemfile'));
      const result = findProjectRoot(path.join(tmpDir, 'subdir'));
      assert.strictEqual(result, fs.realpathSync(tmpDir));
    });

    test('returns null when no Gemfile found', () => {
      const result = findProjectRoot(tmpDir);
      assert.strictEqual(result, null);
    });

    test('walks up directories to find Gemfile', () => {
      const subdir = path.join(tmpDir, 'a', 'b', 'c');
      fs.mkdirSync(subdir, { recursive: true });
      fs.copyFileSync(path.join(fixturesDir, 'Gemfile'), path.join(tmpDir, 'Gemfile'));
      const result = findProjectRoot(subdir);
      assert.strictEqual(result, fs.realpathSync(tmpDir));
    });

    test('returns null for nested dirs without Gemfile', () => {
      const subdir = path.join(tmpDir, 'a', 'b', 'c');
      fs.mkdirSync(subdir, { recursive: true });
      const result = findProjectRoot(subdir);
      assert.strictEqual(result, null);
    });

    test('stops at filesystem root', () => {
      const result = findProjectRoot('/');
      assert.strictEqual(result, null);
    });

    test('returns null for a deleted file instead of throwing (card 519)', () => {
      const ghost = path.join(tmpDir, 'gone.rb');
      assert.strictEqual(fs.existsSync(ghost), false);
      assert.strictEqual(findProjectRoot(ghost), null);
    });

    test('detects Gemfile in the fixtures directory', () => {
      const result = findProjectRoot(fixturesDir);
      assert.strictEqual(result, fs.realpathSync(fixturesDir));
    });
  });

  suite('runDocscribe', () => {
    test('returns error when no Gemfile found', async () => {
      const noGemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docscribe-nogem-'));
      const noGemFile = path.join(noGemDir, 'test.rb');
      fs.writeFileSync(noGemFile, '');
      const { runDocscribe } = await import('../../docscribeRunner');
      const result = await runDocscribe({ file: noGemFile, strategy: 'check' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.output, 'No Gemfile found in project tree');
      fs.rmSync(noGemDir, { recursive: true, force: true });
    });
  });

  suite('execCommand', () => {
    test('resolves with success on clean exec', async () => {
      const mockExec = sinon.stub().yields(null, 'output text', '');
      const result = await execCommand(
        'bundle',
        ['exec', 'docscribe', 'file.rb'],
        '/tmp',
        mockExec,
      );
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.hasIssues, false);
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, 'output text');
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(result.output, 'output text');
    });

    test('resolves with success but hasIssues on exit code 1', async () => {
      const err = Object.assign(new Error('issues found'), { code: 1 });
      const mockExec = sinon.stub().yields(err, 'json output', 'F');
      const result = await execCommand(
        'docscribe',
        ['--format', 'json', 'file.rb'],
        '/tmp',
        mockExec,
      );
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.hasIssues, true);
      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.stdout, 'json output');
    });

    test('resolves with failure on exec error (exit code 2+)', async () => {
      const err = Object.assign(new Error('fail'), { code: 2 });
      const mockExec = sinon.stub().yields(err, '', 'stderr text');
      const result = await execCommand('docscribe', ['file.rb'], '/tmp', mockExec);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.hasIssues, false);
      assert.strictEqual(result.exitCode, 2);
      assert.strictEqual(result.stderr, 'stderr text');
    });

    test('merges stderr into output', async () => {
      const mockExec = sinon.stub().yields(null, 'stdout', 'stderr');
      const result = await execCommand('bundle', ['exec', 'docscribe'], '/tmp', mockExec);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.stdout, 'stdout');
      assert.strictEqual(result.stderr, 'stderr');
      assert.strictEqual(result.output, 'stdout\nstderr');
    });

    test('marks result cancelled when signal aborts (card 497)', async () => {
      const controller = new AbortController();
      const mockExec = sinon
        .stub()
        .callsFake(
          (
            _cmd: string,
            _args: string[],
            options: { signal?: AbortSignal },
            callback: (err: Error | null, stdout: string, stderr: string) => void,
          ) => {
            if (options.signal?.aborted) {
              callback(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }), '', '');
            } else {
              callback(null, 'output text', '');
            }
          },
        );
      controller.abort();
      const result = await execCommand('bundle', ['exec', 'docscribe', 'a.rb'], '/tmp', mockExec, {
        signal: controller.signal,
      });
      assert.strictEqual(result.cancelled, true);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.hasIssues, false);
    });

    test('passes signal through to exec options', async () => {
      const controller = new AbortController();
      const mockExec = sinon.stub().yields(null, 'output text', '');
      await execCommand('bundle', ['exec', 'docscribe', 'a.rb'], '/tmp', mockExec, {
        signal: controller.signal,
      });
      const execOptions = mockExec.firstCall.args[2] as { signal?: AbortSignal };
      assert.strictEqual(execOptions.signal, controller.signal);
    });

    test('cancelled defaults to false without signal', async () => {
      const mockExec = sinon.stub().yields(null, 'output text', '');
      const result = await execCommand('bundle', ['exec', 'docscribe', 'a.rb'], '/tmp', mockExec);
      assert.strictEqual(result.cancelled, false);
    });
  });

  suite('checkGemInstalled', () => {
    test('returns true on exit 0 with version on stdout', async () => {
      const mockExec = sinon.stub().yields(null, '1.6.2\n', '');
      assert.strictEqual(await checkGemInstalled('/tmp', mockExec), true);
    });

    test('returns false on exit 1 (card 495: missing gem, bundler "not currently included")', async () => {
      const err = Object.assign(new Error('missing gem'), { code: 1 });
      const mockExec = sinon
        .stub()
        .yields(err, '', "Could not find gem 'docscribe' (not currently included)");
      assert.strictEqual(await checkGemInstalled('/tmp', mockExec), false);
    });

    test('returns false on exit 0 without version on stdout', async () => {
      const mockExec = sinon.stub().yields(null, '', '');
      assert.strictEqual(await checkGemInstalled('/tmp', mockExec), false);
    });

    test('returns false on exec error (exit code 2+)', async () => {
      const err = Object.assign(new Error('fail'), { code: 2 });
      const mockExec = sinon.stub().yields(err, '', 'bundler: command not found: bundle');
      assert.strictEqual(await checkGemInstalled('/tmp', mockExec), false);
    });
  });

  suite('parseCapabilities', () => {
    teardown(() => {
      clearCachedCapabilitiesForTesting();
      clearServerModeWarningForTesting();
    });

    test('returns null for empty string', () => {
      assert.strictEqual(parseCapabilities(''), null);
    });

    test('returns null for non-version string', () => {
      assert.strictEqual(parseCapabilities('not-a-version'), null);
    });

    test('parses 1.4.9 — no server, no batch', () => {
      const caps = parseCapabilities('1.4.9');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.4.9');
      assert.strictEqual(caps.hasServerMode, false);
      assert.strictEqual(caps.hasBatchMode, false);
      assert.strictEqual(caps.hasRbsCollection, true);
      assert.strictEqual(caps.hasExitCodeSemantics, false);
    });

    test('parses 1.5.0 — no server', () => {
      const caps = parseCapabilities('1.5.0');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, false);
      assert.strictEqual(caps.hasBatchMode, false);
      assert.strictEqual(caps.hasExitCodeSemantics, true);
    });

    test('parses 1.5.1 — server yes, batch no', () => {
      const caps = parseCapabilities('1.5.1');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.5.1');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, false);
    });

    test('parses 1.5.2 — server and batch', () => {
      const caps = parseCapabilities('1.5.2');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
    });

    test('parses 1.6.1 — server and batch, no 1.6.2 features', () => {
      const caps = parseCapabilities('1.6.1');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
      assert.strictEqual(caps.hasValidateTypes, false);
      assert.strictEqual(caps.hasUpdateTypesRpc, false);
    });

    test('parses 1.6.2 — validate-types and update_types RPC', () => {
      const caps = parseCapabilities('1.6.2');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.6.2');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
      assert.strictEqual(caps.hasValidateTypes, true);
      assert.strictEqual(caps.hasUpdateTypesRpc, true);
    });

    test('parses 2.0.0 — server and batch', () => {
      const caps = parseCapabilities('2.0.0');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.hasServerMode, true);
      assert.strictEqual(caps.hasBatchMode, true);
    });

    test('handles version with surrounding text', () => {
      const caps = parseCapabilities('docscribe 1.6.1');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.6.1');
      assert.strictEqual(caps.hasServerMode, true);
    });

    test('handles version with newline', () => {
      const caps = parseCapabilities('1.5.1\n');
      if (!caps) throw new Error('expected caps');
      assert.strictEqual(caps.version, '1.5.1');
      assert.strictEqual(caps.hasServerMode, true);
    });
  });

  suite('collectWorkspaceFiles', () => {
    test('finds rb and rake files and excludes node_modules', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-collect-'));
      try {
        fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(root, '.git'), { recursive: true });
        fs.writeFileSync(path.join(root, 'lib', 'a.rb'), '');
        fs.writeFileSync(path.join(root, 'lib', 'b.rake'), '');
        fs.writeFileSync(path.join(root, 'Rakefile'), '');
        fs.writeFileSync(path.join(root, 'node_modules', 'c.rb'), '');
        fs.writeFileSync(path.join(root, '.git', 'd.rb'), '');
        fs.writeFileSync(path.join(root, 'README.md'), '');
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(files.includes(path.join(root, 'lib', 'b.rake')));
        assert.ok(files.includes(path.join(root, 'Rakefile')));
        assert.ok(!files.includes(path.join(root, 'node_modules', 'c.rb')));
        assert.ok(!files.includes(path.join(root, '.git', 'd.rb')));
        assert.ok(!files.includes(path.join(root, 'README.md')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns sorted list', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-collect-'));
      try {
        fs.writeFileSync(path.join(root, 'z.rb'), '');
        fs.writeFileSync(path.join(root, 'a.rb'), '');
        const files = collectWorkspaceFiles(root);
        const sorted = [...files].sort();
        assert.deepStrictEqual(files, sorted);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('applies yml exclude and include', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-collect-'));
      try {
        fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
        fs.mkdirSync(path.join(root, 'spec'), { recursive: true });
        fs.writeFileSync(path.join(root, 'lib', 'a.rb'), '');
        fs.writeFileSync(path.join(root, 'spec', 'a_spec.rb'), '');
        fs.writeFileSync(
          path.join(root, 'docscribe.yml'),
          'filter:\n  files:\n    exclude:\n      - spec/\n    include:\n      - lib/\n',
        );
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'lib', 'a.rb')));
        assert.ok(!files.includes(path.join(root, 'spec', 'a_spec.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('respects root gitignore with negation', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-collect-'));
      try {
        fs.mkdirSync(path.join(root, 'gen'), { recursive: true });
        fs.writeFileSync(path.join(root, 'gen', 'a.rb'), '');
        fs.writeFileSync(path.join(root, 'gen', 'keep.rb'), '');
        fs.writeFileSync(path.join(root, 'top.rb'), '');
        fs.writeFileSync(path.join(root, '.gitignore'), 'gen/\n!gen/keep.rb\n');
        const files = collectWorkspaceFiles(root);
        assert.ok(!files.includes(path.join(root, 'gen', 'a.rb')));
        assert.ok(files.includes(path.join(root, 'gen', 'keep.rb')));
        assert.ok(files.includes(path.join(root, 'top.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('fileFilterPatterns', () => {
    test('normalizeFilePattern expands dir shorthand', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-filter-'));
      try {
        fs.mkdirSync(path.join(root, 'spec'), { recursive: true });
        assert.deepStrictEqual(normalizeFilePattern('spec/', root), ['spec/**/*']);
        assert.deepStrictEqual(normalizeFilePattern('spec', root), ['spec/**/*']);
        assert.deepStrictEqual(normalizeFilePattern('lib/*.rb', root), ['lib/*.rb']);
        assert.deepStrictEqual(normalizeFilePattern('  ', root), []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('matchFilePattern handles globs, collapsed segments and regex', () => {
      assert.strictEqual(matchFilePattern('spec/**/*', 'spec/a/b_spec.rb'), true);
      assert.strictEqual(matchFilePattern('spec/**/*', 'lib/a.rb'), false);
      assert.strictEqual(matchFilePattern('lib/**/*.rb', 'lib/a.rb'), true);
      assert.strictEqual(matchFilePattern('/_spec\\.rb$/', 'spec/a_spec.rb'), true);
      assert.strictEqual(matchFilePattern('/_spec\\.rb$/', 'lib/a.rb'), false);
      assert.strictEqual(matchFilePattern('**/.hidden.rb', '.hidden.rb'), true);
    });

    test('processFileByFilter: exclude wins, empty include means all', () => {
      assert.strictEqual(processFileByFilter('lib/a.rb', [], []), true);
      assert.strictEqual(processFileByFilter('spec/a.rb', [], ['spec']), true);
      assert.strictEqual(processFileByFilter('spec/a.rb', [], ['spec/**/*']), false);
      assert.strictEqual(processFileByFilter('lib/a.rb', ['lib/**/*'], ['lib/a.rb']), false);
      assert.strictEqual(processFileByFilter('lib/a.rb', ['app/**/*'], []), false);
      assert.strictEqual(processFileByFilter('lib/a.rb', ['lib/**/*'], []), true);
    });

    test('parseFilterFilesSection reads inline and dash forms', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-filter-'));
      try {
        const inline = parseFilterFilesSection(
          'filter:\n  files:\n    include: [lib, app]\n    exclude: [spec]\n',
          root,
        );
        assert.deepStrictEqual(inline.include, ['lib', 'app']);
        assert.deepStrictEqual(inline.exclude, ['spec']);
        const dash = parseFilterFilesSection(
          'filter:\n  files:\n    exclude:\n      - spec/\n      - "tmp/x"\n',
          root,
        );
        assert.deepStrictEqual(dash.include, []);
        assert.deepStrictEqual(dash.exclude, ['spec/**/*', 'tmp/x']);
        const missing = parseFilterFilesSection('other:\n  x: 1\n', root);
        assert.deepStrictEqual(missing, { include: [], exclude: [] });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('loadFileFilterPatterns falls back to spec exclude', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-filter-'));
      try {
        assert.deepStrictEqual(loadFileFilterPatterns(root), { include: [], exclude: ['spec'] });
        fs.writeFileSync(
          path.join(root, 'docscribe.yml'),
          'filter:\n  files:\n    include: [lib]\n',
        );
        assert.deepStrictEqual(loadFileFilterPatterns(root), {
          include: ['lib'],
          exclude: ['spec'],
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('fallback exclude actually filters an existing spec dir', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-filter-'));
      try {
        fs.mkdirSync(path.join(root, 'spec'), { recursive: true });
        fs.writeFileSync(path.join(root, 'spec', 'a_spec.rb'), '');
        fs.writeFileSync(path.join(root, 'top.rb'), '');
        // no yml: fallback must expand to spec/**/* since the dir exists
        assert.deepStrictEqual(loadFileFilterPatterns(root), {
          include: [],
          exclude: ['spec/**/*'],
        });
        const files = collectWorkspaceFiles(root);
        assert.ok(files.includes(path.join(root, 'top.rb')));
        assert.ok(!files.includes(path.join(root, 'spec', 'a_spec.rb')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test('loadGitignorePatterns skips comments and splits negations', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-filter-'));
      try {
        fs.writeFileSync(path.join(root, '.gitignore'), '# comment\n\ngen/\n!gen/keep.rb\n');
        assert.deepStrictEqual(loadGitignorePatterns(root), {
          ignore: ['gen/**/*'],
          negate: ['gen/keep.rb', 'gen/keep.rb/**/*'],
        });
        fs.rmSync(path.join(root, '.gitignore'));
        assert.deepStrictEqual(loadGitignorePatterns(root), { ignore: [], negate: [] });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  suite('ensureRbsGemLine', () => {
    test('appends gem line when missing', () => {
      const out = ensureRbsGemLine('source "https://rubygems.org"\ngem "rails"\n');
      assert.ok(out?.endsWith('gem "rbs"\n'));
      assert.ok(out?.includes('gem "rails"'));
    });

    test('adds trailing newline when missing', () => {
      assert.strictEqual(ensureRbsGemLine('gem "rails"'), 'gem "rails"\ngem "rbs"\n');
    });

    test('returns null when already present', () => {
      assert.strictEqual(ensureRbsGemLine('gem "rbs"\n'), null);
      assert.strictEqual(ensureRbsGemLine("gem 'rbs'\n"), null);
    });
  });

  suite('chunkArray', () => {
    test('splits array into chunks', () => {
      assert.deepStrictEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    });

    test('returns single chunk if size larger than array', () => {
      assert.deepStrictEqual(chunkArray([1, 2], 10), [[1, 2]]);
    });

    test('handles empty array', () => {
      assert.deepStrictEqual(chunkArray([], 32), []);
    });
  });
});
