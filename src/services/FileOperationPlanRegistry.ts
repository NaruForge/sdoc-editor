import { randomUUID } from 'crypto';
import type {
  FileOperationArtifactId,
  FileOperationIntent,
  FileOperationPlanId,
} from '../../shared/editor/fileOperations';

export type FileOperationPlanErrorCode =
  | 'PLAN_NOT_FOUND'
  | 'PLAN_ALREADY_RUNNING'
  | 'ARTIFACT_IN_USE'
  | 'STALE_SOURCE'
  | 'STALE_TARGET';

export class FileOperationPlanError extends Error {
  constructor(public readonly code: FileOperationPlanErrorCode, message: string) {
    super(message);
    this.name = 'FileOperationPlanError';
  }
}

export interface RegisteredFileOperationPlan<Payload> {
  readonly planId: FileOperationPlanId;
  readonly sessionId: string;
  readonly requestId: string;
  readonly intent: FileOperationIntent;
  readonly sourceFingerprint: string;
  readonly targetFingerprint: string;
  readonly payload: Payload;
}

interface StoredPlan<Payload> {
  plan: RegisteredFileOperationPlan<Payload>;
  controller: AbortController;
  running: boolean;
  committing: boolean;
}

export interface ExecuteFileOperationPlanOptions<Payload, Result> {
  sessionId: string;
  requestId: string;
  planId: FileOperationPlanId;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  readSourceFingerprint(): Promise<string>;
  readTargetFingerprint(): Promise<string>;
  run(
    plan: RegisteredFileOperationPlan<Payload>,
    signal: AbortSignal,
    report: (stage: string) => void,
  ): Promise<Result>;
}

/** In-memory capability registry; opaque IDs never encode paths or document identity. */
export class FileOperationPlanRegistry<Payload, Artifact> {
  private readonly plans = new Map<FileOperationPlanId, StoredPlan<Payload>>();
  private readonly artifacts = new Map<FileOperationArtifactId, {
    sessionId: string;
    value: Artifact;
    leased: boolean;
  }>();
  private readonly retryIntents = new Map<string, FileOperationIntent>();

  constructor(private readonly createId: () => string = randomUUID) {}

  registerPlan(input: Omit<RegisteredFileOperationPlan<Payload>, 'planId'>): {
    planId: FileOperationPlanId;
  } {
    const planId = this.createId();
    const plan = Object.freeze({ ...input, planId });
    this.plans.set(planId, {
      plan, controller: new AbortController(), running: false, committing: false,
    });
    this.rememberRetryIntent(input.sessionId, input.requestId, input.intent);
    return { planId };
  }

  getPlan(sessionId: string, requestId: string, planId: FileOperationPlanId): RegisteredFileOperationPlan<Payload> {
    const stored = this.plans.get(planId);
    if (!stored || stored.plan.sessionId !== sessionId || stored.plan.requestId !== requestId) {
      throw new FileOperationPlanError('PLAN_NOT_FOUND', 'The file operation plan is unavailable.');
    }
    return stored.plan;
  }

  async executePlan<Result>(options: ExecuteFileOperationPlanOptions<Payload, Result>): Promise<Result> {
    const stored = this.plans.get(options.planId);
    const plan = this.getPlan(options.sessionId, options.requestId, options.planId);
    if (!stored || stored.running) {
      throw new FileOperationPlanError('PLAN_ALREADY_RUNNING', 'The file operation plan is already running.');
    }
    stored.running = true;
    const relayAbort = (): void => stored.controller.abort();
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    if (options.signal?.aborted) relayAbort();
    try {
      stored.controller.signal.throwIfAborted();
      if (await options.readSourceFingerprint() !== plan.sourceFingerprint) {
        throw new FileOperationPlanError('STALE_SOURCE', 'The source changed after preflight.');
      }
      if (await options.readTargetFingerprint() !== plan.targetFingerprint) {
        throw new FileOperationPlanError('STALE_TARGET', 'The destination changed after preflight.');
      }
      return await options.run(
        plan,
        stored.controller.signal,
        options.onProgress ?? (() => undefined),
      );
    } finally {
      options.signal?.removeEventListener('abort', relayAbort);
      this.plans.delete(options.planId);
    }
  }

