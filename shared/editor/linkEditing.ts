import { getMarkRange } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, SelectionBookmark, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { normalizeSafeLinkUrl } from '../document/linkUrl';

export type LinkSelectionCaptureFailure = 'multiple-links' | 'mixed-linked-selection' | 'non-text-selection';

export interface CapturedLinkSelection {
  readonly sourceDocument: ProseMirrorNode;
  readonly bookmark: SelectionBookmark;
  readonly mode: 'insert' | 'edit';
  readonly target: { readonly from: number; readonly to: number };
  readonly text: string;
  readonly href: string;
  readonly commonMarks: readonly Mark[];
  readonly hasMixedFormatting: boolean;
}

export type CaptureLinkSelectionResult =
  { ok: true; snapshot: CapturedLinkSelection } | { ok: false; reason: LinkSelectionCaptureFailure };

export type LinkEditFailure = 'unsafe-url' | 'empty-text' | 'stale-selection' | 'no-link';

export type LinkTransactionResult = { ok: true; transaction: Transaction } | { ok: false; reason: LinkEditFailure };

interface CapturedLinkRange {
  from: number;
  to: number;
  href: string;
}

const nonLinkMarks = (marks: readonly Mark[]): Mark[] => marks.filter((mark) => mark.type.name !== 'link');

const sameMarkSet = (left: readonly Mark[], right: readonly Mark[]): boolean =>
  left.length === right.length && left.every((mark) => right.some((candidate) => candidate.eq(mark)));

const formattingAcross = (state: EditorState, from: number, to: number): { commonMarks: Mark[]; mixed: boolean } => {
  const markSets: Mark[][] = [];
  state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText || position >= to || position + node.nodeSize <= from) return;
    markSets.push(nonLinkMarks(node.marks));
  });
  if (markSets.length === 0) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    return { commonMarks: nonLinkMarks(marks), mixed: false };
  }
  const first = markSets[0] ?? [];
  const commonMarks = first.filter((mark) => markSets.every((marks) => marks.some((candidate) => candidate.eq(mark))));
  return {
    commonMarks,
    mixed: markSets.some((marks) => !sameMarkSet(first, marks)),
  };
};

const linkRangesAcrossSelection = (state: EditorState): CapturedLinkRange[] => {
  const { selection } = state;
  const linkType = state.schema.marks.link;
  if (!linkType) return [];
  const ranges = new Map<string, CapturedLinkRange>();
  const captureAt = (position: number, marks: readonly Mark[]): void => {
    const link = linkType.isInSet(marks);
    if (!link) return;
    const range = getMarkRange(state.doc.resolve(position), linkType, link.attrs);
    if (!range) return;
    const href = typeof link.attrs.href === 'string' ? link.attrs.href : '';
    ranges.set(`${range.from}:${range.to}:${href}`, { ...range, href });
  };

  if (selection.empty) {
    captureAt(selection.from, selection.$from.marks());
  } else {
    state.doc.nodesBetween(selection.from, selection.to, (node, position) => {
      if (!node.isText || position >= selection.to || position + node.nodeSize <= selection.from) return;
      captureAt(Math.max(position, selection.from), node.marks);
    });
  }
  return [...ranges.values()].sort((left, right) => left.from - right.from);
};

const selectionContainsUnlinkedText = (state: EditorState): boolean => {
  const { selection } = state;
  const linkType = state.schema.marks.link;
  if (selection.empty || !linkType) return false;
  let unlinked = false;
  state.doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (
      node.isText &&
      position < selection.to &&
      position + node.nodeSize > selection.from &&
      !linkType.isInSet(node.marks)
    )
      unlinked = true;
  });
  return unlinked;
};

