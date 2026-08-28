import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Mapping, ReplaceStep, type StepMap } from '@tiptap/pm/transform';
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
import { measureEditorPerformanceProbe } from './performanceInstrumentation';

export const STRUCTURE_INDEX_REBUILD_DELAY_MS = 75;
export const STRUCTURE_INDEX_MAX_PENDING_POSITION_MAPS = 32;
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
  pendingPositionMapCount: number;
  positionMaps: readonly StepMap[];
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
  return measureEditorPerformanceProbe('structure-index-build', doc.nodeSize, () => {
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
  });
}

const mapStructureIndex = (
  current: DocumentStructureIndex,
  mapping: Mapping,
): DocumentStructureIndex | undefined => measureEditorPerformanceProbe(
  'structure-index-map',
  current.entries.length + current.references.length,
  () => {
    const entries: DocumentStructureEntry[] = [];
    for (const entry of current.entries) {
      const mapped = mapping.mapResult(entry.pos, 1);
      if (mapped.deleted) return undefined;
      entries.push({ ...entry, pos: mapped.pos });
    }
    const references: DocumentReferenceEntry[] = [];
    for (const reference of current.references) {
      const from = mapping.mapResult(reference.from, 1);
      const to = mapping.mapResult(reference.to, -1);
      if (from.deleted || to.deleted || from.pos > to.pos) return undefined;
      references.push({ ...reference, from: from.pos, to: to.pos });
    }
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
  },
);

const mappingFrom = (maps: readonly StepMap[]): Mapping => new Mapping([...maps]);

interface DirectPlainParagraph {
  readonly node: ProseMirrorNode;
  readonly childIndex: number;
  readonly start: number;
}

const plainParagraphTransactionCache = new WeakMap<Transaction, boolean>();

const directPlainParagraphAt = (
  doc: ProseMirrorNode,
  position: number,
): DirectPlainParagraph | undefined => {
  if (position < 0 || position > doc.content.size) return undefined;
  const resolved = doc.resolve(position);
  if (resolved.depth !== 1 || resolved.parent.type.name !== 'paragraph') return undefined;
  if (!resolved.parent.content.content.every((child) => child.isText && child.marks.length === 0)) {
    return undefined;
  }
  return {
    node: resolved.parent,
    childIndex: resolved.index(0),
    start: resolved.before(1),
  };
};

/**
 * Accepts exactly one direct, unmarked paragraph text replacement. Split/join,
 * marks, inline rich nodes, IDs/attrs, semantic ancestors, and multi-step edits
 * fail closed. The WeakMap shares this proof across every editor plugin.
 */
const computeIsPlainParagraphTextTransaction = (transaction: Transaction): boolean => {
  if (!transaction.docChanged || transaction.steps.length !== 1) return false;
  const step = transaction.steps[0];
  if (!(step instanceof ReplaceStep)
    || (step as unknown as { structure?: boolean }).structure === true) return false;
  if (step.slice.openStart !== 0 || step.slice.openEnd !== 0) return false;
  let insertedTextOnly = true;
  step.slice.content.forEach((node) => {
    if (!node.isText || node.marks.length > 0) insertedTextOnly = false;
  });
  if (!insertedTextOnly) return false;

  const before = transaction.docs[0];
  const after = transaction.doc;
  if (!before.sameMarkup(after) || before.childCount !== after.childCount) return false;
  let changedRange: readonly [number, number, number, number] | undefined;
  step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
    if (changedRange) {
      changedRange = undefined;
      insertedTextOnly = false;
      return;
    }
    changedRange = [oldStart, oldEnd, newStart, newEnd];
  });
  if (!insertedTextOnly || !changedRange) return false;
  const [oldStart, oldEnd, newStart, newEnd] = changedRange;
  const oldFrom = directPlainParagraphAt(before, oldStart);
  const oldTo = directPlainParagraphAt(before, oldEnd);
  const newFrom = directPlainParagraphAt(after, newStart);
  const newTo = directPlainParagraphAt(after, newEnd);
  if (!oldFrom || !oldTo || !newFrom || !newTo) return false;
  if (oldFrom.start !== oldTo.start || newFrom.start !== newTo.start) return false;
  if (oldFrom.childIndex !== oldTo.childIndex
    || oldFrom.childIndex !== newFrom.childIndex
    || newFrom.childIndex !== newTo.childIndex) return false;
  if (!oldFrom.node.sameMarkup(newFrom.node)) return false;
  for (let index = 0; index < before.childCount; index += 1) {
    if (index !== oldFrom.childIndex && before.child(index) !== after.child(index)) return false;
  }
  return true;
};

export function isPlainParagraphTextTransaction(transaction: Transaction): boolean {
  const cached = plainParagraphTransactionCache.get(transaction);
  if (cached !== undefined) return cached;
  const result = measureEditorPerformanceProbe(
    'structure-index-classifier',
    transaction.steps.length,
    () => computeIsPlainParagraphTextTransaction(transaction),
  );
  plainParagraphTransactionCache.set(transaction, result);
  return result;
}

const withStateFields = (
  index: DocumentStructureIndex,
  fields: Pick<DocumentStructureIndexState,
    'dirty' | 'rebuildCount' | 'semanticRevision' | 'invalidationRevision' | 'settingsKey' | 'pendingSettings' | 'positionMaps'>,
): DocumentStructureIndexState => ({
  ...index,
  ...fields,
  pendingPositionMapCount: fields.positionMaps.length,
});

