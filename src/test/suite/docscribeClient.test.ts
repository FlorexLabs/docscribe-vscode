import * as assert from 'assert';
import {
  parseSocketPath,
  localeEnv,
  serverStartScript,
  changesToCheckJson,
  setSocketPathForTesting,
  getSocketPath,
} from '../../docscribeClient';

suite('docscribeClient', () => {
  suiteSetup(() => {
    setSocketPathForTesting(null);
  });

  suite('parseSocketPath', () => {
    test('extracts socket path from first line', () => {
      assert.strictEqual(
        parseSocketPath('/tmp/docscribe-abc123.sock\n'),
        '/tmp/docscribe-abc123.sock',
      );
    });

    test('skips warning lines before the path', () => {
      const stdout = 'warning: something\n/tmp/docscribe-abc123.sock\n';
      assert.strictEqual(parseSocketPath(stdout), '/tmp/docscribe-abc123.sock');
    });

    test('returns null on empty output', () => {
      assert.strictEqual(parseSocketPath(''), null);
    });

    test('returns null on relative or non-path line', () => {
      assert.strictEqual(parseSocketPath('docscribe.sock\n'), null);
    });
  });

  suite('localeEnv', () => {
    test('falls back to en_US.UTF-8 when LANG unset', () => {
      const savedLang = process.env.LANG;
      const savedLc = process.env.LC_ALL;
      try {
        delete process.env.LANG;
        delete process.env.LC_ALL;
        const env = localeEnv();
        assert.strictEqual(env.LANG, 'en_US.UTF-8');
        assert.strictEqual(env.LC_ALL, 'en_US.UTF-8');
      } finally {
        if (savedLang !== undefined) process.env.LANG = savedLang;
        if (savedLc !== undefined) process.env.LC_ALL = savedLc;
      }
    });

    test('preserves an existing LANG and pins LC_ALL', () => {
      const savedLang = process.env.LANG;
      const savedLc = process.env.LC_ALL;
      try {
        process.env.LANG = 'ru_RU.UTF-8';
        delete process.env.LC_ALL;
        const env = localeEnv();
        assert.strictEqual(env.LANG, 'ru_RU.UTF-8');
        assert.strictEqual(env.LC_ALL, 'ru_RU.UTF-8');
      } finally {
        if (savedLang !== undefined) process.env.LANG = savedLang;
        if (savedLc !== undefined) process.env.LC_ALL = savedLc;
      }
    });

    test('keeps the rest of the environment intact', () => {
      const env = localeEnv();
      assert.strictEqual(env.PATH, process.env.PATH);
      assert.strictEqual(env.HOME, process.env.HOME);
    });
  });

  suite('serverStartScript', () => {
    test('starts daemon and prints socket path', () => {
      const script = serverStartScript();
      assert.ok(script.includes('Docscribe::Server.ensure_running!'));
      assert.ok(script.includes('daemonize: false'));
      assert.ok(script.includes('puts Docscribe::Server.socket_path'));
    });
  });

  suite('changesToCheckJson', () => {
    test('builds CLI-format JSON with summary from daemon changes', () => {
      const json = changesToCheckJson('/tmp/ds-test/sample.rb', [
        { type: 'insert_full_doc_block', file: '/tmp/ds-test/sample.rb', line: 2 },
      ]);
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.summary.offense_count, 1);
      assert.strictEqual(parsed.summary.target_file_count, 1);
      assert.strictEqual(parsed.summary.error_count, 0);
      assert.strictEqual(parsed.files.length, 1);
      assert.strictEqual(parsed.files[0].path, '/tmp/ds-test/sample.rb');
      assert.strictEqual(parsed.files[0].offenses[0].location.start_line, 2);
      assert.strictEqual(parsed.files[0].offenses[0].cop_name, 'DocScribe/MissingDocumentation');
    });

    test('handles empty changes', () => {
      const json = changesToCheckJson('/tmp/clean.rb', []);
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.summary.offense_count, 0);
      assert.deepStrictEqual(parsed.files[0].offenses, []);
    });

    test('defaults line to 1 for malformed change entries', () => {
      const json = changesToCheckJson('/tmp/x.rb', [{ type: 'insert_full_doc_block' }]);
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.files[0].offenses[0].location.start_line, 1);
    });
  });

  suite('socketPath', () => {
    test('getSocketPath returns null by default', () => {
      assert.strictEqual(getSocketPath(), null);
    });

    test('setSocketPathForTesting overrides', () => {
      setSocketPathForTesting('/tmp/test.sock');
      assert.strictEqual(getSocketPath(), '/tmp/test.sock');
      setSocketPathForTesting(null);
      assert.strictEqual(getSocketPath(), null);
    });
  });
});
