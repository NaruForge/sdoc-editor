# Structured Doc Editor — Copilot Instructions

## Project Overview

This is a VS Code custom editor extension for `.sdoc` (Structured Document) files.
It provides a WYSIWYG editor backed by Tiptap/ProseMirror, targeting use as an
organization-wide standard document format.

## .sdoc File Format Rules (CRITICAL)

### Envelope Structure (v1.0)

Every `.sdoc` file MUST follow this envelope:

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "...",
    "author": "...",
    "created": "ISO 8601",
    "modified": "ISO 8601"
  },
  "doc": {
    "type": "doc",
    "content": [ ... ]
  }
}
```

- `sdoc` — **Required**. Schema version string.
- `meta` — **Required**. Must include `title`, `author`, `created`, `modified`.
- `doc` — **Required**. The Tiptap document tree.
- The authoritative schema is defined in `sdoc.schema.json` at the project root.

### Attribute Naming Convention

JSON attribute names MUST use **clean camelCase** — never HTML `data-*` prefixes.

| ✅ Correct (JSON) | ❌ Forbidden (JSON) | HTML DOM attribute |
|---|---|---|
| `caption` | `data-caption` | `data-caption` |
| `align` | `data-align` | `data-align` |
| `width` | `data-width` | `data-width` |

- Tiptap `addAttributes()` defines clean names (`caption`, `align`, `width`).
- `parseHTML` reads from `data-*` DOM attributes.
- `renderHTML` writes to `data-*` DOM attributes.
- The JSON serialization always uses the clean names.

### Backward Compatibility

- `SdocEditorProvider.unwrapSdoc()` auto-migrates legacy files (bare `{ "type": "doc" }` without envelope) and legacy attribute names (`data-caption` → `caption`).
- When adding new attributes, always include migration logic in `migrateAttributes()`.

### Node Types

Supported node types (see `sdoc.schema.json` for full definition):

| Node Type | Category | Key Attributes |
|---|---|---|
| `heading` | Block | `level` (1–6) |
| `paragraph` | Block | — |
| `bulletList` | Block | — |
| `orderedList` | Block | `start`, `type` |
| `listItem` | Block | — |
| `codeBlock` | Block | `language` |
| `table` | Block | `caption`, `align`, `width` |
| `image` | Block | `src`, `alt`, `title`, `caption`, `align` |
| `mathBlock` | Block | `latex` |
| `mathInline` | Inline | `latex` |
| `text` | Inline | `text`, `marks[]` |
| `hardBreak` | Inline | — |

### Mark Types

`bold`, `italic`, `underline`, `strike`, `code`, `link` (with `href`).

## Architecture Rules

### Extension Side (`src/`)

- `SdocEditorProvider` handles file I/O, envelope wrap/unwrap, URI conversion.
- Converters (`src/converter/`) transform the `doc` tree — never the envelope.
- Export commands (`src/commands/`) must unwrap the envelope before converting.
- Settings are read from `vscode.workspace.getConfiguration('structuredDocEditor')`.

### Webview Side (`webview-ui/`)

- The webview receives and sends **only the `doc` tree** — it never sees the envelope or metadata.
- `EditorContext` holds the document state and user settings.
- Global `window.__editorSettings` exposes settings for non-React NodeViews.
- `window.__editorFlushUpdate()` forces immediate save (bypass debounce).

### Custom NodeViews (CustomImage, CustomTable)

- These are vanilla DOM NodeViews (not React) for performance.
- HTML DOM attributes use `data-*` prefix; JSON attributes use clean names.
- Caption editing is inline (click → input → Enter/blur to save).
- Always call `__editorFlushUpdate()` after programmatic attribute changes.

### CSS Conventions

- Caption prefixes use CSS custom properties: `--image-caption-prefix`, `--table-caption-prefix`.
- Numbering classes: `.simple-numbering`, `.hierarchical-numbering`.
- Heading numbering: `.show-numbering`, `.hide-numbering`.
- Image alignment: `[data-align="left|center|right"]` on `.image-node-wrapper`.

### Adding New Node Types (Checklist)

1. Define the Tiptap extension in `webview-ui/src/extensions/`.
2. Register it in `tiptapExtensions.ts`.
3. Add conversion logic in all 3 converters (HTML, AsciiDoc, Markdown).
4. Update `sdoc.schema.json` with the new node definition.
5. Use clean attribute names (no `data-*` prefix in JSON).
6. Add migration logic in `SdocEditorProvider.migrateAttributes()` if renaming.

### VS Code Settings Namespace

All settings live under `structuredDocEditor.*`:

- `document.defaultAuthor` — default author name for new documents
- `caption.imagePrefix` / `caption.tablePrefix` — caption label text
- `caption.numbering` — `simple` or `hierarchical`
- `heading.numbering` — boolean
- `image.defaultAlignment` — `left`, `center`, `right`
- `export.imagePath` — `relative`, `absolute`
- `theme.*` — HTML export theming

### Context Menus

- All floating menus must check viewport bounds and reposition to avoid clipping.
- Use `useRef` + `useEffect` to measure and adjust after render.

## Code Style

- TypeScript strict mode.
- Prefer `const` over `let`.
- No `any` types at module boundaries (internal helpers may use `any` for Tiptap node traversal).
- File naming: PascalCase for components/extensions, camelCase for utilities/hooks.
- No unnecessary comments — code should be self-documenting.
