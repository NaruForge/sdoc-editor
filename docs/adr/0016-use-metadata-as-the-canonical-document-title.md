# ADR 0016: Use metadata as the canonical document title

- Status: Accepted
- Date: 2026-08-06

## Context

Documents created from the built-in templates persisted the same title in both
`meta.title` and a body H1 identified by `meta.template.titleNodeId`. The editor
edited metadata and body content independently, while export could render both.
The two values could therefore diverge and produce duplicate visual and semantic
titles.

Existing workspace and personal templates may still contain `titleNodeId`, and
documents created from historical built-ins may contain the corresponding H1.
Automatically removing a broadly matched heading would risk deleting authored
content.

## Decision

`meta.title` is the single canonical document title. Empty-document creation and
current built-in templates do not add a title H1 to the body.

Template instantiation retains read compatibility for `titleNodeId` but consumes
the explicitly designated heading as a template placeholder instead of copying
or rewriting it. All unrelated metadata, settings, structure, IDs, and links are
preserved.

Parsing applies one conservative in-memory compatibility migration. It removes
the heading only when there is exactly one title-like candidate and it is the
first top-level node with the exact historical shape: a plain unmarked H1 whose
only attributes are `level: 1`, `id: "document-title"`, and `numbered: false`,
and whose exact text equals `meta.title`. Parsing does not persist the migrated
envelope. A pure analyzer reports safe, ambiguous, and absent cases so a later UI
resolver can present uncertain headings to the user without guessing.

The persisted schema remains `.sdoc` 1.0, and `titleNodeId` remains readable for
legacy templates.

## Consequences

- New documents have one title source and no duplicate title H1.
- Exact historical built-in output is cleaned up when read without rewriting the
  source file.
- Marked, moved, aligned, numbered, nested, mismatched, or multiple candidates
  remain unchanged until a user resolves them.
- Navigate and export surfaces must consume `meta.title` as the virtual document
  title in their separately owned integration slices.
