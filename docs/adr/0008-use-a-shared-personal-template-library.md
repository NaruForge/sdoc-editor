# ADR 0008: Use a shared personal template library

## Status

Accepted

## Context

ADR 0007 introduced immutable built-in and workspace templates, but deliberately
left personal template storage and management undefined. Storing personal
templates independently in VS Code global storage and Tauri app data would give
the two local hosts different catalogs. Using display names as file names would
also couple identity to renaming and expose path handling to untrusted input.

Personal templates are snapshots of documents and may contain private document
identity metadata or non-portable asset paths. Updates and deletes can race with
external changes because users may inspect or back up the managed directory.

## Decision

Local VS Code and Tauri installations use the same managed library:

```text
~/.sdoc/templates/
```

VS Code Remote, WSL, and SSH use the home directory of the remote extension
host. Cross-device cloud synchronization and arbitrary additional template
folders are not part of this decision.

Each personal template is a schema-valid, content-only `.sdoc` snapshot stored
as `<uuid>.sdoc`. Its intrinsic identity is `user:<uuid>` in
`meta.template.id`; the display name is metadata and may change without changing
the file identity. Duplicate intrinsic IDs are all excluded from the usable
catalog instead of selecting a first winner.

Snapshot creation is host-neutral. It copies the portable document body,
document title, and document settings, adds validated template metadata, and
does not copy author, document version, timestamps, or arbitrary source
metadata. The source document is never mutated. Image and Draw.io nodes are
rejected until the asset bundle contract in issue #26 is implemented.

Hosts own the managed filesystem boundary. They derive paths only from validated
UUIDs, enforce canonical containment and size/count limits, create without
overwriting, replace atomically after checking an expected content fingerprint,
and move deleted records into the managed `.trash/` directory. Both hosts use
the same create-new `.mutation.lock` lease so cooperative cross-process
mutations cannot pass the same fingerprint check concurrently. A lock left by a
crash is recoverable after five minutes; malformed partial lock payloads use
the file modification time for the same expiry rule. The shared
TypeScript core owns metadata narrowing, duplicate diagnostics, snapshot
semantics, structural preview, and instantiation. Rust validates the envelope
and storage identity but does not reproduce template semantics.

The first preview is structural rather than rendered HTML: heading outline,
object counts, and document-setting keys. It treats all strings as text and
applies item and text-length limits.

## Consequences

- Local VS Code and Tauri use one zero-configuration personal catalog.
- Renaming a template does not change its identity.
- Personal template mutations are protected from stale catalog entries and
  external edits.
- Remote VS Code environments have a separate remote-home catalog and must say
  so in the UI.
- Personal templates remain inspectable and backup-friendly `.sdoc` files.
- Documents with local assets cannot yet be saved as personal templates.
- Full rendered preview, cloud synchronization, remote catalogs, executable
  variables, and live links from documents to templates remain out of scope.
