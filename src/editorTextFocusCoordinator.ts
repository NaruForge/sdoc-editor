export interface EditorTextFocusIdentity {
  sessionId: string;
  documentId: string;
}

export interface EditorTextFocusLease<Owner> extends EditorTextFocusIdentity {
  owner: Owner;
}

/**
 * Owns the host-side focus lease for the editor that may receive text commands.
 * Requiring the owner and identity when releasing prevents a stale panel from
 * clearing a lease acquired by a newer active editor.
 */
export class EditorTextFocusCoordinator<Owner> {
  private lease: EditorTextFocusLease<Owner> | undefined;

  public get currentLease(): Readonly<EditorTextFocusLease<Owner>> | undefined {
    return this.lease;
  }

  public update(
    owner: Owner,
    identity: EditorTextFocusIdentity,
    focused: boolean,
    ownerIsActive: boolean,
  ): boolean {
    if (!focused || !ownerIsActive) {
      return this.release(owner, identity);
    }

    if (this.owns(owner, identity)) return false;
    this.lease = { owner, ...identity };
    return true;
  }

  public release(owner: Owner, identity: EditorTextFocusIdentity): boolean {
    if (!this.owns(owner, identity)) return false;
    this.lease = undefined;
    return true;
  }

  public clear(): boolean {
    if (!this.lease) return false;
    this.lease = undefined;
    return true;
  }

  public owns(owner: Owner, identity: EditorTextFocusIdentity): boolean {
    return this.lease?.owner === owner
      && this.lease.sessionId === identity.sessionId
      && this.lease.documentId === identity.documentId;
  }
}
