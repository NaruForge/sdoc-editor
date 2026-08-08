import { describe, expect, it, vi } from 'vitest';
import {
  FileOperationPlanRegistry,
  FileOperationPlanError,
} from '../src/services/FileOperationPlanRegistry';

const intent = { kind: 'export', format: 'html' } as const;

describe('host file operation plan registry', () => {
  it('scopes immutable plans and artifacts to one editor session', () => {
    let sequence = 0;
    const registry = new FileOperationPlanRegistry<{ bytes: Uint8Array }, { uri: string }>(
      () => `opaque-${++sequence}`,
    );
    const registered = registry.registerPlan({
      sessionId: 'session-a', requestId: 'request-a', intent,
      sourceFingerprint: 'source:1', targetFingerprint: 'missing',
      payload: { bytes: new Uint8Array([1, 2]) },
    });

    expect(registry.getPlan('session-a', 'request-a', registered.planId).payload.bytes)
      .toEqual(new Uint8Array([1, 2]));
    expect(() => registry.getPlan('session-b', 'request-a', registered.planId))
      .toThrowError(FileOperationPlanError);

    const artifact = registry.registerArtifact('session-a', { uri: 'file:///result.html' });
    expect(registry.getArtifact('session-a', artifact.artifactId).uri).toContain('result.html');
    expect(() => registry.getArtifact('session-b', artifact.artifactId))
      .toThrowError(FileOperationPlanError);
    expect(registry.takeArtifact('session-a', artifact.artifactId).uri).toContain('result.html');
    expect(() => registry.getArtifact('session-a', artifact.artifactId))
      .toThrowError(FileOperationPlanError);
  });

  it('rejects stale source and destination fingerprints before execution', async () => {
    const registry = new FileOperationPlanRegistry<{ value: string }, never>(() => 'plan-1');
    const { planId } = registry.registerPlan({
      sessionId: 'session-a', requestId: 'request-a', intent,
      sourceFingerprint: 'source:1', targetFingerprint: 'target:1',
      payload: { value: 'snapshot' },
    });

    await expect(registry.executePlan({
      sessionId: 'session-a', requestId: 'request-a', planId,
      readSourceFingerprint: async () => 'source:2',
      readTargetFingerprint: async () => 'target:1',
      run: async () => 'not-run',
    })).rejects.toMatchObject({ code: 'STALE_SOURCE' });

    const second = registry.registerPlan({
      sessionId: 'session-a', requestId: 'request-b', intent,
      sourceFingerprint: 'source:1', targetFingerprint: 'target:1',
      payload: { value: 'snapshot' },
    });
    await expect(registry.executePlan({
      sessionId: 'session-a', requestId: 'request-b', planId: second.planId,
      readSourceFingerprint: async () => 'source:1',
      readTargetFingerprint: async () => 'target:2',
      run: async () => 'not-run',
    })).rejects.toMatchObject({ code: 'STALE_TARGET' });
  });

  it('runs once with external cancellation and progress and preserves retry intent', async () => {
    let sequence = 0;
    const registry = new FileOperationPlanRegistry<{ value: string }, never>(
      () => `plan-${++sequence}`,
    );
    const first = registry.registerPlan({
      sessionId: 'session-a', requestId: 'request-a', intent,
      sourceFingerprint: 'source:1', targetFingerprint: 'missing',
      payload: { value: 'snapshot' },
    });
    const controller = new AbortController();
    const progress = vi.fn();
    const result = await registry.executePlan({
      sessionId: 'session-a', requestId: 'request-a', planId: first.planId,
      signal: controller.signal,
      onProgress: progress,
      readSourceFingerprint: async () => 'source:1',
      readTargetFingerprint: async () => 'missing',
      run: async (plan, signal, report) => {
        expect(signal.aborted).toBe(false);
        report('rendering');
        return plan.payload.value;
      },
    });
    expect(result).toBe('snapshot');
    expect(progress).toHaveBeenCalledWith('rendering');
    expect(() => registry.getPlan('session-a', 'request-a', first.planId))
      .toThrowError(FileOperationPlanError);
    expect(registry.getRetryIntent('session-a', 'request-a')).toEqual(intent);
  });

  it('does not accept cancellation after the atomic commit boundary', () => {
    const registry = new FileOperationPlanRegistry<{ value: string }, never>(() => 'plan-commit');
    const { planId } = registry.registerPlan({
      sessionId: 'session-a', requestId: 'request-a', intent,
      sourceFingerprint: 'source:1', targetFingerprint: 'missing',
      payload: { value: 'snapshot' },
    });
    registry.markCommitStarted('session-a', 'request-a', planId);
    expect(registry.cancelPlan('session-a', 'request-a', planId)).toBe(false);
  });

  it('leases an artifact until the caller commits or releases the action', () => {
    let sequence = 0;
    const registry = new FileOperationPlanRegistry<never, { body: string }>(
      () => `artifact-${++sequence}`,
    );
    const { artifactId } = registry.registerArtifact('session-a', { body: 'before import' });

    const first = registry.leaseArtifact('session-a', artifactId);
    expect(first.value.body).toBe('before import');
    expect(() => registry.leaseArtifact('session-a', artifactId))
      .toThrowError(FileOperationPlanError);

    first.release();
    const retry = registry.leaseArtifact('session-a', artifactId);
    retry.commit();
    expect(() => registry.getArtifact('session-a', artifactId))
      .toThrowError(FileOperationPlanError);
  });

  it('does not abort a plan whose atomic commit already started when clearing a session', async () => {
    const registry = new FileOperationPlanRegistry<{ value: string }, never>(() => 'plan-commit');
    const { planId } = registry.registerPlan({
      sessionId: 'session-a', requestId: 'request-a', intent,
      sourceFingerprint: 'source:1', targetFingerprint: 'missing',
      payload: { value: 'snapshot' },
    });
    let releaseRun!: () => void;
    const running = registry.executePlan({
      sessionId: 'session-a', requestId: 'request-a', planId,
      readSourceFingerprint: async () => 'source:1',
      readTargetFingerprint: async () => 'missing',
      run: async (_plan, signal) => {
        registry.markCommitStarted('session-a', 'request-a', planId);
        await new Promise<void>((resolve) => { releaseRun = resolve; });
        expect(signal.aborted).toBe(false);
        return 'committed';
      },
    });

    await vi.waitFor(() => expect(releaseRun).toBeTypeOf('function'));
    registry.clearSession('session-a');
    releaseRun();
    await expect(running).resolves.toBe('committed');
  });
});
