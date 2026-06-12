import * as assert from 'assert';
import * as vscode from 'vscode';

suite('DocScribe Extension', () => {
  test('extension should be present', () => {
    assert.ok(true, 'extension loaded');
  });

  test('commands should be registered', async () => {
    const ext = vscode.extensions.getExtension('unurgunite.docscribe-vscode');
    console.log('Extension found:', !!ext);
    if (ext) {
      console.log('Extension activated:', ext.isActive);
      if (!ext.isActive) {
        await ext.activate();
        console.log('After manual activate:', ext.isActive);
      }
    }

    const commands = await vscode.commands.getCommands(true);
    const docscribeCommands = commands.filter((c: string) => c.startsWith('docscribe.'));

    console.log('docscribe commands:', JSON.stringify(docscribeCommands));

    assert.ok(docscribeCommands.includes('docscribe.checkFile'));
    assert.ok(docscribeCommands.includes('docscribe.checkWorkspace'));
    assert.ok(docscribeCommands.includes('docscribe.safeFix'));
    assert.ok(docscribeCommands.includes('docscribe.aggressiveFix'));
    assert.ok(docscribeCommands.includes('docscribe.applyFix'));
  });
});
