import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  buildNumberingIndex,
  type NumberedEntry,
  type NumberedKind,
} from '../document/numbering';
import type { ResolvedEditorSettings, TiptapNode } from '../types';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionOptions,
} from './extensionRuntime';

export const STRUCTURE_INDEX_REBUILD_DELAY_MS = 75;
export const STRUCTURE_INDEX_REFERENCE_SYNC_META = 'structureIndexReferenceSync';
export const STRUCTURE_INDEX_SETTINGS_REFRESH_META = 'crossRefResync';

export interface DocumentStructureEntry {
  kind: NumberedKind;
  id?: string;
  pos: number;
  number: string;
  displayLabel: string;
  baseLabel: string;
  referenceLabel: string;
  title?: string;
  headingLevel?: number;
  numbered: boolean;
}

export interface DocumentReferenceEntry {
  targetId: string;
  from: number;
  to: number;
}

export interface DocumentStructureIndex {
  entries: readonly DocumentStructureEntry[];
  headings: readonly DocumentStructureEntry[];
  figures: readonly DocumentStructureEntry[];
  tables: readonly DocumentStructureEntry[];
  equations: readonly DocumentStructureEntry[];
  endnotes: readonly DocumentStructureEntry[];
  references: readonly DocumentReferenceEntry[];
  byId: ReadonlyMap<string, DocumentStructureEntry>;
}

export interface DocumentStructureIndexState extends DocumentStructureIndex {
  dirty: boolean;
  rebuildCount: number;
  semanticRevision: number;
  invalidationRevision: number;
  settingsKey: string;
  pendingSettings: ResolvedEditorSettings;
}

interface StructureIndexPluginOptions {
  getSettings(): ResolvedEditorSettings;
}

interface StructureIndexHost {
  readonly state: EditorState;
  dispatch(transaction: Transaction): void;
}

interface RebuildMeta {
  kind: 'rebuild';
  index: DocumentStructureIndex;
  settings: ResolvedEditorSettings;
}

interface InvalidateMeta {
  kind: 'invalidate';
}

type StructureIndexMeta = RebuildMeta | InvalidateMeta;

export const documentStructureIndexKey = new PluginKey<DocumentStructureIndexState>('documentStructureIndex');

export const documentStructureSettingsKey = (settings: ResolvedEditorSettings): string => [
  settings.headingNumbering,
  settings.headingStartNumber,
  settings.captionNumbering,
  settings.equationNumbering,
  settings.captionStyle,
  settings.crossRefIncludeCaption,
].join('|');

const toStructureEntry = (entry: NumberedEntry, pos: number): DocumentStructureEntry => ({
  kind: entry.kind,
  ...(entry.id ? { id: entry.id } : {}),
  pos,
  number: entry.number,
  displayLabel: entry.displayLabel,
  baseLabel: entry.baseLabel,
  referenceLabel: entry.referenceLabel,
  ...(entry.title !== undefined ? { title: entry.title } : {}),
  ...(entry.headingLevel !== undefined ? { headingLevel: entry.headingLevel } : {}),
  numbered: entry.numbered,
});

const isNumberedNode = (node: ProseMirrorNode): boolean =>
  node.type.name === 'heading'
  || node.type.name === 'image'
  || node.type.name === 'table'
  || node.type.name === 'mathBlock'
  || node.type.name === 'endnote';

