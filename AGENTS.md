# Structured Doc Editor — Agent Guide

## Product

Structured Doc Editor edits `.sdoc` and `.tiptap.json` documents in two hosts:

- VS Code extension: `src/` with the React webview in `webview-ui/`
- Windows desktop app: `tauri-app/` with a Rust/Tauri host

The document model, converters, settings, and host-neutral utilities belong in `shared/`. Host APIs such as `vscode` and `@tauri-apps/*` must not enter shared modules.

## Source of truth

- `sdoc.schema.json`: persisted `.sdoc` document contract
- `shared/types.ts`: TypeScript document and settings types
- `shared/settingsResolver.ts`: defaults and settings resolution
- `shared/converter/`: all import/export conversion
- `shared/editor/`: UI and Tiptap code shared by both hosts
- `docs/architecture.md`: current architecture
- `docs/adr/`: durable architectural decisions; newer ADRs may supersede older ones

Do not create a repository-local task database. Use the issue tracker for planned work and Git history for completed work.

## Required commands

Run from the repository root:

```powershell
npm ci
npm run check
npm run build:all
```

For Rust changes also run:

```powershell
cargo fmt --manifest-path tauri-app/Cargo.toml --all -- --check
cargo clippy --manifest-path tauri-app/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path tauri-app/Cargo.toml --workspace
```

## Change rules

1. Preserve unrelated working-tree changes.
2. Add behavior tests before changing migration, ID assignment, cross-references, or converters.
3. Add common editor behavior to `shared/editor/`, not separately to both hosts.
4. Keep host differences behind adapters or host-level components.
5. Parse external JSON as `unknown` and validate or narrow it at the boundary.
6. Do not add new `any`, untyped `window` globals, synchronous extension-host I/O, or copied defaults.
7. Update schemas, examples, tests, MCP authoring guidance, and converters when the persisted document format changes.
8. Keep user documentation in `README.md`, contributor workflow in `CONTRIBUTING.md`, and implementation detail in `docs/`.

## Packaging

- `npm run package` creates the VSIX and `version.json` in `output/`.
- `npm run build:desktop` builds the Tauri frontend only.
- Native installers are built through Tauri after the frontend and Rust checks pass.
- Versions are synchronized by `npm run version:check`.
