# ADR 0017: Separate editor acknowledgement from disk save

## Status

Accepted

## Context

The webview sends debounced document mutations to the VS Code Extension Host.
An accepted mutation updates the in-memory `TextDocument`, but it does not prove
that the corresponding bytes reached disk. Treating that acknowledgement as a
completed save can tell a user that work is safe when the document is still
dirty, a later save fails, or an acknowledgement belongs to an older editor
session.

External changes and invalid source recovery add further states that cannot be
represented truthfully by one boolean. A useful status must distinguish local
edits, webview-to-host synchronization, the VS Code save lifecycle, conflicts,
and failures without accepting stale cross-document messages.

## Decision

Webview mutation acknowledgement and disk save are separate protocol events.
`editAcknowledged` means only that the exact session, document, edit, and base
revision were accepted into the host `TextDocument`. It carries the host-owned
`modified` timestamp, which the editor adopts only after the coordinator accepts
that acknowledgement.

The host publishes `documentSaveState` events from VS Code's `onWillSaveTextDocument`
and `onDidSaveTextDocument`. Every event includes the editor session, document
identity, monotonically increasing save generation, and document revision. The
webview ignores mismatched identities, older generations, and terminal-state
regressions.

The visible state is derived with this priority: invalid document, external
conflict, mutation failure, disk-save failure, saving, mutation in flight,
unacknowledged local work, saved, and disk-save pending. `Saved` is shown only
when a current disk-save event covers the latest acknowledged revision and no
newer local or in-flight mutation exists. Retry is offered only for transient
mutation transport or write errors; conflict and invalid-document recovery stay
in their dedicated workflows.

This changes runtime protocol and UI behavior only. It does not change the
persisted `.sdoc` schema.

## Consequences

- Users can distinguish editor synchronization from durable disk persistence.
- Stale save notifications from another session, document, or generation cannot
  overwrite a newer visible state.
- The host remains the sole owner of persisted modification timestamps.
- Save failures remain visible and actionable instead of being replaced by a
  later stale success event.
- Protocol fixtures and both host and webview lifecycle tests must evolve when
  save-state semantics change.
