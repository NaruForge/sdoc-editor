# Architecture

## Overview

Structured Doc Editor is one editor product presented through two hosts. A document must have the same persisted meaning, editor behavior, and conversion result in VS Code and the Windows desktop app.

```text
VS Code extension ─┐
                   ├─ typed host bridge ─ shared/editor
Tauri desktop ─────┘                       │
                                           ├─ shared/document
                                           ├─ shared/template
                                           ├─ shared/book
                                           ├─ shared/settingsResolver
                                           └─ shared/converter
                                                    │
                                                  .sdoc
```

## Source-of-truth layers

### Document contract

- `sdoc.schema.json` defines the persisted envelope.
- `shared/types.ts` defines TypeScript document and settings types.
- `shared/document/sdocUtils.ts` owns migration, cleanup, ID assignment, title extraction, cross-reference synchronization, and normalization.
- `tests/fixtures/document-contract.json` protects legacy and current behavior across TypeScript and Rust tests.
- `shared/document/documentContract.ts` narrows external JSON, rejects unsupported versions, and validates persisted output with AJV.
- `shared/document/runtimeAssets.ts` separates host hydration from portable persistence dehydration.
- Save protocols carry document identity, base revision, edit identity, and acknowledgement; hosts reject stale or cross-document writes.

Rust reads and writes the envelope but deliberately does not reproduce document semantics. The Tauri frontend runs the same TypeScript migration and normalization used by the VS Code host.

### Document templates

`shared/template/` owns built-in template data, untrusted template metadata narrowing, catalog diagnostics, and immutable template instantiation. A template is a schema-valid `.sdoc` envelope; creating a document removes template-only metadata, refreshes document metadata, optionally updates an explicitly identified title heading, and preserves settings, IDs, and links.

Hosts discover workspace templates only from the non-recursive `.sdoc/templates/*.sdoc` boundary. They enforce canonical containment, symlink containment, size and count limits, present host-native selection UI, flush the active editor, and create a new file without overwriting an existing target. In VS Code, zero-byte documents are represented as an editable in-memory blank document without writing on open; the capability-gated shared template panel applies a selected catalog snapshot to the current document only after confirmation, exact identity/revision/text revalidation, and one full-document `WorkspaceEdit`. Rust validates and stores the envelope produced by the shared TypeScript core but does not create template document semantics.

### Book composition

`shared/book/` is the host-neutral `.sdocbook` boundary. It parses untrusted manifests, normalizes project-relative paths, loads chapters through an injected `BookDocumentLoader`, composes one document tree, and returns structured diagnostics. Preview and export consumers must use this result instead of independently merging files. The VS Code provider supplies open-buffer and filesystem access; a future Tauri host can supply its own loader without copying composition rules.

Chapter loading is parallel while results and diagnostics remain in manifest order. Each valid chapter receives a deterministic invisible export anchor. Loaders accept cancellation, and host watchers subscribe only to current includes.

### Editor UI

`shared/editor/` owns reusable React components, editor context, hooks, Tiptap extensions, extension runtime callbacks, constants, and structural CSS. NodeViews receive `EditorExtensionRuntime` explicitly; they do not communicate through `window.__*` globals.

The host-neutral `EditorHostBridge` and the discriminated unions in `shared/types/messages.ts` define host communication. JSON entering the VS Code webview boundary is narrowed with runtime message guards before use.

### Conversion and settings

`shared/converter/` contains host-neutral import/export conversion. `shared/settingsResolver.ts` owns defaults, caption presets, and document-over-workspace setting resolution. Neither layer may access VS Code, Tauri, or the filesystem.

`shared/document/numbering.ts` is the single numbering index for editor previews, lists, cross-references, and HTML, Markdown, AsciiDoc, and Slides output. Export services flush host editors first and pass current in-memory documents to shared converters.

### Path and runtime boundaries

- Persisted assets use portable `./images/...` or `./drawio/...` paths; display URLs and hydration metadata are runtime-only.
- Hosts validate basename, extension, canonical containment, and symlink containment independently of the UI.
- Tauri grants asset protocol access only after resolving a validated document-relative asset.
- Watcher events include owner document, generation, and portable relative path; stale generations are ignored and duplicate events are coalesced.

## Host responsibilities

### VS Code

- `src/SdocEditorProvider.ts`: editor lifecycle, TextDocument synchronization, and message routing
- `src/SdocBookProvider.ts`: Book webview orchestration, open-buffer loader, file watching, and export destination handling
- `src/services/VsCodeAssetService.ts`: image and Draw.io operations
- `src/services/VsCodeExportService.ts`: export orchestration
- `src/services/VsCodeTemplateService.ts`: workspace template discovery, create-new orchestration, and guarded current-document template application
- `webview-ui/src/`: VS Code bridge, message handling, and VS Code-specific shell composition

### Tauri

- `tauri-app/src/`: desktop shell, workspace explorer, Tauri bridge, and desktop export service
- `tauri-app/src-tauri/src/commands.rs`: document command state and module exports
- `tauri-app/src-tauri/src/commands/`: asset, workspace, watcher, settings, and file-I/O command modules
- `tauri-app/src-tauri/src/document.rs`: envelope transport and contract-fixture tests

## Dependency rules

1. Hosts may depend on `shared/`; `shared/` must not import `vscode` or `@tauri-apps/*`.
2. Persisted semantics live once in the TypeScript document core.
3. Template discovery and file creation belong to hosts; template parsing and instantiation belong to `shared/template/`.
4. Host differences cross typed adapters or component props, never ambient globals.
5. Common UI and structural CSS live in `shared/editor/`; host styles only override theme or shell behavior.
6. External JSON is accepted as `unknown` and narrowed at its boundary.

## Verification

- `npm run check`: version sync, TypeScript, ESLint, and Vitest contracts
- `npm run build:all`: VS Code extension, webview, and Tauri frontend builds
- Cargo fmt, Clippy with warnings denied, and Cargo tests: native host verification
- `npm run package`: version-checked VSIX in `output/`
