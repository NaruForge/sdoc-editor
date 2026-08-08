# ADR 0019: Use portable Book publish profiles and settings snapshots

- Status: Accepted
- Date: 2026-08-08
- Decision issues: #141, #142

## Context

Standalone and Book export previously resolved document values over host workspace
defaults. A Book manifest did not persist its design or export choices, so the
same committed sources could produce different output on another machine or
remote host. The settings UI also received only effective values and could not
distinguish persisted, inherited, built-in, or session-only values.

Adding host defaults to a Book export plan would preserve the ambiguity. An
open-time migration would make legacy Books dirty without an intentional
publish decision and could silently choose durable output semantics.

## Decision

### Versioned inline Book profile

`.sdocbook` is a discriminated `1.0 | 1.1` contract. Version `1.0` remains
readable, editable, and composable, but it has no reproducible export contract.
Version `1.1` requires one inline `publish` profile with:

- a complete heading and caption settings snapshot;
- the versioned `default-v1` theme and optional Book-relative CSS;
- HTML embedding and PDF scale;
- `fail` or `source-fallback` diagram behavior; and
- an optional Book-relative output directory.

The parser never upgrades a manifest. A caller must supply a complete profile
to the explicit `upgradeBookToV1_1` operation. External profile references,
branding, fonts, remote targets, and release history are not part of v1.

All persisted CSS, output, and chapter paths are normalized as Book-relative
paths. Absolute, URI-like, traversal, control-character, and Windows alternate
data stream paths are rejected before host filesystem access.

### Provenance-aware resolution

`ResolvedDocumentSettingsSnapshot` is the shared immutable settings contract.
It carries complete values, per-key source, scope, portability, application
targets, diagnostics, and a deterministic SHA-256 fingerprint.

Resolution has three explicit contexts:

- `standalone`: document settings over versioned built-ins;
- `book`: Book profile settings over versioned built-ins, with chapter conflicts
  reported as warnings; and
- `editor`: temporary view preferences over document and versioned built-ins.

Legacy host defaults are deliberately ignored for portable document appearance
in all three contexts. Host-owned chrome preferences remain separate from the
document settings registry. The settings UI, standalone export, Book export,
and semantic save normalization therefore resolve the same persisted value over
the same versioned built-in; saving a document without an override cannot bake
machine-local heading, caption, or reference labels into its body.

The existing value-only `resolveSettings` API remains a compatibility wrapper
for non-portable legacy callers. Portable persistence, export, and settings UI
must use snapshots. Materialization pins effective values explicitly, while
snapshot diffing reports both value and provenance changes.

## Consequences

- A committed `1.1` Book profile has machine-independent settings semantics.
- Legacy Books do not become dirty on open, and export can fail closed until a
  user explicitly chooses a profile.
- Settings UI and preflight can explain where each value came from and whether
  it is portable.
- Existing non-portable compatibility callers may still observe host defaults;
  persistence, export, and settings UI must not call the compatibility wrapper.
- Future profile changes require a new profile or Book version rather than a
  reinterpretation of `profileVersion: "1"`.
