# ADR 0010: Use single-flight document mutations and explicit editor replacement

- Status: Accepted
- Date: 2026-07-27
- Decision issues: #45, #20

## Context

The editable Tiptap document is the user's immediate source of truth. The
previous bridge nevertheless treated host snapshots as authoritative after
initialization. VS Code sent full `update` snapshots for external changes and
metadata or document-setting writes, and sent a content-bearing
`editRejected`. The webview applied each with `setContent`.

`setContent` cancels the editor's pending debounce, replaces the ProseMirror
document, and does not preserve its transaction or undo history. A delayed
snapshot could therefore restore text just deleted by the user. Tauri did not
echo ordinary saves, but a late or duplicate asset-hydration result could
replace a document after editing started.

Content, metadata, and document settings also used independent messages.
Optimistically advanced revisions and multiple outstanding snapshots made
their relative order ambiguous.

## Decision

### One host-neutral persistence state machine

`shared/persistence/DocumentSyncCoordinator.ts` owns each editor session's:

- session and document identity;
- acknowledged host revision;
- monotonically increasing local generation;
- single in-flight mutation;
- latest coalesced pending mutation;
- acknowledged generation and point-in-time flush waiters;
- non-destructive error, conflict, and external-change state.

A `DocumentMutation` is a complete local draft containing portable content,
metadata, and raw document settings. Every kind of persisted editor change is
submitted through this one sequence.

Only an acknowledgement whose session, document, and edit identity matches
the current in-flight mutation may advance the acknowledged revision. Later
input remains editable and replaces the one pending draft. After an ACK, that
latest draft is sent against the newly acknowledged revision.

A rejection preserves the newest local draft, stops automatic transport, and
rejects affected flush barriers. It never returns an editor-replacement
effect and never retries automatically. Stale or cross-session responses are
ignored. A later user-requested save barrier may retry transient write or
transport errors; conflicts and invalid documents still require their explicit
recovery path. “Keep mine” is an explicit rebase and retry against the observed
host revision and receives a new local generation so barriers wait for its ACK.

`SaveCoordinator` captures the local generation at a save/export action's
request time and waits for that generation to be acknowledged. Later typing
may continue and remains pending for the next mutation.

### Full-document replacement is an explicit boundary

`shared/editor/documentReplacement.ts` is the only full-document replacement
boundary. It accepts exactly:

- `initial-load`;
- `user-reload`;
- `user-import`;
- `confirmed-template`.

The Tiptap editor starts non-editable. The initial document is hydrated and
applied exactly once before editing is enabled. ACK, reject, external change,
metadata, document settings, and asset refreshes have no accepted replacement
reason and cannot call this boundary.

Tauri assigns an opaque session ID for each open and uses a hydration
generation coordinator. Duplicate hydration for one session shares a single
operation; a late result from an old session or an unmounted editor is
discarded.

### Correlated bridge contract

Persistence edits require session ID, document ID, edit ID, base revision,
local generation, and a complete mutation. ACK and reject messages repeat
session, document, edit, and revision identity. Rejects carry a structured
code and may carry a host snapshot for comparison, but the snapshot is never
applied automatically.

Flush completion and failure both require session and request identity.
Generic background `update`, optional edit identity, and separate persisted
metadata/settings messages are removed.

### External changes

An unsuppressed VS Code text-document change produces `externalChange`.
The editor shows a non-modal notice and retains selection, composition, undo
history, and local content. The shared comparison model shows top-level block
changes side by side. Persistent node IDs are preferred; type, path, content,
and stable order provide deterministic fallback matching.

Clean documents offer Compare and Reload. Dirty documents also offer Keep
mine. Reload and Keep mine require explicit user action; destructive choices
are confirmed. No conflict markers or automatic merge are introduced.

### Host boundaries

Hosts still dehydrate, normalize, validate, and persist complete `.sdoc`
snapshots. This decision changes the live bridge, not `sdoc.schema.json`.
Expected-text suppression continues to distinguish a VS Code host edit from
an external edit. Rust retains exact-source revalidation and atomic writes.

VS Code save and export use correlated flush barriers. Tauri switch, close,
template creation, JSON view, and export drain its save queue; queue draining
follows any mutation enqueued by an ACK callback before reporting idle.

The current VS Code `CustomTextEditorProvider` cannot delay arbitrary panel
disposal. A future `CustomDocument` migration may add a strict backup/close
contract and minimal text edits; that Phase 3 work remains tracked by #20 and
does not permit background editor replacement in the meantime.

## Consequences

- Delete, Backspace, IME composition, selection, and undo history are no
  longer replaced by persistence ACKs, failures, settings changes, or external
  file notifications.
- The persisted `.sdoc` format and converter contracts do not change.
- Full snapshots remain the storage unit, but no longer act as background
  rollback messages.
- Conflict recovery is visible and user-directed.
- Large documents still pay snapshot normalization and comparison costs;
  single-flight coalescing bounds host I/O. Operation-based editing and CRDTs
  remain out of scope.
