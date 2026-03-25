import { useEditor, JSONContent } from '@tiptap/react';
import { useRef, useEffect } from 'react';
import { tiptapExtensions } from '../extensions/tiptapExtensions';

interface UseTiptapEditorOptions {
  onUpdate: (content: JSONContent) => void;
}

export const useTiptapEditor = ({ onUpdate }: UseTiptapEditorOptions) => {
  const skipUpdateRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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
        onUpdate(json);
      }, 300);
    },
  });

  const setContent = (content: JSONContent) => {
    if (!editor) return;
    
    skipUpdateRef.current = true;
    editor.commands.setContent(content, false);
  };

  const flushUpdate = () => {
    if (!editor) return;
    
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // Immediately send current state
    const json = editor.getJSON();
    onUpdate(json);
  };

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
