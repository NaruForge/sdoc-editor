# ADR 0004: Use typed editor host bridges

- Status: Accepted
- Date: 2026-07-20

## Context

Vanilla NodeViews communicated with React and the hosts through mutable `window.__*` callbacks and a globally exposed `window.vscode` object. Tauri messages accepted arbitrary records, allowing unsupported or malformed messages to bypass compile-time checks.

## Decision

Define host-neutral message unions and an `EditorHostBridge` in `shared/`. Inject an `EditorExtensionRuntime` when constructing Tiptap extensions. Narrow JSON messages at the webview boundary before dispatch.

## Consequences

Shared editor code cannot call host APIs or ambient editor globals. Adding a host operation requires updating the typed protocol and every adapter, making capability gaps visible during development.
