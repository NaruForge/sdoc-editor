# ADR 0021: Bound ordinary editor projections and defer broader runtime changes

- Status: Accepted
- Date: 2026-08-28
- Decision issue: #216

## Context

The exact `rich-mixed-5k` Chromium release corpus met its DOM and retained-heap
budgets after passive rich-node work was reduced, but ordinary paragraph input
still missed the key-to-next-paint budget. Typed test instrumentation separated
`EditorState` and plugin application, `EditorView.updateState`, and post-update
work. It also counted structure, fold, numbering, Lowlight, persistent-ID, and
NodeView activity without changing production message or persistence formats.

Before the final transaction optimization, dispatch median/p95 was 30.1/55.9
ms and state/plugin work was 23.4/39.9 ms. A full document structure projection
was rebuilt on all 15 sampled ordinary keystrokes, at 11.3/17.6 ms. Structure
position mapping itself was only 0.3/3.1 ms, fold mapping at most 0.3 ms,
Lowlight mapping at most 0.1 ms, and persistent-ID scans were already skipped.

## Decision

### Adopt a strict ordinary-paragraph proof and bounded position mapping

All cooperating editor plugins share one `WeakMap<Transaction, boolean>`
classification. The fast path accepts exactly one `ReplaceStep` in one direct
top-level paragraph when both old and new paragraphs contain only unmarked text
and retain the same node type, attrs, stable ID, top-level index, and unchanged
siblings. Multi-step edits, split/join, mark or internal-link changes, inline
rich nodes, block attrs, semantic ancestors, and uncertain mappings fail
closed.

The structure-index state retains one immutable semantic projection. An
accepted insertion appends its `StepMap` to a maximum-32 chain without copying
the semantic arrays or `byId`, changing the semantic revision, notifying
listeners, or rebuilding numbering. Position queries and navigation map only
when needed and cache a materialized view of that state. Deletion compacts
eagerly; a deleted/ambiguous mapped structural position, an uncertain
transaction, settings change, or the 32-map bound uses the exact eager mapping
or full rebuild path. Fresh-build differential tests cover heading,
cross-reference, fold, numbering, Lowlight, ID, IME, Undo/Redo, selection, and
compaction behavior.

Semantic numbering retains ProseMirror's generic `DecorationSet.map`. A
specialized stable-heading projection was tested against a fresh-build oracle,
but actual Chromium cost regressed from median/p95 3.8/6.2 ms to 11.8/18.9 ms
and was rejected.

### Defer a host leaf-text operation protocol

No production leaf-text message or alternate persistence path is introduced.
The existing debounced full snapshot remains authoritative and the measured
5k host acknowledgement already meets its current persistence budget; reducing
that background acknowledgement would not directly repair the remaining paint
latency. A future shadow-only experiment may proceed only if it:

- derives bounded leaf text operations from an already acknowledged host
  revision while the full snapshot continues to determine persisted bytes;
- proves byte-for-byte output, `meta.modified`, validation, Undo/Redo, import,
  reload, external-conflict, reject/retry, and stale-ACK equivalence;
- falls back to the full validate/serialize path for every unproved operation;
- shows a material end-to-end acknowledgement reduction on the actual Host
  corpus without adding a second document authority.

Only after those conditions hold may a separate decision consider making the
operation path authoritative.

### Do not move AJV validation to a Worker or virtualize the editable document

AJV Worker ownership is a no-go for this phase. It would add another snapshot
transfer, cancellation, ordering, and failure boundary while ordinary content
still requires the exact host validation and the current ACK path meets its
budget. The shadow operation gate above must first demonstrate that validation
is the user-relevant limiting phase.

Editable-document virtualization is also a no-go. The optimized corpus uses
about 40.6k DOM nodes and 55.6 MB retained heap, below the 50k and 128 MiB
budgets. Virtualization would risk native selection, composition, find,
accessibility, copy, drag, Undo/Redo, and scroll geometry while the measured
remaining input time is dispatch/view/paint rather than capacity pressure.

## Rejected alternatives

- A vanilla CodeBlock NodeView removed React lifecycle warnings but twice
  failed the actual focus-driven language-option materialization contract. The
  tested React lazy selector remains.
- Specialized semantic-numbering decoration reconstruction was correct but
  materially slower in the actual browser and was reverted.
- We do not weaken the corpus, move the capture point, or relax release budgets
  to declare success.

## Consequences

The best post-change run removed all 15 ordinary full structure builds. Dispatch
median/p95 improved to 11.7/18.4 ms and met the 20 ms dispatch target.
Key-to-next-paint improved to 44.7/59.8 ms with a 59.8 ms maximum, so the 50 ms
p95 target remains unmet although the 100 ms maximum target passes. The same run
recorded open p95 2,329.1 ms, scroll p95 59.9 ms, navigation p95 99.9 ms, 40,573
DOM nodes, and 55.6 MB retained heap. Open, key-paint, and scroll remain release
gate failures.

A final repeat after reverting the slower numbering experiment confirmed zero
ordinary full structure builds and dispatch median/p95 12.2/16.5 ms. Browser
paint variability remained material: key-to-next-paint was 45.2/71.1 ms, open
p95 2,237.6 ms, scroll p95 56.0 ms, and navigation p95 104.4 ms. These repeated
failures, rather than the best single run, keep the release gate open.

These Chromium measurements use the repository's Vite/React development
harness. React reports `flushSync` lifecycle warnings while mounting the large
NodeView population, so absolute mount and paint timings include development
runtime overhead. The corpus, capture points, and budgets remain unchanged;
a production-build harness comparison is deferred rather than using this
limitation to waive a failed release budget.

Future work should first examine supported batching for the remaining React
NodeView mount lifecycle and browser layout/paint, preserving all native editor
semantics. Issue #216 should remain open until the release corpus budgets pass;
this ADR does not authorize virtualization, a Worker, or a production leaf-text
protocol.
