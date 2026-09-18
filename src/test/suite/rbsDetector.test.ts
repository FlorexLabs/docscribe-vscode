import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findDocscribeYml,
  readExplicitRbsEnabled,
  hasSigFiles,
  hasRbsInLock,
  hasCollection,
  gemfileHasRbs,
  shouldUseRbs,
  rbsHash,
  buildRbsCliOverrides,
} from '../../rbsDetector';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ds-rbs-'));
}

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

suite('rbsDetector', () => {
  let root: string;

  setup(() => {
    root = makeRoot();
  });

  teardown(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  suite('gemfileHasRbs', () => {
    test('detects double-quoted gem', () => {
      const gemfile = path.join(root, 'Gemfile');
      fs.writeFileSync(gemfile, 'source "https://rubygems.org"\ngem "rbs"\n');
      assert.strictEqual(gemfileHasRbs(gemfile), true);
    });

    test('detects single-quoted gem', () => {
      const gemfile = path.join(root, 'Gemfile');
      fs.writeFileSync(gemfile, "gem 'rbs'\n");
      assert.strictEqual(gemfileHasRbs(gemfile), true);
    });

    test('returns false when absent or unreadable', () => {
      const gemfile = path.join(root, 'Gemfile');
      fs.writeFileSync(gemfile, 'gem "rails"\n');
      assert.strictEqual(gemfileHasRbs(gemfile), false);
      assert.strictEqual(gemfileHasRbs(path.join(root, 'Nope')), false);
    });
  });

  suite('hasSigFiles', () => {
    test('false without sig dir', () => {
      assert.strictEqual(hasSigFiles(root), false);
    });

    test('true with nested rbs file', () => {
      writeFile(root, 'sig/app/user.rbs', 'class User end');
      assert.strictEqual(hasSigFiles(root), true);
    });

    test('false with sig dir but no rbs files', () => {
      writeFile(root, 'sig/README.md', 'docs');
      assert.strictEqual(hasSigFiles(root), false);
    });
  });

  suite('hasRbsInLock', () => {
    test('matches indented rbs entry', () => {
      writeFile(root, 'Gemfile.lock', 'GEM\n  specs:\n    rbs (3.4.0)\n');
      assert.strictEqual(hasRbsInLock(root), true);
    });

    test('false without lock or entry', () => {
      assert.strictEqual(hasRbsInLock(root), false);
      writeFile(root, 'Gemfile.lock', 'GEM\n  specs:\n    rails (7.0)\n');
      // rewrite without rbs
      assert.strictEqual(hasRbsInLock(root), false);
    });
  });

  suite('hasCollection', () => {
    test('false by default, true when lock exists', () => {
      assert.strictEqual(hasCollection(root), false);
      writeFile(root, 'rbs_collection.lock.yaml', 'sources: []');
      assert.strictEqual(hasCollection(root), true);
    });
  });

  suite('readExplicitRbsEnabled', () => {
    test('null without config', () => {
      assert.strictEqual(readExplicitRbsEnabled(root), null);
    });

    test('reads true and false', () => {
      writeFile(root, 'docscribe.yml', 'rbs:\n  enabled: true\n');
      assert.strictEqual(readExplicitRbsEnabled(root), true);
      writeFile(root, 'docscribe.yml', 'rbs:\n  enabled: false\n');
      assert.strictEqual(readExplicitRbsEnabled(root), false);
    });

    test('reads dotted config name', () => {
      writeFile(root, '.docscribe.yml', 'rbs:\n  enabled: true\n');
      assert.strictEqual(readExplicitRbsEnabled(root), true);
    });

    test('null when rbs section has no enabled key', () => {
      writeFile(root, 'docscribe.yml', 'rbs:\n  collection: true\n');
      assert.strictEqual(readExplicitRbsEnabled(root), null);
    });
  });

  suite('findDocscribeYml', () => {
    test('prefers docscribe.yml over dotted name', () => {
      writeFile(root, '.docscribe.yml', 'a: 1');
      writeFile(root, 'docscribe.yml', 'b: 2');
      assert.strictEqual(findDocscribeYml(root), path.join(root, 'docscribe.yml'));
    });

    test('null when missing', () => {
      assert.strictEqual(findDocscribeYml(root), null);
    });
  });

  suite('shouldUseRbs', () => {
    test('explicit config wins over everything', () => {
      writeFile(root, 'docscribe.yml', 'rbs:\n  enabled: false\n');
      writeFile(root, 'sig/app/user.rbs', 'class User end');
      assert.strictEqual(shouldUseRbs(root, true), false);
      writeFile(root, 'docscribe.yml', 'rbs:\n  enabled: true\n');
      fs.rmSync(path.join(root, 'sig'), { recursive: true, force: true });
      assert.strictEqual(shouldUseRbs(root, false), true);
    });

    test('sig beats lock beats gemfile', () => {
      writeFile(root, 'sig/app/user.rbs', 'class User end');
      assert.strictEqual(shouldUseRbs(root, false), true);
      fs.rmSync(path.join(root, 'sig'), { recursive: true, force: true });
      writeFile(root, 'Gemfile.lock', 'GEM\n  specs:\n    rbs (3.4.0)\n');
      assert.strictEqual(shouldUseRbs(root, false), true);
      fs.rmSync(path.join(root, 'Gemfile.lock'), { force: true });
      assert.strictEqual(shouldUseRbs(root, true), true);
      assert.strictEqual(shouldUseRbs(root, false), false);
    });
  });

  suite('rbsHash', () => {
    test('stable for same tree', () => {
      writeFile(root, 'sig/app/user.rbs', 'class User end');
      const first = rbsHash(root, false);
      const second = rbsHash(root, false);
      assert.strictEqual(first, second);
    });

    test('changes on new sig file, collection and flag flip', () => {
      const base = rbsHash(root, false);
      writeFile(root, 'sig/app/user.rbs', 'class User end');
      const withSig = rbsHash(root, false);
      assert.notStrictEqual(withSig, base);
      writeFile(root, 'sig/app/other.rbs', 'class Other end');
      assert.notStrictEqual(rbsHash(root, false), withSig);
      const locked = rbsHash(root, false);
      writeFile(root, 'rbs_collection.lock.yaml', 'sources: []');
      assert.notStrictEqual(rbsHash(root, false), locked);
      // flag flip matters only without sig files to force it
      fs.rmSync(path.join(root, 'sig'), { recursive: true, force: true });
      fs.rmSync(path.join(root, 'rbs_collection.lock.yaml'), { force: true });
      assert.notStrictEqual(rbsHash(root, false), rbsHash(root, true));
    });
  });

  suite('buildRbsCliOverrides', () => {
    test('undefined when everything off', () => {
      assert.strictEqual(buildRbsCliOverrides(false, false, false), undefined);
    });

    test('rbs without collection', () => {
      assert.deepStrictEqual(buildRbsCliOverrides(true, false, false), { rbs: true });
    });

    test('rbs with collection and validate', () => {
      assert.deepStrictEqual(buildRbsCliOverrides(true, true, true), {
        rbs: true,
        rbs_collection: true,
        validate_types: true,
      });
    });

    test('validate alone without rbs', () => {
      assert.deepStrictEqual(buildRbsCliOverrides(false, false, true), {
        validate_types: true,
      });
    });
  });
});
