---
applyTo: "src/**,shared/**"
---

# Extension Host & MCP Server

## Extension Side (`src/`)

- `SdocEditorProvider` handles file I/O, envelope wrap/unwrap, URI conversion.
- `unwrapSdoc()` auto-migrates legacy files (bare `{ "type": "doc" }`) and legacy `data-*` attributes.
- Export commands (`src/commands/`) must unwrap the envelope before converting.
- Settings are read from `vscode.workspace.getConfiguration('structuredDocEditor')`.
- `setupAgent()` copies Instructions/Skills from bundled `docs/agent/.github/` to workspace and writes `.vscode/mcp.json`.
- `updateChecker.ts` checks `structuredDocEditor.update.sharedFolder` for newer VSIX versions.
- CSP in `SdocEditorProvider` includes `${webview.cspSource}` in `script-src` for dynamic imports.

## MCP Server (`src/mcp/server.ts`)

- Separate esbuild entry point → `dist/mcp-server.js`.
- Uses `@modelcontextprotocol/sdk` + `zod` for type-safe tool definitions.
- Tool implementations live in `shared/mcp/toolHandlers.ts`.
- Tools: `sdoc_validate`, `sdoc_create`, `sdoc_export`, `sdoc_import`, `sdoc_getSchema`, `sdoc_assignIds`, `sdoc_syncRefs`, `sdoc_migrate`, `sdoc_query`.
- Resource: `sdoc://schema` — provides the JSON schema.

## VS Code Settings

All settings live under `structuredDocEditor.*`:

- `caption.imagePrefix` / `caption.tablePrefix` — caption label text
- `caption.numbering` — `simple` or `hierarchical`
- `heading.numbering` — boolean (auto heading numbering)
- `heading.decoration` — boolean (H1 border-bottom decoration)
- `heading.h1Color` / `heading.h2Color` / `heading.h3Color` — hex color for heading numbering
- `image.defaultAlignment` — `left`, `center`, `right`
- `export.selfContained` — `none`, `images-only` (default), `full`
- `export.imagePath` — `relative`, `absolute` (used when selfContained is `none`)
- `theme.companyLogo` — company logo URL for HTML export
- `theme.companyName` — company name for HTML export
- `theme.primaryColor` / `theme.accentColor` — HTML export theme colors
- `theme.fontFamily` — HTML export font
- `theme.customStyles` — custom CSS for HTML export
- `update.sharedFolder` — shared folder path for auto-update

## VS Code Commands

| Command | Description |
|---|---|
| `structuredDocEditor.exportToHtml` | Export to HTML (self-contained with base64 images) |
| `structuredDocEditor.exportToAdoc` | Export to AsciiDoc |
| `structuredDocEditor.exportToMarkdown` | Export to Markdown |
| `structuredDocEditor.exportToPdf` | Export to PDF (via system Chrome/Edge headless) |
| `structuredDocEditor.setupAgent` | Setup AI Agent (Instructions + Skills + MCP) |

## Metadata Management

- Author is managed **in-editor** via `DocumentHeader`, NOT in VS Code settings.
- Version defaults to `0.1` for new documents. Editable in DocumentHeader.
- `updateMeta` message from webview updates the envelope's `meta`.
- `metaUpdate` message from provider sends current metadata to webview on init.
- Title is auto-extracted from the first H1 heading on every save.
- Dates (`created`, `modified`) are managed automatically by `SdocEditorProvider`.

## Build System

- **esbuild.mjs**: Two entry points — `src/extension.ts` → `dist/extension.js`, `src/mcp/server.ts` → `dist/mcp-server.js`.
- **Webview**: Vite build, output to `dist/webview/`.
- **npm workspaces**: Root `package.json` has `workspaces: ["webview-ui"]`.
- **VSIX packaging**: `scripts/postpackage.mjs` or `build-vsix.ps1`/`build-vsix.sh`.
- **Tauri build**: `build-tauri-app.ps1` (Windows PowerShell, requires Rust + Node on Windows).
