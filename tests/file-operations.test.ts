import { describe, expect, it } from 'vitest';
import {
  FILE_OPERATION_IDLE_STATE,
  createFileOperationError,
  createFileOperationControllerState,
  fileOperationReducer,
  isFileOperationActive,
  tryStartFileOperation,
} from '../shared/editor/fileOperations';

const exportRequest = {
  sessionId: 'session-a',
  requestId: 'request-1',
  kind: 'export' as const,
  format: 'html',
  stage: 'Preparing export…',
};

const exportIntent = {
  kind: 'export' as const,
  format: 'html' as const,
};

const exportPlan = {
  planId: 'plan-1',
  intent: exportIntent,
  source: {
    displayName: 'chapter.sdoc',
    sizeBytes: 128,
    revision: 4,
  },
  destination: {
    displayName: 'chapter.html',
    exists: false,
  },
  warnings: [],
  requiresConfirmation: true,
};

describe('file operation state', () => {
  it('moves a prepared operation through immutable preflight and execution', () => {
    const initial = createFileOperationControllerState('session-a');
    const preflighting = fileOperationReducer(initial, {
      type: 'prepare',
      sessionId: 'session-a',
      requestId: 'request-1',
      intent: exportIntent,
      stage: 'Checking export…',
    });
    expect(preflighting.operationState).toEqual({
      phase: 'preflighting',
      requestId: 'request-1',
      intent: exportIntent,
      stage: 'Checking export…',
    });
    expect(isFileOperationActive(preflighting.operationState)).toBe(true);

    const awaitingConfirmation = fileOperationReducer(preflighting, {
      type: 'preflight',
      sessionId: 'session-a',
      requestId: 'request-1',
      plan: exportPlan,
    });
    expect(awaitingConfirmation.operationState).toEqual({
      phase: 'awaiting-confirmation',
      requestId: 'request-1',
      intent: exportIntent,
      plan: exportPlan,
    });

    const running = fileOperationReducer(awaitingConfirmation, {
      type: 'execute',
      sessionId: 'session-a',
      requestId: 'request-1',
      planId: 'plan-1',
      stage: 'Rendering…',
    });
    expect(running.operationState).toEqual({
      phase: 'running',
      requestId: 'request-1',
      kind: 'export',
      format: 'html',
      intent: exportIntent,
      planId: 'plan-1',
      stage: 'Rendering…',
    });

    const details = {
      outcome: 'completed' as const,
      artifact: {
        artifactId: 'artifact-1',
        displayName: 'chapter.html',
        sizeBytes: 256,
      },
      warnings: [],
      availableActions: [
        { action: 'open', artifactId: 'artifact-1' },
        { action: 'reveal', artifactId: 'artifact-1' },
        { action: 'copy', artifactId: 'artifact-1' },
        { action: 'repeat' },
      ] as const,
    };
    const succeeded = fileOperationReducer(running, {
      type: 'succeeded',
      sessionId: 'session-a',
      requestId: 'request-1',
      result: 'completed',
      details,
    });
    expect(succeeded.operationState).toEqual({
      phase: 'succeeded',
      requestId: 'request-1',
      result: 'completed',
      intent: exportIntent,
      details,
    });
    expect(isFileOperationActive(succeeded.operationState)).toBe(false);
  });

  it('ignores stale plans and preserves the original intent when retrying', () => {
    const preflighting = fileOperationReducer(createFileOperationControllerState('session-a'), {
      type: 'prepare',
      sessionId: 'session-a',
      requestId: 'request-1',
      intent: exportIntent,
      stage: 'Checking export…',
    });
    expect(fileOperationReducer(preflighting, {
      type: 'preflight',
      sessionId: 'session-a',
      requestId: 'stale-request',
      plan: { ...exportPlan, planId: 'stale-plan' },
    })).toBe(preflighting);

    const awaitingConfirmation = fileOperationReducer(preflighting, {
      type: 'preflight',
      sessionId: 'session-a',
      requestId: 'request-1',
      plan: exportPlan,
    });
    expect(fileOperationReducer(awaitingConfirmation, {
      type: 'execute',
      sessionId: 'session-a',
      requestId: 'request-1',
      planId: 'stale-plan',
      stage: 'Rendering…',
    })).toBe(awaitingConfirmation);

    const failed = fileOperationReducer(awaitingConfirmation, {
      type: 'failed',
      sessionId: 'session-a',
      requestId: 'request-1',
      error: createFileOperationError('STALE_SOURCE', 'The document changed.', true),
    });
    const retried = fileOperationReducer(failed, {
      type: 'retry',
      sessionId: 'session-a',
      previousRequestId: 'request-1',
      requestId: 'request-2',
      stage: 'Checking export again…',
    });
    expect(retried.operationState).toEqual({
      phase: 'preflighting',
      requestId: 'request-2',
      intent: exportIntent,
      stage: 'Checking export again…',
    });
  });

  it('cancels any active phase but ignores stale cancellation', () => {
    const preflighting = fileOperationReducer(createFileOperationControllerState('session-a'), {
      type: 'prepare',
      sessionId: 'session-a',
      requestId: 'request-1',
      intent: exportIntent,
      stage: 'Checking export…',
    });
    expect(fileOperationReducer(preflighting, {
      type: 'cancel',
      sessionId: 'session-a',
      requestId: 'stale-request',
    })).toBe(preflighting);
    expect(fileOperationReducer(preflighting, {
      type: 'cancel',
      sessionId: 'session-a',
      requestId: 'request-1',
    }).operationState).toEqual({
      phase: 'cancelled',
      requestId: 'request-1',
      intent: exportIntent,
    });
  });

  it('represents every terminal status phase and fallback success', () => {
    const initial = createFileOperationControllerState('session-a');
    const running = fileOperationReducer(initial, {
      type: 'start',
      ...exportRequest,
    });
    expect(running.operationState).toEqual({
      phase: 'running',
      requestId: 'request-1',
      kind: 'export',
      format: 'html',
      stage: 'Preparing export…',
    });

    expect(fileOperationReducer(running, {
      type: 'succeeded',
      sessionId: 'session-a',
      requestId: 'request-1',
      result: 'completed',
    }).operationState).toEqual({
      phase: 'succeeded',
      requestId: 'request-1',
      result: 'completed',
    });

    expect(fileOperationReducer(running, {
      type: 'succeeded',
      sessionId: 'session-a',
      requestId: 'request-1',
      result: 'fallback',
    }).operationState).toEqual({
      phase: 'succeeded',
      requestId: 'request-1',
      result: 'fallback',
    });

    expect(fileOperationReducer(running, {
      type: 'failed',
      sessionId: 'session-a',
      requestId: 'request-1',
      error: createFileOperationError('WRITE_FAILED', 'Could not write the file.', true),
    }).operationState).toMatchObject({
      phase: 'failed',
      error: {
        code: 'WRITE_FAILED',
        message: 'Could not write the file.',
        retryable: true,
      },
    });

    expect(fileOperationReducer(running, {
      type: 'cancelled',
      sessionId: 'session-a',
      requestId: 'request-1',
    }).operationState).toEqual({ phase: 'cancelled', requestId: 'request-1' });
  });

  it('ignores stale request and session results', () => {
    const running = fileOperationReducer(createFileOperationControllerState('session-a'), {
      type: 'start',
      ...exportRequest,
    });

    expect(fileOperationReducer(running, {
      type: 'succeeded',
      sessionId: 'session-a',
      requestId: 'older-request',
      result: 'completed',
    })).toBe(running);
    expect(fileOperationReducer(running, {
      type: 'failed',
      sessionId: 'session-b',
      requestId: 'request-1',
      error: createFileOperationError('UNKNOWN', 'Unexpected failure.'),
    })).toBe(running);
    expect(fileOperationReducer(
      fileOperationReducer(running, {
        type: 'session-changed',
        sessionId: 'session-b',
      }),
      {
        type: 'succeeded',
        sessionId: 'session-a',
        requestId: 'request-1',
        result: 'completed',
      },
    ).operationState).toEqual(FILE_OPERATION_IDLE_STATE);
  });

  it('keeps a completed result actionable when a correlated result action fails', () => {
    const running = fileOperationReducer(createFileOperationControllerState('session-a'), {
      type: 'start',
      ...exportRequest,
    });
    const succeeded = fileOperationReducer(running, {
      type: 'succeeded',
      sessionId: 'session-a',
      requestId: 'request-1',
      result: 'completed',
      details: {
        outcome: 'completed',
        warnings: [],
        availableActions: [{ action: 'repeat' }],
      },
    });

    const recovered = fileOperationReducer(succeeded, {
      type: 'result-action-failed',
      sessionId: 'session-a',
      requestId: 'request-1',
      error: createFileOperationError(
        'STALE_SOURCE',
        'The document changed after the import completed.',
        false,
      ),
    });

    expect(recovered.operationState).toMatchObject({
      phase: 'succeeded',
      requestId: 'request-1',
      details: {
        warnings: ['The document changed after the import completed.'],
        availableActions: [{ action: 'repeat' }],
      },
    });
    expect(fileOperationReducer(succeeded, {
      type: 'result-action-failed',
      sessionId: 'session-a',
      requestId: 'stale-result',
      error: createFileOperationError('UNKNOWN', 'stale'),
    })).toBe(succeeded);
  });

  it('allows only one operation at a time', () => {
    const first = tryStartFileOperation(
      createFileOperationControllerState('session-a'),
      exportRequest,
    );
    expect(first.accepted).toBe(true);

    const second = tryStartFileOperation(first.state, {
      sessionId: 'session-a',
      requestId: 'request-2',
      kind: 'import',
      format: 'markdown',
      stage: 'Reading file…',
    });
    expect(second).toEqual({ accepted: false, state: first.state });
  });

  it('bounds and sanitizes display-safe errors', () => {
    const error = createFileOperationError(
      'TRANSPORT_ERROR',
      `Connection failed at C:\\Users\\person\\secret.sdoc.\u0000 ${'x'.repeat(600)}`,
    );

    expect(error.message).not.toContain('\u0000');
    expect(error.message).not.toContain('person');
    expect(error.message).toContain('[path]');
    expect(error.message.length).toBeLessThanOrEqual(500);
    expect(error.retryable).toBe(false);
  });
});
