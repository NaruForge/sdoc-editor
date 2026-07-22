import { useEditor, JSONContent } from '@tiptap/react';
import { useRef, useEffect, useCallback, useMemo } from 'react';
import { createTiptapExtensions } from '../extensions/tiptapExtensions';
import type { EditorExtensionRuntime } from '../extensionRuntime';

interface UseTiptapEditorOptions {
  onUpdate: (content: JSONContent) => void;
  runtime: EditorExtensionRuntime;
  handleSaveShortcut?: boolean;
}

interface SaveShortcutEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
}

export class PendingEditorUpdateGate {
  private pending = false;

  public markPending(): void {
    this.pending = true;
  }

  public clear(): void {
    this.pending = false;
  }

  public consume(): boolean {
    if (!this.pending) return false;
    this.pending = false;
    return true;
  }
}

export type EditorFlushMode = 'barrier' | 'pending-only';

export function shouldEmitEditorFlush(mode: EditorFlushMode, hadPendingUpdate: boolean): boolean {
  return mode === 'barrier' || hadPendingUpdate;
}

export function shouldFlushOnSaveShortcut(
  event: SaveShortcutEvent,
  enabled: boolean,
): boolean {
  return enabled && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
}

export const useTiptapEditor = ({
  onUpdate,
  runtime,
  handleSaveShortcut = true,
}: UseTiptapEditorOptions) => {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const updateGateRef = useRef(new PendingEditorUpdateGate());
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const extensions = useMemo(() => createTiptapExtensions(runtime), [runtime]);
  const editor = useEditor({
    extensions,
    content: '',
    onUpdate: ({ editor }) => {
      updateGateRef.current.markPending();
      // Debounce updates to avoid too many messages
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        updateGateRef.current.clear();
        const json = editor.getJSON();
        onUpdateRef.current(json);
      }, 300);
    },
  });

  const setContent = (content: JSONContent) => {
    if (!editor) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    updateGateRef.current.clear();

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

  const emitUpdate = useCallback((mode: EditorFlushMode) => {
    const hadPendingUpdate = updateGateRef.current.consume();
    if (!editor || !shouldEmitEditorFlush(mode, hadPendingUpdate)) return false;

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Immediately send current state
    const json = editor.getJSON();
    onUpdateRef.current(json);
    return true;
  }, [editor]);

  // Save/close callers require an acknowledgement barrier even when the debounce
  // already emitted an edit that may still be waiting in the host queue.
  const flushUpdate = useCallback(() => emitUpdate('barrier'), [emitUpdate]);
  // Template confirmation must not dirty an untouched document when cancelled.
  const flushPendingUpdate = useCallback(() => emitUpdate('pending-only'), [emitUpdate]);

  // Standalone hosts flush Ctrl+S directly. VS Code delegates it to onWillSave.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldFlushOnSaveShortcut(e, handleSaveShortcut)) {
        flushUpdate();
      }
    };
    dom.addEventListener('keydown', handleKeyDown);
    return () => dom.removeEventListener('keydown', handleKeyDown);
  }, [editor, flushUpdate, handleSaveShortcut]);

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
    flushPendingUpdate,
  };
};