/** Capture exact selection state and the complete active link range before focus leaves the editor. */
export function captureLinkSelection(state: EditorState): CaptureLinkSelectionResult {
  const { selection } = state;
  if (
    !selection.$from.parent.inlineContent ||
    !selection.$to.parent.inlineContent ||
    !selection.$from.sameParent(selection.$to)
  ) {
    return { ok: false, reason: 'non-text-selection' };
  }
  const linkRanges = linkRangesAcrossSelection(state);
  if (linkRanges.length > 1) return { ok: false, reason: 'multiple-links' };
  if (linkRanges.length === 1 && selectionContainsUnlinkedText(state)) {
    return { ok: false, reason: 'mixed-linked-selection' };
  }

  const linkRange = linkRanges[0];
  const target = linkRange ? { from: linkRange.from, to: linkRange.to } : { from: selection.from, to: selection.to };
  const formatting = formattingAcross(state, target.from, target.to);
  return {
    ok: true,
    snapshot: {
      sourceDocument: state.doc,
      bookmark: selection.getBookmark(),
      mode: linkRange ? 'edit' : 'insert',
      target,
      text: state.doc.textBetween(target.from, target.to, ''),
      href: linkRange?.href ?? '',
      commonMarks: formatting.commonMarks,
      hasMixedFormatting: formatting.mixed,
    },
  };
}

const snapshotIsCurrent = (state: EditorState, snapshot: CapturedLinkSelection): boolean =>
  state.doc === snapshot.sourceDocument && snapshot.target.from >= 0 && snapshot.target.to <= state.doc.content.size;

export function applyLinkEdit(
  state: EditorState,
  snapshot: CapturedLinkSelection,
  edit: { url: string; text: string },
): LinkTransactionResult {
  if (!snapshotIsCurrent(state, snapshot)) return { ok: false, reason: 'stale-selection' };
  const normalized = normalizeSafeLinkUrl(edit.url);
  if (!normalized.ok) return { ok: false, reason: 'unsafe-url' };
  if (!edit.text) return { ok: false, reason: 'empty-text' };
  const linkType = state.schema.marks.link;
  if (!linkType) return { ok: false, reason: 'no-link' };

  const { from, to } = snapshot.target;
  const transaction = state.tr;
  const link = linkType.create({ href: normalized.url });
  if (edit.text === snapshot.text && from !== to) {
    transaction.removeMark(from, to, linkType);
    transaction.addMark(from, to, link);
    transaction.setSelection(snapshot.bookmark.resolve(transaction.doc));
  } else {
    const replacement = state.schema.text(edit.text, [...snapshot.commonMarks, link]);
    transaction.replaceWith(from, to, replacement);
    transaction.setSelection(TextSelection.create(transaction.doc, from, from + replacement.nodeSize));
  }
  return { ok: true, transaction };
}

export function restoreCapturedLinkSelection(state: EditorState, snapshot: CapturedLinkSelection): Transaction {
  if (state.doc !== snapshot.sourceDocument) return state.tr;
  return state.tr.setSelection(snapshot.bookmark.resolve(state.doc));
}

export function removeCapturedLink(state: EditorState, snapshot: CapturedLinkSelection): LinkTransactionResult {
  if (!snapshotIsCurrent(state, snapshot)) return { ok: false, reason: 'stale-selection' };
  if (snapshot.mode !== 'edit') return { ok: false, reason: 'no-link' };
  const linkType = state.schema.marks.link;
  if (!linkType) return { ok: false, reason: 'no-link' };
  const transaction = state.tr.removeMark(snapshot.target.from, snapshot.target.to, linkType);
  transaction.setSelection(snapshot.bookmark.resolve(transaction.doc));
  return { ok: true, transaction };
}

const actionableUrl = (snapshot: CapturedLinkSelection): string | undefined => {
  if (snapshot.mode !== 'edit') return undefined;
  const normalized = normalizeSafeLinkUrl(snapshot.href);
  return normalized.ok ? normalized.url : undefined;
};

export function openCapturedLink(snapshot: CapturedLinkSelection, open: (url: string) => void): boolean {
  const url = actionableUrl(snapshot);
  if (!url) return false;
  open(url);
  return true;
}

export async function copyCapturedLink(
  snapshot: CapturedLinkSelection,
  writeText: (url: string) => Promise<void>,
): Promise<boolean> {
  const url = actionableUrl(snapshot);
  if (!url) return false;
  try {
    await writeText(url);
    return true;
  } catch {
    return false;
  }
}
