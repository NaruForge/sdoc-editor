# ADR 0013: Use hashed, routed advisor context

## Status

Accepted

## Context

Required Grok planning and final-diff critiques previously depended on a free-form
prompt and on the model attempting repository reads. That made headless execution
fragile, encouraged oversized payloads, and could not prove that relevant shared,
host, schema, and test context had been selected. A hash of an incomplete payload
proves only that the payload did not change; it does not prove coverage.

## Decision

`advisor-context.ps1` is the only generator for required advisor repository
context. It has two modes:

- `Planning` accepts a bounded task specification and zero or more affected
  repository paths. Zero paths deliberately produces canonical core context for
  early planning. One optional generator-side expansion can add routed paths.
- `FinalDiff` accepts the same task specification and captures the exact textual
  diff from `BaseRef` (default `HEAD`) for the explicit or discovered change set.

The canonical core always contains `AGENTS.md`, `PRODUCT.md`,
`docs/architecture.md`, and a deterministic ADR index containing each tracked
ADR's path, title, and exact SHA-256. `DESIGN.md` is selected only for UI routes.
The versioned path and relationship registry is
`.agents/skills/orchestrate-sdoc-work/references/project-context.routes.json`.
It contains routing data, not prose summaries. Every supplied or discovered
changed path must match at least one route. Declarative relationships add required
cross-host, schema, native-contract, and test sources. Missing or unclassified
inputs fail closed.

The generator writes UTF-8 without BOM and LF-only artifacts to a new direct child
of the OS temporary directory named `sdoc-advisor-context-<guid>`. It emits a
compact JSON summary on stdout; it never emits bundle contents. On success the
directory remains alive for `invoke-advisor.ps1`, which must verify and delete
that exact directory in `finally`. On generator failure partial artifacts are
deleted by the generator. `-KeepArtifacts` is diagnostic-only and changes
`callerMustDelete` to false; it does not publish artifacts into the repository.

The public success summary has `schemaVersion: 1`, `contextStatus: "complete"`,
`artifactDirectory`, `bundlePaths`, `integrityManifestPath`, `coveragePath`,
`contextSha256`, `fingerprint`, `selectionSha256`, `selectedPaths`, `shards`,
`expansionApplied`, and `callerMustDelete`. The default total bundle limit is
256 KiB and the maximum is six concern shards plus the canonical core. Exceeding
either configured bound fails closed.

Integrity and coverage are separate machine-readable contracts:

- `integrity-manifest.json` schema version 1 records exact byte counts and
  SHA-256 values for configuration, task specification, optional expansion
  request, exact diff, every selected repository source, and every ADR index
  source. `selectedInputFingerprint` hashes the sorted exact-input records.
`contextSha256` hashes the ordered bundle names, byte counts, and exact bundle
SHA-256 values, thereby covering all bundle bytes.
- `selection-coverage.json` schema version 1 records changed-path route and
  concern classifications, relationship satisfaction, selection reasons,
  selected paths, expansion state, and an empty `unclassifiedPaths` array.
  `selectionSha256` hashes this coverage artifact. It is coverage evidence, not
  an integrity substitute.

Repository sources must be repository-relative, route-allowlisted, valid UTF-8,
textual, bounded, canonically contained, and tracked. A new untracked source is
allowed only when it is explicitly named by `ChangedPath`, `ChangeSetFile`, or
`IncludeUntrackedPath`, matches `safeUntrackedPatterns`, and passes the same
content checks. Arbitrary user `.sdoc` files are denied; only routed, tracked
examples or fixtures may be selected. Traversal, external source paths, symlink
escape, denied path classes, binary data, oversized input, credentials, and
private keys fail closed. Task specifications and expansion-request files may be
caller-owned temporary payloads, but they are bounded, UTF-8, secret-scanned,
hashed, and never treated as repository source authority.

An expansion request is either `-RequestedPath` or a JSON file with
`schemaVersion: 1`, `attempt: 1`, and non-empty `requestedPaths`. The two forms
are mutually exclusive. The wrapper enforces at most one expansion round. The
generator re-applies route, relationship, containment, tracking, and content
checks and includes expanded content in the canonical core and its concern
shard. Grok receives payload-only context and is never granted shell or file-read
tools.

For `FinalDiff`, the canonical core contains the exact bounded diff. Concern
shards intentionally omit a second full-text copy of changed non-canonical files
and contain only routed surrounding contracts, host counterparts, and tests.
This keeps the 256 KiB ceiling meaningful without losing changed bytes; tests
lock both the exact-diff presence and the absence of duplicate changed sources.

## Consequences

Advisor inputs are reproducible from selected content and fail closed when the
registry cannot justify their impact coverage. Concern shards may intentionally
duplicate shared and host sources so cross-host behavior is reviewed together;
the core supplies relationship metadata for synthesis.

Registry maintenance becomes part of repository architecture work. New source
areas need a route and appropriate relationship edges before their changes can be
reviewed. A valid hash cannot waive a coverage failure, and a successful provider
exit cannot waive wrapper validation or context-hash echo checks.
