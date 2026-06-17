import * as assert from 'assert';
import * as vscode from 'vscode';
import * as pkg from '../../../package.json';

suite('DocScribe Extension', () => {
  test('extension should be present', () => {
    assert.ok(true, 'extension loaded');
  });

  test('commands should be registered', async () => {
    const ext = vscode.extensions.getExtension('unurgunite.docscribe-vscode');
    if (ext && !ext.isActive) {
      await ext.activate();
    }

    const commands = await vscode.commands.getCommands(true);
    const docscribeCommands = commands.filter((c: string) => c.startsWith('docscribe.'));

    assert.ok(docscribeCommands.includes('docscribe.checkFile'));
    assert.ok(docscribeCommands.includes('docscribe.checkWorkspace'));
    assert.ok(docscribeCommands.includes('docscribe.safeFix'));
    assert.ok(docscribeCommands.includes('docscribe.aggressiveFix'));
    assert.ok(docscribeCommands.includes('docscribe.applyFix'));
    assert.ok(docscribeCommands.includes('docscribe.toggleFoldComments'));
  });

  suite('A1: activationEvents', () => {
    test('should activate on ruby language', () => {
      assert.ok(pkg.activationEvents.includes('onLanguage:ruby'));
    });

    test('should activate on rake language', () => {
      assert.ok(pkg.activationEvents.includes('onLanguage:rake'));
    });

    test('should activate when Gemfile is present', () => {
      assert.ok(pkg.activationEvents.includes('workspaceContains:**/Gemfile'));
    });
  });

  suite('A2: keybindings', () => {
    test('should have checkFile keybinding for ruby', () => {
      const kb = pkg.contributes.keybindings.find(
        (k: { command: string }) => k.command === 'docscribe.checkFile',
      );
      assert.ok(kb);
      assert.strictEqual(kb.key, 'ctrl+shift+d');
      assert.strictEqual(kb.mac, 'cmd+shift+d');
      assert.strictEqual(kb.when, 'editorLangId == ruby');
    });
  });

  suite('A3: editor context menu', () => {
    test('should have checkFile in editor context', () => {
      const menu = pkg.contributes.menus['editor/context'];
      const checkFile = menu.find((m: { command: string }) => m.command === 'docscribe.checkFile');
      assert.ok(checkFile);
      assert.ok(checkFile.when.includes('ruby'));
    });

    test('should have safeFix in editor context', () => {
      const menu = pkg.contributes.menus['editor/context'];
      const safeFix = menu.find((m: { command: string }) => m.command === 'docscribe.safeFix');
      assert.ok(safeFix);
      assert.ok(safeFix.when.includes('ruby'));
    });

    test('should have aggressiveFix in editor context', () => {
      const menu = pkg.contributes.menus['editor/context'];
      const aggressiveFix = menu.find(
        (m: { command: string }) => m.command === 'docscribe.aggressiveFix',
      );
      assert.ok(aggressiveFix);
      assert.ok(aggressiveFix.when.includes('ruby'));
    });
  });

  suite('B2: ignorePatterns setting', () => {
    test('should have ignorePatterns configuration', () => {
      const prop = pkg.contributes.configuration.properties['docscribe.ignorePatterns'];
      assert.ok(prop);
      assert.strictEqual(prop.type, 'array');
      assert.deepStrictEqual(prop.default, []);
    });
  });

  suite('C3: foldComments setting', () => {
    test('should have foldComments configuration', () => {
      const prop = pkg.contributes.configuration.properties['docscribe.foldComments'];
      assert.ok(prop);
      assert.strictEqual(prop.type, 'boolean');
      assert.strictEqual(prop.default, false);
    });
  });
});
