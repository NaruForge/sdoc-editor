# Architecture

## Overview

Structured Doc Editor v0.9.1 has two supported delivery surfaces: the VS Code
extension for visual editing and the SDOC CLI for non-visual document
automation. Both consume one TypeScript document core and the same persisted
`.sdoc` contract.

The Windows Desktop app reached end of life with v0.7.8. Its historical source
does not define current architecture, build, release, or verification
obligations. See
[ADR 0014](adr/0014-retire-the-windows-desktop-host.md).

```text
VS Code extension ─ typed bridge ─ shared/editor
       │                                  │
       │                                  ├─ shared/document
       │                                  ├─ shared/template
       │                                  ├─ shared/book
       │                                  ├─ shared/settingsResolver
       │                                  └─ shared/converter
       │
SDOC CLI ─ filesystem boundary ─ shared/document/operations
       │                                  │
       └──────────────────────────────────┴─ .sdoc
```

## Source-of-truth layers

### Document contract

- `sdoc.schema.json` defines the persisted envelope.
- `shared/types.ts` defines TypeScript document and settings types.
- `shared/document/sdocUtils.ts` owns cleanup, ID assignment, cross-reference
  synchronization, and normalization. `shared/document/titleMigration.ts`
  conservatively removes only the exact historical duplicate-title heading.
- `tests/fixtures/document-contract.json` protects legacy and current
  TypeScript behavior.
- `shared/document/documentContract.ts` narrows external JSON, rejects
  unsupported versions, and validates persisted output with AJV.
- `shared/document/runtimeAssets.ts` separates host hydration from portable
  persistence dehydration.
- Save and mutation protocols carry document identity, base revision, edit
  identity, and acknowledgement so stale or cross-document writes are rejected.

### Document templates

`shared/template/` owns built-in template data, untrusted template metadata
narrowing, catalog diagnostics, and immutable template instantiation. A
template is a schema-valid `.sdoc` envelope. Creating a document removes
template-only metadata, refreshes document metadata, consumes a legacy
explicit title placeholder, and preserves settings, IDs, and links.
`meta.title` is the canonical title; current templates do not duplicate it as a
body H1. See
[ADR 0016](adr/0016-use-metadata-as-the-canonical-document-title.md).

Instantiation also removes persisted document identity (`meta.documentId` and
legacy `meta.id`). Applying a template to an existing VS Code document
preserves that document's identity explicitly.

The VS Code host discovers workspace templates only from the non-recursive
`.sdoc/templates/*.sdoc` boundary. It enforces canonical and symlink
containment, size and count limits, flushes the active editor, and creates a new
file without overwriting an existing target. Zero-byte documents are editable
in memory without writing on open. Applying a selected catalog snapshot to the
current document requires confirmation, exact identity/revision/text
revalidation, and one full-document `WorkspaceEdit`.

Personal templates use `~/.sdoc/templates/`. Each record is a content-only
`.sdoc` snapshot with an intrinsic `user:<uuid>` ID, while name and description
remain editable metadata. `shared/template/` creates immutable snapshots,
rejects unsupported assets, isolates duplicate IDs, and builds bounded
structural previews. The VS Code adapter derives managed paths from UUIDs,
enforces canonical containment, uses content fingerprints for optimistic
updates, stores atomically, and moves deleted records to `.trash/`. Remote VS
Code extension hosts resolve the remote user's separate home library.

### Book composition

`shared/book/` is the host-neutral `.sdocbook` boundary. It parses untrusted
manifests, normalizes project-relative paths, loads chapters through an
injected `BookDocumentLoader`, composes one document tree, and returns
structured diagnostics. Preview and export consumers use this result rather
than independently merging files. The VS Code provider supplies open-buffer
and filesystem access.

Chapter loading is parallel while results and diagnostics remain in manifest
order. Each valid chapter receives a deterministic invisible export anchor.
Loaders accept cancellation, and host watchers subscribe only to current
includes. Manifest, chapter-count, per-chapter, and aggregate byte limits are
enforced before composition. Book mutations are serialized and carry the
manifest revision so a stale browser action cannot overwrite a newer edit.

### Editor UI

`shared/editor/` owns reusable React components, editor context, hooks, Tiptap
extensions, extension runtime callbacks, constants, and structural CSS.
NodeViews receive `EditorExtensionRuntime` explicitly; they do not communicate
through `window.__*` globals.

