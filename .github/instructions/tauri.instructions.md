---
applyTo: "tauri-app/**"
---

# Tauri Desktop App

## Architecture

- Mirrors `webview-ui/` structure: same components, extensions, hooks, styles.
- Uses `tauri-app/src/adapters/tauriMessaging.ts` instead of VS Code messaging.
- Has its own `package.json` and `node_modules` (mermaid installed separately).
- Rust backend in `src-tauri/` handles file I/O, settings persistence, window management.

## Sync Rules

When editor features change in `webview-ui/`, the same changes must be applied here:
- **Extensions**: Copy modified files from `webview-ui/src/extensions/` → `tauri-app/src/extensions/`.
- **Components**: Copy modified components and adapt imports (messaging adapter).
- **tiptapExtensions.ts**: Keep the extension registration list in sync.
- **Styles**: `tauri-theme.css` mirrors `vscode-theme.css` but uses standalone CSS variables (no `--vscode-*` prefix).

## Key Differences from webview-ui

| Aspect | webview-ui | tauri-app |
|---|---|---|
| Messaging | `useVSCodeMessaging` + `vscode.postMessage` | `tauriMessaging.ts` + Tauri invoke |
| CSS variables | `--vscode-editor-*` | standalone equivalents |
| File I/O | VS Code extension host | Rust backend (`commands.rs`) |
| Build | Vite → `dist/webview/` | Vite + `cargo tauri build` |

## Build

- **Script**: `build-tauri-app.ps1` (Windows PowerShell).
- Requires: Node.js + npm (Windows native), Rust toolchain.
- Output: `.msi` installer in `src-tauri/target/release/bundle/`.
