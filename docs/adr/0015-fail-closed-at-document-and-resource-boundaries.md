# ADR 0015: Fail closed at document and resource boundaries

## Status

Accepted

## Context

A visual editor must never turn malformed or unsupported source text into a new
empty document and later overwrite the original. External edits can also make a
previously valid file invalid while the webview still contains valuable local
work. Unbounded document, import, asset, book, DNS, and export-runtime work can
stall the Extension Host or make behavior depend on network availability.

## Decision

The VS Code host parses source text through one strict document contract before
creating an editable snapshot. Invalid initial source receives a source-only UI
with non-empty diagnostics and no editor mutation channel. If an external edit
invalidates a document after a valid snapshot was loaded, the webview keeps its
local draft but loses every write capability. Restoring that local draft
requires an explicit confirmation and an exact session, document, and revision
match; repairing the source and reloading remains the default recovery path.

Host operations publish explicit capabilities instead of inferring editability
from mounted UI. Flush acknowledgements are owned by the requesting editor
session and document. Book mutations are serialized and revision checked.

Documents and imports are limited to 32 MiB. Individual assets are limited to
32 MiB, embedded assets to 256 MiB and 1,024 references, and host reads use a
concurrency limit of four. Book manifests and chapter composition have matching
bounded contracts. Canonical containment applies to assets and custom CSS.
Kroki DNS resolution has a cancellable deadline. KaTeX and Mermaid export
runtime files are shipped in the VSIX; full self-contained export never fetches
runtime code from a CDN.

## Consequences

- Corrupt source remains byte-for-byte recoverable until the user repairs it or
  explicitly chooses a validated recovery action.
- Read-only behavior is enforced by protocol capability and host validation,
  not only disabled controls.
- Large inputs fail with bounded, actionable errors instead of consuming
  unbounded memory or Extension Host time.
- The VSIX is larger because it includes the offline export runtime and KaTeX
  fonts, but full HTML/PDF export is deterministic and works offline.
- Limits are product contracts and require tests and release notes when changed.
