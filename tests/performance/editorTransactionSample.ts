import { Extension, getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { resolveEditorSettings } from '../../shared/settingsResolver';
import { createDocumentStructureIndexPlugin } from '../../shared/editor/structureIndex';
import type { AcceptedPerformanceCorpus } from './fixtures';

export interface EditorTransactionDimensions {
  topLevelBlocks: number;
  nodeCount: number;
  textSize: number;
}

export interface EditorTransactionSample {
  before: EditorTransactionDimensions;
  run(): void;
  after(): EditorTransactionDimensions;
}

const stableBlockAttributes = Extension.create({
  name: 'performanceStableBlockAttributes',
  addGlobalAttributes() {
    return [{
      types: ['heading', 'paragraph', 'codeBlock', 'blockquote', 'bulletList', 'listItem'],
      attributes: {
        id: { default: null },
        numbered: { default: null },
      },
    }];
  },
});

const schema = getSchema([StarterKit, stableBlockAttributes]);
const settings = resolveEditorSettings();

const dimensions = (state: EditorState): EditorTransactionDimensions => ({
  topLevelBlocks: state.doc.childCount,
  nodeCount: state.doc.nodeSize,
  textSize: state.doc.textContent.length,
});

/** Creates one isolated, fixed-input sample. Construction is deliberately outside timing. */
export const createEditorTransactionSample = (
  corpus: AcceptedPerformanceCorpus,
): EditorTransactionSample | undefined => {
  if (corpus.axis === 'rich') return undefined;
  const structurePlugin = createDocumentStructureIndexPlugin({ getSettings: () => settings });
  let state = EditorState.create({
    schema,
    plugins: [structurePlugin],
    doc: schema.nodeFromJSON(corpus.envelope.doc),
  });
  const before = dimensions(state);
  return {
    before,
    run(): void {
      // Replace one existing character so every sample has the same structural
      // and text dimensions before and after the representative transaction.
      const transaction = state.tr.insertText('x', 1, 2);
      if (!transaction.docChanged) throw new Error('ordinary text transaction must change the document');
      state = state.apply(transaction);
    },
    after: () => dimensions(state),
  };
};
