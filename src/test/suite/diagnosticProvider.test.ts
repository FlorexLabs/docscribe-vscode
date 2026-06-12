import * as assert from 'assert';
import { parseExplainOutput } from '../../diagnosticProvider';

suite('diagnosticProvider', () => {
  suite('parseExplainOutput', () => {
    test('returns empty map for empty output', () => {
      const result = parseExplainOutput('');
      assert.strictEqual(result.size, 0);
    });

    test('returns empty map for whitespace-only output', () => {
      const result = parseExplainOutput('\n  \n');
      assert.strictEqual(result.size, 0);
    });

    test('parses a single file with one issue', () => {
      const output = ['OK app/models/user.rb', '  - Missing documentation at line 15'].join('\n');

      const result = parseExplainOutput(output);
      assert.strictEqual(result.size, 1);

      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.error, false);
      assert.strictEqual(file.issues.length, 1);
      assert.strictEqual(file.issues[0].line, 15);
      assert.strictEqual(file.issues[0].message, 'Missing documentation at line 15');
    });

    test('parses a single file with multiple issues', () => {
      const output = [
        'OK app/models/user.rb',
        '  - Missing documentation at line 10',
        '  - Missing documentation at line 25',
        '  - Missing documentation at line 42',
      ].join('\n');

      const result = parseExplainOutput(output);
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.issues.length, 3);
      assert.strictEqual(file.issues[1].line, 25);
    });

    test('parses multiple files', () => {
      const output = [
        'OK app/models/user.rb',
        '  - Missing documentation at line 15',
        'OK app/controllers/posts_controller.rb',
        '  - Missing documentation at line 5',
        '  - Missing documentation at line 12',
        'OK app/models/post.rb',
      ].join('\n');

      const result = parseExplainOutput(output);
      assert.strictEqual(result.size, 3);
      assert.strictEqual(result.get('app/models/user.rb')?.issues.length, 1);
      assert.strictEqual(result.get('app/controllers/posts_controller.rb')?.issues.length, 2);
      assert.strictEqual(result.get('app/models/post.rb')?.issues.length, 0);
    });

    test('handles ERR status', () => {
      const output = ['ERR app/models/user.rb'].join('\n');

      const result = parseExplainOutput(output);
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.error, true);
      assert.strictEqual(file.issues.length, 0);
    });

    test('handles FAIL status like OK', () => {
      const output = ['FAIL app/models/user.rb', '  - Missing documentation at line 15'].join('\n');

      const result = parseExplainOutput(output);
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.error, false);
      assert.strictEqual(file.issues.length, 1);
    });

    test('skips lines without line number', () => {
      const output = ['OK app/models/user.rb', '  - Some warning without line number'].join('\n');

      const result = parseExplainOutput(output);
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.issues.length, 0);
    });

    test('ignores non-matching lines between files', () => {
      const output = [
        'OK app/models/user.rb',
        '  - Missing documentation at line 15',
        '',
        'some random output',
        'OK app/models/post.rb',
        '  - Missing documentation at line 42',
      ].join('\n');

      const result = parseExplainOutput(output);
      assert.strictEqual(result.size, 2);
    });
  });
});
