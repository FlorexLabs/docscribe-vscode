import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseJsonOutput } from '../../diagnosticProvider';

const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'suite', 'fixtures');

function loadJson(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

suite('diagnosticProvider', () => {
  suite('parseJsonOutput', () => {
    test('returns empty map for empty output', () => {
      const result = parseJsonOutput('');
      assert.strictEqual(result.size, 0);
    });

    test('returns empty map for invalid JSON', () => {
      const result = parseJsonOutput('not json');
      assert.strictEqual(result.size, 0);
    });

    test('parses a single file with one offense', () => {
      const result = parseJsonOutput(loadJson('single-offense.json'));
      assert.strictEqual(result.size, 1);

      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.error, false);
      assert.strictEqual(file.issues.length, 1);
      assert.strictEqual(file.issues[0].line, 10);
      assert.strictEqual(file.issues[0].message, 'missing @param for name at line 10');
      assert.strictEqual(file.issues[0].copName, 'Docscribe/MissingParam');
      assert.strictEqual(file.issues[0].severity, 'convention');
    });

    test('parses a single file with multiple offenses', () => {
      const result = parseJsonOutput(loadJson('multiple-offenses.json'));
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.issues.length, 2);
      assert.strictEqual(file.issues[0].copName, 'Docscribe/MissingParam');
      assert.strictEqual(file.issues[1].copName, 'Docscribe/MissingReturn');
    });

    test('parses multiple files', () => {
      const result = parseJsonOutput(loadJson('multiple-files.json'));
      assert.strictEqual(result.size, 2);
      assert.strictEqual(result.get('app/models/user.rb')?.issues.length, 1);
      assert.strictEqual(result.get('app/controllers/posts_controller.rb')?.issues.length, 2);
      assert.strictEqual(result.get('app/models/post.rb'), undefined);
    });

    test('handles fatal severity', () => {
      const result = parseJsonOutput(loadJson('error-output.json'));
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.issues.length, 1);
      assert.strictEqual(file.issues[0].severity, 'fatal');
    });

    test('parses .rake files the same as .rb files', () => {
      const result = parseJsonOutput(loadJson('rake-offense.json'));
      assert.strictEqual(result.size, 1);
      const file = result.get('lib/tasks/db.rake');
      assert.ok(file);
      assert.strictEqual(file.issues[0].line, 5);
      assert.strictEqual(file.issues[0].copName, 'Docscribe/MissingParam');
    });
  });
});
