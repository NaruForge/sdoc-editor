# ADR 0006: Use acknowledged persistence and portable assets

## Status

Accepted

## Context

Debounced editors can race document switches, saves, external edits, and shutdown. Host display URLs are also unsuitable persisted identifiers because they are machine-specific and can widen local-file access during export.

## Decision

Every editor session identifies its document and sends edits with a base revision and edit identity. Hosts acknowledge applied revisions and reject stale or cross-document work. Save, switch, close, and export operations await an explicit flush barrier. Tauri replaces files through a temporary file and atomic rename.

Persisted documents contain only portable relative asset paths. Hosts hydrate those paths into display URLs at runtime and dehydrate runtime-only attributes before validation or storage. Asset reads and writes require supported extensions and canonical containment within the active document or workspace boundary.

## Consequences

- Timeouts and failed flushes are visible failures, never implicit success.
- A delayed edit cannot be applied to a newly opened document.
- Export and book composition can revalidate local asset provenance before reading files.
- Host adapters carry more session state, but persistence semantics are testable outside UI timing.
