import React, { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ExternalChangeBanner } from './ExternalChangeBanner';
import './externalChanges.css';

export type ExternalChangeResolution = 'keep-mine' | 'reload';

export type ExternalChangePromptState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirming'; readonly resolution: ExternalChangeResolution }
  | { readonly kind: 'running'; readonly resolution: ExternalChangeResolution }
  | { readonly kind: 'failed'; readonly resolution: ExternalChangeResolution };

export type ExternalChangePromptEvent =
  | { readonly type: 'confirm'; readonly resolution: ExternalChangeResolution }
  | { readonly type: 'cancel' }
  | { readonly type: 'run' }
  | { readonly type: 'succeed' }
  | { readonly type: 'fail' };

export const initialExternalChangePromptState: ExternalChangePromptState = Object.freeze({
  kind: 'idle',
});

/** Pure transition function kept public so both host tests can protect the shared interaction contract. */
export const reduceExternalChangePromptState = (
  state: ExternalChangePromptState,
  event: ExternalChangePromptEvent,
): ExternalChangePromptState => {
  switch (event.type) {
    case 'confirm':
      return state.kind === 'idle' ? { kind: 'confirming', resolution: event.resolution } : state;
    case 'cancel':
      return state.kind === 'confirming' || state.kind === 'failed' ? initialExternalChangePromptState : state;
    case 'run':
      return state.kind === 'confirming' || state.kind === 'failed'
        ? { kind: 'running', resolution: state.resolution }
        : state;
    case 'succeed':
      return state.kind === 'running' ? initialExternalChangePromptState : state;
    case 'fail':
      return state.kind === 'running' ? { kind: 'failed', resolution: state.resolution } : state;
  }
};

/** Returns the wrapped Tab target, or -1 when a modal has no available Tab stop. */
export const externalChangePromptTabTarget = (
  currentIndex: number,
  focusableCount: number,
  backwards: boolean,
): number => {
  if (focusableCount <= 0) return -1;
  if (backwards) return currentIndex <= 0 ? focusableCount - 1 : currentIndex - 1;
  return currentIndex === -1 || currentIndex === focusableCount - 1 ? 0 : currentIndex + 1;
};

export interface ExternalChangePromptLabels {
  readonly message: string;
  readonly compare: string;
  readonly keepMine: string;
  readonly reload: string;
  readonly keepTitle: string;
  readonly reloadTitle: string;
  readonly keepConfirm: string;
  readonly reloadConfirm: string;
  readonly cancel: string;
  readonly keepRunning: string;
  readonly reloadRunning: string;
  readonly failure: string;
  readonly retry: string;
}

const defaultLabels: ExternalChangePromptLabels = {
  message: 'This document changed outside the editor.',
  compare: 'Compare',
  keepMine: 'Keep mine',
  reload: 'Reload',
  keepTitle: 'Keep your version?',
  reloadTitle: 'Reload from disk?',
  keepConfirm: 'Your version will replace the version on disk.',
  reloadConfirm: 'Your unsaved editor changes will be discarded.',
  cancel: 'Cancel',
  keepRunning: 'Keeping your version…',
  reloadRunning: 'Reloading from disk…',
  failure: 'The external change could not be resolved. Try again.',
  retry: 'Retry',
};

export interface ExternalChangePromptProps {
  readonly isDirty: boolean;
  readonly onCompare: () => void;
  readonly onKeepMine: () => Promise<void>;
  readonly onReload: () => Promise<void>;
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
  readonly labels?: Partial<ExternalChangePromptLabels>;
}

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Banner and confirmation flow for an external document change.
 * Resolution stays entirely caller-owned; this component only serializes the interaction.
 */
