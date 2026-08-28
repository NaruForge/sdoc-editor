import React, { useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent } from '@tiptap/react';
import type { PerformanceMeasurement, PerformanceReport } from '@shared/performance/instrumentation';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '@shared/editor/extensionRuntime';
import { useTiptapEditor } from '@shared/editor/hooks/useTiptapEditor';
import { installTestOnlyEditorPerformanceProbe } from '@shared/editor/performanceInstrumentation';
import { DocumentSyncCoordinator } from '@shared/persistence/DocumentSyncCoordinator';
import {
  createAcceptedPerformanceCorpus,
  type AcceptedPerformanceCorpusName,
} from '../../performance/fixtures';
import '@shared/editor/styles/fonts.css';
import '@shared/editor/styles/editor.css';
import './harness.css';

const harnessStartedAt = performance.now();
const longTasks: PerformanceEntry[] = [];
if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
  observer.observe({ type: 'longtask', buffered: true });
}

type BrowserCorpusName = Extract<
  AcceptedPerformanceCorpusName,
  | 'text-5k'
  | 'text-10k'
  | 'structure-10k'
  | 'rich-mixed-5k'
  | 'rich-balanced-5k'
>;

interface BrowserPerformanceHarness {
  armKeyToNextPaint(): void;
  readKeyToNextPaint(): Promise<void>;
  readDebouncedUpdate(): Promise<void>;
  focusInputTarget(): string;
  measureSyncCheckpoint(): void;
  measureScroll(edge: 'start' | 'end'): Promise<void>;
  measureNavigation(edge: 'start' | 'end'): Promise<void>;
  documentTextLength(): number;
  selectionParentType(): string;
  setEditable(editable: boolean): void;
  undo(): boolean;
  redo(): boolean;
  report(jsHeapUsedBytes?: number): PerformanceReport;
}

declare global {
  interface Window {
    __sdocBrowserPerformance?: BrowserPerformanceHarness;
  }
}

const supportedCorpora: readonly BrowserCorpusName[] = [
  'text-5k',
  'text-10k',
  'structure-10k',
  'rich-mixed-5k',
  'rich-balanced-5k',
];

const readCorpus = (): BrowserCorpusName => {
  const value = new URLSearchParams(window.location.search).get('corpus');
  return supportedCorpora.includes(value as BrowserCorpusName)
    ? value as BrowserCorpusName
    : 'text-5k';
};

const afterNextPaint = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

const durationMeasurement = (
  name: string,
  startedAt: number,
  operationCount: number,
): PerformanceMeasurement => ({
  name,
  durationMs: performance.now() - startedAt,
  operationCount,
  outcome: 'ok',
});

const durationBetweenMeasurement = (
  name: string,
  startedAt: number,
  finishedAt: number,
  operationCount: number,
): PerformanceMeasurement => ({
  name,
  durationMs: finishedAt - startedAt,
  operationCount,
  outcome: 'ok',
});

