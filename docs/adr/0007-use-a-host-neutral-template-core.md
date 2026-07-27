# ADR 0007: Use a host-neutral template core

## Status

Accepted

## Context

VS Code and Tauri previously created new documents independently. Adding built-in and workspace templates to both hosts would otherwise duplicate template metadata parsing, document initialization, and cleanup rules, allowing their persisted results to diverge.

## Decision

Treat every template as an untrusted, schema-valid `.sdoc` envelope. `shared/template/` owns template metadata narrowing, built-in templates, diagnostics, and immutable instantiation. Instantiation removes template-only metadata, refreshes document metadata, updates only an explicitly identified title heading, and preserves document settings, IDs, and links.

Persisted document identity belongs to an instantiated document, not to its
template. Instantiation therefore removes `meta.documentId` and legacy
`meta.id` in addition to `meta.template`. Applying a template to an already
open document is a host-level operation and preserves that document's current
identity.

Hosts own filesystem discovery, canonical and symlink containment, user interaction, flush barriers, and create-new storage. Workspace templates are read non-recursively from `.sdoc/templates/*.sdoc`. Tauri Rust revalidates and stores the envelope produced by the TypeScript core but does not reproduce template semantics.

The CLI is another filesystem host. It may select a bundled template by exact
`builtin:*` ID or read one explicitly named `.sdoc` template, but it does not
discover workspace or personal template directories. New files are published
atomically without replacing an existing path.

## Consequences

- Both hosts create semantically identical documents from the same template.
- Teams can version workspace templates with Git without installing a separate package.
- Invalid templates are isolated as diagnostics instead of breaking the catalog.
- Existing files and template sources are never overwritten by the new-document flow.
- Personal templates, asset bundles, variables, and remote catalogs require separate designs and issues.
