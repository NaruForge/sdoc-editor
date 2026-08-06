const assert = require('node:assert/strict');
const vscode = require('vscode');

async function waitFor(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function run() {
  const extension = vscode.extensions.getExtension('swbaek.structured-doc-editor');
  assert.ok(extension, 'The development extension must be discoverable.');
  await extension.activate();
  assert.equal(extension.isActive, true, 'The extension must activate in the real Extension Host.');

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'structuredDocEditor.newSdoc',
    'structuredDocEditor.exportToHtml',
    'structuredDocEditor.cleanUpLegacySettings',
  ]) {
    assert.ok(commands.includes(command), `Expected registered command: ${command}`);
  }

  const workspace = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspace, 'The test workspace must be open.');
  const openCustomEditor = async (fileName, expectEditableUi = false) => {
    const documentUri = vscode.Uri.joinPath(workspace.uri, fileName);
    await vscode.commands.executeCommand(
      'vscode.openWith',
      documentUri,
      'structuredDocEditor.sdoc',
      { preview: false },
    );
    await waitFor(
      () => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType === 'structuredDocEditor.sdoc',
      `The Structured Doc custom editor did not open ${fileName}.`,
    );
    assert.equal(
      vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.toString(),
      documentUri.toString(),
    );
    if (expectEditableUi) {
      assert.equal(
        await vscode.commands.executeCommand('structuredDocEditor.test.waitForEditorUiReady'),
        true,
        `The Structured Doc webview UI did not render ${fileName}.`,
      );
    }
    return documentUri;
  };
  const closeActiveEditor = () => vscode.commands.executeCommand('workbench.action.closeActiveEditor');

  for (const fileName of ['invalid.sdoc', 'future.sdoc']) {
    const uri = vscode.Uri.joinPath(workspace.uri, fileName);
    const before = await vscode.workspace.fs.readFile(uri);
    await openCustomEditor(fileName);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = await vscode.workspace.fs.readFile(uri);
    assert.deepEqual(after, before, `${fileName} source bytes must remain untouched on open.`);
    await closeActiveEditor();
  }

  const validUri = await openCustomEditor('valid.sdoc', true);
  const invalidExternalBytes = Buffer.from('{"sdoc":"1.0","doc":', 'utf8');
  await vscode.workspace.fs.writeFile(validUri, invalidExternalBytes);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(
    await vscode.workspace.fs.readFile(validUri),
    invalidExternalBytes,
    'An invalid external edit must not be replaced by the visual editor.',
  );
  await closeActiveEditor();
}

module.exports = { run };
