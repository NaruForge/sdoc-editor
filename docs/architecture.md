# Architecture

## Overview

Structured Doc Editor has one editor product presented through two hosts. Both hosts consume the same persisted document contract and as much common editor code as possible.

```text
VS Code host ─┐
              ├─ shared/editor ─ shared/document + converters ─ .sdoc
Tauri host ───┘
```

## Layers

### Document core

`shared/types.ts`, `shared/document/sdocUtils.ts`, and `sdoc.schema.json` define the persisted envelope, Tiptap node tree, migrations, generated IDs, and cross-reference behavior. External JSON is validated or narrowed at this boundary.

### Conversion

`shared/converter/` contains pure TypeScript converters. Converters receive a document tree and options; they do not access VS Code, Tauri, the filesystem, or mutable module-level state.

### Editor UI

`shared/editor/` contains host-neutral React components, hooks, and Tiptap extensions. `webview-ui/` and `tauri-app/` keep only host adapters, host shells, styles, and genuinely different behavior.

### Hosts

The VS Code extension owns TextDocument integration, webview security, VS Code commands, and VSIX packaging. Tauri owns native file operations, settings persistence, workspace watching, and desktop packaging.

## Dependency direction

Host code may depend on shared code. Shared code must never depend on a host. Rust and TypeScript implementations share contract fixtures rather than duplicating undocumented behavior.

## Verification boundaries

- Unit tests protect migrations, IDs, references, and converters.
- Type checking and ESLint protect TypeScript and React code.
- Cargo fmt, clippy, and tests protect the native host.
- CI builds both frontends and packages a VSIX smoke artifact.
