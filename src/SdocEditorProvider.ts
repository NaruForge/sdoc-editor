import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getNonce, getWebviewUri } from './utils/webviewHelper';
import { ExpectedDocumentChanges } from './utils/expectedDocumentChanges';
import { convertMarkdownToJson } from '../shared/converter';
import { generateFontFaceCSS } from './utils/fontUtils';
import { convertImagePathsToWebviewUris, convertWebviewUrisToRelativePaths } from './utils/imageUtils';
import {
  unwrapSdoc as sharedUnwrapSdoc,
  normalizeDocument,
} from '../shared/document/sdocUtils';
import {
  getCaptionPreset,
  resolveEditorSettings,
  resolveSettings,
  SETTINGS_DEFAULTS,
} from '../shared/settingsResolver';
import type { DocumentSettings, CaptionStyleName, SdocMeta, TiptapNode } from '../shared/types';
import type {
  EditorToHostMessage,
  PersonalTemplateOperation,
  TemplateErrorCode,
  TemplateOperationError,
} from '../shared/types/messages';
import { isEditorToHostMessage } from '../shared/types/messageGuards';
import { VsCodeAssetService } from './services/VsCodeAssetService';
import { VsCodeExportService, type ExportFormat } from './services/VsCodeExportService';
import { RecoverableSerialQueue } from '../shared/persistence/RecoverableSerialQueue';
import {
  readDocumentMutationBestEffort,
  type DocumentMutation,
} from '../shared/persistence/DocumentSyncCoordinator';
import { assertPersistedDocument, parseDocumentContract, readDocumentSettings } from '../shared/document/documentContract';
import { dehydrateDocumentAssets } from '../shared/document/runtimeAssets';
import { runExportAfterFlush } from '../shared/export/runExportAfterFlush';
import {
  canApplyTemplateToCurrentDocument,
  commitCurrentDocumentTemplateApplication,
  isFilesystemBackedScheme,
  isUninitializedSdocText,
  isWorkspaceTemplatePath,
  prepareCurrentDocumentTemplateApplication,
  VsCodeTemplateService,
  type CurrentDocumentIdentity,
  type WorkspaceTemplateRoot,
} from './services/VsCodeTemplateService';
import {
  buildTemplateStructuralPreview,
  createPersonalTemplateSnapshot,
  suggestTemplateTitleNodeId,
  updatePersonalTemplateMetadata,
  type SdocTemplate,
  type TemplateDiagnostic,
} from '../shared/template';
import {
  projectTemplateCatalogDiagnostic,
  projectTemplateCatalogDiagnostics,
} from '../shared/template/catalogView';
import { createFileOperationError } from '../shared/editor/fileOperations';
import {
  DEFAULT_DIAGRAM_RENDERER_SETTINGS,
  type DiagramRendererSettings,
} from '../shared/diagramRenderer';
import {
  KrokiDiagramService,
  KrokiRenderError,
} from './services/KrokiDiagramService';
import {
  readUiLanguagePreference,
  resolveUiLanguagePreference,
  type UiLanguagePreference,
} from '../shared/editor/i18n/locale';
import {
  EditorTextFocusCoordinator,
  type EditorTextFocusIdentity,
} from './editorTextFocusCoordinator';
import {
  recoverFromUiLanguageWriteFailure,
  updateUiLanguagePreference,
} from './uiLanguagePreferenceUpdate';

