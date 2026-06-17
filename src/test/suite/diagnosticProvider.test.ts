import * as assert from 'assert';
import { parseJsonOutput } from '../../diagnosticProvider';

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
      const json = JSON.stringify({
        metadata: { docscribe_version: '1.5.0', ruby_version: '3.2.0' },
        files: [
          {
            path: 'app/models/user.rb',
            offenses: [
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingParam',
                message: 'missing @param for name at line 10',
                corrected: false,
                correctable: true,
                location: { start_line: 10, start_column: 1, last_line: 10, last_column: 1 },
              },
            ],
          },
        ],
        summary: {
          offense_count: 1,
          target_file_count: 1,
          inspected_file_count: 1,
          error_count: 0,
        },
      });

      const result = parseJsonOutput(json);
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
      const json = JSON.stringify({
        metadata: { docscribe_version: '1.5.0', ruby_version: '3.2.0' },
        files: [
          {
            path: 'app/models/user.rb',
            offenses: [
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingParam',
                message: 'missing @param for name at line 10',
                corrected: false,
                correctable: true,
                location: { start_line: 10, start_column: 1, last_line: 10, last_column: 1 },
              },
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingReturn',
                message: 'missing @return at line 25',
                corrected: false,
                correctable: true,
                location: { start_line: 25, start_column: 1, last_line: 25, last_column: 1 },
              },
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingParam',
                message: 'missing @param for email at line 42',
                corrected: false,
                correctable: true,
                location: { start_line: 42, start_column: 1, last_line: 42, last_column: 1 },
              },
            ],
          },
        ],
        summary: {
          offense_count: 3,
          target_file_count: 1,
          inspected_file_count: 1,
          error_count: 0,
        },
      });

      const result = parseJsonOutput(json);
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.issues.length, 3);
      assert.strictEqual(file.issues[1].line, 25);
    });

    test('parses multiple files', () => {
      const json = JSON.stringify({
        metadata: { docscribe_version: '1.5.0', ruby_version: '3.2.0' },
        files: [
          {
            path: 'app/models/user.rb',
            offenses: [
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingParam',
                message: 'missing @param for name at line 15',
                corrected: false,
                correctable: true,
                location: { start_line: 15, start_column: 1, last_line: 15, last_column: 1 },
              },
            ],
          },
          {
            path: 'app/controllers/posts_controller.rb',
            offenses: [
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingParam',
                message: 'missing @param for id at line 5',
                corrected: false,
                correctable: true,
                location: { start_line: 5, start_column: 1, last_line: 5, last_column: 1 },
              },
              {
                severity: 'convention',
                cop_name: 'Docscribe/MissingReturn',
                message: 'missing @return at line 12',
                corrected: false,
                correctable: true,
                location: { start_line: 12, start_column: 1, last_line: 12, last_column: 1 },
              },
            ],
          },
          {
            path: 'app/models/post.rb',
            offenses: [],
          },
        ],
        summary: {
          offense_count: 3,
          target_file_count: 3,
          inspected_file_count: 3,
          error_count: 0,
        },
      });

      const result = parseJsonOutput(json);
      assert.strictEqual(result.size, 2);
      assert.strictEqual(result.get('app/models/user.rb')?.issues.length, 1);
      assert.strictEqual(result.get('app/controllers/posts_controller.rb')?.issues.length, 2);
      assert.strictEqual(result.get('app/models/post.rb'), undefined);
    });

    test('handles errors via summary.error_count', () => {
      const json = JSON.stringify({
        metadata: { docscribe_version: '1.5.0', ruby_version: '3.2.0' },
        files: [
          {
            path: 'app/models/user.rb',
            offenses: [
              {
                severity: 'fatal',
                cop_name: 'Docscribe/ProcessingError',
                message: 'Error reading file: Permission denied',
                corrected: false,
                correctable: false,
                location: { start_line: 1, start_column: 1, last_line: 1, last_column: 1 },
              },
            ],
          },
        ],
        summary: {
          offense_count: 1,
          target_file_count: 1,
          inspected_file_count: 0,
          error_count: 1,
        },
      });

      const result = parseJsonOutput(json);
      const file = result.get('app/models/user.rb');
      assert.ok(file);
      assert.strictEqual(file.error, false);
      assert.strictEqual(file.issues.length, 1);
      assert.strictEqual(file.issues[0].severity, 'fatal');
    });
  });
});
