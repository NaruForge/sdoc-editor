import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { ResolvedEditorSettings } from '../../types';
import {
  documentStructureSettingsKey,
  getDocumentStructureIndexState,
  requestStructureIndexSettingsRefresh,
  subscribeToDocumentStructureIndex,
  type DocumentStructureIndexState,
} from '../structureIndex';

export function useDocumentStructureIndex(
  editor: Editor | null,
  settings: ResolvedEditorSettings,
): DocumentStructureIndexState | null {
  const [index, setIndex] = useState<DocumentStructureIndexState | null>(null);
  const settingsKey = useMemo(() => documentStructureSettingsKey(settings), [settings]);

  useEffect(() => {
    if (!editor) {
      setIndex(null);
      return;
    }
    setIndex(getDocumentStructureIndexState(editor.state));
    return subscribeToDocumentStructureIndex(editor.view, setIndex);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = getDocumentStructureIndexState(editor.state);
    if (current.settingsKey !== settingsKey) {
      requestStructureIndexSettingsRefresh(editor.view);
    }
  }, [editor, settingsKey]);

  return index;
}