/** The only full document serialization/numbering pass used by editor structure consumers. */
export function buildDocumentStructureIndex(
  doc: ProseMirrorNode,
  settings: ResolvedEditorSettings,
): DocumentStructureIndex {
  const numbering = buildNumberingIndex(doc.toJSON() as TiptapNode, settings);
  const entries: DocumentStructureEntry[] = [];
  const references: DocumentReferenceEntry[] = [];
  let numberedIndex = 0;

  doc.descendants((node, pos) => {
    if (isNumberedNode(node)) {
      const numbered = numbering.entries[numberedIndex++];
      if (numbered) entries.push(toStructureEntry(numbered, pos));
    }
    if (!node.isText) return;
    const link = node.marks.find((mark) =>
      mark.type.name === 'link'
      && typeof mark.attrs.href === 'string'
      && mark.attrs.href.startsWith('#'));
    if (link) {
      references.push({
        targetId: (link.attrs.href as string).slice(1),
        from: pos,
        to: pos + node.nodeSize,
      });
    }
  });

  const byId = new Map<string, DocumentStructureEntry>();
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
  }
  return {
    entries,
    headings: entries.filter((entry) => entry.kind === 'heading'),
    figures: entries.filter((entry) => entry.kind === 'figure'),
    tables: entries.filter((entry) => entry.kind === 'table'),
    equations: entries.filter((entry) => entry.kind === 'equation'),
    endnotes: entries.filter((entry) => entry.kind === 'endnote'),
    references,
    byId,
  };
}

const mapStructureIndex = (
  current: DocumentStructureIndex,
  transaction: Transaction,
): DocumentStructureIndex => {
  const entries = current.entries.map((entry) => ({
    ...entry,
    pos: transaction.mapping.map(entry.pos, 1),
  }));
  const references = current.references.map((reference) => ({
    ...reference,
    from: transaction.mapping.map(reference.from, 1),
    to: transaction.mapping.map(reference.to, -1),
  }));
  const byId = new Map<string, DocumentStructureEntry>();
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
  }
  return {
    entries,
    headings: entries.filter((entry) => entry.kind === 'heading'),
    figures: entries.filter((entry) => entry.kind === 'figure'),
    tables: entries.filter((entry) => entry.kind === 'table'),
    equations: entries.filter((entry) => entry.kind === 'equation'),
    endnotes: entries.filter((entry) => entry.kind === 'endnote'),
    references,
    byId,
  };
};

const hasInternalLink = (node: ProseMirrorNode): boolean =>
  node.isText && node.marks.some((mark) =>
    mark.type.name === 'link'
    && typeof mark.attrs.href === 'string'
    && mark.attrs.href.startsWith('#'));

const isPlainParagraphRange = (doc: ProseMirrorNode, from: number, to: number): boolean => {
  const safeFrom = Math.max(0, Math.min(from, doc.content.size));
  const safeTo = Math.max(safeFrom, Math.min(to, doc.content.size));
  if (doc.resolve(safeFrom).parent.type.name !== 'paragraph') return false;
  if (doc.resolve(safeTo).parent.type.name !== 'paragraph') return false;
  let plain = true;
  doc.nodesBetween(safeFrom, safeTo, (node) => {
    if (hasInternalLink(node)) plain = false;
    if (!node.isText && node.type.name !== 'paragraph') plain = false;
    return plain;
  });
  return plain;
};

/** True only for transactions proven not to affect structure, numbering, captions, or internal refs. */
export function isPlainParagraphTextTransaction(transaction: Transaction): boolean {
  if (!transaction.docChanged || transaction.steps.length === 0) return false;
  let changedRangeCount = 0;
  for (let stepIndex = 0; stepIndex < transaction.steps.length; stepIndex += 1) {
    const oldDoc = transaction.docs[stepIndex];
    const step = transaction.steps[stepIndex];
    const map = step.getMap();
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      changedRangeCount += 1;
      if (!isPlainParagraphRange(oldDoc, oldStart, oldEnd)
        || !isPlainParagraphRange(transaction.doc, newStart, newEnd)) {
        changedRangeCount = Number.NEGATIVE_INFINITY;
      }
    });
    if (changedRangeCount < 0) return false;
  }
  return changedRangeCount > 0;
}

const withStateFields = (
  index: DocumentStructureIndex,
  fields: Pick<DocumentStructureIndexState,
    'dirty' | 'rebuildCount' | 'semanticRevision' | 'invalidationRevision' | 'settingsKey' | 'pendingSettings'>,
): DocumentStructureIndexState => ({ ...index, ...fields });

