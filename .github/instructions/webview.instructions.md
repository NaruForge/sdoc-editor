---
applyTo: "webview-ui/**"
---

# Webview Editor (React + Tiptap)

## Architecture

- The webview receives the `doc` tree for editing and `meta` object for display.
- `DocumentHeader` component displays metadata (title, author, dates) above the editor.
- Author and version are editable inline; title is auto-synced from H1; dates are auto-managed.
- `EditorContext` holds the document state and user settings.
- Global `window.__editorSettings` exposes settings for non-React NodeViews.
- `window.__editorFlushUpdate()` forces immediate save (bypass debounce).

## Tiptap Extensions (`webview-ui/src/extensions/`)

| Extension | Type | Description |
|---|---|---|
| `CustomImage` | NodeView (vanilla DOM) | Image with caption, alignment, context menu |
| `CustomTable` | NodeView (vanilla DOM) | Table with caption, properties modal |
| `DiagramBlock` | NodeView (vanilla DOM) | Mermaid diagram rendering + click-to-edit |
| `CodeBlockView` | NodeView (React) | Syntax-highlighted code block |
| `MathBlock` / `MathInline` | Node | KaTeX rendering |
| `CrossReference` | Plugin | `@` trigger → suggestion popup → link insertion |
| `SectionFold` | Plugin (in tiptapExtensions.ts) | Heading fold/unfold toggle |
| `HeadingKeyboardShortcuts` | Plugin (in tiptapExtensions.ts) | Tab/Shift-Tab to adjust heading level |
| `internalLinkClick` | Plugin (in tiptapExtensions.ts) | Click internal `#` links to scroll |

## Custom NodeViews (CustomImage, CustomTable, DiagramBlock)

- These are vanilla DOM NodeViews (not React) for performance.
- HTML DOM attributes use `data-*` prefix; JSON attributes use clean names.
- Caption editing is inline (click → input → Enter/blur to save).
- DiagramBlock uses `mermaid` npm package for live SVG rendering.
- NodeViews call global `__showDiagramDialog()` / `__showImageProperties()` / `__showImageContextMenu()` to trigger React dialogs from vanilla DOM.
- Always call `__editorFlushUpdate()` after programmatic attribute changes.

## Diagram Support (Mermaid)

- `DiagramBlock` extension renders Mermaid SVG live in the editor.
- `DiagramDialog` provides a split-pane code editor with live preview and 6 preset templates.
- The node uses `{ type: "diagram", attrs: { language: "mermaid", code: "..." } }`.
- The `language` field is extensible for future plantuml/d2/graphviz support.

## Cross-References

- Headings, images, and tables auto-receive an `id` attribute on save (`assignAutoIds()`).
- Heading ids are slugified from text; images get `figure-N`; tables get `table-N`.
- Users type `@` in the editor to trigger a suggestion popup listing all referenceable targets.
- Selecting a target inserts a `link` mark with `href="#target-id"` and the target's label as text.
- On save, `syncCrossReferences()` updates all internal link texts to match current numbering.
- Internal links (`href` starting with `#`) render as styled chips via CSS.
- Clicking internal links scrolls to the target via the `internalLinkClick` plugin.

## Section Fold

- `SectionFold` plugin in `tiptapExtensions.ts` adds fold/unfold toggle next to headings.
- Toggling hides all content between the heading and the next same-or-higher-level heading.
- Uses ProseMirror decorations: `.fold-toggle` button and `.section-collapsed` content hiding.

## Table of Contents

- `TableOfContents` component renders a sidebar with heading entries.
- Position-based navigation (`pos`) — clicking scrolls editor to the heading node.
- Supports hierarchical numbering when `showNumbering` is enabled.
- Toggle via toolbar TOC button.

## Context Menus

- All floating menus must check viewport bounds and reposition to avoid clipping.
- Use `useRef` + `useEffect` to measure and adjust after render.
- Image context menu: right-click on image → properties, replace, copy path, delete.
- Table context menu: right-click in table → row/column operations, properties.
- Editor context menu: right-click in editor → insert image, drawio, equation, etc.

## CSS Conventions

- Caption prefixes: `--image-caption-prefix`, `--table-caption-prefix`.
- Numbering: `.simple-numbering`, `.hierarchical-numbering`.
- Heading numbering: `.show-numbering`, `.hide-numbering`.
- Heading decoration: `.show-heading-decoration`, colors via `--heading-h1-color`, `--heading-h2-color`, `--heading-h3-color`.
- Image alignment: `[data-align="left|center|right"]` on `.image-node-wrapper`.
- Diagram blocks: `.diagram-block`, `.diagram-rendered`, `.diagram-error`, `.diagram-language-badge`.
- Section fold: `.fold-toggle`, `.section-collapsed`.
- Table of Contents: `.toc-panel`, `.toc-nav`, `.toc-entry`, `.toc-level-*`, `.toc-active`.
- Task lists: `ul[data-type="taskList"]`, `li[data-checked]`.
- Cross-reference: `.crossref-popup`, `.crossref-dialog`.
- Internal link chips: `a[href^="#"]` with special chip styling.
- Editor layout: `.editor-body-layout`, `.editor-body-with-toc`, `.editor-content-area`.