export const ExternalChangePrompt: React.FC<ExternalChangePromptProps> = ({
  isDirty,
  onCompare,
  onKeepMine,
  onReload,
  fallbackFocusRef,
  labels: labelOverrides,
}) => {
  const labels = { ...defaultLabels, ...labelOverrides };
  const [state, setState] = useState<ExternalChangePromptState>(initialExternalChangePromptState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef(state);
  const titleId = useId();
  const descriptionId = useId();

  stateRef.current = state;

  const restoreFocus = useCallback(
    (preferFallback = false): void => {
      const captured = returnFocusRef.current;
      const target = preferFallback || !captured?.isConnected ? fallbackFocusRef?.current : captured;
      target?.focus();
      returnFocusRef.current = null;
    },
    [fallbackFocusRef],
  );

  useEffect(
    () => () => {
      if (stateRef.current.kind !== 'idle') {
        restoreFocus(stateRef.current.kind === 'running');
      }
    },
    [restoreFocus],
  );

  useEffect(() => {
    if (state.kind === 'confirming' || state.kind === 'failed') {
      cancelRef.current?.focus();
    } else if (state.kind === 'running') {
      dialogRef.current?.focus();
    }
  }, [state.kind]);

  const openConfirmation = (resolution: ExternalChangeResolution): void => {
    if (stateRef.current.kind !== 'idle') return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : (fallbackFocusRef?.current ?? null);
    const confirming: ExternalChangePromptState = { kind: 'confirming', resolution };
    stateRef.current = confirming;
    setState(confirming);
  };

  const cancel = (): void => {
    if (stateRef.current.kind !== 'confirming' && stateRef.current.kind !== 'failed') return;
    stateRef.current = initialExternalChangePromptState;
    setState(initialExternalChangePromptState);
    queueMicrotask(() => restoreFocus());
  };

  const run = async (): Promise<void> => {
    const currentState = stateRef.current;
    if (currentState.kind !== 'confirming' && currentState.kind !== 'failed') return;
    const resolution = currentState.resolution;
    const running: ExternalChangePromptState = { kind: 'running', resolution };
    stateRef.current = running;
    setState(running);
    try {
      await (resolution === 'keep-mine' ? onKeepMine() : onReload());
      stateRef.current = initialExternalChangePromptState;
      setState(initialExternalChangePromptState);
      queueMicrotask(() => restoreFocus(true));
    } catch {
      const failed: ExternalChangePromptState = { kind: 'failed', resolution };
      stateRef.current = failed;
      setState(failed);
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      if (state.kind !== 'running') {
        event.preventDefault();
        cancel();
      }
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = externalChangePromptTabTarget(currentIndex, focusable.length, event.shiftKey);
    if (nextIndex === -1) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    focusable[nextIndex].focus();
  };

  const resolution = state.kind === 'idle' ? undefined : state.resolution;
  const isRunning = state.kind === 'running';
  const isFailed = state.kind === 'failed';
  const title = resolution === 'keep-mine' ? labels.keepTitle : labels.reloadTitle;
  const description = resolution === 'keep-mine' ? labels.keepConfirm : labels.reloadConfirm;
  const runningStatus = resolution === 'keep-mine' ? labels.keepRunning : labels.reloadRunning;

  return (
    <>
      <ExternalChangeBanner
        isDirty={isDirty}
        onCompare={onCompare}
        onKeepMine={() => openConfirmation('keep-mine')}
        onReload={() => openConfirmation('reload')}
        disabled={state.kind !== 'idle'}
        busy={isRunning}
        status={isRunning ? runningStatus : undefined}
        error={isFailed ? labels.failure : undefined}
        message={labels.message}
        compareLabel={labels.compare}
        keepMineLabel={labels.keepMine}
        reloadLabel={labels.reload}
      />
      {resolution && (
        <div
          className="external-change-prompt__scrim"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancel();
          }}
        >
          <div
            ref={dialogRef}
            className="external-change-prompt"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            aria-busy={isRunning || undefined}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
            {isRunning && (
              <p className="external-change-prompt__status" role="status">
                {runningStatus}
              </p>
            )}
            {isFailed && (
              <p className="external-change-prompt__error" role="alert">
                {labels.failure}
              </p>
            )}
            <div className="external-change-prompt__actions">
              <button
                ref={cancelRef}
                type="button"
                className="external-change-action"
                disabled={isRunning}
                autoFocus
                onClick={cancel}
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                className="external-change-action external-change-action--primary"
                disabled={isRunning}
                onClick={() => void run()}
              >
                {isFailed ? labels.retry : resolution === 'keep-mine' ? labels.keepMine : labels.reload}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
