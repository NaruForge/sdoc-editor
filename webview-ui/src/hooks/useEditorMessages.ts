import { useRef, useState, MutableRefObject } from 'react';
import { Editor as TiptapEditor, type JSONContent } from '@tiptap/react';
import { useEditorContext, resolveFontWeight } from '@shared/editor/context/EditorContext';
import { useVSCodeMessaging } from './useVSCodeMessaging';
import { preprocessImportedHtml } from '@shared/editor/utils/preprocessImportedHtml';
import { isUpdatedDrawioAsset } from '@shared/editor/drawioUpdates';
import type { ManagedTemplateDescriptor } from '@shared/types/messages';

export interface MetaState {
  title: string;
  author: string;
  version: string;
  created: string;
  modified: string;
}

interface UseEditorMessagesOptions {
  editor: TiptapEditor | null;
  flushUpdate: () => boolean;
  flushPendingUpdate: () => boolean;
  setContentRef: MutableRefObject<((content: JSONContent) => void) | null>;
  initDoneRef: MutableRefObject<boolean>;
  setMeta: React.Dispatch<React.SetStateAction<MetaState>>;
  persistenceSessionRef: MutableRefObject<{
    sessionId: string;
    documentId: string;
    revision: number;
    pendingFlushRequestId?: string;
  } | null>;
}