`DocumentStructureIndexExtension` owns one transaction-mapped structural index
for outline, figures, tables, equations, numbering, and internal references.
Ordinary paragraph edits map positions without rebuilding or notifying semantic
subscribers; structural edits coalesce into one trailing rebuild.

The `EditorHostBridge` and discriminated unions in
`shared/types/messages.ts` define communication between the VS Code webview and
extension host. JSON entering the webview boundary is narrowed with runtime
message guards before use.

### Editing and persistence synchronization

`shared/persistence/DocumentSyncCoordinator.ts` is the host-neutral live-edit
state machine. It serializes complete content, metadata, and document-settings
drafts with one in-flight mutation and one latest coalesced pending mutation.
Only the matching acknowledgement advances the confirmed revision. Rejects,
stale responses, and external-change notices preserve the local editor draft
and never apply a host snapshot.

The editor starts read-only and crosses
`shared/editor/documentReplacement.ts` exactly once for initial hydration.
Strict source parsing must succeed before the host grants an editable
capability. Invalid initial source receives a diagnostic source-only surface;
no synthetic empty document is created. If an external edit makes a previously
valid source invalid, the local draft is preserved but all mutation
capabilities are revoked. Reusing that draft requires explicit confirmation and
an exact session, document, and revision match.
Later full-document replacement is limited to explicit Reload, Import, and
confirmed Template actions. Persistence acknowledgement/rejection, settings,
external file changes, and asset refreshes do not cross this boundary.

Save and export barriers capture a local generation and wait for its
acknowledgement while later input remains editable. External changes use the
shared non-modal banner and read-only metadata, document-settings, and block
comparison in
`shared/editor/externalChanges/`; no automatic refresh or merge is performed.
Conflict decisions use a shared accessible confirmation dialog. Keeping local
changes waits for the correlated acknowledgement, while cancellation or
failure preserves both the local draft and external-change notice. See
[ADR 0010](adr/0010-use-single-flight-document-mutations-and-explicit-replacement.md).

A later user save or export barrier may retry a transient write or transport
failure. Conflict and invalid-document errors never retry through that path;
they require explicit conflict recovery or source repair.
Flush requests and acknowledgements are owned by the exact editor session and
document, so disposal of one panel cannot settle another panel's save barrier.
An edit acknowledgement updates the host buffer only; a distinct monotonic,
identity-bound save event is required before the UI reports `Saved`. See
[ADR 0015](adr/0015-fail-closed-at-document-and-resource-boundaries.md) and
[ADR 0017](adr/0017-separate-editor-acknowledgement-from-disk-save.md).

### Conversion and settings

`shared/converter/` contains host-neutral import/export conversion.
`shared/settingsResolver.ts` owns defaults, caption presets, and
document-over-workspace setting resolution. Neither layer may access VS Code or
the filesystem.

Mermaid diagrams render locally. PlantUML, D2, and Graphviz rendering requires
first-use consent and is performed by the VS Code extension host with a bounded
in-memory cache; converters never access the network. Passive document opening
never prompts or transmits source. The host prepares validated image assets
through `shared/export/diagramPreparation.ts` for both single documents and
manifest-ordered book chapters. Rendering is deduplicated by language and
source while fallback reporting retains occurrence and chapter counts. A shared
abort signal spans diagram preparation, image embedding, and staged output
publication. The host renders only after authoritative global consent, while converters
preserve a source-only fallback when rendering is declined or unavailable.
Consent and renderer trust settings never enter `.sdoc` or `DocumentSettings`.
See [ADR 0011](adr/0011-use-opt-in-host-diagram-rendering.md),
[ADR 0012](adr/0012-use-first-use-consent-for-external-diagram-rendering.md),
and [ADR 0013](adr/0013-use-validated-per-language-diagram-images.md).

`shared/document/numbering.ts` is the single numbering index for editor
previews, lists, cross-references, and HTML, Markdown, AsciiDoc, and Slides
output. Export services flush the VS Code editor first and pass the current
in-memory document to shared converters. Full self-contained HTML/PDF export
loads KaTeX, Mermaid, and KaTeX fonts from `dist/export-assets` shipped in the
VSIX and performs no CDN fetch.

### Semantic document operations

`shared/document/operations/` is the host-neutral boundary for inspecting,
validating, and atomically applying versioned semantic operation batches.
Callers identify a document revision by SHA-256 of its exact bytes, including
any UTF-8 BOM. Persistent IDs target referenceable nodes; other mutable blocks
use a revision-scoped path, node type, and canonical subtree digest. Targets
are resolved before a batch starts, so an earlier insertion or move cannot
redirect a later operation.