export class SdocEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly SDOC_VERSION = '1.0';
  private static readonly EDITOR_TEXT_FOCUS_CONTEXT = 'structuredDocEditor.editorTextFocus';
  private static readonly TOGGLE_BOLD_COMMAND = 'structuredDocEditor.toggleBold';
  private static watcherGeneration = 0;
  private static instance: SdocEditorProvider | undefined;
  private readonly assetService = new VsCodeAssetService();
  private readonly exportService: VsCodeExportService;

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SdocEditorProvider(context);
    SdocEditorProvider.instance = provider;
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      'structuredDocEditor.sdoc',
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    const toggleBoldRegistration = vscode.commands.registerCommand(
      SdocEditorProvider.TOGGLE_BOLD_COMMAND,
      // Winning VS Code's keybinding resolution prevents the workbench sidebar
      // command. The original DOM keyboard event still reaches ProseMirror,
      // which owns the single document mutation and preserves its selection.
      () => undefined,
    );
    return vscode.Disposable.from(
      providerRegistration,
      toggleBoldRegistration,
      { dispose: () => provider.dispose() },
    );
  }

  public static async exportActiveDocument(format: ExportFormat): Promise<void> {
    const provider = SdocEditorProvider.instance;
    if (!provider) throw new Error('Structured Doc Editor is not active.');
    await provider.exportActive(format);
  }

  public static async flushActiveDocument(): Promise<void> {
    const provider = SdocEditorProvider.instance;
    if (!provider) return;
    await provider.flushActive();
  }

  /** Exact snapshots expected from our own WorkspaceEdit, never a blind event counter. */
  private readonly expectedDocumentChanges = new ExpectedDocumentChanges();
  private pendingFlushResolvers = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly editorSessions = new Map<string, {
    document: vscode.TextDocument;
    panel: vscode.WebviewPanel;
    sessionId: string;
  }>();
  private readonly editorTextFocus = new EditorTextFocusCoordinator<vscode.WebviewPanel>();
  private focusContextUpdates: Promise<unknown> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.exportService = new VsCodeExportService(context);
    this.setEditorTextFocusContext(false);
  }

  private setEditorTextFocusContext(value: boolean): void {
    this.focusContextUpdates = this.focusContextUpdates
      .then(() => vscode.commands.executeCommand(
        'setContext',
        SdocEditorProvider.EDITOR_TEXT_FOCUS_CONTEXT,
        value,
      ))
      .catch((error: unknown) => {
        console.error('Failed to update Structured Doc editor text focus context', error);
      });
  }

  private updateEditorTextFocus(
    panel: vscode.WebviewPanel,
    identity: EditorTextFocusIdentity,
    focused: boolean,
  ): void {
    if (this.editorTextFocus.update(panel, identity, focused, panel.active)) {
      this.setEditorTextFocusContext(this.editorTextFocus.currentLease !== undefined);
    }
  }

  private releaseEditorTextFocus(
    panel: vscode.WebviewPanel,
    identity: EditorTextFocusIdentity,
  ): void {
    if (this.editorTextFocus.release(panel, identity)) {
      this.setEditorTextFocusContext(false);
    }
  }

  private dispose(): void {
    this.editorTextFocus.clear();
    // Extension reloads must also reset a context key left by an interrupted host.
    this.setEditorTextFocusContext(false);
    if (SdocEditorProvider.instance === this) {
      SdocEditorProvider.instance = undefined;
    }
  }

  private readDiagramRendererSettings(): DiagramRendererSettings {
    const config = vscode.workspace.getConfiguration('structuredDocEditor.diagramRenderer');
    const userValue = <T,>(key: string, fallback: T): T => {
      const inspected = config.inspect<T>(key);
      return inspected?.globalValue ?? fallback;
    };
    return {
      enabled: userValue('enabled', DEFAULT_DIAGRAM_RENDERER_SETTINGS.enabled),
      endpoint: userValue('endpoint', DEFAULT_DIAGRAM_RENDERER_SETTINGS.endpoint),
      allowPrivateNetwork: userValue(
        'allowPrivateNetwork',
        DEFAULT_DIAGRAM_RENDERER_SETTINGS.allowPrivateNetwork,
      ),
    };
  }

  private readUiLanguagePreference(): UiLanguagePreference {
    const config = vscode.workspace.getConfiguration('structuredDocEditor.ui');
    const inspected = config.inspect<unknown>('language');
    return readUiLanguagePreference(inspected?.globalValue);
  }

  private resolveUiLocale() {
    return resolveUiLanguagePreference(
      this.readUiLanguagePreference(),
      vscode.env.language,
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Setup webview
    const documentDir = vscode.Uri.joinPath(document.uri, '..');

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media', 'fonts'),
        vscode.Uri.joinPath(documentDir, 'images'),
        vscode.Uri.joinPath(documentDir, 'drawio'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    const sessionId = randomUUID();
    const documentId = document.uri.toString();
    const editorIdentity = { sessionId, documentId };
    this.editorSessions.set(documentId, { document, panel: webviewPanel, sessionId });
    let writeBlockedReason: string | undefined;
    let readOnlyWarningShown = false;
    let templateApplicationPending = false;
    let templateManagementPending = false;
    let fileOperationPending = false;
    let availableTemplates = new Map<string, SdocTemplate>();
    let personalTemplateFingerprints = new Map<string, string>();
    let templateCatalogGeneration = 0;
    const personalRootScope = vscode.env.remoteName ? 'remote' : 'local';
    const templateService = new VsCodeTemplateService({
      personalSourceLabel: vscode.env.remoteName
        ? `Remote (${vscode.env.remoteName}) · extension host home`
        : 'Local · shared with the desktop app',
    });
    const diagramService = new KrokiDiagramService(this.readDiagramRendererSettings());
    const diagramRequests = new Map<string, AbortController>();
    const pendingImportAcks = new Map<string, {
      resolve: (applied: boolean) => void;
      timer: NodeJS.Timeout;
    }>();
    const waitForImportApplied = (requestId: string): Promise<boolean> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingImportAcks.delete(requestId);
          reject(new Error('Timed out waiting for the imported document to be applied.'));
        }, 10_000);
        pendingImportAcks.set(requestId, { resolve, timer });
      });
    const prepareDiagramImages = async (
      format: ExportFormat,
    ): Promise<{ images: Map<string, string>; usedFallback: boolean }> => {
      const images = new Map<string, string>();
      if (format !== 'html' && format !== 'pdf' && format !== 'slides') {
        return { images, usedFallback: false };
      }
      const sources = new Map<string, { language: 'plantuml' | 'd2' | 'graphviz'; code: string }>();
      let usedFallback = false;
      const visit = (node: TiptapNode): void => {
        if (node.type === 'diagram') {
          const language = typeof node.attrs?.language === 'string'
            ? node.attrs.language.toLowerCase()
            : 'mermaid';
          const code = typeof node.attrs?.code === 'string' ? node.attrs.code : '';
          if (language !== 'mermaid') {
            if (language === 'plantuml' || language === 'd2' || language === 'graphviz') {
              sources.set(`${language}\0${code}`, { language, code });
            } else {
              usedFallback = true;
            }
          }
        }
        node.content?.forEach(visit);
      };
      visit(readCurrentMutation().content);
      await Promise.all([...sources.entries()].map(async ([key, source]) => {
        try {
          const rendered = await diagramService.render(source.language, source.code);
          images.set(key, rendered.dataUrl);
        } catch {
          usedFallback = true;
        }
      }));
      return { images, usedFallback };
    };

    // Read and send editor settings to webview
    const readVscodeDocDefaults = (): Partial<DocumentSettings> => {
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      return {
        headingNumbering: config.get<boolean>('heading.numbering', true),
        headingStartNumber: config.get<number>('heading.startNumber', SETTINGS_DEFAULTS.headingStartNumber),
        headingDecoration: config.get<boolean>('heading.decoration', true),
        headingH1Color: config.get<string>('heading.h1Color', SETTINGS_DEFAULTS.headingH1Color),
        headingH2Color: config.get<string>('heading.h2Color', SETTINGS_DEFAULTS.headingH2Color),
        headingH3Color: config.get<string>('heading.h3Color', SETTINGS_DEFAULTS.headingH3Color),
        headingH4Color: config.get<string>('heading.h4Color', SETTINGS_DEFAULTS.headingH4Color),
        headingH5Color: config.get<string>('heading.h5Color', SETTINGS_DEFAULTS.headingH5Color),
        headingH6Color: config.get<string>('heading.h6Color', SETTINGS_DEFAULTS.headingH6Color),
        captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
        captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
        equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
        crossRefIncludeCaption: config.get<boolean>('caption.crossRefIncludeCaption', false),
        pdfScale: config.get<number>('export.pdfScale', 70),
        selfContained: config.get<'none' | 'images-only' | 'full'>('export.selfContained', 'images-only'),
        slideBreakLevel: config.get<'h1-only' | 'h1-h2-vertical'>('slide.breakLevel', 'h1-only'),
        slideTransition: config.get<'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom'>('slide.transition', 'none'),
        showTitleSlide: config.get<boolean>('slide.showTitleSlide', true),
        outputDir: config.get<string>('export.outputDir', ''),
      };
    };

    const readDocSettings = (): Partial<DocumentSettings> | undefined => {
      try {
        const text = document.getText();
        const parsed: unknown = text.trim() ? JSON.parse(text) : {};
        return readDocumentSettings(parsed);
      } catch {
        return undefined;
      }
    };

    const sendSettings = () => {
      const config = vscode.workspace.getConfiguration('structuredDocEditor');
      const vscodeDefaults = readVscodeDocDefaults();
      const docSettings = readDocSettings();
      const resolved = resolveEditorSettings(docSettings, vscodeDefaults, {
        defaultImageAlignment: config.get<'left' | 'center' | 'right'>('image.defaultAlignment', 'center'),
        exportImagePath: config.get<'relative' | 'absolute'>('export.imagePath', 'relative'),
      });
      const preset = getCaptionPreset(resolved.captionStyle);
      webviewPanel.webview.postMessage({
        type: 'settingsChanged',
        settings: {
          captionStyle: resolved.captionStyle,
          imageCaptionPrefix: preset.figurePrefix,
          tableCaptionPrefix: preset.tablePrefix,
          equationCaptionPrefix: preset.equationPrefix,
          captionSeparator: preset.separator,
          tableNumberStyle: preset.tableNumberStyle,
          equationParens: preset.equationParens,
          captionNumbering: resolved.captionNumbering,
          equationNumbering: resolved.equationNumbering,
          crossRefIncludeCaption: resolved.crossRefIncludeCaption,
          headingNumbering: resolved.headingNumbering,
          headingStartNumber: resolved.headingStartNumber,
          headingDecoration: resolved.headingDecoration,
          headingH1Color: resolved.headingH1Color,
          headingH2Color: resolved.headingH2Color,
          headingH3Color: resolved.headingH3Color,
          headingH4Color: resolved.headingH4Color,
          headingH5Color: resolved.headingH5Color,
          headingH6Color: resolved.headingH6Color,
          defaultImageAlignment: resolved.defaultImageAlignment,
          exportImagePath: resolved.exportImagePath,
          pdfScale: resolved.pdfScale,
          selfContained: resolved.selfContained,
          slideBreakLevel: resolved.slideBreakLevel,
          slideTransition: resolved.slideTransition,
          showTitleSlide: resolved.showTitleSlide,
          outputDir: resolved.outputDir,
          fontWeightBody: config.get<string>('font.body', 'Regular'),
          fontWeightBold: config.get<string>('font.bold', 'Bold'),
          fontWeightH1: config.get<string>('font.h1', 'Bold'),
          fontWeightH2: config.get<string>('font.h2', 'SemiBold'),
          fontWeightH3: config.get<string>('font.h3', 'SemiBold'),
        },
      });
      // Also send raw doc-level settings so the Settings Panel knows what's overridden
      webviewPanel.webview.postMessage({
        type: 'docSettingsChanged',
        docSettings: docSettings || null,
      });
    };

    const sendUiLanguage = () => {
      webviewPanel.webview.postMessage({
        type: 'uiLanguageChanged',
        preference: this.readUiLanguagePreference(),
        locale: this.resolveUiLocale(),
      });
    };

    // Send initial document content with image paths converted
    const sendUpdate = () => {
      try {
        const text = document.getText();
        const parsed: unknown = isUninitializedSdocText(text)
          ? { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } }
          : JSON.parse(text);
        const contract = parseDocumentContract(parsed);
        writeBlockedReason = contract.ok
          ? undefined
          : contract.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; ');
        if (writeBlockedReason && !readOnlyWarningShown) {
          readOnlyWarningShown = true;
          vscode.window.showWarningMessage(
            `Structured Doc opened read-only to protect the original file: ${writeBlockedReason}`,
          );
        }
        // Unwrap sdoc envelope → extract doc node
        const { doc, meta } = sharedUnwrapSdoc(parsed);
        const { settings: documentSettings, ...persistedMeta } = meta;
        // Convert image paths to webview URIs
        const convertedJson = convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);
        webviewPanel.webview.postMessage({
          type: 'init',
          locale: this.resolveUiLocale(),
          sessionId,
          documentId,
          revision: document.version,
          ...(writeBlockedReason ? { readOnlyReason: writeBlockedReason } : {}),
          snapshot: {
            content: convertedJson,
            meta: persistedMeta,
            documentSettings: documentSettings ?? null,
          },
        });
        sendUiLanguage();
        sendSettings();
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to parse document: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    };

    const readCurrentDocumentValue = (): unknown => {
      const text = document.getText();
      return isUninitializedSdocText(text)
        ? { sdoc: SdocEditorProvider.SDOC_VERSION, meta: {}, doc: { type: 'doc', content: [] } }
        : JSON.parse(text);
    };

    const readCurrentMutation = (): DocumentMutation => {
      const parsed = readCurrentDocumentValue();
      const { doc, meta } = sharedUnwrapSdoc(parsed);
      const { settings: documentSettings, ...persistedMeta } = meta;
      return {
        content: convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview),
        meta: persistedMeta,
        documentSettings: documentSettings ?? null,
      };
    };

    const tryReadCurrentMutation = (): DocumentMutation | undefined =>
      readDocumentMutationBestEffort(readCurrentMutation);

    const postExternalChange = (): void => {
      webviewPanel.webview.postMessage({
        type: 'externalChange',
        sessionId,
        documentId,
        revision: document.version,
        snapshot: readCurrentMutation(),
      });
    };

    const postExplicitReplacement = (
      reason: 'user-reload' | 'confirmed-template',
    ): void => {
      webviewPanel.webview.postMessage({
        type: 'replaceDocument',
        sessionId,
        documentId,
        revision: document.version,
        reason,
        snapshot: readCurrentMutation(),
      });
    };

    const currentDocumentIdentity = (): CurrentDocumentIdentity => ({
      sessionId,
      documentId,
      revision: document.version,
    });

    const workspaceTemplateRoots = (): WorkspaceTemplateRoot[] =>
      (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => isFilesystemBackedScheme(folder.uri.scheme))
        .map((folder) => ({
          identity: folder.uri.toString(),
          name: folder.name,
          rootPath: folder.uri.fsPath,
        }));

    const sendTemplateCatalog = async (requestId: string): Promise<void> => {
      const generation = ++templateCatalogGeneration;
      try {
        const discovery = await templateService.discover(workspaceTemplateRoots());
        if (generation === templateCatalogGeneration) {
          availableTemplates = new Map(
            discovery.catalog.templates.map((template) => [template.descriptor.id, template]),
          );
          personalTemplateFingerprints = new Map(discovery.personalFingerprints);
        }
      const diagnosticCount = discovery.hostDiagnostics.length + discovery.catalog.diagnostics.length;
      if (diagnosticCount > 0) {
        console.warn('Structured Doc template discovery diagnostics', {
          host: discovery.hostDiagnostics,
          contract: discovery.catalog.diagnostics,
        });
      }
        webviewPanel.webview.postMessage({
        type: 'templateCatalog',
        requestId,
        templates: discovery.catalog.templates.map((template) => ({
          ...template.descriptor,
          sourceLabel: template.descriptor.source === 'builtin'
            ? 'Structured Doc Editor'
            : template.descriptor.source === 'workspace'
              ? 'Workspace templates'
              : `${personalRootScope === 'remote' ? 'Remote' : 'Local'} · ~/.sdoc/templates`,
          preview: buildTemplateStructuralPreview(template),
          ...(discovery.personalFingerprints.has(template.descriptor.id)
            ? { revisionToken: discovery.personalFingerprints.get(template.descriptor.id) }
            : {}),
        })),
        diagnostics: [
          ...projectTemplateCatalogDiagnostics(discovery.catalog.diagnostics, 'catalog'),
          ...discovery.hostDiagnostics.map((diagnostic, index) => {
            const code: TemplateDiagnostic['code'] =
              diagnostic.code === 'invalid-json' ? 'malformed-document'
                : diagnostic.code === 'file-too-large' ? 'file-too-large'
                  : diagnostic.code === 'candidate-limit-exceeded' ? 'candidate-limit-exceeded'
                    : diagnostic.code === 'read-failed' ? 'read-failed'
                      : diagnostic.code === 'unsupported-file-type' ? 'unsupported-filesystem'
                        : 'unsafe-path';
            return projectTemplateCatalogDiagnostic({
              code,
              targetPath: diagnostic.targetPath,
              message: 'Template discovery failed.',
            }, 'catalog', index);
          }),
        ],
        personalRootScope,
        });
      } catch (error) {
        console.error('Structured Doc template catalog discovery failed', error);
        webviewPanel.webview.postMessage({
          type: 'templateCatalogFailed',
          requestId,
          error: {
            code: 'catalog-unavailable',
            message: 'The template catalog could not be loaded.',
          },
        });
      }
    };

    const applyTemplateToCurrentDocument = async (
      templateId: string,
      expected: CurrentDocumentIdentity,
    ): Promise<boolean> => {
      if (!canApplyTemplateToCurrentDocument(
        document.getText(), document.getText(), expected, currentDocumentIdentity(),
      )) {
        return false;
      }

      const template = availableTemplates.get(templateId);
      if (!template) {
        return false;
      }
      const defaultTitle = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
        || 'Untitled';
      const baselineText = document.getText();
      const prepared = prepareCurrentDocumentTemplateApplication({
        currentText: baselineText,
        template,
        defaultTitle,
      });
      const committed = await commitCurrentDocumentTemplateApplication({
        expectedText: baselineText,
        currentText: document.getText(),
        expected,
        current: currentDocumentIdentity(),
        preparedText: prepared.text,
        apply: async (text) => {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
            text,
          );
          await this.applyExpectedEdit(document, edit, text);
        },
      });
      if (!committed) {
        return false;
      }
      postExplicitReplacement('confirmed-template');
      return true;
    };

    type PersonalTemplateRequest = Extract<EditorToHostMessage, {
      type:
        | 'savePersonalTemplate'
        | 'updatePersonalTemplate'
        | 'duplicatePersonalTemplate'
        | 'deletePersonalTemplate'
        | 'openPersonalTemplateFolder';
    }>;

    const templateRequestFailure = (code: TemplateErrorCode, message: string): never => {
      throw Object.assign(new Error(message), { templateErrorCode: code });
    };

    const classifyTemplateRequestError = (error: unknown): TemplateOperationError => {
      if (error instanceof Error && 'templateErrorCode' in error) {
        const code = (error as Error & { templateErrorCode: TemplateErrorCode }).templateErrorCode;
        return { code, message: 'The template action could not be completed.' };
      }
      return { code: 'operation-failed', message: 'The template action could not be completed.' };
    };

    const requireLiveTemplateRequest = (
      request: Extract<PersonalTemplateRequest, { sessionId: string }>,
    ): void => {
      const current = currentDocumentIdentity();
      if (request.sessionId !== current.sessionId
        || request.documentId !== current.documentId
        || request.baseRevision !== current.revision) {
        templateRequestFailure(
          'document-changed',
          'The document changed before the template operation started.',
        );
      }
    };

    const handlePersonalTemplateRequest = async (
      request: PersonalTemplateRequest,
    ): Promise<void> => {
      let operation: PersonalTemplateOperation;
      switch (request.type) {
        case 'savePersonalTemplate': operation = 'save'; break;
        case 'updatePersonalTemplate': operation = 'update'; break;
        case 'duplicatePersonalTemplate': operation = 'duplicate'; break;
        case 'deletePersonalTemplate': operation = 'delete'; break;
        case 'openPersonalTemplateFolder': operation = 'open-folder'; break;
      }
      let result: 'completed' | 'failed' = 'failed';
      let resultTemplateId: string | undefined;
      let resultError: TemplateOperationError | undefined;
      try {
        if ('sessionId' in request) {
          await messageQueue.whenIdle();
          requireLiveTemplateRequest(request);
        }
        if (request.type === 'openPersonalTemplateFolder') {
          const personalRoot = await templateService.ensurePersonalTemplateRoot();
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(personalRoot));
          result = 'completed';
          return;
        }
        if (request.type === 'deletePersonalTemplate') {
          const template = availableTemplates.get(request.templateId);
          if (!template || template.descriptor.source !== 'user') {
            return templateRequestFailure('template-unavailable', 'The selected personal template is no longer available.');
          }
          if (personalTemplateFingerprints.get(request.templateId) !== request.revisionToken) {
            templateRequestFailure('template-changed', 'The selected personal template changed.');
          }
          await templateService.trashPersonalTemplate(request.templateId, request.revisionToken);
          result = 'completed';
          resultTemplateId = request.templateId;
          return;
        }
        if (request.type === 'updatePersonalTemplate' || request.type === 'duplicatePersonalTemplate') {
          const template = availableTemplates.get(request.templateId);
          const currentFingerprint = personalTemplateFingerprints.get(request.templateId);
          if (!template || template.descriptor.source !== 'user') {
            return templateRequestFailure('template-unavailable', 'The selected personal template is no longer available.');
          }
          if (currentFingerprint !== request.revisionToken) {
            templateRequestFailure('template-changed', 'The selected personal template changed.');
          }
          const metadata = request.metadata;
          if (request.type === 'updatePersonalTemplate') {
            const updated = updatePersonalTemplateMetadata(template, metadata);
            await templateService.updatePersonalTemplate(
              request.templateId,
              request.revisionToken,
              updated.envelope,
            );
            resultTemplateId = request.templateId;
          } else {
            const newTemplateId = `user:${randomUUID()}`;
            const duplicate = createPersonalTemplateSnapshot(template.envelope, {
              id: newTemplateId,
              ...metadata,
              titleNodeId: template.descriptor.titleNodeId,
              sourceLabel: template.descriptor.sourceLabel,
            });
            await templateService.createPersonalTemplate(newTemplateId, duplicate.envelope);
            resultTemplateId = newTemplateId;
          }
          result = 'completed';
          return;
        }

        await messageQueue.whenIdle();
        requireLiveTemplateRequest(request);
        await this.flushEditor(webviewPanel.webview, sessionId);
        await messageQueue.whenIdle();
        const baselineIdentity = currentDocumentIdentity();
        const baselineText = document.getText();
        const metadata = request.metadata;
        if (document.getText() !== baselineText
          || currentDocumentIdentity().revision !== baselineIdentity.revision) {
          templateRequestFailure('document-changed', 'The document changed during the template operation.');
        }
        const source: unknown = isUninitializedSdocText(baselineText)
          ? { sdoc: '1.0', meta: {}, doc: { type: 'doc', content: [] } }
          : JSON.parse(baselineText);
        const contract = parseDocumentContract(source);
        if (!contract.ok || contract.legacy) {
          return templateRequestFailure('invalid-document', 'Only a valid SDOC 1.0 document can be saved as a personal template.');
        }
        const persistedSource = {
          ...contract.envelope,
          doc: dehydrateDocumentAssets(contract.envelope.doc),
        };
        const newTemplateId = `user:${randomUUID()}`;
        const snapshot = createPersonalTemplateSnapshot(persistedSource, {
          id: newTemplateId,
          ...metadata,
          titleNodeId: suggestTemplateTitleNodeId(contract.envelope),
          sourceLabel: templateService.personalTemplateRootPath,
        });
        await templateService.createPersonalTemplate(newTemplateId, snapshot.envelope);
        result = 'completed';
        resultTemplateId = newTemplateId;
      } catch (error) {
        resultError = classifyTemplateRequestError(error);
        console.error('Structured Doc template operation failed', error);
      } finally {
        templateManagementPending = false;
        webviewPanel.webview.postMessage({
          type: 'templateOperationFinished',
          requestId: request.requestId,
          operation,
          result,
          ...(resultTemplateId ? { templateId: resultTemplateId } : {}),
          ...(resultError ? { error: resultError } : {}),
        });
      }
    };

    // Handle messages from webview (sequential queue to preserve order)
    const messageQueue = new RecoverableSerialQueue();
    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isEditorToHostMessage(message)) {
        console.warn('Ignoring malformed Structured Doc editor message', message);
        return;
      }
      if (message.type === 'editorTextFocusChanged') {
        if (message.sessionId !== sessionId || message.documentId !== documentId) return;
        const registeredSession = this.editorSessions.get(documentId);
        if (registeredSession?.panel !== webviewPanel
          || registeredSession.sessionId !== sessionId
          || registeredSession.document !== document) return;
        this.updateEditorTextFocus(webviewPanel, editorIdentity, message.focused);
        return;
      }
      const readOnlySafeMessages = new Set([
        'ready', 'flushComplete', 'viewJson', 'export', 'openDocument', 'browseSdocFiles',
        'importMarkdown', 'importHtml', 'fileOperationApplied',
        'requestTemplateCatalog',
        'savePersonalTemplate', 'updatePersonalTemplate', 'duplicatePersonalTemplate',
        'deletePersonalTemplate', 'openPersonalTemplateFolder',
        'renderDiagram', 'cancelDiagramRender', 'updateDiagramRendererSettings',
        'testDiagramRendererConnection', 'updateUiLanguage',
      ]);
      if (writeBlockedReason && !readOnlySafeMessages.has(message.type)) {
        if (message.type === 'edit') {
          const hostSnapshot = tryReadCurrentMutation();
          webviewPanel.webview.postMessage({
            type: 'editRejected',
            sessionId,
            documentId,
            editId: message.editId,
            revision: document.version,
            code: 'INVALID_DOCUMENT',
            message: writeBlockedReason,
            ...(hostSnapshot ? { hostSnapshot } : {}),
          });
          if (message.flushRequestId) {
            this.rejectFlush(message.flushRequestId, new Error(writeBlockedReason));
          }
        }
        vscode.window.showErrorMessage(`Document is read-only because it is invalid: ${writeBlockedReason}`);
        if (message.type === 'applyTemplate') {
          webviewPanel.webview.postMessage({
            type: 'templateApplicationFinished',
            requestId: message.requestId,
            result: 'failed',
          });
        }
        return;
      }
      // Export must stay outside the serial message queue: its flush response is itself
      // an editor message and would otherwise wait behind the export that is awaiting it.
      if (message.type === 'export') {
        if (fileOperationPending || message.sessionId !== sessionId || message.documentId !== documentId) {
          webviewPanel.webview.postMessage({
            type: 'fileOperationStatus',
            sessionId: message.sessionId,
            state: {
              phase: 'failed',
              requestId: message.requestId,
              error: createFileOperationError(
                'FILE_OPERATION_BUSY',
                'Another file operation is already running.',
                false,
              ),
            },
          });
          return;
        }
        fileOperationPending = true;
        let usedDiagramFallback = false;
        let exportResult: 'completed' | 'cancelled' | 'fallback' = 'completed';
        void runExportAfterFlush(
          () => this.flushEditor(webviewPanel.webview, sessionId),
          async () => {
            const prepared = await prepareDiagramImages(message.format);
            usedDiagramFallback = prepared.usedFallback;
            exportResult = await this.exportService.exportDocument(
              document,
              message.format,
              prepared.images,
            );
          },
        ).then(() => {
          if (exportResult === 'cancelled') {
            webviewPanel.webview.postMessage({
              type: 'fileOperationStatus',
              sessionId,
              state: { phase: 'cancelled', requestId: message.requestId },
            });
            return;
          }
          webviewPanel.webview.postMessage({
            type: 'fileOperationStatus',
            sessionId,
            state: {
              phase: 'succeeded',
              requestId: message.requestId,
              result: usedDiagramFallback || exportResult === 'fallback'
                ? 'fallback'
                : 'completed',
            },
          });
        }).catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Structured Doc export failed: ${detail}`);
          webviewPanel.webview.postMessage({
            type: 'fileOperationStatus',
            sessionId,
            state: {
              phase: 'failed',
              requestId: message.requestId,
              error: createFileOperationError(
                'EXPORT_FAILED',
                'The document could not be exported.',
                true,
              ),
            },
          });
        }).finally(() => {
          fileOperationPending = false;
        });
        return;
      }
      if (message.type === 'renderDiagram') {
        const controller = new AbortController();
        diagramRequests.get(message.requestId)?.abort();
        diagramRequests.set(message.requestId, controller);
        void diagramService.render(message.language, message.source, {
          signal: controller.signal,
        }).then((result) => {
          webviewPanel.webview.postMessage({
            type: 'diagramRenderResult',
            requestId: message.requestId,
            result: {
              status: 'ready',
              dataUrl: result.dataUrl,
              width: result.width,
              height: result.height,
            },
          });
        }).catch((error: unknown) => {
          const renderError = error instanceof KrokiRenderError
            ? error
            : new KrokiRenderError(
              'offline',
              'The diagram renderer could not be reached.',
              true,
            );
          webviewPanel.webview.postMessage({
            type: 'diagramRenderResult',
            requestId: message.requestId,
            result: {
              status: 'error',
              code: renderError.code,
              message: renderError.message,
              retryable: renderError.retryable,
            },
          });
        }).finally(() => {
          diagramRequests.delete(message.requestId);
        });
        return;
      }
      if (message.type === 'cancelDiagramRender') {
        diagramRequests.get(message.requestId)?.abort();
        diagramRequests.delete(message.requestId);
        return;
      }
      if (message.type === 'updateDiagramRendererSettings') {
        const config = vscode.workspace.getConfiguration('structuredDocEditor.diagramRenderer');
        void Promise.all([
          config.update('enabled', message.settings.enabled, vscode.ConfigurationTarget.Global),
          config.update('endpoint', message.settings.endpoint, vscode.ConfigurationTarget.Global),
          config.update(
            'allowPrivateNetwork',
            message.settings.allowPrivateNetwork,
            vscode.ConfigurationTarget.Global,
          ),
        ]).then(() => {
          diagramService.updateSettings(message.settings);
          webviewPanel.webview.postMessage({
            type: 'diagramRendererSettings',
            settings: message.settings,
          });
        });
        return;
      }
      if (message.type === 'testDiagramRendererConnection') {
        const testService = new KrokiDiagramService({ ...message.settings, enabled: true });
        void testService.render('graphviz', 'digraph { ready }', { timeoutMs: 3_000 })
          .then((result) => webviewPanel.webview.postMessage({
            type: 'diagramRenderResult',
            requestId: message.requestId,
            result: {
              status: 'ready',
              dataUrl: result.dataUrl,
              width: result.width,
              height: result.height,
            },
          }))
          .catch((error: unknown) => {
            const renderError = error instanceof KrokiRenderError
              ? error
              : new KrokiRenderError('offline', 'The endpoint could not be reached.', true);
            webviewPanel.webview.postMessage({
              type: 'diagramRenderResult',
              requestId: message.requestId,
              result: {
                status: 'error',
                code: renderError.code,
                message: renderError.message,
                retryable: renderError.retryable,
              },
            });
          });
        return;
      }
      if (message.type === 'flushComplete') {
        if (message.sessionId === sessionId && message.requestId) this.resolveFlush(message.requestId);
        return;
      }
      if (message.type === 'flushFailed') {
        if (message.sessionId === sessionId) {
          this.rejectFlush(message.requestId, new Error(message.message));
        }
        return;
      }
      if (message.type === 'fileOperationApplied') {
        if (message.sessionId === sessionId && message.documentId === documentId) {
          const pending = pendingImportAcks.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingImportAcks.delete(message.requestId);
            pending.resolve(message.applied);
          }
        }
        return;
      }
      if (message.type === 'savePersonalTemplate'
        || message.type === 'updatePersonalTemplate'
        || message.type === 'duplicatePersonalTemplate'
        || message.type === 'deletePersonalTemplate'
        || message.type === 'openPersonalTemplateFolder') {
        if (templateManagementPending) {
          webviewPanel.webview.postMessage({
            type: 'templateOperationFinished',
            requestId: message.requestId,
            operation: message.type === 'savePersonalTemplate' ? 'save'
              : message.type === 'updatePersonalTemplate' ? 'update'
                : message.type === 'duplicatePersonalTemplate' ? 'duplicate'
                  : message.type === 'deletePersonalTemplate' ? 'delete'
                    : 'open-folder',
            result: 'failed',
            error: {
              code: 'operation-failed',
              message: 'Another template operation is already running.',
            },
          });
          return;
        }
        templateManagementPending = true;
        void handlePersonalTemplateRequest(message);
        return;
      }
      if (message.type === 'applyTemplate') {
        if (templateApplicationPending) {
          webviewPanel.webview.postMessage({
            type: 'templateApplicationFinished',
            requestId: message.requestId,
            result: 'failed',
            error: {
              code: 'operation-failed',
              message: 'Another template operation is already running.',
            },
          });
          return;
        }
        templateApplicationPending = true;
      }
      if (message.type === 'importMarkdown' || message.type === 'importHtml') {
        if (fileOperationPending || message.sessionId !== sessionId || message.documentId !== documentId) {
          webviewPanel.webview.postMessage({
            type: 'fileOperationStatus',
            sessionId: message.sessionId,
            state: {
              phase: 'failed',
              requestId: message.requestId,
              error: createFileOperationError(
                'FILE_OPERATION_BUSY',
                'Another file operation is already running.',
                false,
              ),
            },
          });
          return;
        }
        fileOperationPending = true;
      }
      messageQueue.enqueue(async () => {
        switch (message.type) {
          case 'ready':
            sendUpdate();
            webviewPanel.webview.postMessage({
              type: 'diagramRendererSettings',
              settings: this.readDiagramRendererSettings(),
            });
            break;
          case 'updateUiLanguage': {
            const config = vscode.workspace.getConfiguration('structuredDocEditor.ui');
            await updateUiLanguagePreference(message.preference, {
              write: async (preference) => {
                await config.update(
                  'language',
                  preference,
                  vscode.ConfigurationTarget.Global,
                );
              },
              publishCurrent: sendUiLanguage,
              recoverFromWriteFailure: (error) => recoverFromUiLanguageWriteFailure(error, {
                report: (writeError) => {
                  console.error('Structured Doc UI language update failed', writeError);
                },
                showError: async (messageText, action) =>
                  vscode.window.showErrorMessage(messageText, action),
                openUserSettings: async () => {
                  await vscode.commands.executeCommand('workbench.action.openSettingsJson');
                },
              }),
            });
            break;
          }
          case 'requestTemplateCatalog':
            await sendTemplateCatalog(message.requestId);
            break;
          case 'applyTemplate': {
            let applied = false;
            let applicationError: TemplateOperationError | undefined;
            try {
              applied = await applyTemplateToCurrentDocument(message.templateId, {
                sessionId: message.sessionId,
                documentId: message.documentId,
                revision: message.baseRevision,
              });
              if (!applied) {
                applicationError = {
                  code: availableTemplates.has(message.templateId)
                    ? 'document-changed'
                    : 'template-unavailable',
                  message: 'The template could not be applied.',
                };
              }
            } catch (error) {
              console.error('Structured Doc template application failed', error);
              applicationError = {
                code: 'operation-failed',
                message: 'The template could not be applied.',
              };
            } finally {
              templateApplicationPending = false;
              webviewPanel.webview.postMessage({
                type: 'templateApplicationFinished',
                requestId: message.requestId,
                result: applied ? 'applied' : 'failed',
                ...(applicationError ? { error: applicationError } : {}),
              });
            }
            break;
          }
          case 'edit':
            if (message.sessionId !== sessionId || message.documentId !== documentId
              || message.baseRevision !== document.version) {
              const hostSnapshot = tryReadCurrentMutation();
              webviewPanel.webview.postMessage({
                type: 'editRejected',
                sessionId,
                documentId,
                editId: message.editId,
                revision: document.version,
                code: 'STALE_REVISION',
                message: 'stale revision or document identity',
                ...(hostSnapshot ? { hostSnapshot } : {}),
              });
              if (message.flushRequestId) {
                this.rejectFlush(message.flushRequestId, new Error('Editor flush was rejected as stale.'));
              }
              break;
            }
            try {
              await this.updateDocument(document, message.mutation);
              webviewPanel.webview.postMessage({
                type: 'editAcknowledged',
                sessionId,
                documentId,
                editId: message.editId,
                revision: document.version,
              });
              if (message.flushRequestId) this.resolveFlush(message.flushRequestId);
            } catch (error) {
              const hostSnapshot = tryReadCurrentMutation();
              webviewPanel.webview.postMessage({
                type: 'editRejected',
                sessionId,
                documentId,
                editId: message.editId,
                revision: document.version,
                code: 'WRITE_FAILED',
                message: error instanceof Error ? error.message : String(error),
                ...(hostSnapshot ? { hostSnapshot } : {}),
              });
              if (message.flushRequestId) {
                this.rejectFlush(message.flushRequestId, new Error('Editor flush failed to apply.'));
              }
              throw error;
            }
            break;
          case 'viewJson':
            await this.openJsonView(document);
            break;
          case 'saveImage':
            await this.assetService.saveImage(document, webviewPanel.webview, message);
            break;
          case 'createDrawio':
            await this.assetService.createDrawioFile(document, webviewPanel.webview, message);
            break;
          case 'importDrawio':
            await this.assetService.importDrawioFile(document, webviewPanel.webview);
            break;
          case 'openDrawio':
            await this.assetService.openDrawioFile(document, message);
            break;
          case 'insertExistingImage':
            await this.assetService.insertExistingImage(document, webviewPanel.webview);
            break;
          case 'replaceImage':
            await this.assetService.replaceImage(document, webviewPanel.webview, message.pos);
            break;
          case 'openDocument':
            await this.openLinkedDocument(document, message.path, message.anchor);
            break;
          case 'browseSdocFiles':
            await this.browseSdocFiles(document, webviewPanel.webview);
            break;
          case 'importMarkdown':
            try {
              await this.importMarkdown(
                document,
                webviewPanel,
                message,
                () => waitForImportApplied(message.requestId),
              );
            } finally {
              fileOperationPending = false;
            }
            break;
          case 'importHtml':
            try {
              await this.importHtml(
                document,
                webviewPanel,
                message,
                () => waitForImportApplied(message.requestId),
              );
            } finally {
              fileOperationPending = false;
            }
            break;
          case 'selectCssFile': {
            const selectedPath = await this.selectCssFile(document);
            if (selectedPath !== undefined) {
              webviewPanel.webview.postMessage({
                type: 'documentSettingSelected',
                key: message.target === 'slide' ? 'slideCssPath' : 'htmlCssPath',
                value: selectedPath,
              });
            }
            break;
          }
          case 'clearCssFile': {
            webviewPanel.webview.postMessage({
              type: 'documentSettingSelected',
              key: message.target === 'slide' ? 'slideCssPath' : 'htmlCssPath',
              value: null,
            });
            break;
          }
        }
      }, (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('Structured Doc message failed', error);
        vscode.window.showErrorMessage(`Structured Doc operation failed: ${detail}`);
      });
    });

    // Flush webview state before save to prevent data loss
    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;

      e.waitUntil(this.flushEditor(webviewPanel.webview, sessionId, 1000));
    });

    // Handle external document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        // Don't send update if we caused the change
        if (this.expectedDocumentChanges.consume(
          document.uri.toString(),
          document.getText(),
        )) {
          return;
        }

        if (isUninitializedSdocText(document.getText())) {
          postExternalChange();
          return;
        }

        // Send updated content to webview
        try {
          postExternalChange();
        } catch {
          // Ignore parse errors during typing
        }
      }
    });

    // drawio.svg 파일 변경 감시 — draw.io 확장이 저장하면 웹뷰 이미지를 갱신
    const drawioWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(documentDir, 'drawio/**/*.drawio.svg')
    );

    const drawioGeneration = ++SdocEditorProvider.watcherGeneration;
    const pendingDrawioEvents = new Map<string, NodeJS.Timeout>();
    const notifyDrawioUpdated = (uri: vscode.Uri) => {
      const relativePath = `./${path.relative(documentDir.fsPath, uri.fsPath).replace(/\\/g, '/')}`;
      const previous = pendingDrawioEvents.get(relativePath);
      if (previous) clearTimeout(previous);
      // 캐시 버스팅: 타임스탬프를 쿼리 파라미터로 추가
      pendingDrawioEvents.set(relativePath, setTimeout(() => {
        pendingDrawioEvents.delete(relativePath);
        const webviewUri = webviewPanel.webview.asWebviewUri(uri);
        void webviewPanel.webview.postMessage({
          type: 'drawioFileUpdated', documentId, generation: drawioGeneration, relativePath,
          newWebviewUri: `${webviewUri.toString()}?t=${Date.now()}`,
        });
      }, 150));
    };

    drawioWatcher.onDidChange(notifyDrawioUpdated);
    drawioWatcher.onDidCreate(notifyDrawioUpdated);

    // Watch for settings changes
    const settingsSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('structuredDocEditor')) {
        sendSettings();
      }
      if (e.affectsConfiguration('structuredDocEditor.ui.language')) {
        sendUiLanguage();
      }
    });
    const viewStateSubscription = webviewPanel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active) {
        this.releaseEditorTextFocus(webviewPanel, editorIdentity);
      }
    });

    // Cleanup
    webviewPanel.onDidDispose(() => {
      this.releaseEditorTextFocus(webviewPanel, editorIdentity);
      if (this.editorSessions.get(documentId)?.panel === webviewPanel) {
        this.editorSessions.delete(documentId);
      }
      changeDocumentSubscription.dispose();
      willSaveSubscription.dispose();
      drawioWatcher.dispose();
      pendingDrawioEvents.forEach((timer) => clearTimeout(timer));
      settingsSubscription.dispose();
      viewStateSubscription.dispose();
      this.expectedDocumentChanges.clear(document.uri.toString());
      for (const [requestId, pending] of this.pendingFlushResolvers) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Editor was closed before its content could be flushed.'));
        this.pendingFlushResolvers.delete(requestId);
      }
    });
  }

  private async updateDocument(
    document: vscode.TextDocument,
    mutation: DocumentMutation,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    // Convert webview URIs back to relative paths before saving
    const convertedContent = dehydrateDocumentAssets(
      convertWebviewUrisToRelativePaths(mutation.content),
    );

    // Read existing file to preserve metadata
    const existingText = document.getText();
    let existingMeta: SdocMeta = {};
    try {
      existingMeta = sharedUnwrapSdoc(existingText.trim() ? JSON.parse(existingText) : {}).meta;
    } catch {
      // intentionally ignored: parse errors during editing
    }

    const nextMeta: SdocMeta = { ...existingMeta, ...mutation.meta };
    if (mutation.documentSettings && Object.keys(mutation.documentSettings).length > 0) {
      nextMeta.settings = mutation.documentSettings;
    } else {
      delete nextMeta.settings;
    }

    // Resolve settings from doc settings > VS Code > default
    const config = vscode.workspace.getConfiguration('structuredDocEditor');
    const resolved = resolveSettings(nextMeta.settings, {
      equationNumbering: config.get<'sequential' | 'hierarchical'>('equation.numbering', 'sequential'),
      captionStyle: config.get<CaptionStyleName>('caption.style', 'modern'),
      crossRefIncludeCaption: config.get<boolean>('caption.crossRefIncludeCaption', false),
      captionNumbering: config.get<'sequential' | 'hierarchical'>('caption.numbering', 'sequential'),
      headingNumbering: config.get<boolean>('heading.numbering', true),
      headingStartNumber: config.get<number>('heading.startNumber', SETTINGS_DEFAULTS.headingStartNumber),
    });

    const synced = normalizeDocument(convertedContent, {
      equationNumbering: resolved.equationNumbering,
      captionStyle: resolved.captionStyle,
      crossRefIncludeCaption: resolved.crossRefIncludeCaption,
      captionNumbering: resolved.captionNumbering,
      headingNumbering: resolved.headingNumbering,
      headingStartNumber: resolved.headingStartNumber,
    });

    // Wrap in sdoc envelope, preserving settings
    const sdocFile: Record<string, unknown> = {
      sdoc: SdocEditorProvider.SDOC_VERSION,
      meta: {
        ...nextMeta,
        title: nextMeta.title || '',
        author: nextMeta.author || '',
        version: nextMeta.version || '0.1',
        created: nextMeta.created || new Date().toISOString(),
        modified: new Date().toISOString(),
        ...(nextMeta.settings && Object.keys(nextMeta.settings).length > 0
          ? { settings: nextMeta.settings }
          : {}),
      },
      doc: synced,
    };
    assertPersistedDocument(sdocFile);

    // Pretty-print JSON for better git diffs
    const json = JSON.stringify(sdocFile, null, 2);
    edit.replace(document.uri, fullRange, json);

    await this.applyExpectedEdit(document, edit, json);
  }

  private async applyExpectedEdit(
    document: vscode.TextDocument,
    edit: vscode.WorkspaceEdit,
    expectedText: string,
  ): Promise<void> {
    const uri = document.uri.toString();
    const expectedAppliedText = this.expectedDocumentChanges.expect(
      uri,
      expectedText,
      document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    );
    let applied: boolean;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch (error) {
      this.expectedDocumentChanges.remove(uri, expectedAppliedText);
      throw error;
    }
    if (!applied) {
      this.expectedDocumentChanges.remove(uri, expectedAppliedText);
      throw new Error('VS Code rejected the document edit.');
    }
  }

  private async exportActive(format: ExportFormat): Promise<void> {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input;
    const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : undefined;
    if (!uri || (!uri.path.endsWith('.sdoc') && !uri.path.endsWith('.tiptap.json'))) {
      throw new Error('The active tab is not a Structured Doc document.');
    }

    const key = uri.toString();
    const session = this.editorSessions.get(key);
    const document = session?.document
      ?? vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === key)
      ?? await vscode.workspace.openTextDocument(uri);
    await runExportAfterFlush(
      session ? () => this.flushEditor(session.panel.webview, session.sessionId) : undefined,
      async () => {
        await this.exportService.exportDocument(document, format);
      },
    );
  }

  private async flushActive(): Promise<void> {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input;
    const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : undefined;
    if (!uri) return;
    const session = this.editorSessions.get(uri.toString());
    if (session) await this.flushEditor(session.panel.webview, session.sessionId);
  }

  private flushEditor(webview: vscode.Webview, sessionId: string, timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        if (!this.pendingFlushResolvers.has(requestId)) return;
        this.rejectFlush(requestId, new Error('Timed out waiting for the editor to flush its latest content.'));
      }, timeoutMs);
      this.pendingFlushResolvers.set(requestId, { resolve, reject, timer });
      void webview.postMessage({ type: 'requestFlush', sessionId, requestId }).then((delivered) => {
        if (!delivered) this.rejectFlush(requestId, new Error('The editor is unavailable for export.'));
      }, (error: unknown) => {
        this.rejectFlush(requestId, error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Resolve any pending flush for this document */
  private resolveFlush(requestId: string): void {
    const pending = this.pendingFlushResolvers.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingFlushResolvers.delete(requestId);
      pending.resolve();
    }
  }

  private rejectFlush(requestId: string, error: Error): void {
    const pending = this.pendingFlushResolvers.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingFlushResolvers.delete(requestId);
      pending.reject(error);
    }
  }

  private async openJsonView(document: vscode.TextDocument): Promise<void> {
    try {
      // Open the same document with text editor (not custom editor)
      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        'default',
        { viewColumn: vscode.ViewColumn.Beside, preview: false }
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open JSON view: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async importMarkdown(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    request: Extract<EditorToHostMessage, { type: 'importMarkdown' }>,
    waitUntilApplied: () => Promise<boolean>,
  ): Promise<void> {
    try {
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import Markdown',
        filters: { 'Markdown Files': ['md', 'markdown'] },
      });
      if (!fileUris || fileUris.length === 0) {
        await webviewPanel.webview.postMessage({
          type: 'fileOperationStatus',
          sessionId: request.sessionId,
          state: { phase: 'cancelled', requestId: request.requestId },
        });
        return;
      }

      const mdBytes = await vscode.workspace.fs.readFile(fileUris[0]);
      const mdText = new TextDecoder('utf-8').decode(mdBytes);
      const doc = convertMarkdownToJson(mdText);

      // Convert image paths to webview URIs
      const documentDir = vscode.Uri.joinPath(document.uri, '..');
      const convertedDoc = convertImagePathsToWebviewUris(doc, documentDir, webviewPanel.webview);

      const applied = waitUntilApplied();
      await webviewPanel.webview.postMessage({
        type: 'importContent',
        requestId: request.requestId,
        sessionId: request.sessionId,
        documentId: request.documentId,
        content: convertedDoc,
      });
      if (!await applied) {
        await webviewPanel.webview.postMessage({
          type: 'fileOperationStatus',
          sessionId: request.sessionId,
          state: { phase: 'cancelled', requestId: request.requestId },
        });
        return;
      }
      await webviewPanel.webview.postMessage({
        type: 'fileOperationStatus',
        sessionId: request.sessionId,
        state: { phase: 'succeeded', requestId: request.requestId, result: 'completed' },
      });
      vscode.window.showInformationMessage('Markdown imported successfully');
    } catch (error) {
      await webviewPanel.webview.postMessage({
        type: 'fileOperationStatus',
        sessionId: request.sessionId,
        state: {
          phase: 'failed',
          requestId: request.requestId,
          error: createFileOperationError(
            'IMPORT_FAILED',
            'The Markdown file could not be imported.',
            true,
          ),
        },
      });
      vscode.window.showErrorMessage(
        `Failed to import Markdown: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async importHtml(
    _document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    request: Extract<EditorToHostMessage, { type: 'importHtml' }>,
    waitUntilApplied: () => Promise<boolean>,
  ): Promise<void> {
    try {
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import HTML',
        filters: { 'HTML Files': ['html', 'htm'] },
      });
      if (!fileUris || fileUris.length === 0) {
        await webviewPanel.webview.postMessage({
          type: 'fileOperationStatus',
          sessionId: request.sessionId,
          state: { phase: 'cancelled', requestId: request.requestId },
        });
        return;
      }

      const htmlBytes = await vscode.workspace.fs.readFile(fileUris[0]);
      const htmlText = new TextDecoder('utf-8').decode(htmlBytes);
      const applied = waitUntilApplied();

      // Send raw HTML to webview — Tiptap's setContent(htmlString) will parse it
      await webviewPanel.webview.postMessage({
        type: 'importHtml',
        requestId: request.requestId,
        sessionId: request.sessionId,
        documentId: request.documentId,
        html: htmlText,
      });
      if (!await applied) {
        await webviewPanel.webview.postMessage({
          type: 'fileOperationStatus',
          sessionId: request.sessionId,
          state: { phase: 'cancelled', requestId: request.requestId },
        });
        return;
      }
      await webviewPanel.webview.postMessage({
        type: 'fileOperationStatus',
        sessionId: request.sessionId,
        state: { phase: 'succeeded', requestId: request.requestId, result: 'completed' },
      });
      vscode.window.showInformationMessage('HTML imported successfully');
    } catch (error) {
      await webviewPanel.webview.postMessage({
        type: 'fileOperationStatus',
        sessionId: request.sessionId,
        state: {
          phase: 'failed',
          requestId: request.requestId,
          error: createFileOperationError(
            'IMPORT_FAILED',
            'The HTML file could not be imported.',
            true,
          ),
        },
      });
      vscode.window.showErrorMessage(
        `Failed to import HTML: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async openLinkedDocument(
    currentDocument: vscode.TextDocument,
    relPath: string,
    _anchor?: string
  ): Promise<void> {
    try {
      const currentDir = path.dirname(currentDocument.uri.fsPath);
      const targetPath = path.resolve(currentDir, relPath);
      const targetUri = vscode.Uri.file(targetPath);

      // Verify file exists
      try {
        await vscode.workspace.fs.stat(targetUri);
      } catch {
        vscode.window.showWarningMessage(`File not found: ${relPath}`);
        return;
      }

      await vscode.commands.executeCommand('vscode.open', targetUri);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async browseSdocFiles(
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const currentDir = path.dirname(document.uri.fsPath);

    // Find all .sdoc files in workspace
    const files = await vscode.workspace.findFiles(
      '**/*.sdoc',
      '{**/node_modules/**,**/.sdoc/templates/**}',
      100,
    );
    const currentPath = document.uri.fsPath;

    const items = files
      .filter((file) => {
        if (file.fsPath === currentPath) return false;
        return !isWorkspaceTemplatePath(file.path);
      })
      .map(f => {
        const rel = path.relative(currentDir, f.fsPath).replace(/\\/g, '/');
        const label = path.basename(f.fsPath);
        return { label, description: rel, fsPath: f.fsPath, relativePath: rel.startsWith('.') ? rel : `./${rel}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a .sdoc document to link',
      matchOnDescription: true,
    });

    if (selected) {
      // Read the target document to get its referenceable targets
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(selected.fsPath));
        const text = new TextDecoder().decode(data);
        const parsed = JSON.parse(text);
        const { doc } = sharedUnwrapSdoc(parsed);
        const targets = this.collectExternalTargets(doc);

        webview.postMessage({
          type: 'sdocFileBrowseResult',
          path: selected.relativePath,
          fileName: selected.label,
          targets,
        });
      } catch {
        webview.postMessage({
          type: 'sdocFileBrowseResult',
          path: selected.relativePath,
          fileName: selected.label,
          targets: [],
        });
      }
    }
  }

  private collectExternalTargets(doc: TiptapNode): Array<{ id: string; type: string; label: string }> {
    const targets: Array<{ id: string; type: string; label: string }> = [];
    if (!doc?.content) return targets;

    const h = [0, 0, 0, 0, 0, 0];
    let imgCnt = 0;
    let tblCnt = 0;

    const getText = (node: TiptapNode): string => {
      if (node.type === 'text') return node.text || '';
      if (!node.content) return '';
      return node.content.map(getText).join('');
    };

    for (const node of doc.content) {
      if (node.type === 'heading') {
        const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
        h[level - 1]++;
        for (let j = level; j < 6; j++) h[j] = 0;
        if (level === 1) { imgCnt = 0; tblCnt = 0; }
        const nums = h.slice(0, level).join('.') + '.';
        const text = getText(node);
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
        if (id) targets.push({ id, type: 'heading', label: `${nums} ${text}` });
      }
      if (node.type === 'image' && typeof node.attrs?.id === 'string') {
        imgCnt++;
        const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
        targets.push({ id: node.attrs.id, type: 'figure', label: caption ? `Figure ${imgCnt}: ${caption}` : `Figure ${imgCnt}` });
      }
      if (node.type === 'table' && typeof node.attrs?.id === 'string') {
        tblCnt++;
        const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
        targets.push({ id: node.attrs.id, type: 'table', label: caption ? `Table ${tblCnt}: ${caption}` : `Table ${tblCnt}` });
      }
    }

    return targets;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = getWebviewUri(webview, this.context.extensionUri, [
      'dist',
      'webview',
      'assets',
      'index.js',
    ]);
    const styleUri = getWebviewUri(webview, this.context.extensionUri, [
      'dist',
      'webview',
      'assets',
      'index.css',
    ]);

    // Build @font-face declarations for bundled fonts
    const fontFaces = generateFontFaceCSS(webview, this.context.extensionUri);

    const nonce = getNonce();
    const htmlLanguage = this.resolveUiLocale() === 'ko' ? 'ko-KR' : 'en';

    return `<!DOCTYPE html>
<html lang="${htmlLanguage}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <style>${fontFaces}</style>
  <link href="${styleUri}" rel="stylesheet">
  <title>Structured Doc Editor</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async selectCssFile(document: vscode.TextDocument): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const defaultUri = workspaceFolder?.uri ?? vscode.Uri.file(path.dirname(document.uri.fsPath));

    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      defaultUri,
      filters: { 'CSS Files': ['css'] },
      title: 'Custom CSS 파일 선택',
    });

    if (!result || result.length === 0) {
      return undefined;
    }

    const selectedUri = result[0];
    const basePath = workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    return './' + path.relative(basePath, selectedUri.fsPath).replace(/\\/g, '/');
  }

}
