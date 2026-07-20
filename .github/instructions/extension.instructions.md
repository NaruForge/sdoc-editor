---
applyTo: "src/**,shared/mcp/**,esbuild.mjs"
---

# VS Code extension and MCP

- `src/` owns VS Code APIs, TextDocument integration, commands, webview CSP, and host messaging.
- `src/mcp/server.ts` is a separate esbuild entry point; tool behavior belongs in `shared/mcp/`.
- `setupAgent()` installs the bundled format instructions and registers `dist/mcp-server.js` in `.github/mcp.json`. It also removes a matching legacy `.vscode/mcp.json` entry.
- Read setting defaults through `shared/settingsResolver.ts`; do not reproduce default objects in providers or commands.
- Extension ↔ webview messages use the unions in `shared/types/messages.ts`.
- Keep synchronous filesystem work out of normal extension-host paths.