Section operations use heading ranges in one parent content array. The core
normalizes through resolved document settings, validates schema and
reference/link/asset invariants, and returns a bounded semantic diff. Existing
invariant violations are tracked as a baseline multiset; a batch may not add or
increase them.

The additive `sdoc.read/1` projection contract provides bounded semantic reads
without changing the legacy inspector. A caller selects one catalog, one
complete target, an existing same-parent section range, or document content.
Catalog pages contain whole entries, while section and document pages contain
whole sibling or top-level subtrees; exact UTF-8 byte and node budgets never
split a subtree. Opaque checksum cursors bind the exact byte revision,
projection, query scope, and next index. They detect corruption but are not
authentication tokens. See
[ADR 0018](adr/0018-use-bounded-semantic-read-projections.md).

The `cli/` workspace is the filesystem delivery surface for this core. Its
`sdoc` executable previews mutations unless `--write` is supplied. A no-op does
not update `meta.modified` or write bytes. Writes acquire a sibling lock,
re-read and verify the byte revision inside the lock, then use a synced sibling
temporary file and atomic rename. The operations core itself performs no file
or network access. The CLI also creates documents from bundled or explicitly
named templates through the shared template core, using atomic no-replace
publication. Lock ownership is versioned. A same-host lock older than the
recovery threshold is reclaimed only when its PID is conclusively dead; live,
remote, legacy, malformed, and uncertain locks remain blocked. See
[ADR 0009](adr/0009-use-versioned-semantic-document-operations.md).

### Path and runtime boundaries

- Persisted assets use portable `./images/...` or `./drawio/...` paths; display
  URLs and hydration metadata are runtime-only.
- The VS Code host validates basename, extension, canonical containment, and
  symlink containment independently of the UI.
- Documents and imports are capped at 32 MiB. A local asset is capped at 32 MiB;
  self-contained export permits at most 1,024 references and 256 MiB of unique
  asset bytes, read with concurrency four. Custom CSS is capped at 1 MiB.
- Kroki DNS resolution and HTTP work share one absolute retryable deadline; the
  resolved address is validated before the connection is made.
- Watcher events include owner document, generation, and portable relative
  path; stale generations are ignored and duplicate events are coalesced.

## Delivery-surface responsibilities

### VS Code

- `src/SdocEditorProvider.ts`: editor lifecycle, TextDocument synchronization,
  and message routing
- `src/SdocBookProvider.ts`: Book webview orchestration, open-buffer loader,
  file watching, and export destination handling
- `src/services/VsCodeAssetService.ts`: image and Draw.io operations
- `src/services/VsCodeExportService.ts`: export orchestration
- `src/services/VsCodeTemplateService.ts`: workspace and personal template
  discovery, managed storage, create-new orchestration, and guarded template
  application
- `webview-ui/src/`: VS Code bridge, message handling, and shell composition

### CLI

- `cli/src/`: command parsing, filesystem boundaries, diagnostics, and package
  entry point
- `shared/document/operations/`: versioned semantic operation contracts and
  host-neutral application logic
- `cli/README.md`: public command, output, and exit-code contract

### Retired Desktop source

The `v0.7.8` tag records the final Desktop implementation. `tauri-app/` is not
present on `main` and must not be treated as a current delivery surface.
Changes after v0.7.8 do not require Tauri parity, Rust tests, Desktop packaging,
or Desktop release notes. Historical ADRs remain intact as records of the
constraints in effect when those versions were supported.

## Dependency rules

1. VS Code and CLI boundaries may depend on `shared/`; `shared/` must not import
   `vscode` or access host filesystems directly.
2. Persisted semantics live once in the TypeScript document core.
3. Template discovery and file creation belong to delivery surfaces; template
   parsing and instantiation belong to `shared/template/`.
4. Extension-host and webview differences cross typed adapters or component
   props, never ambient globals.
5. Reusable UI and structural CSS live in `shared/editor/`; webview integration
   styles only map the VS Code theme or shell behavior.
6. External JSON is accepted as `unknown` and narrowed at its boundary.

## Verification

- `npm run check`: version sync, design and generated-validator contracts,
  TypeScript, ESLint, and Vitest
- `npm run build:all`: VS Code extension, webview, and CLI builds
- `npm run package`: version-checked VSIX in `output/`
- `npm run package:cli`: installable CLI `.tgz` in `output/`

Rust and Tauri checks are not part of the v0.9.1 build contract.