function PerformanceEditor() {
  const corpus = useMemo(() => createAcceptedPerformanceCorpus(readCorpus()), []);
  const measurements = useRef<PerformanceMeasurement[]>([]);
  const keyProbe = useRef<Promise<void> | null>(null);
  const debounceProbe = useRef<Promise<void> | null>(null);
  const resolveDebounceProbe = useRef<(() => void) | null>(null);
  const keyStartedAt = useRef<number | null>(null);
  const keyProbeCapturedBeforeBubble = useRef(false);
  const keyDispatchArmed = useRef(false);
  const syncSubmitCallbacks = useRef(0);
  const ready = useRef(false);
  const sync = useMemo(() => {
    const coordinator = new DocumentSyncCoordinator({
      identity: { sessionId: 'performance-session', documentId: 'performance-document', revision: 0 },
      createEditId: () => 'performance-edit',
      send: () => { syncSubmitCallbacks.current += 1; },
    });
    coordinator.adoptReplacement(0, {
      content: { type: 'doc', content: [] },
      meta: corpus.envelope.meta,
      documentSettings: null,
    });
    return coordinator;
  }, [corpus]);
  const { editor, replaceEditorDocument } = useTiptapEditor({
    onUpdate: () => {
      if (keyStartedAt.current === null) return;
      measurements.current.push(durationMeasurement('debounced-update-wait', keyStartedAt.current, 1));
      keyStartedAt.current = null;
      resolveDebounceProbe.current?.();
      resolveDebounceProbe.current = null;
    },
    runtime: NOOP_EDITOR_EXTENSION_RUNTIME,
    handleSaveShortcut: false,
    translationLocale: 'en',
  });

  useEffect(() => {
    if (!editor || ready.current) return;
    ready.current = true;
    if (!replaceEditorDocument('initial-load', corpus.envelope.doc)) {
      throw new Error('browser performance fixture could not cross the initial replacement boundary');
    }
    editor.setEditable(true, false);
    let inputTargetPosition = 1;
    let inputTargetNodeType = 'unknown';
    const midpoint = editor.state.doc.content.size / 2;
    editor.state.doc.forEach((node, offset) => {
      if (inputTargetPosition !== 1 || offset < midpoint || node.type.name !== 'paragraph') return;
      if (!node.content.content.every((child) => child.isText)) return;
      inputTargetPosition = offset + 1;
      inputTargetNodeType = node.type.name;
    });
    const originalDispatch = editor.view.dispatch;
    const originalUpdateState = editor.view.updateState;
    let collectPluginSamples = false;
    let updateStateStartedAt: number | null = null;
    let updateStateFinishedAt: number | null = null;
    const uninstallEditorProbe = installTestOnlyEditorPerformanceProbe((sample) => {
      if (!collectPluginSamples) return;
      measurements.current.push({
        name: `plugin-${sample.name}`,
        durationMs: sample.durationMs,
        operationCount: sample.operationCount,
        outcome: 'ok',
      });
    });
    editor.view.updateState = (state) => {
      updateStateStartedAt = performance.now();
      originalUpdateState.call(editor.view, state);
      updateStateFinishedAt = performance.now();
      if (collectPluginSamples) {
        measurements.current.push(durationBetweenMeasurement(
          'editor-view-update-state-cpu',
          updateStateStartedAt,
          updateStateFinishedAt,
          1,
        ));
      }
    };
    editor.view.dispatch = (transaction) => {
      if (!keyDispatchArmed.current || !transaction.docChanged) {
        originalDispatch.call(editor.view, transaction);
        return;
      }
      keyDispatchArmed.current = false;
      const startedAt = performance.now();
      updateStateStartedAt = null;
      updateStateFinishedAt = null;
      collectPluginSamples = true;
      try {
        originalDispatch.call(editor.view, transaction);
      } finally {
        collectPluginSamples = false;
      }
      const finishedAt = performance.now();
      if (updateStateStartedAt !== null) {
        measurements.current.push(durationBetweenMeasurement(
          'editor-state-apply-plugins-cpu',
          startedAt,
          updateStateStartedAt,
          1,
        ));
      }
      if (updateStateFinishedAt !== null) {
        measurements.current.push(durationBetweenMeasurement(
          'editor-post-update-cpu',
          updateStateFinishedAt,
          finishedAt,
          1,
        ));
      }
      measurements.current.push(durationBetweenMeasurement(
        'editor-dispatch-cpu',
        startedAt,
        finishedAt,
        1,
      ));
    };

    const recordLongTasks = (
      phase: 'open' | 'input' | 'scroll' | 'navigation',
      startedAt: number,
      finishedAt: number,
    ): void => {
      const entries = longTasks.filter((entry) =>
        entry.startTime < finishedAt && entry.startTime + entry.duration > startedAt);
      measurements.current.push({
        name: `${phase}-long-task-total`,
        durationMs: entries.reduce((total, entry) => total + entry.duration, 0),
        operationCount: entries.length,
        outcome: 'ok',
      });
    };

    const waitForEditorDomToSettle = async (): Promise<void> => {
      let previousCount = -1;
      let stableFrames = 0;
      for (let frame = 0; frame < 600; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const count = editor.view.dom.querySelectorAll('*').length;
        stableFrames = count === previousCount ? stableFrames + 1 : 0;
        previousCount = count;
        if (stableFrames >= 3) return;
      }
      throw new Error('browser performance editor DOM did not settle');
    };

    void waitForEditorDomToSettle().then(() => afterNextPaint()).then(() => {
      const finishedAt = performance.now();
      measurements.current.push(durationBetweenMeasurement(
        'open-to-editable-next-paint',
        harnessStartedAt,
        finishedAt,
        corpus.topLevelBlocks,
      ));
      recordLongTasks('open', harnessStartedAt, finishedAt);
      document.documentElement.dataset.performanceReady = 'true';
    });

    window.__sdocBrowserPerformance = {
      armKeyToNextPaint(): void {
        if (keyProbe.current) throw new Error('a key probe is already pending');
        debounceProbe.current = new Promise<void>((resolve) => { resolveDebounceProbe.current = resolve; });
        keyProbe.current = new Promise<void>((resolve) => {
          keyDispatchArmed.current = true;
          editor.view.dom.addEventListener('keydown', (event) => {
            const startedAt = performance.now();
            keyStartedAt.current = startedAt;
            document.documentElement.dataset.keyProbeCapture = 'before-bubble';
            void afterNextPaint().then(() => {
              const finishedAt = performance.now();
              measurements.current.push(durationBetweenMeasurement(
                'key-to-next-paint',
                startedAt,
                finishedAt,
                1,
              ));
              recordLongTasks('input', startedAt, finishedAt);
              resolve();
            });
          }, { capture: true, once: true });
        });
      },
      async readKeyToNextPaint(): Promise<void> {
        if (!keyProbe.current) throw new Error('the key probe was not armed');
        await keyProbe.current;
        keyProbe.current = null;
      },
      async readDebouncedUpdate(): Promise<void> {
        if (!debounceProbe.current) throw new Error('the debounce probe was not armed');
        await debounceProbe.current;
        debounceProbe.current = null;
      },
      focusInputTarget(): string {
        editor.chain().setTextSelection(inputTargetPosition).focus().run();
        return editor.state.selection.$from.parent.type.name;
      },
      measureSyncCheckpoint(): void {
        const callbacksBefore = syncSubmitCallbacks.current;
        const startedAt = performance.now();
        const content = editor.getJSON();
        sync.submitContent(content, corpus.envelope.meta, null);
        measurements.current.push(durationMeasurement('sync-checkpoint-cpu', startedAt, 1));
        if (syncSubmitCallbacks.current !== callbacksBefore + 1) {
          throw new Error('sync checkpoint must invoke exactly one submit callback');
        }
      },
      async measureScroll(edge): Promise<void> {
        const startedAt = performance.now();
        window.scrollTo({
          top: edge === 'start' ? 0 : document.documentElement.scrollHeight,
          behavior: 'instant',
        });
        await afterNextPaint();
        const finishedAt = performance.now();
        measurements.current.push(durationBetweenMeasurement(
          'scroll-next-paint',
          startedAt,
          finishedAt,
          corpus.topLevelBlocks,
        ));
        recordLongTasks('scroll', startedAt, finishedAt);
      },
      async measureNavigation(edge): Promise<void> {
        const startedAt = performance.now();
        const position = edge === 'start' ? 1 : Math.max(1, editor.state.doc.content.size - 1);
        editor.chain().focus().setTextSelection(position).scrollIntoView().run();
        await afterNextPaint();
        const finishedAt = performance.now();
        measurements.current.push(durationBetweenMeasurement(
          'navigate-next-paint',
          startedAt,
          finishedAt,
          1,
        ));
        recordLongTasks('navigation', startedAt, finishedAt);
      },
      documentTextLength(): number {
        return editor.state.doc.textContent.length;
      },
      selectionParentType(): string {
        return editor.state.selection.$from.parent.type.name;
      },
      setEditable(editable): void {
        editor.setEditable(editable, false);
      },
      undo(): boolean {
        return editor.commands.undo();
      },
      redo(): boolean {
        return editor.commands.redo();
      },
      report(jsHeapUsedBytes?: number): PerformanceReport {
        const domNodeCount = editor.view.dom.querySelectorAll('*').length + 1;
        const images = [...editor.view.dom.querySelectorAll<HTMLImageElement>(
          '.image-node-wrapper img',
        )];
        const loadedImages = images.filter((image) => image.complete && image.naturalWidth > 0);
        const firstLoadedImage = loadedImages[0];
        const longTaskDurationMs = longTasks.reduce((total, entry) => total + entry.duration, 0);
        const browserVersion = navigator.userAgent.match(/(?:Chrome|Chromium)\/([^ ]+)/)?.[1]
          ?? 'unknown';
        return {
          schemaVersion: 1,
          clock: 'monotonic',
          unit: 'milliseconds',
          context: {
            surface: 'chromium-editor',
            browserEngine: 'chromium',
            browserVersion,
            corpus: corpus.name,
            fixtureSeed: corpus.seed,
            documentBytes: corpus.byteLength,
            documentNodes: corpus.nodeCount,
            topLevelBlocks: corpus.topLevelBlocks,
            domNodeCount,
            domParagraphCount: editor.view.dom.querySelectorAll('p').length,
            domCodeBlockCount: editor.view.dom.querySelectorAll('.code-block').length,
            domCodeLanguageOptionCount: editor.view.dom.querySelectorAll('.code-block select option').length,
            domMathCount: editor.view.dom.querySelectorAll('.math-inline, .math-block').length,
            domDeferredMathBlockCount: editor.view.dom.querySelectorAll('.math-block-render-placeholder').length,
            domImageCount: editor.view.dom.querySelectorAll('.image-node-wrapper').length,
            domLoadedImageCount: loadedImages.length,
            firstLoadedImageNaturalWidth: firstLoadedImage?.naturalWidth ?? 0,
            firstLoadedImageNaturalHeight: firstLoadedImage?.naturalHeight ?? 0,
            domTableCount: editor.view.dom.querySelectorAll('.table-node-wrapper').length,
            domDiagramCount: editor.view.dom.querySelectorAll('.diagram-block').length,
            longTaskCount: longTasks.length,
            keyProbeCapturedBeforeBubble: keyProbeCapturedBeforeBubble.current,
            syncSubmitCallbacks: syncSubmitCallbacks.current,
            inputTargetNodeType,
            ...(jsHeapUsedBytes === undefined
              ? {}
              : { jsHeapUsedBytes, retainedJsHeapBytes: jsHeapUsedBytes }),
          },
          measurements: [
            ...measurements.current.map((measurement) => ({ ...measurement })),
            {
              name: 'observed-long-task-total',
              durationMs: longTaskDurationMs,
              operationCount: longTasks.length,
              outcome: 'ok',
            },
          ],
        };
      },
    };

    return () => {
      editor.view.dispatch = originalDispatch;
      editor.view.updateState = originalUpdateState;
      uninstallEditorProbe();
      delete window.__sdocBrowserPerformance;
    };
  }, [corpus, editor, replaceEditorDocument]);

  return (
    <main
      className="browser-performance-harness"
      data-corpus={corpus.name}
      onKeyDown={() => {
        keyProbeCapturedBeforeBubble.current = document.documentElement.dataset.keyProbeCapture
          === 'before-bubble';
        delete document.documentElement.dataset.keyProbeCapture;
      }}
    >
      <EditorContent editor={editor} />
    </main>
  );
}

document.documentElement.lang = 'en';
document.documentElement.dataset.host = 'vscode';
document.documentElement.dataset.fixtureTheme = 'light';
document.documentElement.dataset.theme = 'light';

createRoot(document.getElementById('root')!).render(<PerformanceEditor />);
