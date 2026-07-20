import { useEditor, JSONContent } from '@tiptap/react';
import { useRef, useEffect, useCallback, MutableRefObject } from 'react';
import { tiptapExtensions } from '../extensions/tiptapExtensions';

interface UseTiptapEditorOptions {
  onUpdate: (content: JSONContent, saveRequested?: boolean) => void;
  pendingEditRef: MutableRefObject<number>;
}

export const useTiptapEditor = ({ onUpdate, pendingEditRef }: UseTiptapEditorOptions) => {
  const skipUpdateRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const editor = useEditor({
    extensions: tiptapExtensions,
    content: '',
    onUpdate: ({ editor }) => {
      if (skipUpdateRef.current) {
        skipUpdateRef.current = false;
        return;
      }

      // Debounce updates to avoid too many messages
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const json = editor.getJSON();
        pendingEditRef.current++;
        onUpdateRef.current(json);
      }, 300);
    },
  });

  const setContent = (content: JSONContent) => {
    if (!editor) return;

    skipUpdateRef.current = true;

    // Save cursor position before replacing content
    const { from, to } = editor.state.selection;

    editor.commands.setContent(content, { emitUpdate: false });

    // Restore cursor position (clamped to new doc size)
    try {
      const newMax = editor.state.doc.content.size;
      const safeFrom = Math.min(from, newMax);
      const safeTo = Math.min(to, newMax);
      editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
    } catch {
      // ignore if position is invalid
    }
  };

  const flushUpdate = useCallback((saveRequested = false) => {
    if (!editor) return;

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Immediately send current state
    const json = editor.getJSON();
    pendingEditRef.current++;
    onUpdateRef.current(json, saveRequested);
  }, [editor, pendingEditRef]);

  // Flush pending edits on Ctrl+S so save always captures the latest state
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        flushUpdate(true);
      }
    };
    dom.addEventListener('keydown', handleKeyDown);
    return () => dom.removeEventListener('keydown', handleKeyDown);
  }, [editor, flushUpdate]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    editor,
    setContent,
    flushUpdate,
  };
};