export function useEditorMessages({
  editor,
  flushUpdate,
  flushPendingUpdate,
  setContentRef,
  initDoneRef,
  setMeta,
  persistenceSessionRef,
}: UseEditorMessagesOptions) {
  const { dispatch } = useEditorContext();
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const flushRef = useRef(flushUpdate);
  flushRef.current = flushUpdate;
  const flushPendingRef = useRef(flushPendingUpdate);
  flushPendingRef.current = flushPendingUpdate;

  const [isExporting, setIsExporting] = useState(false);
  const [templates, setTemplates] = useState<ManagedTemplateDescriptor[]>([]);
  const [templateDiagnosticCount, setTemplateDiagnosticCount] = useState(0);
  const [isTemplateCatalogLoading, setIsTemplateCatalogLoading] = useState(true);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [isManagingTemplate, setIsManagingTemplate] = useState(false);
  const [personalTemplateRootPath, setPersonalTemplateRootPath] = useState('');
  const [personalTemplateRootScope, setPersonalTemplateRootScope] = useState<'local' | 'remote'>('local');

  const { postMessage } = useVSCodeMessaging((message) => {
    const ed = editorRef.current;
    const flush = flushRef.current;

    switch (message.type) {
      case 'init':
        persistenceSessionRef.current = {
          sessionId: message.sessionId,
          documentId: message.documentId,
          revision: message.revision,
        };
        ed?.setEditable(!message.readOnlyReason);
        if (setContentRef.current) {
          setContentRef.current(message.content);
          if (!initDoneRef.current) {
            initDoneRef.current = true;
            dispatch({ type: 'SET_READY', payload: true });
          }
        } else {
          dispatch({ type: 'SET_DOC', payload: message.content });
        }
        break;
      case 'templateCatalog':
        setTemplates(message.templates);
        setTemplateDiagnosticCount(message.diagnosticCount);
        setPersonalTemplateRootPath(message.personalRootPath);
        setPersonalTemplateRootScope(message.personalRootScope);
        setIsTemplateCatalogLoading(false);
        break;
      case 'templateApplicationFinished':
        setIsApplyingTemplate(false);
        break;
      case 'templateOperationFinished':
        setIsManagingTemplate(false);
        break;
      case 'update':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId) break;
        persistenceSessionRef.current.revision = message.revision;
        if (setContentRef.current) {
          setContentRef.current(message.content);
        }
        break;
      case 'requestFlush':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId) break;
        persistenceSessionRef.current.pendingFlushRequestId = message.requestId;
        if (ed) {
          flush();
        } else {
          postMessage({ type: 'flushComplete', sessionId: message.sessionId, requestId: message.requestId });
        }
        break;
      case 'editAcknowledged':
        if (persistenceSessionRef.current?.sessionId === message.sessionId) {
          persistenceSessionRef.current.revision = Math.max(
            persistenceSessionRef.current.revision,
            message.revision,
          );
        }
        break;
      case 'editRejected':
        if (persistenceSessionRef.current?.sessionId !== message.sessionId) break;
        persistenceSessionRef.current.revision = message.revision;
        setContentRef.current?.(message.content);
        break;
      case 'settingsChanged': {
        const s = { ...message.settings };
        if (typeof s.fontWeightBody === 'string') s.fontWeightBody = resolveFontWeight(s.fontWeightBody);
        if (typeof s.fontWeightBold === 'string') s.fontWeightBold = resolveFontWeight(s.fontWeightBold);
        if (typeof s.fontWeightH1 === 'string') s.fontWeightH1 = resolveFontWeight(s.fontWeightH1);
        if (typeof s.fontWeightH2 === 'string') s.fontWeightH2 = resolveFontWeight(s.fontWeightH2);
        if (typeof s.fontWeightH3 === 'string') s.fontWeightH3 = resolveFontWeight(s.fontWeightH3);
        dispatch({ type: 'SET_SETTINGS', payload: s });
        break;
      }
      case 'docSettingsChanged':
        dispatch({ type: 'SET_DOC_SETTINGS', payload: message.docSettings ?? null });
        break;
      case 'metaUpdate':
        setMeta(prev => ({ ...prev, ...message.meta }));
        break;
      case 'importContent':
        if (ed) {
          ed.commands.setContent(message.content);
          flush();
        }
        break;
      case 'importHtml':
        if (ed) {
          const cleaned = preprocessImportedHtml(message.html);
          ed.commands.setContent(cleaned);
          flush();
        }
        break;
      case 'imageSaved':
        if (ed && message.webviewUri) {
          ed.chain().focus().setImage({
            src: message.webviewUri,
            alt: message.imageName || '',
          }).run();
          flush();
        }
        break;
      case 'drawioCreated':
        if (ed && message.webviewUri) {
          ed.chain().focus().setImage({
            src: message.webviewUri,
            alt: message.fileName || 'diagram',
            title: message.fileName || 'diagram',
          }).run();
          flush();
        }
        break;
      case 'imageInserted':
        if (ed && message.webviewUri) {
          ed.chain().focus().setImage({
            src: message.webviewUri,
            alt: message.fileName || 'image',
          }).run();
          flush();
        }
        break;
      case 'drawioFileUpdated':
        if (ed && message.relativePath && message.newWebviewUri) {
          ed.chain().command(({ tr }) => {
            tr.doc.descendants((node, pos) => {
              if (node.type.name === 'image' && isUpdatedDrawioAsset(node.attrs.relativePath, message.relativePath)) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: message.newWebviewUri });
              }
            });
            return true;
          }).run();
        }
        break;
      case 'imageReplaced':
        if (ed && message.webviewUri && typeof message.pos === 'number') {
          ed.chain().focus().command(({ tr }) => {
            const node = tr.doc.nodeAt(message.pos);
            if (node && node.type.name === 'image') {
              tr.setNodeMarkup(message.pos, undefined, {
                ...node.attrs,
                src: message.webviewUri,
              });
            }
            return true;
          }).run();
          flush();
        }
        break;
      case 'exportStarted':
        setIsExporting(true);
        break;
      case 'exportDone':
        setIsExporting(false);
        break;
    }
  });

  const handleViewJson = () => {
    postMessage({ type: 'viewJson' });
  };

  const handleExport = (format: 'html' | 'adoc' | 'markdown' | 'pdf' | 'slides') => {
    postMessage({ type: 'export', format });
  };

  const handleImport = (format: 'markdown' | 'html') => {
    postMessage({ type: format === 'markdown' ? 'importMarkdown' : 'importHtml' });
  };

  const handleMetaChange = (field: string, value: string) => {
    setMeta(prev => ({ ...prev, [field]: value }));
    postMessage({ type: 'updateMeta', meta: { [field]: value } });
  };

  const handleRequestTemplateCatalog = () => {
    setIsTemplateCatalogLoading(true);
    postMessage({ type: 'requestTemplateCatalog' });
  };

  const handleApplyTemplate = (templateId: string) => {
    if (isApplyingTemplate) return;
    flushPendingRef.current();
    const session = persistenceSessionRef.current;
    if (!session) return;
    setIsApplyingTemplate(true);
    postMessage({
      type: 'applyTemplate',
      templateId,
      sessionId: session.sessionId,
      documentId: session.documentId,
      baseRevision: session.revision,
    });
  };

  const postIdentifiedTemplateOperation = (
    type: 'savePersonalTemplate' | 'updatePersonalTemplate' | 'duplicatePersonalTemplate',
    template?: ManagedTemplateDescriptor,
  ) => {
    if (isManagingTemplate) return;
    const session = persistenceSessionRef.current;
    if (!session) return;
    if (type !== 'savePersonalTemplate' && (!template || !template.revisionToken)) return;
    setIsManagingTemplate(true);
    if (type === 'savePersonalTemplate') {
      postMessage({
        type,
        requestId: crypto.randomUUID(),
        sessionId: session.sessionId,
        documentId: session.documentId,
        baseRevision: session.revision,
      });
      return;
    }
    if (!template?.revisionToken) return;
    postMessage({
      type,
      requestId: crypto.randomUUID(),
      sessionId: session.sessionId,
      documentId: session.documentId,
      baseRevision: session.revision,
      templateId: template.id,
      revisionToken: template.revisionToken,
    });
  };

  const handleSavePersonalTemplate = () =>
    postIdentifiedTemplateOperation('savePersonalTemplate');
  const handleUpdatePersonalTemplate = (template: ManagedTemplateDescriptor) =>
    postIdentifiedTemplateOperation('updatePersonalTemplate', template);
  const handleDuplicatePersonalTemplate = (template: ManagedTemplateDescriptor) =>
    postIdentifiedTemplateOperation('duplicatePersonalTemplate', template);
  const handleDeletePersonalTemplate = (template: ManagedTemplateDescriptor) => {
    if (isManagingTemplate || !template.revisionToken) return;
    setIsManagingTemplate(true);
    postMessage({
      type: 'deletePersonalTemplate',
      requestId: crypto.randomUUID(),
      templateId: template.id,
      revisionToken: template.revisionToken,
    });
  };
  const handleOpenPersonalTemplateFolder = () => {
    if (isManagingTemplate) return;
    setIsManagingTemplate(true);
    postMessage({ type: 'openPersonalTemplateFolder', requestId: crypto.randomUUID() });
  };

  return {
    postMessage,
    handleViewJson,
    handleExport,
    handleImport,
    handleMetaChange,
    handleRequestTemplateCatalog,
    handleApplyTemplate,
    handleSavePersonalTemplate,
    handleUpdatePersonalTemplate,
    handleDuplicatePersonalTemplate,
    handleDeletePersonalTemplate,
    handleOpenPersonalTemplateFolder,
    templates,
    templateDiagnosticCount,
    isTemplateCatalogLoading,
    isApplyingTemplate,
    isManagingTemplate,
    personalTemplateRootPath,
    personalTemplateRootScope,
    isExporting,
  };
}
