import { describe, expect, it } from 'vitest';
import {
  FILE_OPERATION_IDLE_STATE,
  createFileOperationError,
  createFileOperationControllerState,
  fileOperationReducer,
  tryStartFileOperation,
} from '../shared/editor/fileOperations';

const exportRequest = {
  sessionId: 'session-a',
  requestId: 'request-1',
  kind: 'export' as const,
  format: 'html',
  stage: 'Preparing export…',
};

describe('file operation state', () => {
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
