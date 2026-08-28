const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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

function isUnsafeTextBoundary(text, offset) {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (before === 0x0d && after === 0x0a)
    || (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function expectedMinimalTextChange(currentText, nextText) {
  let startOffset = 0;
  const sharedLimit = Math.min(currentText.length, nextText.length);
  while (startOffset < sharedLimit
    && currentText.charCodeAt(startOffset) === nextText.charCodeAt(startOffset)) {
    startOffset += 1;
  }
  while (startOffset > 0
    && (isUnsafeTextBoundary(currentText, startOffset)
      || isUnsafeTextBoundary(nextText, startOffset))) {
    startOffset -= 1;
  }
  const suffixLimit = Math.min(
    currentText.length - startOffset,
    nextText.length - startOffset,
  );
  let suffixLength = 0;
  while (suffixLength < suffixLimit
    && currentText.charCodeAt(currentText.length - suffixLength - 1)
      === nextText.charCodeAt(nextText.length - suffixLength - 1)) {
    suffixLength += 1;
  }
  while (suffixLength > 0
    && (isUnsafeTextBoundary(currentText, currentText.length - suffixLength)
      || isUnsafeTextBoundary(nextText, nextText.length - suffixLength))) {
    suffixLength -= 1;
  }
  return {
    rangeOffset: startOffset,
    rangeLength: currentText.length - suffixLength - startOffset,
    text: nextText.slice(startOffset, nextText.length - suffixLength),
  };
}

function applyObservedTextChanges(currentText, changes) {
  return [...changes]
    .sort((left, right) => right.rangeOffset - left.rangeOffset)
    .reduce(
      (text, change) => text.slice(0, change.rangeOffset)
        + change.text
        + text.slice(change.rangeOffset + change.rangeLength),
      currentText,
    );
}

function median(samples) {
  assert.ok(samples.length > 0, 'Median requires at least one sample.');
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
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
      'structuredDocEditor.test.getActivePersistenceState',
      'structuredDocEditor.test.getActiveFileOperation',
      'structuredDocEditor.test.prepareActiveImport',
      'structuredDocEditor.test.confirmActiveFileOperation',
      'structuredDocEditor.test.runActiveResultAction',
      'structuredDocEditor.test.resetActivePerformanceReport',
      'structuredDocEditor.test.getActivePerformanceReport',
      'structuredDocEditor.test.applyActiveLocalizedMutation',
      'structuredDocEditor.test.applyActiveMetadataMutation',
      'structuredDocEditor.test.getActiveBookFileOperation',
      'structuredDocEditor.test.prepareActiveBookExport',
      'structuredDocEditor.test.confirmActiveBookFileOperation',
      'structuredDocEditor.test.runActiveBookResultAction',
      'structuredDocEditor.test.openActiveBookSource',
    ]) {
      assert.ok(commands.includes(command), `Expected registered command: ${command}`);
    }
  });

  await scenario('keeps valid documents stable on open without a false external change on save', async () => {
    const showcaseSource = vscode.Uri.file(path.join(
      extension.extensionPath,
      'shared',
      'template',
      'builtins',
      'feature-showcase.sdoc.json',
    ));
    const copiedShowcase = vscode.Uri.joinPath(workspace.uri, 'copied-feature-showcase.sdoc');
    await vscode.workspace.fs.writeFile(copiedShowcase, await readBytes(showcaseSource));

    for (const fileName of ['valid.sdoc', 'copied-feature-showcase.sdoc']) {
      const uri = vscode.Uri.joinPath(workspace.uri, fileName);
      const before = await readBytes(uri);
      const beforeText = Buffer.from(before).toString('utf8');
      const beforeModified = JSON.parse(beforeText).meta.modified;

      await openCustomEditor(workspace, fileName, 'structuredDocEditor.sdoc', true);
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === uri.toString(),
      );
      assert.ok(document, `Expected the ${fileName} text document behind the custom editor.`);

      // Cover Tiptap's debounced update window. State-only editor setup must not
      // synthesize a document mutation after initial hydration.
      await new Promise((resolve) => setTimeout(resolve, 750));
      assert.equal(document.isDirty, false, `${fileName} must remain clean after open.`);
      assert.equal(document.getText(), beforeText, `${fileName} buffer bytes must remain unchanged.`);
      assert.equal(
        JSON.parse(document.getText()).meta.modified,
        beforeModified,
        `${fileName} meta.modified must remain unchanged on open.`,
      );
      assert.deepEqual(await readBytes(uri), before, `${fileName} disk bytes must remain unchanged.`);

      const openedState = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      assert.equal(openedState.externalChangeCount, 0);
      await vscode.commands.executeCommand('workbench.action.files.save');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const savedState = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      assert.equal(document.isDirty, false, `${fileName} must remain clean after save.`);
      assert.equal(
        savedState.externalChangeCount,
        0,
        `${fileName} clean save must not be reported as an external change.`,
      );
      assert.equal(
        Buffer.from(await readBytes(uri)).toString('utf8'),
        document.getText(),
        `${fileName} clean save must leave matching disk and editor snapshots.`,
      );
      await closeActiveEditor();
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

  await scenario('saves an editor mutation to disk without entering an external-change loop', async () => {
    const fixtureUri = vscode.Uri.joinPath(workspace.uri, 'valid.sdoc');
    const sourceUri = vscode.Uri.joinPath(workspace.uri, 'save-loop.sdoc');
    await vscode.workspace.fs.writeFile(sourceUri, await readBytes(fixtureUri));
    await openCustomEditor(workspace, 'save-loop.sdoc', 'structuredDocEditor.sdoc', true);
    const importUri = vscode.Uri.joinPath(workspace.uri, 'import.md');
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === sourceUri.toString(),
    );
    assert.ok(document, 'Expected the save-loop text document behind the custom editor.');

    await vscode.commands.executeCommand(
      'structuredDocEditor.test.prepareActiveImport', importUri.toString(), 'markdown',
    );
    await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveFileOperation');
    await waitFor(
      () => document.getText().includes('Imported heading'),
      'The webview mutation did not reach the VS Code text document before save.',
    );
    await waitFor(
      () => document.isDirty,
      'The editor mutation did not make the VS Code text document dirty.',
    );

    const beforeSave = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActivePersistenceState',
    );
    assert.equal(beforeSave.externalChangeCount, 0);
    await vscode.commands.executeCommand('workbench.action.files.save');
    await waitFor(
      () => !document.isDirty,
      'Ctrl+S-equivalent save did not clear the VS Code dirty state.',
    );
    await waitFor(async () => {
      const state = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      return state.phase === 'saved';
    }, 'The editor did not reach the host-confirmed Saved state.');

    const savedState = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActivePersistenceState',
    );
    assert.equal(savedState.phase, 'saved');
    assert.equal(savedState.isDirty, false);
    assert.equal(
      savedState.externalChangeCount,
      0,
      'The extension must not report its own save lifecycle as an external change.',
    );
    assert.equal(
      Buffer.from(await readBytes(sourceUri)).toString('utf8'),
      document.getText(),
      'The disk contents must match the host-confirmed editor snapshot.',
    );

    await vscode.commands.executeCommand('workbench.action.files.save');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const repeatedSaveState = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActivePersistenceState',
    );
    assert.equal(repeatedSaveState.phase, 'saved');
    assert.equal(repeatedSaveState.externalChangeCount, 0);
    await closeActiveEditor();
  });

  await scenario('applies the exact minimal host range and preserves native Undo and Redo', async () => {
    const fixtureUri = vscode.Uri.joinPath(workspace.uri, 'valid.sdoc');
    const sourceUri = vscode.Uri.joinPath(workspace.uri, 'native-undo.sdoc');
    await vscode.workspace.fs.writeFile(sourceUri, await readBytes(fixtureUri));
    await openCustomEditor(workspace, 'native-undo.sdoc', 'structuredDocEditor.sdoc', true);
    const importUri = vscode.Uri.joinPath(workspace.uri, 'import.md');
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === sourceUri.toString(),
    );
    assert.ok(document, 'Expected the native Undo text document behind the custom editor.');
    const before = document.getText();
    const observedChanges = [];
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== sourceUri.toString()) return;
      observedChanges.push(...event.contentChanges.map((change) => ({
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text,
      })));
    });
    try {
      await vscode.commands.executeCommand(
        'structuredDocEditor.test.prepareActiveImport', importUri.toString(), 'markdown',
      );
      await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveFileOperation');
      await waitFor(
        () => document.getText().includes('Imported heading'),
        'The minimal-range mutation did not reach the VS Code text document.',
      );
      await waitFor(async () => {
        const snapshot = await vscode.commands.executeCommand(
          'structuredDocEditor.test.getActiveFileOperation',
        );
        return snapshot.state.phase === 'succeeded';
      }, 'The minimal-range import did not finish its ACK path.');
    } finally {
      changeSubscription.dispose();
    }
    const after = document.getText();
    const expectedChange = expectedMinimalTextChange(before, after);
    assert.deepEqual(
      observedChanges,
      [expectedChange],
      'The host must apply one exact common-prefix/suffix WorkspaceEdit range.',
    );
    assert.ok(expectedChange.rangeOffset > 0, 'The host edit must preserve the shared prefix.');
    assert.ok(
      expectedChange.rangeOffset + expectedChange.rangeLength < before.length,
      'The host edit must preserve the shared suffix.',
    );

    await vscode.commands.executeCommand('undo');
    await waitFor(() => document.getText() === before, 'Native Undo did not restore the source text.');
    await waitFor(() => !document.isDirty, 'Native Undo did not restore the clean save point.');
    await vscode.commands.executeCommand('redo');
    await waitFor(() => document.getText() === after, 'Native Redo did not restore the host edit.');
    await waitFor(() => document.isDirty, 'Native Redo did not restore the dirty state.');
    await vscode.commands.executeCommand('undo');
    await waitFor(() => document.getText() === before, 'Second native Undo did not restore text.');
    await waitFor(() => !document.isDirty, 'Second native Undo did not restore the clean state.');
    await closeActiveEditor();
  });

  await scenario('reports real mutation, ACK, and save phases without absolute-time gates', async () => {
    const fixtureUri = vscode.Uri.joinPath(workspace.uri, 'valid.sdoc');
    const sourceUri = vscode.Uri.joinPath(workspace.uri, 'performance-save.sdoc');
    await vscode.workspace.fs.writeFile(sourceUri, await readBytes(fixtureUri));
    await openCustomEditor(workspace, 'performance-save.sdoc', 'structuredDocEditor.sdoc', true);
    const importUri = vscode.Uri.joinPath(workspace.uri, 'performance-import.md');
    const importedTopLevelBlocks = 5_001;
    const importText = [
      '# Performance import',
      ...Array.from(
        { length: importedTopLevelBlocks - 1 },
        (_, index) => `Deterministic performance paragraph ${index.toString(36)}.`,
      ),
    ].join('\n\n');
    await vscode.workspace.fs.writeFile(importUri, Buffer.from(`${importText}\n`, 'utf8'));
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === sourceUri.toString(),
    );
    assert.ok(document, 'Expected the performance text document behind the custom editor.');
    const beforeMutationText = document.getText();

    await vscode.commands.executeCommand('structuredDocEditor.test.resetActivePerformanceReport');
    await vscode.commands.executeCommand(
      'structuredDocEditor.test.prepareActiveImport', importUri.toString(), 'markdown',
    );
    await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveFileOperation');
    await waitFor(
      () => document.getText().includes('Performance import'),
      'The measured webview mutation did not reach the VS Code text document.',
    );
    await waitFor(() => document.isDirty, 'The measured mutation did not make the document dirty.');

    await vscode.commands.executeCommand('workbench.action.files.save');
    await waitFor(() => !document.isDirty, 'The measured save did not clear the dirty state.');
    await waitFor(async () => {
      const state = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      return state.phase === 'saved';
    }, 'The measured save did not reach the host-confirmed Saved state.');

    const report = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActivePerformanceReport',
    );
    assert.deepEqual(
      { schemaVersion: report.schemaVersion, clock: report.clock, unit: report.unit },
      {
        schemaVersion: 1,
        clock: 'monotonic',
        unit: 'milliseconds',
      },
    );
    assert.deepEqual(
      Object.keys(report.context).sort(),
      ['architecture', 'nodeVersion', 'platform', 'surface', 'vscodeVersion'],
      'The performance context must not expose a URI, path, or document content.',
    );
    assert.equal(report.context.surface, 'vscode-extension-host');
    assert.equal(report.context.vscodeVersion, vscode.version);
    assert.equal(report.context.nodeVersion, process.versions.node);
    assert.equal(report.context.platform, process.platform);
    assert.equal(report.context.architecture, process.arch);
    const names = new Set(report.measurements.map((measurement) => measurement.name));
    for (const name of [
      'webview-checkpoint-to-ack-received',
      'host-edit-received-to-ack-post',
      'update-document-total',
      'dehydrate-document-assets',
      'parse-existing-envelope',
      'resolve-document-settings',
      'normalize-document',
      'validate-persisted-document',
      'serialize-pretty-document',
      'plan-minimal-document-edit',
      'workspace-edit-source-range-code-units',
      'workspace-edit-inserted-code-units',
      'workspace-edit-source-code-units',
      'workspace-edit-target-code-units',
      'workspace-edit-replacement-ratio-ppm',
      'workspace-edit-range-count',
      'workspace-edit-content-change-count',
      'workspace-edit-modified-token-cache-hit',
      'workspace-edit-modified-token-fallback',
      'canonical-persistence-cache-hit',
      'canonical-metadata-reused',
      'canonical-settings-reused',
      'canonical-content-reused',
      'validate-persisted-metadata',
      'workspace-apply-edit',
      'save-flush-barrier',
      'save-lifecycle-to-did-save',
    ]) {
      assert.ok(names.has(name), `Expected measured Extension Host phase: ${name}`);
    }
    const updateDocument = report.measurements.find(
      (measurement) => measurement.name === 'update-document-total',
    );
    assert.equal(
      updateDocument.operationCount,
      importedTopLevelBlocks,
      'The Extension Host report must cover the complete deterministic 5k-block mutation.',
    );
    const planEdit = report.measurements.find(
      (measurement) => measurement.name === 'plan-minimal-document-edit',
    );
    const sourceRange = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-source-range-code-units',
    );
    const insertedRange = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-inserted-code-units',
    );
    const applyEdit = report.measurements.find(
      (measurement) => measurement.name === 'workspace-apply-edit',
    );
    const sourceCodeUnits = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-source-code-units',
    );
    const targetCodeUnits = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-target-code-units',
    );
    const replacementRatio = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-replacement-ratio-ppm',
    );
    const contentChangeCount = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-content-change-count',
    );
    const modifiedTokenCacheHit = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-modified-token-cache-hit',
    );
    const modifiedTokenFallback = report.measurements.find(
      (measurement) => measurement.name === 'workspace-edit-modified-token-fallback',
    );
    assert.equal(planEdit.operationCount, beforeMutationText.length + document.getText().length);
    assert.ok(sourceRange.operationCount < beforeMutationText.length);
    assert.ok(insertedRange.operationCount < document.getText().length);
    assert.equal(sourceCodeUnits.operationCount, beforeMutationText.length);
    assert.equal(targetCodeUnits.operationCount, document.getText().length);
    assert.equal(
      replacementRatio.operationCount,
      Math.round(
        ((sourceRange.operationCount + insertedRange.operationCount)
          / (sourceCodeUnits.operationCount + targetCodeUnits.operationCount)) * 1_000_000,
      ),
    );
    assert.equal(contentChangeCount.operationCount, 1);
    assert.equal(modifiedTokenCacheHit.operationCount, 0);
    assert.equal(modifiedTokenFallback.operationCount, 1);
    assert.equal(
      applyEdit.operationCount,
      document.getText().length,
      'The existing workspace apply metric must retain its complete snapshot operation count.',
    );
    for (const measurement of report.measurements) {
      assert.equal(Number.isFinite(measurement.durationMs), true);
      assert.ok(measurement.durationMs >= 0);
      assert.ok(Number.isSafeInteger(measurement.operationCount));
      assert.ok(measurement.operationCount >= 0);
      assert.equal(measurement.outcome, 'ok');
    }
    assert.doesNotThrow(
      () => JSON.stringify(report),
      'The portable Extension Host report must be JSON serializable.',
    );

    await closeActiveEditor();
  });

  await scenario('measures a localized middle-block transaction on an adopted 5k document', async () => {
    const sourceUri = vscode.Uri.joinPath(workspace.uri, 'performance-localized-5k.sdoc');
    const blockCount = 5_000;
    const blockIndex = 2_500;
    const mutationCount = 8;
    const localizedMarker = ' [localized-vscode-perf]';
    const envelope = {
      sdoc: '1.0',
      meta: {
        title: 'Localized Extension Host performance',
        author: 'deterministic-fixture',
        version: '1.0',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:00.000Z',
      },
      doc: {
        type: 'doc',
        content: Array.from({ length: blockCount }, (_, index) => ({
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [{
            type: 'text',
            text: `Deterministic localized paragraph ${index.toString(36)}.`,
          }],
        })),
      },
    };
    const sourceText = `${JSON.stringify(envelope, null, 2)}\n`;
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceText, 'utf8'));
    await openCustomEditor(
      workspace,
      'performance-localized-5k.sdoc',
      'structuredDocEditor.sdoc',
      true,
    );
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === sourceUri.toString(),
    );
    assert.ok(document, 'Expected the localized 5k text document behind the custom editor.');
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal(document.getText(), sourceText, '5k hydration must adopt the exact baseline.');
    assert.equal(document.isDirty, false, '5k hydration must remain clean before the transaction.');
    const baselineRevision = document.version;
    const observedChangeSets = [];
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== sourceUri.toString()) return;
      if (event.contentChanges.length > 0) {
        observedChangeSets.push({
          revision: event.document.version,
          changes: event.contentChanges.map((change) => ({
            rangeOffset: change.rangeOffset,
            rangeLength: change.rangeLength,
            text: change.text,
          })),
        });
      }
    });

    await vscode.commands.executeCommand('structuredDocEditor.test.resetActivePerformanceReport');
    const documentSnapshots = [sourceText];
    try {
      for (let mutationIndex = 0; mutationIndex < mutationCount; mutationIndex += 1) {
        const beforeText = document.getText();
        const beforeRevision = document.version;
        assert.equal(
          await vscode.commands.executeCommand(
            'structuredDocEditor.test.applyActiveLocalizedMutation',
            blockIndex,
          ),
          true,
          'The test-only webview transaction must be delivered.',
        );
        await waitFor(
          () => document.version === beforeRevision + 1,
          `Localized mutation ${mutationIndex + 1} did not create exactly one revision.`,
        );
        await waitFor(async () => {
          const state = await vscode.commands.executeCommand(
            'structuredDocEditor.test.getActivePersistenceState',
          );
          return state.phase === 'dirty' && state.revision === document.version;
        }, `Localized mutation ${mutationIndex + 1} did not complete its host ACK path.`);
        assert.equal(
          observedChangeSets.length,
          mutationIndex + 1,
          `Localized mutation ${mutationIndex + 1} must emit one content event.`,
        );
        const observed = observedChangeSets[mutationIndex];
        assert.equal(observed.revision, beforeRevision + 1);
        assert.equal(
          observed.changes.length,
          2,
          'Each warm or cold product mutation must separate modified and body ranges.',
        );
        assert.equal(
          applyObservedTextChanges(beforeText, observed.changes),
          document.getText(),
          'Each two-range event must reconstruct the exact product serialization.',
        );
        documentSnapshots.push(document.getText());
      }
    } finally {
      changeSubscription.dispose();
    }

    const targetText = document.getText();
    assert.equal(
      observedChangeSets.length,
      mutationCount,
      'The localized run must observe one exact content event per mutation.',
    );
    const sourceEnvelope = JSON.parse(sourceText);
    const targetEnvelope = JSON.parse(targetText);
    assert.notEqual(
      targetEnvelope.meta.modified,
      sourceEnvelope.meta.modified,
      'The measured product serialization must include its real meta.modified update.',
    );
    assert.equal(
      targetEnvelope.doc.content[blockIndex].content[0].text,
      `${envelope.doc.content[blockIndex].content[0].text}${localizedMarker.repeat(mutationCount)}`,
      'Only the selected middle paragraph must receive the localized editor transaction.',
    );
    assert.equal(
      document.version,
      baselineRevision + mutationCount,
      'Every pair of ranges must commit as one exact VS Code document revision.',
    );

    await vscode.commands.executeCommand('workbench.action.files.save');
    await waitFor(() => !document.isDirty, 'The localized 5k document did not save.');
    const report = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActivePerformanceReport',
    );
    const mutationMeasurements = (name) => {
      const matches = report.measurements.filter((measurement) => measurement.name === name);
      assert.equal(
        matches.length,
        mutationCount,
        `Expected one ${name} sample per localized mutation.`,
      );
      return matches;
    };
    const sourceCodeUnits = mutationMeasurements('workspace-edit-source-code-units');
    const targetCodeUnits = mutationMeasurements('workspace-edit-target-code-units');
    const sourceRangeCodeUnits = mutationMeasurements('workspace-edit-source-range-code-units');
    const insertedCodeUnits = mutationMeasurements('workspace-edit-inserted-code-units');
    const replacementRatios = mutationMeasurements('workspace-edit-replacement-ratio-ppm');
    const rangeCounts = mutationMeasurements('workspace-edit-range-count');
    const contentChangeCounts = mutationMeasurements('workspace-edit-content-change-count');
    const updateDocuments = mutationMeasurements('update-document-total');
    const applyEdits = mutationMeasurements('workspace-apply-edit');
    const cacheHits = mutationMeasurements('workspace-edit-modified-token-cache-hit');
    const fallbacks = mutationMeasurements('workspace-edit-modified-token-fallback');
    const canonicalCacheHits = mutationMeasurements('canonical-persistence-cache-hit');
    const metadataReuse = mutationMeasurements('canonical-metadata-reused');
    const settingsReuse = mutationMeasurements('canonical-settings-reused');
    const contentReuse = mutationMeasurements('canonical-content-reused');
    const parseExisting = mutationMeasurements('parse-existing-envelope');
    const resolveSettings = mutationMeasurements('resolve-document-settings');
    const normalizeDocuments = mutationMeasurements('normalize-document');
    const validateDocuments = mutationMeasurements('validate-persisted-document');
    const plannerSamples = mutationMeasurements('plan-minimal-document-edit');
    for (let index = 0; index < mutationCount; index += 1) {
      const observedChanges = observedChangeSets[index].changes;
      assert.equal(sourceCodeUnits[index].operationCount, documentSnapshots[index].length);
      assert.equal(targetCodeUnits[index].operationCount, documentSnapshots[index + 1].length);
      assert.equal(
        sourceRangeCodeUnits[index].operationCount,
        observedChanges.reduce((total, change) => total + change.rangeLength, 0),
      );
      assert.equal(
        insertedCodeUnits[index].operationCount,
        observedChanges.reduce((total, change) => total + change.text.length, 0),
      );
      assert.equal(rangeCounts[index].operationCount, 2);
      assert.equal(contentChangeCounts[index].operationCount, 2);
      assert.equal(
        replacementRatios[index].operationCount,
        Math.round(
          ((sourceRangeCodeUnits[index].operationCount + insertedCodeUnits[index].operationCount)
            / (sourceCodeUnits[index].operationCount + targetCodeUnits[index].operationCount))
              * 1_000_000,
        ),
        'Every artifact ratio must be independently derivable from portable counters.',
      );
      assert.ok(
        replacementRatios[index].operationCount < 10_000,
        `Localized edit ${index + 1} exceeds 1%: ${replacementRatios[index].operationCount} ppm.`,
      );
      assert.equal(updateDocuments[index].operationCount, blockCount);
      assert.equal(applyEdits[index].operationCount, documentSnapshots[index + 1].length);
    }
    assert.deepEqual(
      cacheHits.map((measurement) => measurement.operationCount),
      [0, ...Array(mutationCount - 1).fill(1)],
      'The actual Host must record one cold plan followed by revision-bound warm hits.',
    );
    assert.deepEqual(
      fallbacks.map((measurement) => measurement.operationCount),
      [1, ...Array(mutationCount - 1).fill(0)],
      'Only the first actual Host plan may use the lexical fallback.',
    );
    assert.deepEqual(
      canonicalCacheHits.map((measurement) => measurement.operationCount),
      Array(mutationCount).fill(1),
      'Every ordinary content edit must be authorized by the exact host baseline revision.',
    );
    assert.deepEqual(
      metadataReuse.map((measurement) => measurement.operationCount),
      Array(mutationCount).fill(1),
    );
    assert.deepEqual(
      settingsReuse.map((measurement) => measurement.operationCount),
      Array(mutationCount).fill(1),
    );
    assert.deepEqual(
      contentReuse.map((measurement) => measurement.operationCount),
      Array(mutationCount).fill(0),
      'Changed editor content must still cross normalization and full validation.',
    );
    assert.deepEqual(
      parseExisting.map((measurement) => measurement.operationCount),
      Array(mutationCount).fill(0),
      'The host-owned metadata snapshot must remove the repeated source JSON parse.',
    );
    assert.deepEqual(
      resolveSettings.map((measurement) => measurement.operationCount),
      [1, ...Array(mutationCount - 1).fill(0)],
      'Standalone settings resolve once and must be reused while its revision is unchanged.',
    );
    assert.deepEqual(
      normalizeDocuments.map((measurement) => measurement.operationCount),
      Array(mutationCount).fill(blockCount),
    );
    assert.deepEqual(
      validateDocuments.map((measurement) => measurement.operationCount),
      Array(mutationCount).fill(blockCount),
      'Ordinary content edits retain full persisted-document validation.',
    );
    const warmPlannerMedian = median(
      plannerSamples.slice(1).map((measurement) => measurement.durationMs),
    );
    assert.ok(
      warmPlannerMedian < plannerSamples[0].durationMs * 0.5,
      `Warm Host planner median ${warmPlannerMedian}ms must beat cold ${plannerSamples[0].durationMs}ms by 50%.`,
    );

    await vscode.commands.executeCommand('structuredDocEditor.test.resetActivePerformanceReport');
    const beforeMetadataText = document.getText();
    const beforeMetadataEnvelope = JSON.parse(beforeMetadataText);
    const beforeMetadataRevision = document.version;
    const measuredTitle = 'Localized 5k metadata cache measurement';
    assert.equal(
      await vscode.commands.executeCommand(
        'structuredDocEditor.test.applyActiveMetadataMutation',
        measuredTitle,
      ),
      true,
      'The test-only metadata mutation must be delivered.',
    );
    await waitFor(
      () => document.version === beforeMetadataRevision + 1,
      'The metadata-only mutation did not create exactly one host revision.',
    );
    await waitFor(async () => {
      const state = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      return state.phase === 'dirty' && state.revision === document.version;
    }, 'The metadata-only mutation did not complete its ACK path.');
    const metadataText = document.getText();
    const metadataEnvelope = JSON.parse(metadataText);
    assert.equal(metadataEnvelope.meta.title, measuredTitle);
    assert.deepEqual(
      metadataEnvelope.doc,
      beforeMetadataEnvelope.doc,
      'Metadata-only persistence must reuse the exact canonical document semantics.',
    );
    const metadataReport = await vscode.commands.executeCommand(
      'structuredDocEditor.test.getActivePerformanceReport',
    );
    const metadataOperation = (name) => {
      const matches = metadataReport.measurements.filter((measurement) => measurement.name === name);
      assert.equal(matches.length, 1, `Expected one metadata-only ${name} sample.`);
      return matches[0].operationCount;
    };
    assert.equal(metadataOperation('canonical-persistence-cache-hit'), 1);
    assert.equal(metadataOperation('canonical-metadata-reused'), 0);
    assert.equal(metadataOperation('canonical-settings-reused'), 1);
    assert.equal(metadataOperation('canonical-content-reused'), 1);
    assert.equal(metadataOperation('parse-existing-envelope'), 0);
    assert.equal(metadataOperation('dehydrate-document-assets'), 0);
    assert.equal(metadataOperation('resolve-document-settings'), 0);
    assert.equal(metadataOperation('normalize-document'), 0);
    assert.equal(metadataOperation('validate-persisted-document'), 0);
    assert.equal(metadataOperation('validate-persisted-metadata'), 1);

    await vscode.commands.executeCommand('undo');
    await waitFor(
      () => document.getText() === beforeMetadataText && !document.isDirty,
      'One native Undo must restore the saved pre-metadata snapshot.',
    );
    await vscode.commands.executeCommand('redo');
    await waitFor(
      () => document.getText() === metadataText && document.isDirty,
      'One native Redo must restore the metadata-only product mutation.',
    );
    await vscode.commands.executeCommand('undo');
    await waitFor(
      () => document.getText() === beforeMetadataText && !document.isDirty,
      'The metadata probe must return to the saved content baseline.',
    );

    await vscode.commands.executeCommand('undo');
    await waitFor(
      () => document.getText() === documentSnapshots[mutationCount - 1] && document.isDirty,
      'One native Undo must restore exactly the preceding 5k mutation.',
    );
    await vscode.commands.executeCommand('redo');
    await waitFor(
      () => document.getText() === targetText && !document.isDirty,
      'One native Redo must restore the saved two-range product mutation.',
    );

    const reportPath = process.env.SDOC_VSCODE_PERF_REPORT;
    if (reportPath) {
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, `${JSON.stringify({
        ...report,
        measurements: [...report.measurements, ...metadataReport.measurements],
      }, null, 2)}\n`, 'utf8');
    }
    await closeActiveEditor();
  });

  await scenario('ignores final-newline and formatting-only edits without an external warning', async () => {
    const filesConfig = vscode.workspace.getConfiguration('files');
    await filesConfig.update('insertFinalNewline', true, vscode.ConfigurationTarget.Workspace);
    try {
      assert.equal(
        vscode.workspace.getConfiguration('files').get('insertFinalNewline'),
        true,
        'The workspace must enable files.insertFinalNewline for this probe.',
      );

      const fixtureUri = vscode.Uri.joinPath(workspace.uri, 'valid.sdoc');
      const sourceUri = vscode.Uri.joinPath(workspace.uri, 'save-final-newline.sdoc');
      await vscode.workspace.fs.writeFile(sourceUri, await readBytes(fixtureUri));
      await openCustomEditor(workspace, 'save-final-newline.sdoc', 'structuredDocEditor.sdoc', true);
      const importUri = vscode.Uri.joinPath(workspace.uri, 'import.md');
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === sourceUri.toString(),
      );
      assert.ok(document, 'Expected the insertFinalNewline text document behind the custom editor.');

      await vscode.commands.executeCommand(
        'structuredDocEditor.test.prepareActiveImport', importUri.toString(), 'markdown',
      );
      await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveFileOperation');
      await waitFor(
        () => document.getText().includes('Imported heading'),
        'The webview mutation did not reach the VS Code text document before save.',
      );
      await waitFor(
        () => document.isDirty,
        'The editor mutation did not make the VS Code text document dirty.',
      );

      const afterMutation = document.getText();
      assert.equal(
        afterMutation.endsWith('\n'),
        true,
        'The extension persistence snapshot must include a trailing newline.',
      );
      const beforeSave = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      assert.equal(beforeSave.externalChangeCount, 0);

      await vscode.commands.executeCommand('workbench.action.files.save');
      await waitFor(
        () => !document.isDirty,
        'Ctrl+S-equivalent save did not clear the VS Code dirty state.',
      );
      await waitFor(async () => {
        const state = await vscode.commands.executeCommand(
          'structuredDocEditor.test.getActivePersistenceState',
        );
        return state.phase === 'saved';
      }, 'The editor did not reach the host-confirmed Saved state.');

      const afterSave = document.getText();
      const savedState = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      assert.equal(afterSave.endsWith('\n'), true);
      assert.equal(
        savedState.externalChangeCount,
        0,
        'files.insertFinalNewline must not produce an external-change warning.',
      );
      assert.deepEqual(JSON.parse(afterSave), JSON.parse(afterMutation));
      assert.equal(
        Buffer.from(await readBytes(sourceUri)).toString('utf8'),
        afterSave,
        'The final-newline save must leave matching valid disk and editor snapshots.',
      );

      const lineEnding = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      const reformatted = `${JSON.stringify(JSON.parse(afterSave), null, 4)}\n`
        .replace(/\n/g, lineEnding);
      assert.notEqual(reformatted, afterSave, 'The formatting-only probe must change source text.');
      const formattingEdit = new vscode.WorkspaceEdit();
      formattingEdit.replace(
        sourceUri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
        reformatted,
      );
      assert.equal(
        await vscode.workspace.applyEdit(formattingEdit),
        true,
        'The real formatting-only WorkspaceEdit must apply.',
      );
      await waitFor(
        () => document.getText() === reformatted,
        'The formatting-only edit did not reach the backing text document.',
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      const reformattedState = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      assert.equal(
        reformattedState.externalChangeCount,
        0,
        'Parse-equal JSON formatting must not be reported as an external change.',
      );
      assert.deepEqual(JSON.parse(document.getText()), JSON.parse(afterSave));

      // A freshly preflighted semantic edit proves the parse-equal revision was
      // acknowledged rather than silently leaving the webview on a stale base.
      // It must also cold-plan because the formatting event revoked the prior
      // exact-revision token authority and import is an explicit replacement.
      await vscode.commands.executeCommand('structuredDocEditor.test.resetActivePerformanceReport');
      const secondImportUri = vscode.Uri.joinPath(workspace.uri, 'import-after-format.md');
      await vscode.workspace.fs.writeFile(
        secondImportUri,
        Buffer.from('# Revision advanced\n\nSecond semantic import.\n', 'utf8'),
      );
      await vscode.commands.executeCommand(
        'structuredDocEditor.test.prepareActiveImport', secondImportUri.toString(), 'markdown',
      );
      await vscode.commands.executeCommand('structuredDocEditor.test.confirmActiveFileOperation');
      await waitFor(
        () => document.getText().includes('Revision advanced')
          && !document.getText().includes('Imported heading'),
        'The next semantic editor mutation was rejected after the formatting-only revision.',
      );
      assert.equal(document.getText().endsWith(lineEnding), true);
      assert.doesNotThrow(() => JSON.parse(document.getText()));
      const postFormatReport = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePerformanceReport',
      );
      assert.deepEqual(
        postFormatReport.measurements
          .filter((measurement) => measurement.name === 'workspace-edit-modified-token-cache-hit')
          .map((measurement) => measurement.operationCount),
        [0],
        'Formatting/import must not reuse the preceding revision token authority.',
      );
      assert.deepEqual(
        postFormatReport.measurements
          .filter((measurement) => measurement.name === 'workspace-edit-modified-token-fallback')
          .map((measurement) => measurement.operationCount),
        [1],
        'The post-format import must use one fail-closed lexical plan.',
      );
      assert.deepEqual(
        postFormatReport.measurements
          .filter((measurement) => measurement.name === 'canonical-persistence-cache-hit')
          .map((measurement) => measurement.operationCount),
        [0],
        'Formatting and explicit import must revoke canonical component reuse authority.',
      );
      assert.deepEqual(
        postFormatReport.measurements
          .filter((measurement) => measurement.name === 'validate-persisted-document')
          .map((measurement) => measurement.operationCount > 0),
        [true],
        'An explicit import must retain full persisted-document validation.',
      );
      await vscode.commands.executeCommand('workbench.action.files.save');
      await waitFor(
        () => !document.isDirty,
        'The document did not save after the post-format semantic mutation.',
      );
      assert.deepEqual(
        JSON.parse(Buffer.from(await readBytes(sourceUri)).toString('utf8')),
        JSON.parse(document.getText()),
        'Disk and editor must remain valid after the post-format semantic mutation.',
      );
      const finalState = await vscode.commands.executeCommand(
        'structuredDocEditor.test.getActivePersistenceState',
      );
      assert.equal(finalState.externalChangeCount, 0);
    } finally {
      await filesConfig.update('insertFinalNewline', undefined, vscode.ConfigurationTarget.Workspace);
      await closeActiveEditor();
    }
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
