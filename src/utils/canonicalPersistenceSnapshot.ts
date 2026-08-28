import type {
  DocumentSettings,
  ResolvedDocumentSettingsSnapshot,
  SdocMeta,
  TiptapNode,
} from '../../shared/types';
import type {
  DocumentComponentRevisions,
} from '../../shared/persistence/DocumentSyncCoordinator';

export interface CanonicalPersistenceAuthority {
  sessionId: string;
  documentId: string;
  /** Exact live TextDocument identity; URI equality is not sufficient after reopen. */
  documentIdentity: object;
}

export interface CanonicalPersistenceSnapshot {
  revision: number;
  componentRevisions: DocumentComponentRevisions;
  /** Persisted metadata excluding document settings. */
  metadata: Partial<SdocMeta>;
  documentSettings: Partial<DocumentSettings> | null;
  resolvedSettings?: ResolvedDocumentSettingsSnapshot;
  /** Present only after the host has normalized and validated this exact graph. */
  normalizedContent?: TiptapNode;
}

export interface CanonicalPersistenceReuse {
  snapshot: CanonicalPersistenceSnapshot;
  changed: Readonly<{
    content: boolean;
    metadata: boolean;
    settings: boolean;
  }>;
  reuse: Readonly<{
    metadata: boolean;
    settings: boolean;
    resolvedSettings: boolean;
    normalizedContent: boolean;
  }>;
}

interface OwnedCanonicalPersistenceSnapshot extends CanonicalPersistenceSnapshot {
  authority: CanonicalPersistenceAuthority;
}

const validRevision = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const validComponentRevisions = (value: DocumentComponentRevisions): boolean =>
  validRevision(value.content)
  && validRevision(value.metadata)
  && validRevision(value.settings);

/**
 * One small, host-owned canonical snapshot for an editor session.
 *
 * Component revisions arriving from the webview are change hints, never cache
 * authority. Reuse is possible only while the exact live document, session,
 * and host-issued TextDocument revision still match this entry. Components
 * reported as unchanged are read from this host snapshot, not from the
 * untrusted incoming mutation.
 */
export class RevisionBoundCanonicalPersistenceCache {
  private current: OwnedCanonicalPersistenceSnapshot | undefined;

  public adopt(
    authority: CanonicalPersistenceAuthority,
    snapshot: CanonicalPersistenceSnapshot,
  ): boolean {
    if (!validRevision(snapshot.revision)
      || !validComponentRevisions(snapshot.componentRevisions)) {
      this.invalidate();
      return false;
    }
    this.current = {
      ...snapshot,
      authority,
      componentRevisions: Object.freeze({ ...snapshot.componentRevisions }),
    };
    return true;
  }

  public resolve(
    authority: CanonicalPersistenceAuthority,
    revision: number,
    componentRevisions: DocumentComponentRevisions,
  ): CanonicalPersistenceReuse | undefined {
    const current = this.current;
    if (!current
      || current.authority.sessionId !== authority.sessionId
      || current.authority.documentId !== authority.documentId
      || current.authority.documentIdentity !== authority.documentIdentity
      || current.revision !== revision
      || !validComponentRevisions(componentRevisions)) return undefined;

    const changed = Object.freeze({
      content: componentRevisions.content > current.componentRevisions.content,
      metadata: componentRevisions.metadata > current.componentRevisions.metadata,
      settings: componentRevisions.settings > current.componentRevisions.settings,
    });
    if (componentRevisions.content < current.componentRevisions.content
      || componentRevisions.metadata < current.componentRevisions.metadata
      || componentRevisions.settings < current.componentRevisions.settings
      || (!changed.content && !changed.metadata && !changed.settings)) return undefined;

    return {
      snapshot: current,
      changed,
      reuse: Object.freeze({
        metadata: !changed.metadata,
        settings: !changed.settings,
        resolvedSettings: !changed.settings && current.resolvedSettings !== undefined,
        normalizedContent: !changed.content
          && !changed.settings
          && current.normalizedContent !== undefined,
      }),
    };
  }

  public invalidate(): void {
    this.current = undefined;
  }
}