  cancelPlan(sessionId: string, requestId: string, planId?: FileOperationPlanId): boolean {
    const candidates = planId ? [[planId, this.plans.get(planId)] as const] : [...this.plans.entries()];
    for (const [id, stored] of candidates) {
      if (stored?.plan.sessionId === sessionId && stored.plan.requestId === requestId) {
        if (stored.committing) return false;
        stored.controller.abort();
        if (!stored.running) this.plans.delete(id);
        return true;
      }
    }
    return false;
  }

  markCommitStarted(sessionId: string, requestId: string, planId: FileOperationPlanId): void {
    const stored = this.plans.get(planId);
    this.getPlan(sessionId, requestId, planId);
    if (stored) stored.committing = true;
  }

  getRetryIntent(sessionId: string, requestId: string): FileOperationIntent | undefined {
    return this.retryIntents.get(this.requestKey(sessionId, requestId));
  }

  rememberRetryIntent(sessionId: string, requestId: string, intent: FileOperationIntent): void {
    this.retryIntents.set(this.requestKey(sessionId, requestId), intent);
  }

  registerArtifact(sessionId: string, value: Artifact): { artifactId: FileOperationArtifactId } {
    const artifactId = this.createId();
    this.artifacts.set(artifactId, { sessionId, value, leased: false });
    return { artifactId };
  }

  getArtifact(sessionId: string, artifactId: FileOperationArtifactId): Artifact {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.sessionId !== sessionId) {
      throw new FileOperationPlanError('PLAN_NOT_FOUND', 'The file operation artifact is unavailable.');
    }
    return artifact.value;
  }

  takeArtifact(sessionId: string, artifactId: FileOperationArtifactId): Artifact {
    const value = this.getArtifact(sessionId, artifactId);
    this.artifacts.delete(artifactId);
    return value;
  }

  leaseArtifact(sessionId: string, artifactId: FileOperationArtifactId): {
    value: Artifact;
    commit(): void;
    release(): void;
  } {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.sessionId !== sessionId) {
      throw new FileOperationPlanError('PLAN_NOT_FOUND', 'The file operation artifact is unavailable.');
    }
    if (artifact.leased) {
      throw new FileOperationPlanError('ARTIFACT_IN_USE', 'The file operation artifact is already in use.');
    }
    artifact.leased = true;
    let open = true;
    return {
      value: artifact.value,
      commit: () => {
        if (!open) return;
        open = false;
        if (this.artifacts.get(artifactId) === artifact) this.artifacts.delete(artifactId);
      },
      release: () => {
        if (!open) return;
        open = false;
        if (this.artifacts.get(artifactId) === artifact) artifact.leased = false;
      },
    };
  }

  deleteArtifact(sessionId: string, artifactId: FileOperationArtifactId): boolean {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.sessionId !== sessionId || artifact.leased) return false;
    return this.artifacts.delete(artifactId);
  }

  clearSession(sessionId: string): void {
    for (const [planId, stored] of this.plans) {
      if (stored.plan.sessionId === sessionId) {
        if (!stored.committing) {
          stored.controller.abort();
          this.plans.delete(planId);
        }
      }
    }
    for (const [artifactId, artifact] of this.artifacts) {
      if (artifact.sessionId === sessionId) this.artifacts.delete(artifactId);
    }
    for (const key of this.retryIntents.keys()) {
      if (key.startsWith(`${sessionId}\u0000`)) this.retryIntents.delete(key);
    }
  }

  private requestKey(sessionId: string, requestId: string): string {
    return `${sessionId}\u0000${requestId}`;
  }
}
