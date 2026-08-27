import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { isPlainParagraphTextTransaction } from './structureIndex';

interface BlankDocumentProjection {
  allTopLevelBlocksAreParagraphs: boolean;
  visibleTextCount: number;
}

const countVisibleText = (text: string): number => text.match(/\S/gu)?.length ?? 0;

const projectBlankEditorDocument = (doc: ProseMirrorNode): BlankDocumentProjection => {
  let allTopLevelBlocksAreParagraphs = true;
  let visibleTextCount = 0;
  doc.forEach((block) => {
    if (block.type.name !== 'paragraph') {
      allTopLevelBlocksAreParagraphs = false;
      return;
    }
    block.forEach((inline) => {
      if (inline.isText) visibleTextCount += countVisibleText(inline.text ?? '');
    });
  });
  return { allTopLevelBlocksAreParagraphs, visibleTextCount };
};

const isBlankProjection = (projection: BlankDocumentProjection): boolean =>
  projection.allTopLevelBlocksAreParagraphs && projection.visibleTextCount === 0;

const updatePlainParagraphProjection = (
  projection: BlankDocumentProjection,
  transaction: Transaction,
): BlankDocumentProjection => {
  let visibleTextCount = projection.visibleTextCount;
  for (let stepIndex = 0; stepIndex < transaction.steps.length; stepIndex += 1) {
    const oldDoc = transaction.docs[stepIndex];
    const newDoc = transaction.docs[stepIndex + 1] ?? transaction.doc;
    transaction.steps[stepIndex].getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      visibleTextCount -= countVisibleText(oldDoc.textBetween(oldStart, oldEnd));
      visibleTextCount += countVisibleText(newDoc.textBetween(newStart, newEnd));
    });
  }
  return {
    allTopLevelBlocksAreParagraphs: projection.allTopLevelBlocksAreParagraphs,
    visibleTextCount,
  };
};

/**
 * Matches the start-card definition of an empty editor without serializing the
 * ProseMirror document. Non-text inline nodes are intentionally ignored, as
 * they were by the previous JSON-based check.
 */
export function isBlankEditorDocument(doc: ProseMirrorNode): boolean {
  return isBlankProjection(projectBlankEditorDocument(doc));
}

type TransactionEvent = { transaction: Transaction };

/**
 * Publishes only blank/non-blank transitions. Transaction events include full
 * document replacements even when Tiptap's `emitUpdate` option is disabled.
 */
export function subscribeToBlankEditorDocument(
  editor: Editor,
  listener: (blank: boolean) => void,
): () => void {
  let projection = projectBlankEditorDocument(editor.state.doc);
  let previous = isBlankProjection(projection);
  listener(previous);

  const handleTransaction = ({ transaction }: TransactionEvent) => {
    if (!transaction.docChanged) return;
    projection = isPlainParagraphTextTransaction(transaction)
      ? updatePlainParagraphProjection(projection, transaction)
      : projectBlankEditorDocument(transaction.doc);
    const next = isBlankProjection(projection);
    if (next === previous) return;
    previous = next;
    listener(next);
  };

  editor.on('transaction', handleTransaction);
  return () => editor.off('transaction', handleTransaction);
}