const rawDocumentStructureIndexState = (state: EditorState): DocumentStructureIndexState => {
  const index = documentStructureIndexKey.getState(state);
  if (!index) throw new Error('Document structure index plugin is not registered');
  return index;
};

const materializedStructureIndexCache = new WeakMap<
  DocumentStructureIndexState,
  DocumentStructureIndexState
>();

const materializeStructureIndexState = (
  current: DocumentStructureIndexState,
  doc: ProseMirrorNode,
): DocumentStructureIndexState => {
  if (current.positionMaps.length === 0) return current;
  const cached = materializedStructureIndexCache.get(current);
  if (cached) return cached;
  const mapped = mapStructureIndex(current, mappingFrom(current.positionMaps))
    ?? buildDocumentStructureIndex(doc, current.pendingSettings);
  const materialized = withStateFields(mapped, {
    dirty: current.dirty,
    rebuildCount: current.rebuildCount,
    semanticRevision: current.semanticRevision,
    invalidationRevision: current.invalidationRevision,
    settingsKey: current.settingsKey,
    pendingSettings: current.pendingSettings,
    positionMaps: [],
  });
  materializedStructureIndexCache.set(current, materialized);
  return materialized;
};

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
          positionMaps: [],
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
            positionMaps: [],
          });
        }

        const settingsChanged = nextSettingsKey !== previous.settingsKey;
        const ordinaryParagraphChange = transaction.docChanged
          && isPlainParagraphTextTransaction(transaction);
        const semanticChange = transaction.docChanged
          && !transaction.getMeta(STRUCTURE_INDEX_REFERENCE_SYNC_META)
          && !ordinaryParagraphChange;
        const invalidated = meta?.kind === 'invalidate'
          || Boolean(transaction.getMeta(STRUCTURE_INDEX_SETTINGS_REFRESH_META))
          || settingsChanged
          || semanticChange;
        if (!invalidated && !transaction.docChanged) return previous;

        if (ordinaryParagraphChange && !invalidated) {
          const positionMaps = [...previous.positionMaps, ...transaction.mapping.maps];
          const deletesContent = transaction.steps.some((step) =>
            step instanceof ReplaceStep && step.from < step.to);
          if (!deletesContent
            && positionMaps.length <= STRUCTURE_INDEX_MAX_PENDING_POSITION_MAPS) {
            return {
              ...previous,
              pendingSettings: settings,
              positionMaps,
              pendingPositionMapCount: positionMaps.length,
            };
          }
          const compacted = mapStructureIndex(previous, mappingFrom(positionMaps));
          if (compacted) {
            return withStateFields(compacted, {
              dirty: previous.dirty,
              rebuildCount: previous.rebuildCount,
              semanticRevision: previous.semanticRevision,
              invalidationRevision: previous.invalidationRevision,
              settingsKey: previous.settingsKey,
              pendingSettings: settings,
              positionMaps: [],
            });
          }
          return withStateFields(buildDocumentStructureIndex(transaction.doc, settings), {
            dirty: false,
            rebuildCount: previous.rebuildCount + 1,
            semanticRevision: previous.semanticRevision + 1,
            invalidationRevision: previous.invalidationRevision,
            settingsKey: nextSettingsKey,
            pendingSettings: settings,
            positionMaps: [],
          });
        }

        const currentProjection = materializeStructureIndexState(previous, transaction.docs[0] ?? transaction.doc);
        const mapped = transaction.docChanged
          ? mapStructureIndex(currentProjection, transaction.mapping)
            ?? buildDocumentStructureIndex(transaction.doc, settings)
          : currentProjection;

        return withStateFields(mapped, {
          dirty: previous.dirty || invalidated,
          rebuildCount: previous.rebuildCount,
          semanticRevision: previous.semanticRevision,
          invalidationRevision: invalidated
            ? previous.invalidationRevision + 1
            : previous.invalidationRevision,
          settingsKey: previous.settingsKey,
          pendingSettings: settings,
          positionMaps: [],
        });
      },
    },
    view(view) {
      let lastSemanticRevision = rawDocumentStructureIndexState(view.state).semanticRevision;
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
        const state = rawDocumentStructureIndexState(nextView.state);
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
  return materializeStructureIndexState(rawDocumentStructureIndexState(state), state.doc);
}

export function resolveStructurePosition(state: EditorState, stableId: string): number | undefined {
  const current = rawDocumentStructureIndexState(state);
  const entry = current.byId.get(stableId);
  if (!entry) return undefined;
  if (current.positionMaps.length === 0) return entry.pos;
  const mapped = mappingFrom(current.positionMaps).mapResult(entry.pos, 1);
  if (!mapped.deleted) return mapped.pos;
  return materializeStructureIndexState(current, state.doc).byId.get(stableId)?.pos;
}

export function ensureStructureIndexFresh(host: StructureIndexHost): DocumentStructureIndexState {
  const current = rawDocumentStructureIndexState(host.state);
  if (!current.dirty && current.settingsKey === documentStructureSettingsKey(current.pendingSettings)) {
    return materializeStructureIndexState(current, host.state.doc);
  }
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
