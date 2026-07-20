import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';

export function useEditorDomEvents(
  editor: Editor | null,
  onPaste: (event: ClipboardEvent) => void,
): void {
  useEffect(() => {
    if (!editor) return;
    const editorElement = editor.view.dom;
    const listener = onPaste as EventListener;
    editorElement.addEventListener('paste', listener);
    return () => editorElement.removeEventListener('paste', listener);
  }, [editor, onPaste]);

  useEffect(() => {
    if (!editor) return;

    const scrollCursorIntoView = () => {
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const scrollArea = document.querySelector<HTMLElement>('.editor-scroll-area');
        if (!scrollArea) return;
        const areaRect = scrollArea.getBoundingClientRect();
        const margin = 80;
        if (rect.bottom > areaRect.bottom - margin) {
          scrollArea.scrollTop += rect.bottom - areaRect.bottom + margin;
        } else if (rect.top < areaRect.top + margin) {
          scrollArea.scrollTop -= areaRect.top - rect.top + margin;
        }
      });
    };

    const handleMouseNavigation = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.button === 3) editor.commands.navigateBack();
      else editor.commands.navigateForward();
      scrollCursorIntoView();
    };

    document.addEventListener('mousedown', handleMouseNavigation, { capture: true });
    return () => document.removeEventListener('mousedown', handleMouseNavigation, { capture: true });
  }, [editor]);
}
