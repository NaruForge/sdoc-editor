---
applyTo: "tauri-app/**"
---

# Tauri desktop host

- `tauri-app/src/` owns the desktop shell, Tauri adapters, and desktop-only UI.
- Host-neutral editor code belongs in `shared/editor/` and is re-exported locally only for stable imports.
- `tauri-app/src-tauri/` owns native file operations, settings, watchers, and packaging.
- Keep JavaScript package versions aligned through the root npm workspace.
- Document-format changes require equivalent TypeScript and Rust contract tests.
- Verify frontend changes with `npm run build:desktop`; verify Rust with fmt, clippy, and tests from `AGENTS.md`.
