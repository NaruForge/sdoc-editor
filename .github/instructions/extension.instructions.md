---
applyTo: "src/**,shared/document/**,esbuild.mjs"
---

# VS Code extension

- `src/` owns VS Code APIs, TextDocument integration, commands, webview CSP, and host messaging.
- Follow the settings ownership and asynchronous host-I/O contracts in
  `docs/architecture.md#dependency-rules`.
- Extension ↔ webview messages use the unions in `shared/types/messages.ts`.
