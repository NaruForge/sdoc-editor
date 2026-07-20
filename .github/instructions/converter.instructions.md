---
applyTo: "shared/converter/**,src/commands/**"
---

# Converters

- `shared/converter/` is the only converter implementation.
- Converters are pure TypeScript and must not import `vscode`, Tauri APIs, or filesystem APIs.
- Reuse `TiptapNode`, document metadata, and settings types from `shared/types.ts`.
- Pass counters and settings through a context object; do not use mutable module state.
- A new persisted node or mark requires converter coverage and round-trip fixtures.
- Host commands unwrap the `.sdoc` envelope and perform file or UI operations around the converter.
