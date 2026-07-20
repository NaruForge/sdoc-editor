---
applyTo: "webview-ui/**,shared/editor/**"
---

# Editor webview

- `shared/editor/` is the canonical home of common React components, hooks, utilities, and Tiptap extensions.
- `webview-ui/` owns the VS Code adapter, VS Code theme styles, and webview composition.
- `tauri-app/` owns corresponding desktop adapters and shell behavior.
- Declare typed browser bridges in `types/globals.d.ts`; do not cast `window` to `any`.
- Do not define components inside component render functions.
- Generate time-based defaults in event handlers or state initializers, not during render.
- Lazy-load heavyweight optional renderers such as Mermaid.