export function createDocumentStructureIndexPlugin(options: StructureIndexPluginOptions): Plugin {
  return new Plugin<DocumentStructureIndexState>({
    key: documentStructureIndexKey,
    state: {
      init(_, state) {
        const settings = options.getSettings();
        return withStateFields(buildDocumentStructureIndex(state.doc, settings), {
          dirty: false,
          rebuildCount: 1,
          semanticRevision: 1,
          invalidationRevision: 0,
          settingsKey: documentStructureSettingsKey(settings),
          pendingSettings: settings,
        });
      },
      apply(transaction, previous) {
        const settings = options.getSettings();
        const nextSettingsKey = documentStructureSettingsKey(settings);
        const meta = transaction.getMeta(documentStructureIndexKey) as StructureIndexMeta | undefined;
        if (meta?.kind === 'rebuild') {
          return withStateFields(meta.index, {
            dirty: false,
            rebuildCount: previous.rebuildCount + 1,
            semanticRevision: previous.semanticRevision + 1,
            invalidationRevision: previous.invalidationRevision,
            settingsKey: documentStructureSettingsKey(meta.settings),
            pendingSettings: meta.settings,
          });
        }

        const mapped = transaction.docChanged
          ? mapStructureIndex(previous, transaction)
          : previous;
        const settingsChanged = nextSettingsKey !== previous.settingsKey;
        const semanticChange = transaction.docChanged
          && !transaction.getMeta(STRUCTURE_INDEX_REFERENCE_SYNC_META)
          && !isPlainParagraphTextTransaction(transaction);
        const invalidated = meta?.kind === 'invalidate'
          || Boolean(transaction.getMeta(STRUCTURE_INDEX_SETTINGS_REFRESH_META))
          || settingsChanged
          || semanticChange;
        if (!invalidated && !transaction.docChanged) return previous;

        return withStateFields(mapped, {
          dirty: previous.dirty || invalidated,
          rebuildCount: previous.rebuildCount,
          semanticRevision: previous.semanticRevision,
          invalidationRevision: invalidated
            ? previous.invalidationRevision + 1
            : previous.invalidationRevision,
          settingsKey: previous.settingsKey,
          pendingSettings: settings,
        });
      },
    },
    view(view) {
      let lastSemanticRevision = getDocumentStructureIndexState(view.state).semanticRevision;
      let lastInvalidationRevision = -1;
      const scheduler = createTrailingStructureIndexScheduler(() => {
        ensureStructureIndexFresh(view);
      });
      const pendingListeners = pendingStructureIndexListeners.get(view);
      const controller: StructureIndexController = {
        listeners: pendingListeners ?? new Set(),
        scheduler,
      };
      pendingStructureIndexListeners.delete(view);
      structureIndexControllers.set(view, controller);

      const update = (nextView: EditorView) => {
        const state = getDocumentStructureIndexState(nextView.state);
        if (state.dirty && state.invalidationRevision !== lastInvalidationRevision) {
          lastInvalidationRevision = state.invalidationRevision;
          scheduler.request();
        }
        if (state.semanticRevision !== lastSemanticRevision) {
          lastSemanticRevision = state.semanticRevision;
          for (const listener of controller.listeners) listener(state);
        }
      };
      update(view);
      return {
        update,
        destroy() {
          scheduler.cancel();
          controller.listeners.clear();
          pendingStructureIndexListeners.delete(view);
          structureIndexControllers.delete(view);
        },
      };
    },
  });
}

export function getDocumentStructureIndexState(state: EditorState): DocumentStructureIndexState {
  const index = documentStructureIndexKey.getState(state);
  if (!index) throw new Error('Document structure index plugin is not registered');
  return index;
}

export function resolveStructurePosition(state: EditorState, stableId: string): number | undefined {
  return getDocumentStructureIndexState(state).byId.get(stableId)?.pos;
}

