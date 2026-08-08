const assert = require('node:assert/strict');
const vscode = require('vscode');

async function waitFor(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function readBytes(uri) {
  return vscode.workspace.fs.readFile(uri);
}

async function assertFileMissing(uri, message) {
  let exists = true;
  try {
    await vscode.workspace.fs.stat(uri);
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
    exists = false;
  }
  assert.equal(exists, false, message);
}

function activeCustomEditor() {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom, 'Expected an active custom editor tab.');
  return input;
}

async function openCustomEditor(workspace, fileName, viewType, expectStandaloneUi = false) {
  const documentUri = vscode.Uri.joinPath(workspace.uri, fileName);
  await vscode.commands.executeCommand(
    'vscode.openWith',
    documentUri,
    viewType,
    { preview: false },
  );
  await waitFor(
    () => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType === viewType,
    `The ${viewType} custom editor did not open ${fileName}.`,
  );
  const input = activeCustomEditor();
  assert.equal(input.uri.toString(), documentUri.toString());
  if (expectStandaloneUi) {
    assert.equal(
      await vscode.commands.executeCommand('structuredDocEditor.test.waitForEditorUiReady'),
      true,
      `The Structured Doc webview UI did not render ${fileName}.`,
    );
  }
  return documentUri;
}

async function run() {
  let passed = 0;
  const scenario = async (name, callback) => {
    console.log(`  → ${name}`);
    let timer;
    try {
      await Promise.race([
        callback(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    passed += 1;
    console.log(`  ✓ ${name}`);
  };

  const extension = vscode.extensions.getExtension('swbaek.structured-doc-editor');
  assert.ok(extension, 'The development extension must be discoverable.');
  await extension.activate();
  assert.equal(extension.isActive, true, 'The extension must activate in the real Extension Host.');

  const workspace = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspace, 'The test workspace must be open.');
  const closeActiveEditor = () => vscode.commands.executeCommand('workbench.action.closeActiveEditor');

  await scenario('registers public Files commands and the test-only UI readiness seam', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'structuredDocEditor.newSdoc',
      'structuredDocEditor.exportToHtml',
      'structuredDocEditor.exportToAdoc',
      'structuredDocEditor.exportToMarkdown',
      'structuredDocEditor.exportToPdf',
      'structuredDocEditor.exportToSlides',
      'structuredDocEditor.cleanUpLegacySettings',
      'structuredDocEditor.test.waitForEditorUiReady',
      'structuredDocEditor.test.getActiveFileOperation',
      'structuredDocEditor.test.prepareActiveImport',
      'structuredDocEditor.test.confirmActiveFileOperation',
      'structuredDocEditor.test.runActiveResultAction',
      'structuredDocEditor.test.getActiveBookFileOperation',
      'structuredDocEditor.test.prepareActiveBookExport',
      'structuredDocEditor.test.confirmActiveBookFileOperation',
      'structuredDocEditor.test.runActiveBookResultAction',
      'structuredDocEditor.test.openActiveBookSource',
    ]) {
      assert.ok(commands.includes(command), `Expected registered command: ${command}`);
    }
  });

  await scenario('preserves invalid and future standalone source bytes on open', async () => {
    for (const fileName of ['invalid.sdoc', 'future.sdoc']) {
      const uri = vscode.Uri.joinPath(workspace.uri, fileName);
      const before = await readBytes(uri);
      await openCustomEditor(workspace, fileName, 'structuredDocEditor.sdoc');
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.deepEqual(await readBytes(uri), before, `${fileName} source bytes must remain untouched on open.`);
      await closeActiveEditor();
    }
  });

  await scenario('routes Command Palette export from a text tab through Files preflight without a direct write', async () => {
    const sourceUri = vscode.Uri.joinPath(workspace.uri, 'valid.sdoc');
    const outputUri = vscode.Uri.joinPath(workspace.uri, 'valid.html');
    const before = await readBytes(sourceUri);
    await assertFileMissing(outputUri, 'The deterministic export target must start absent.');

    // Reproduce invoking the Command Palette while the .sdoc is deliberately open as text.
    // The command must replace that tab with the custom editor and prepare the Files flow.
    await vscode.commands.executeCommand(
      'vscode.openWith', sourceUri, 'default', { preview: false },
    );
    await waitFor(
      () => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText,
      'The Structured Doc source did not open as a text tab for the regression setup.',
    );
    const exportCommand = vscode.commands.executeCommand('structuredDocEditor.exportToHtml');
    await waitFor(
      () => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType
        === 'structuredDocEditor.sdoc',
      'Command Palette export did not retain the Structured Doc custom editor.',
    );
    await exportCommand;
    const tabsForSource = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
      .filter((tab) => tab.input?.uri?.toString() === sourceUri.toString());
    assert.equal(
      tabsForSource.filter((tab) => tab.input instanceof vscode.TabInputCustom).length,
      1,
      'Command Palette export must open exactly one custom editor for the source.',
    );
    assert.equal(
      tabsForSource.filter((tab) => tab.input instanceof vscode.TabInputText).length,
      0,
      'The original text editor must be replaced instead of remaining as a duplicate tab.',
    );
    assert.equal(
      await vscode.commands.executeCommand('structuredDocEditor.test.waitForEditorUiReady'),
      true,
      'Files prepare must retain a ready editor/webview session.',
    );
    let snapshot;
    const waitForFileOperation = async (phase) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        snapshot = await vscode.commands.executeCommand(
          'structuredDocEditor.test.getActiveFileOperation',
        );
        if (snapshot?.state?.phase === phase) return snapshot;
        if (snapshot?.state?.phase === 'failed') {
          throw new Error(`File operation failed: ${JSON.stringify(snapshot.state.error)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`File operation did not reach ${phase}.`);
    };
    snapshot = await waitForFileOperation('awaiting-confirmation');
    assert.equal(snapshot.plan.intent.kind, 'export');
    await assertFileMissing(
      outputUri,
      'Prepare/preflight must not execute or write before explicit webview confirmation.',
    );
    assert.deepEqual(await readBytes(sourceUri), before, 'Files preflight must not mutate its source.');
    await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveFileOperation');
    snapshot = await waitForFileOperation('succeeded');
    assert.equal(snapshot.state.details.artifact.displayName, 'valid.html');
    assert.ok((await readBytes(outputUri)).byteLength > 0, 'Confirmed export must write the artifact.');
    await vscode.commands.executeCommand('structuredDocEditor.test.runActiveResultAction', 'copy');
    await waitFor(
      () => vscode.env.clipboard.readText().then((text) => text.endsWith('valid.html')),
      'Copy result action did not publish the exported path.',
    );
    await closeActiveEditor();
  });

  await scenario('applies a confirmed import and restores its session checkpoint with Undo', async () => {
    const sourceUri = await openCustomEditor(
      workspace,
      'valid.sdoc',
      'structuredDocEditor.sdoc',
      true,
    );
    const importUri = vscode.Uri.joinPath(workspace.uri, 'import.md');
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === sourceUri.toString(),
    );
    assert.ok(document, 'Expected the source text document behind the custom editor.');
    const before = document.getText();
    await vscode.commands.executeCommand(
      'structuredDocEditor.test.prepareActiveImport', importUri.toString(), 'markdown',
    );
    let snapshot = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActiveFileOperation',
    );
    assert.equal(snapshot.state.phase, 'awaiting-confirmation');
    assert.equal(snapshot.plan.intent.kind, 'import');
    await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveFileOperation');
    await waitFor(
      () => document.getText().includes('Imported heading'),
      'Confirmed import did not replace the body through the webview ACK path.',
    );
    await waitFor(async () => {
      snapshot = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActiveFileOperation',
      );
      return snapshot.state.phase === 'succeeded';
    }, 'Import did not publish a completed result.');
    assert.ok(snapshot.state.details.availableActions.some((item) => item.action === 'undo'));
    await vscode.commands.executeCommand('structuredDocEditor.test.runActiveResultAction', 'undo');
    try {
      await waitFor(
        () => document.getText().includes('The real VS Code Extension Host opened this document.')
          && !document.getText().includes('Imported heading'),
        'Undo did not restore the pre-import body checkpoint.',
      );
    } catch (error) {
      throw new Error(`${error.message} Current source: ${document.getText()}`);
    }
    await closeActiveEditor();
  });

  await scenario('preserves invalid and future Book manifest bytes on open', async () => {
    for (const fileName of ['invalid.sdocbook', 'future.sdocbook']) {
      const uri = vscode.Uri.joinPath(workspace.uri, fileName);
      const before = await readBytes(uri);
      await openCustomEditor(workspace, fileName, 'structuredDocEditor.sdocBook');
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual(await readBytes(uri), before, `${fileName} source bytes must remain untouched on open.`);
      if (fileName === 'invalid.sdocbook') {
        await vscode.commands.executeCommand('structuredDocEditor.test.openActiveBookSource');
        await waitFor(
          () => {
            const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
            return active instanceof vscode.TabInputText && active.uri.toString() === uri.toString();
          },
          'Invalid Book Open Source did not force the raw manifest text editor.',
        );
        assert.deepEqual(await readBytes(uri), before, 'Opening raw Book source must not mutate invalid bytes.');
        await closeActiveEditor();
      }
      await closeActiveEditor();
    }
  });

  await scenario('keeps a v1.0 Book fail-closed without an implicit upgrade or write', async () => {
    const sourceUri = vscode.Uri.joinPath(workspace.uri, 'book-v1.0.sdocbook');
    const outputUri = vscode.Uri.joinPath(workspace.uri, 'book-v1.0.html');
    const before = await readBytes(sourceUri);
    await assertFileMissing(outputUri, 'The legacy Book export target must start absent.');
    await openCustomEditor(workspace, 'book-v1.0.sdocbook', 'structuredDocEditor.sdocBook');
    await new Promise((resolve) => setTimeout(resolve, 750));

    // VS Code does not expose a supported API for injecting a DOM-to-host webview message,
    // and invoking the standalone export command on a Book opens a native error notification
    // whose dismissal cannot be automated reliably. The disabled Book export action and
    // prepareBookExport failure payload therefore stay covered by Book unit/Playwright tests.
    await assertFileMissing(outputUri, 'A v1.0 Book must not produce an export artifact.');
    assert.deepEqual(await readBytes(sourceUri), before, 'Opening/exporting must not auto-upgrade a v1.0 Book.');
    const input = activeCustomEditor();
    assert.equal(input.viewType, 'structuredDocEditor.sdocBook');
    await closeActiveEditor();
  });

  await scenario('preflights, executes, and acts on a v1.1 Book through the real host', async () => {
    const sourceUri = vscode.Uri.joinPath(workspace.uri, 'book-v1.1.sdocbook');
    const chapterUri = vscode.Uri.joinPath(workspace.uri, 'valid.sdoc');
    const outputUri = vscode.Uri.joinPath(workspace.uri, 'book-v1.1.html');
    const sourceBefore = await readBytes(sourceUri);
    const chapterBefore = await readBytes(chapterUri);
    await assertFileMissing(outputUri, 'The Book export target must start absent.');
    await openCustomEditor(workspace, 'book-v1.1.sdocbook', 'structuredDocEditor.sdocBook');
    const input = activeCustomEditor();
    assert.equal(input.viewType, 'structuredDocEditor.sdocBook');
    assert.equal(input.uri.toString(), sourceUri.toString());

    await vscode.commands.executeCommand('structuredDocEditor.test.prepareActiveBookExport', 'html');
    let snapshot = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActiveBookFileOperation',
    );
    assert.equal(snapshot.state.phase, 'awaiting-confirmation');
    assert.equal(snapshot.plan.intent.format, 'html');
    await assertFileMissing(outputUri, 'Book preflight must not write before confirmation.');

    await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveBookFileOperation');
    await waitFor(async () => {
      snapshot = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActiveBookFileOperation',
      );
      if (snapshot.state.phase === 'failed') {
        throw new Error(`Book export failed: ${JSON.stringify(snapshot.state.error)}`);
      }
      return snapshot.state.phase === 'succeeded';
    }, 'Book export did not reach succeeded.');
    assert.equal(snapshot.state.details.artifact.displayName, 'book-v1.1.html');
    assert.ok((await readBytes(outputUri)).byteLength > 0, 'Confirmed Book export must write the artifact.');

    const originalRequestId = snapshot.state.requestId;
    const actionStatus = await vscode.commands.executeCommand(
      'structuredDocEditor.test.runActiveBookResultAction', 'copy',
    );
    assert.equal(actionStatus.status, 'completed');
    assert.notEqual(actionStatus.actionRequestId, originalRequestId);
    await waitFor(
      () => vscode.env.clipboard.readText().then((text) => text.endsWith('book-v1.1.html')),
      'Book copy result action did not publish the exported path.',
    );
    assert.deepEqual(await readBytes(sourceUri), sourceBefore, 'A v1.1 Book must remain stable while its workspace loads.');
    assert.deepEqual(await readBytes(chapterUri), chapterBefore, 'Book composition must not mutate chapter inputs.');
    await closeActiveEditor();
  });

  await scenario('keeps invalid external edits untouched after a ready standalone session', async () => {
    const validUri = await openCustomEditor(
      workspace,
      'valid.sdoc',
      'structuredDocEditor.sdoc',
      true,
    );
    const invalidExternalBytes = Buffer.from('{"sdoc":"1.0","doc":', 'utf8');
    await vscode.workspace.fs.writeFile(validUri, invalidExternalBytes);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(
      await readBytes(validUri),
      invalidExternalBytes,
      'An invalid external edit must not be replaced by the visual editor.',
    );
    await closeActiveEditor();
  });

  console.log(`${passed} VS Code Extension Host scenarios passed.`);
}

module.exports = { run };
