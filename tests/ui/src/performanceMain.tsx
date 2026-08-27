import React, { useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent } from '@tiptap/react';
import type { PerformanceMeasurement, PerformanceReport } from '@shared/performance/instrumentation';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '@shared/editor/extensionRuntime';
import { useTiptapEditor } from '@shared/editor/hooks/useTiptapEditor';
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
  'text-5k' | 'text-10k' | 'structure-10k'
>;

interface BrowserPerformanceHarness {
  armKeyToNextPaint(): void;
  readKeyToNextPaint(): Promise<void>;
  readDebouncedUpdate(): Promise<void>;
  measureSyncCheckpoint(): void;
  measureScrollToBottom(): Promise<void>;
  measureNavigationToStart(): Promise<void>;
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

function PerformanceEditor() {
  const corpus = useMemo(() => createAcceptedPerformanceCorpus(readCorpus()), []);
  const measurements = useRef<PerformanceMeasurement[]>([]);
  const keyProbe = useRef<Promise<void> | null>(null);
  const debounceProbe = useRef<Promise<void> | null>(null);
  const resolveDebounceProbe = useRef<(() => void) | null>(null);
  const keyStartedAt = useRef<number | null>(null);
  const keyProbeCapturedBeforeBubble = useRef(false);
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

    void afterNextPaint().then(() => {
      measurements.current.push(durationMeasurement(
        'open-to-editable-next-paint',
        harnessStartedAt,
        corpus.topLevelBlocks,
      ));
      document.documentElement.dataset.performanceReady = 'true';
    });

    window.__sdocBrowserPerformance = {
      armKeyToNextPaint(): void {
        if (keyProbe.current) throw new Error('a key probe is already pending');
        debounceProbe.current = new Promise<void>((resolve) => { resolveDebounceProbe.current = resolve; });
        keyProbe.current = new Promise<void>((resolve) => {
          editor.view.dom.addEventListener('keydown', (event) => {
            const startedAt = performance.now();
            keyStartedAt.current = startedAt;
            document.documentElement.dataset.keyProbeCapture = 'before-bubble';
            void afterNextPaint().then(() => {
              measurements.current.push(durationMeasurement(
                'key-to-next-paint',
                startedAt,
                1,
              ));
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
      async measureScrollToBottom(): Promise<void> {
        const startedAt = performance.now();
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        await afterNextPaint();
        measurements.current.push(durationMeasurement(
          'scroll-to-bottom-next-paint',
          startedAt,
          corpus.topLevelBlocks,
        ));
      },
      async measureNavigationToStart(): Promise<void> {
        const startedAt = performance.now();
        editor.chain().focus().setTextSelection(1).scrollIntoView().run();
        await afterNextPaint();
        measurements.current.push(durationMeasurement(
          'navigate-to-start-next-paint',
          startedAt,
          1,
        ));
      },
      report(jsHeapUsedBytes?: number): PerformanceReport {
        const domNodeCount = editor.view.dom.querySelectorAll('*').length + 1;
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
            longTaskCount: longTasks.length,
            keyProbeCapturedBeforeBubble: keyProbeCapturedBeforeBubble.current,
            syncSubmitCallbacks: syncSubmitCallbacks.current,
            ...(jsHeapUsedBytes === undefined ? {} : { jsHeapUsedBytes }),
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
