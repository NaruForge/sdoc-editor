# Structured Doc Editor — Copilot Instructions

## Communication

- **All conversations with the user MUST be in Korean (한글).**

## Project Overview

VS Code custom editor extension for `.sdoc` and `.tiptap.json` (Structured Document) files.
WYSIWYG editor backed by Tiptap/ProseMirror. Two deployment targets share the same editor code:
- **VS Code extension** (`webview-ui/`) — custom editor webview
- **Tauri desktop app** (`tauri-app/`) — standalone Windows application

Changes to editor features must be synchronized to both targets.

## .sdoc / .tiptap.json File Format Rules (CRITICAL)

Both `.sdoc` and `.tiptap.json` use the **identical JSON format**, treated interchangeably.

### Envelope (v1.0)

```json
{
  "sdoc": "1.0",
  "meta": { "title": "", "author": "", "version": "1.0", "created": "ISO 8601", "modified": "ISO 8601" },
  "doc": { "type": "doc", "content": [ ... ] }
}
```

All three top-level keys are **required**. Schema: `sdoc.schema.json`.

### Attribute Naming

JSON attributes use **clean camelCase** (e.g. `caption`, `align`). Never `data-*` in JSON.
- `addAttributes()` → clean names; `parseHTML` / `renderHTML` → `data-*` DOM attributes.
- `SdocEditorProvider.migrateAttributes()` handles legacy `data-*` → clean name migration.

### Node Types

| Node | Category | Key Attributes |
|---|---|---|
| `heading` | Block | `level` (1–6), `id`, `textAlign` |
| `paragraph` | Block | `textAlign` |
| `bulletList`, `orderedList` | Block | `start`, `type` (ordered only) |
| `listItem` | Block | — |
| `taskList` | Block | — |
| `taskItem` | Block | `checked` |
| `codeBlock` | Block | `language` |
| `table` | Block | `id`, `caption`, `align`, `width` |
| `tableRow`, `tableCell`, `tableHeader` | Internal | `colspan`, `rowspan`, `colwidth` |
| `image` | Block | `src`, `alt`, `title`, `caption`, `align`, `id` |
| `diagram` | Block | `language` (mermaid/plantuml/d2/graphviz), `code` |
| `mathBlock` | Block | `latex` |
| `mathInline` | Inline | `latex` |
| `text` | Inline | `text`, `marks[]` |
| `hardBreak` | Inline | — |

### Mark Types

`bold`, `italic`, `underline`, `strike`, `code`, `link` (`href`), `textStyle` (color), `highlight` (bg color), `subscript`, `superscript`.

## Project Structure

```
src/                     # VS Code extension host
  extension.ts           # Entry point
  SdocEditorProvider.ts  # Custom editor: file I/O, envelope, URI
  commands/              # Export commands
  converter/             # VS Code-specific converters
  mcp/server.ts          # MCP server (separate esbuild entry)
shared/                  # Shared code (no vscode dependency)
  converter/             # Pure TS converters (MCP + Tauri)
  mcp/                   # MCP tool handlers + sdoc utilities
webview-ui/              # VS Code webview (React + Tiptap)
tauri-app/               # Standalone desktop app (mirrors webview-ui)
docs/agent/              # AI Agent templates (copied via setupAgent)
```

## Cross-Cutting Rules

### Dual Converter Architecture

- **`src/converter/`** — VS Code extension (may use `vscode` API).
- **`shared/converter/`** — MCP server + Tauri (pure TS).

Both must stay in sync. When adding a node type, update **both** sets (8 files total).

### Adding New Node Types (Checklist)

1. Define Tiptap extension in `webview-ui/src/extensions/`.
2. Register in `tiptapExtensions.ts`.
3. Add to **all 8 converter files** (`src/converter/` + `shared/converter/`).
4. Update `sdoc.schema.json`.
5. Clean attribute names only (no `data-*` in JSON).
6. Migration logic in `migrateAttributes()` if renaming.
7. Copy to `tauri-app/src/extensions/` and update its `tiptapExtensions.ts`.
8. Styles in both `vscode-theme.css` and `tauri-theme.css`.

## Code Style

- TypeScript strict mode. Prefer `const` over `let`.
- No `any` at module boundaries (internal helpers may use `any` for Tiptap node traversal).
- PascalCase for components/extensions, camelCase for utilities/hooks.
- No unnecessary comments — code should be self-documenting.

## AI Task Tracking

이 프로젝트는 AI Task Standard(ATS) v0.1을 사용합니다. `.ai/STATUS.md`를 읽고 관련 태스크를 참조하세요.