export function ensureStructureIndexFresh(host: StructureIndexHost): DocumentStructureIndexState {
  const current = getDocumentStructureIndexState(host.state);
  if (!current.dirty && current.settingsKey === documentStructureSettingsKey(current.pendingSettings)) return current;
  const index = buildDocumentStructureIndex(host.state.doc, current.pendingSettings);
  host.dispatch(host.state.tr.setMeta(documentStructureIndexKey, {
    kind: 'rebuild',
    index,
    settings: current.pendingSettings,
  } satisfies RebuildMeta));
  return getDocumentStructureIndexState(host.state);
}

export function requestStructureIndexSettingsRefresh(host: StructureIndexHost): void {
  host.dispatch(host.state.tr.setMeta(documentStructureIndexKey, { kind: 'invalidate' } satisfies InvalidateMeta));
}

export interface TrailingStructureIndexScheduler {
  request(): void;
  flush(): void;
  cancel(): void;
}

export function createTrailingStructureIndexScheduler(
  rebuild: () => void,
): TrailingStructureIndexScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    if (timer === undefined) return;
    cancel();
    rebuild();
  };
  return {
    request() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        rebuild();
      }, STRUCTURE_INDEX_REBUILD_DELAY_MS);
    },
    flush,
    cancel,
  };
}

type StructureIndexListener = (index: DocumentStructureIndexState) => void;
interface StructureIndexController {
  listeners: Set<StructureIndexListener>;
  scheduler: TrailingStructureIndexScheduler;
}
const structureIndexControllers = new WeakMap<EditorView, StructureIndexController>();
const pendingStructureIndexListeners = new WeakMap<EditorView, Set<StructureIndexListener>>();

export function subscribeToDocumentStructureIndex(
  view: EditorView,
  listener: StructureIndexListener,
): () => void {
  const controller = structureIndexControllers.get(view);
  if (controller) {
    controller.listeners.add(listener);
    return () => controller.listeners.delete(listener);
  }

  // The editor can expose its EditorView before this plugin's view lifecycle
  // has registered the controller. Confirm that the state plugin exists, then
  // hold the listener until registration instead of crashing the initial
  // React effect.
  getDocumentStructureIndexState(view.state);
  const pending = pendingStructureIndexListeners.get(view) ?? new Set<StructureIndexListener>();
  pending.add(listener);
  pendingStructureIndexListeners.set(view, pending);
  return () => {
    pending.delete(listener);
    if (pending.size === 0) pendingStructureIndexListeners.delete(view);
  };
}

export const DocumentStructureIndexExtension = Extension.create<EditorExtensionOptions>({
  name: 'documentStructureIndex',
  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },
  addProseMirrorPlugins() {
    return [createDocumentStructureIndexPlugin({
      getSettings: () => this.options.runtime.getSettings(),
    })];
  },
});

export function findActivePosition(sortedPositions: readonly number[], cursorPosition: number): number {
  let low = 0;
  let high = sortedPositions.length - 1;
  let active = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const position = sortedPositions[middle];
    if (position <= cursorPosition) {
      active = position;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return active;
}

export interface OutlinePosition {
  level: number;
  pos: number;
  id?: string;
}

export interface OutlinePresentationIndex {
  hasChildren: readonly boolean[];
  visible: readonly boolean[];
}

/** Builds collapse and child metadata in one pass, including skipped heading levels. */
export function buildOutlinePresentationIndex(
  entries: readonly OutlinePosition[],
  collapsed: ReadonlySet<number | string>,
): OutlinePresentationIndex {
  const hasChildren = new Array<boolean>(entries.length).fill(false);
  const visible = new Array<boolean>(entries.length).fill(true);
  const ancestors: Array<{ index: number; level: number; descendantsHidden: boolean }> = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= entry.level) {
      ancestors.pop();
    }
    const parent = ancestors[ancestors.length - 1];
    if (parent) hasChildren[parent.index] = true;
    visible[index] = !parent?.descendantsHidden;
    ancestors.push({
      index,
      level: entry.level,
      descendantsHidden: Boolean(parent?.descendantsHidden) || collapsed.has(entry.id ?? entry.pos),
    });
  }
  return { hasChildren, visible };
}
