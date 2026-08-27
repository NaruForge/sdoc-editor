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

    const reportPath = process.env.SDOC_VSCODE_PERF_REPORT;
    if (reportPath) {
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
