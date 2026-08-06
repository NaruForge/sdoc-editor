# ADR 0014: Retire the Windows desktop host

- Status: Accepted
- Date: 2026-08-06
- Decision issue: #125

## Context

The Windows Desktop app had no confirmed users, while maintaining it required a
second frontend composition, a Rust filesystem and IPC host, Windows installers,
dependency updates, and cross-host verification. Shared document and editor
code reduced duplication but did not remove that recurring integration cost.

Keeping Desktop current only when spare development capacity was available was
also rejected: an irregular parity promise accumulates compatibility and
security debt without serving an observed user need.

## Decision

Windows Desktop v0.7.8 is the final Desktop release. Starting with v0.8.0, the
supported delivery surfaces are the VS Code extension and SDOC CLI.

`tauri-app/`, Rust checks, Desktop packaging, and Desktop-specific UI and tests
are removed from `main`. The `v0.7.8` tag remains the source recovery point and
its final installers remain available as an explicitly unsupported archive.
Older Desktop release assets are removed.

The document schema, converters, semantic operations, reusable editor code, and
typed extension/webview bridge remain host-neutral where that separation is
still useful. User `.sdoc` documents and `~/.sdoc/templates/` are not Desktop
application residue and are not removed.

This ADR supersedes the active two-host parity and verification obligations in
ADRs 0002, 0004, 0006–0008, and 0010–0013. Those ADRs remain historical records;
their host-neutral document, persistence, security, and UI conclusions continue
to apply where used by VS Code or CLI.

## Consequences

- New features and fixes require no Desktop or Rust implementation.
- `npm run build:all` builds VS Code and CLI only.
- CLI release packaging is independent of the retired Desktop workflow.
- Desktop v0.7.8 receives no security, compatibility, or support updates.
- Reintroducing a standalone application requires a new demand assessment and
  a new architecture decision rather than silently reviving the retired host.
