# ADR 0018: Use bounded semantic read projections

- Status: Accepted
- Date: 2026-08-07
- Decision issue: #159

## Context

The original semantic inspector returns metadata and four catalogs together,
optionally followed by one targeted node. Its bounded block list is useful for
humans and small documents, but it cannot traverse a large catalog without
gaps, resume a section or document read, or prove that a continuation belongs
to the exact bytes and query that created it. Increasing the inspector's limits
would still combine unrelated data and could split a structural subtree across
responses.

Automations need an additive read contract that can select one kind of data,
apply explicit byte and node budgets, and resume deterministically. Existing
`inspectDocumentBytes` callers and its default and targeted result shapes must
remain unchanged.

## Decision

### Additive host-neutral read contract

`shared/document/operations/` owns `projectDocumentBytes` and the
`sdoc.read/1` request and result types. The contract is additive to
`sdoc.operations/1` and to the legacy inspector. It has four projections:

- `catalog` returns exactly one of `blocks`, `outline`, `references`, or
  `referenceables`; `blocks` is the default.
- `target` resolves exactly one persistent/snapshot target or content-index
  path and returns that complete node with its canonical operation target.
- `section` uses the existing same-parent heading range from ADR 0009.
- `document` reads the root document content in top-level order.

Requests are narrowed from `unknown`, reject unknown keys, and enforce exact
`target`/`targetPath` exclusivity. Target reads are deliberately non-paginated.
Catalog, section, and document reads may carry a continuation cursor. An
optional `expectedRevision` provides an explicit exact-byte precondition.

Every success reports `sdoc.read/1`, its projection, the SHA-256 revision of the
exact input bytes, legacy status, document identity when available, ID
normalization need, and bounded warnings. Page metadata reports the number
returned, completion, a continuation only when incomplete, and the limiting
budget. Byte usage is the exact UTF-8 length of `JSON.stringify(result.data)`;
node usage counts complete returned node subtrees where node budgets apply.

The defaults are 256 KiB, 1,000 nodes, and 1,000 catalog entries. Hard caps are
32 MiB, 100,000 nodes, and 10,000 catalog entries. Catalog summaries retain the
legacy 120-character default and 20-to-500 bound. Inputs below their lower
bounds, above their caps, non-integral limits, oversized cursors, and unknown
request fields fail as argument diagnostics.

### Whole-item pagination and explicit non-progress failure

Catalog entries are atomic pagination items. A document page contains only
whole top-level subtrees. A section page contains only whole sibling subtrees
inside the existing section range. No node subtree is split to satisfy a byte
or node budget.

If the first item at a requested position cannot fit, the read fails with
`PROJECTION_ITEM_TOO_LARGE` and the item's required byte and, where applicable,
node counts. It does not return the same continuation cursor, preventing a
successful-looking page that cannot make progress. Otherwise a page stops
before the first item that would exceed its entry, byte, or node budget.

### Revision- and query-bound cursors

A continuation cursor contains a version, exact byte revision, projection,
query digest and scope, and next item index. Its bounded opaque encoding carries
a SHA-256 checksum. The checksum detects corruption; it is not a secret and
does not authenticate or authorize a read.

Malformed, corrupt, or oversized cursors return `INVALID_READ_CURSOR`. A valid
cursor used with different input bytes returns `STALE_READ_CURSOR`, including
UTF-8 BOM and representation-only changes. A cursor used with another
projection or query scope returns `READ_CURSOR_SCOPE_MISMATCH`. An explicit
`expectedRevision` mismatch remains the separate `STALE_REVISION` conflict.

## Consequences

- Large catalogs can be traversed deterministically without gaps or duplicates
  while each response contains only the requested catalog.
- Consumers can concatenate section and document page content in order to
  reconstruct the selected range exactly.
- Byte and node budgets are portable across hosts because the shared core owns
  serialization measurement and structural counting.
- Stateless hosts must re-read, parse, and hash the supplied document for every
  page; the cursor stores no trusted server-side state.
- Existing inspection and semantic mutation producers and consumers require no
  migration.
