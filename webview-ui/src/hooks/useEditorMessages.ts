import { useRef, MutableRefObject } from 'react';
import { Editor as TiptapEditor, type JSONContent } from '@tiptap/react';
import { useEditorContext, resolveFontWeight } from '../context/EditorContext';
import { useVSCodeMessaging } from './useVSCodeMessaging';
import { preprocessImportedHtml } from '../utils/preprocessImportedHtml';

export interface MetaState {
  title: string;
  author: string;
  version: string;
  created: string;
  modified: string;
}

interface UseEditorMessagesOptions {
  editor: TiptapEditor | null;
  flushUpdate: () => void;
  setContentRef: MutableRefObject<((content: JSONContent) => void) | null>;
  initDoneRef: MutableRefObject<boolean>;
  pendingEditRef: MutableRefObject<boolean>;
  setMeta: React.Dispatch<React.SetStateAction<MetaState>>;
}

export function useEditorMessages({
  editor,
  flushUpdate,
  setContentRef,
  initDoneRef,
  pendingEditRef,
  setMeta,
}: UseEditorMessagesOptions) {
  const { dispatch } = useEditorContext();
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const flushRef = useRef(flushUpdate);
  flushRef.current = flushUpdate;

  const { postMessage } = useVSCodeMessaging((message) => {
    const ed = editorRef.current;
    const flush = flushRef.current;

    switch (message.type) {
      case 'init':
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
      case 'update':
        if (pendingEditRef.current) {
          pendingEditRef.current = false;
          break;
        }
        if (setContentRef.current) {
          setContentRef.current(message.content);
        }
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
          const fileName = (message.relativePath as string).split('/').pop()!;
          ed.chain().command(({ tr }) => {
            tr.doc.descendants((node, pos) => {
              if (node.type.name === 'image' && node.attrs.src) {
                const src: string = node.attrs.src;
                if (src.includes(fileName)) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: message.newWebviewUri });
                }
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

  return {
    postMessage,
    handleViewJson,
    handleExport,
    handleImport,
    handleMetaChange,
  };
}
