# ADR 0009: Use versioned semantic document operations

- Status: Accepted
- Date: 2026-07-24
- Decision issue: #41

## Context

Automations must be able to inspect and change `.sdoc` documents without
regenerating the complete persisted JSON. Whole-document replacement makes it
too easy to overwrite concurrent edits, discard IDs or formatting, create
invalid cross-references, and produce noisy diffs.

Most referenceable nodes have persistent IDs, but ordinary mutable blocks do
not. A locator based only on an array path becomes ambiguous after another
operation inserts or moves content. The command-line host must also preserve
the original file representation and must not turn preview or no-op commands
into writes.

## Decision

### Versioned, host-neutral contract

`shared/document/operations/` owns the host-neutral `sdoc.operations/1`
request contract, inspection, validation, immutable batch application, and
bounded semantic diff. Hosts parse external JSON as `unknown`; operation
failures are returned as discriminated diagnostics with stable codes.

Every mutation request supplies the SHA-256 revision of the exact source
bytes. Those bytes include a UTF-8 BOM when one is present. A caller may also
supply `expected.documentId`. The CLI does not infer document identity: when a
requested identity cannot be supplied or checked by the document contract, it
returns an unsupported-contract diagnostic.

Nodes with persistent IDs use ID targets. Other mutable blocks use a protected
snapshot locator containing the original path, node type, and a SHA-256 digest.
The subtree digest is computed from canonical JSON with recursively sorted
object keys; array order and JSON scalar values remain significant. Snapshot
targets and provisional IDs are valid only for the inspected byte revision.
All targets are resolved to internal handles at batch start, so earlier
operations cannot redirect later operations by changing paths.

Inspection may expose deterministic provisional IDs for referenceable nodes
that lack an ID. Applying one is allowed only against the same revision and
persists the assigned ID. Existing duplicate IDs are rejected rather than
repaired automatically.

### Section and batch semantics

A section starts at its heading and extends in the same parent content array
until the next heading whose level is less than or equal to the section
heading. Descendant sections therefore move and delete with their parent.
Inserting a child appends a heading with `parent.level + 1` at the parent
section's end; H6 cannot have a child section.

Block operations reject heading moves and deletion. Section operations are
required for those changes. Heading rename preserves its persistent ID and is
limited to plain-text headings unless an operation explicitly discards
formatting. Block replacement preserves node type and existing
cross-reference identity.

The complete request is validated and all targets and preconditions are
resolved before applying an immutable batch. Any failure rejects the complete
batch. Normalization and schema validation run after application.

Existing dangling references and unsafe links or assets form a baseline
multiset keyed by violation kind and normalized identity. A result may retain
the baseline count, with warnings, but may not add a new member or increase a
member's count. New image paths are limited to portable `./images/` and
`./drawio/` paths.

Normalization resolves `meta.settings` over the defaults in
`shared/settingsResolver.ts`, and the result reports the policy used.
`meta.modified` is updated through an injected clock only when the normalized
document has a semantic change. A no-op does not update metadata and is never
written.

### Preview-first CLI and persistence boundary

The `sdoc-editor-cli` workspace provides the `sdoc` executable for Node.js
22.22.2 or newer. Mutation commands preview by default; only `--write` permits
storage, while `--dry-run` is an explicit preview alias. Legacy raw Tiptap JSON
can be inspected and validated, but writing its envelope upgrade requires
`--upgrade-legacy`.

The CLI reads only the explicitly named `.sdoc` or `.tiptap.json` file (and an
explicit operation input or stdin). It does not traverse directories, fetch
network resources, or read assets.

For `--write`, the CLI exclusively creates a sibling lock, then re-reads the
document inside the lock and verifies the byte revision. It creates an
exclusive sibling temporary file, writes and syncs it, closes it, and performs
an atomic rename. Failures clean up the temporary file and lock while
preserving the original bytes. Successful serialization preserves UTF-8 BOM,
indentation, line endings, and final-newline style.

## Consequences

- AI and scripts exchange small intent payloads and semantic diffs instead of
  complete document JSON.
- Stale files, stale snapshot targets, and concurrent writes fail explicitly.
- Operation authors implement section semantics and invariants once in the
  shared core rather than in each host.
- The byte revision changes for representation-only edits, intentionally
  requiring re-inspection before mutation.
- Canonical subtree hashing protects target identity without changing the
  persisted SDOC schema.
- The npm package is built and tested as an installable artifact but is not
  published to the public npm registry by this decision. Tagged GitHub
  Releases attach the package tarball.
