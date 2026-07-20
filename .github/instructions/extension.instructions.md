---
applyTo: "src/**,shared/document/**,esbuild.mjs"
---

# VS Code extension

- `src/` owns VS Code APIs, TextDocument integration, commands, webview CSP, and host messaging.
- Read setting defaults through `shared/settingsResolver.ts`; do not reproduce default objects in providers or commands.
- Extension ↔ webview messages use the unions in `shared/types/messages.ts`.
- Keep synchronous filesystem work out of normal extension-host paths.
