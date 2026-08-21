---
applyTo: "shared/converter/**,src/commands/**"
---

# Converters

- Follow the converter ownership and dependency rules in `docs/architecture.md`;
  `npm run repo:check` enforces the current direct host API and cross-surface
  import boundaries.
- Reuse `TiptapNode`, document metadata, and settings types from `shared/types.ts`.
- Pass counters and settings through a context object; do not use mutable module state.
- A new persisted node or mark requires converter coverage and round-trip fixtures.
- Host commands unwrap the `.sdoc` envelope and perform file or UI operations around the converter.
