# ADR 0002: Share editor code between hosts

- Status: Accepted
- Date: 2026-07-20

## Context

The VS Code webview and Tauri frontend evolved as copied React trees. Many files were byte-for-byte identical, while instructions required manual synchronization after each change.

## Decision

Move host-neutral React components, hooks, utilities, and Tiptap extensions into `shared/editor/`. Each host retains adapters and behavior that genuinely depends on its runtime.

## Consequences

Common fixes are made once. Host-specific behavior must be expressed through typed adapters or component props. The temporary host re-export modules used during migration have been removed; host code imports shared implementations directly.
