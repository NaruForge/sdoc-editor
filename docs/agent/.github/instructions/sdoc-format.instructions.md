---
description: "Use when editing, creating, or modifying .sdoc or .tiptap.json files. Covers the JSON envelope structure, node types, attribute conventions, marks, and cross-references for Structured Document format."
applyTo: "**/*.{sdoc,tiptap.json}"
---

# .sdoc File Format — AI Authoring Guide

`.sdoc` (and its alias `.tiptap.json`) is a JSON-based structured document format powered by a Tiptap/ProseMirror editor.
The file is saved as pretty-printed JSON and opened in a WYSIWYG custom editor. Both extensions use the identical format.

## Envelope Structure (REQUIRED)

Every `.sdoc` / `.tiptap.json` file MUST have this top-level structure:

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "Document Title",
    "author": "Author Name",
    "version": "1.0",
    "created": "2026-01-01T00:00:00.000Z",
    "modified": "2026-04-03T00:00:00.000Z"
  },
  "doc": {
    "type": "doc",
    "content": [ /* block nodes here */ ]
  }
}
```

- `sdoc` — Schema version. Always `"1.0"`.
- `meta` — Required. Fields: `title`, `author`, `version`, `created` (ISO 8601), `modified` (ISO 8601).
- `doc` — The Tiptap document tree. `type` is always `"doc"`, `content` is an array of block nodes.

## Block Node Types

### heading

```json
{ "type": "heading", "attrs": { "level": 2, "id": "my-heading", "textAlign": "left" }, "content": [ /* inline nodes */ ] }
```
- `level`: 1–6 (required)
- `id`: optional anchor for cross-references (auto-assigned on save, slugified from text)
- `textAlign`: optional `"left"` | `"center"` | `"right"` | `"justify"` | `null`

> **CRITICAL — DO NOT prefix heading text with numbers.**
> The editor automatically generates heading numbers (e.g., `1.`, `1.1`, `2.3.1`) via CSS counters based on the heading `level`.
> Writing `"1. Introduction"` or `"2.1 Overview"` in the text node will cause **double numbering** in the rendered document.
> Always write the bare title only: `"Introduction"`, `"Overview"`.

### paragraph

```json
{ "type": "paragraph", "attrs": { "textAlign": "left" }, "content": [ /* inline nodes */ ] }
```
- `textAlign`: optional `"left"` | `"center"` | `"right"` | `"justify"` | `null`

### bulletList / orderedList

```json
{
  "type": "bulletList",
  "content": [
    { "type": "listItem", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Item" } ] } ] }
  ]
}
```

`orderedList` supports optional attrs: `start` (integer), `type` (string).

### taskList

```json
{
  "type": "taskList",
  "content": [
    { "type": "taskItem", "attrs": { "checked": false }, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Todo" } ] } ] }
  ]
}
```

### codeBlock

```json
{ "type": "codeBlock", "attrs": { "language": "python" }, "content": [ { "type": "text", "text": "print('hello')" } ] }
```
- `language`: optional string (e.g., `"javascript"`, `"python"`, `"rust"`)

### table

```json
{
  "type": "table",
  "attrs": { "caption": "Comparison", "align": "center", "width": "100%", "id": "table-1" },
  "content": [
    {
      "type": "tableRow",
      "content": [
        { "type": "tableHeader", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Name" } ] } ] },
        { "type": "tableHeader", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Value" } ] } ] }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "A" } ] } ] },
        { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "1" } ] } ] }
      ]
    }
  ]
}
```
- `caption`: optional string
- `align`: `"left"` | `"center"` | `"right"` (default: `"left"`)
- `width`: CSS width string (default: `"100%"`)
- `id`: auto-assigned on save (`table-N`)
- Cells: `tableHeader` for header row, `tableCell` for data rows
- Cell attrs: `colspan`, `rowspan` (default 1), `colwidth` (optional array of integers)

### image

```json
{ "type": "image", "attrs": { "src": "./images/diagram.png", "alt": "Architecture", "caption": "System overview", "align": "center", "id": "figure-1" } }
```
- `src`: relative path from the document (e.g., `"./images/photo.png"`)
- `alt`: accessibility text
- `title`: tooltip (optional)
- `caption`: displayed below image (optional)
- `align`: `"left"` | `"center"` | `"right"` (default: `"center"`)
- `id`: auto-assigned on save (`figure-N`)

### mathBlock

```json
{ "type": "mathBlock", "attrs": { "latex": "E = mc^2" } }
```
- `latex`: LaTeX math expression rendered by KaTeX

> **CRITICAL — JSON backslash escaping for LaTeX:**
> JSON strings require `\` to be written as `\\`. Therefore every LaTeX command backslash must be doubled.
> - LaTeX `\frac` → JSON `"\\frac"` ✅
> - LaTeX `\omega` → JSON `"\\omega"` ✅
> - `\\\\frac` (quadruple) or `\\\frac` (triple) are **WRONG** ❌
>
> **Rule**: count the backslashes in your output JSON string. Every LaTeX `\` must appear as exactly **two** characters `\\` in the JSON source. Never one (`\`), never three (`\\\`).  
>
> Correct complex example:
> ```json
> { "type": "mathBlock", "attrs": { "latex": "G(s) = \\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}" } }
> ```
> The JSON string value above, when parsed, becomes the LaTeX: `G(s) = \frac{\omega_n^2}{s^2 + 2\zeta\omega_n s + \omega_n^2}`

### diagram

```json
{ "type": "diagram", "attrs": { "language": "mermaid", "code": "graph TD\n  A --> B" } }
```
- `language`: required — `"mermaid"`, `"plantuml"`, `"d2"`, `"graphviz"`, etc.
- `code`: required — diagram source code as a string

### hardBreak

```json
{ "type": "hardBreak" }
```

## Inline Node Types

### text

```json
{ "type": "text", "text": "Hello world" }
```

With marks:
```json
{ "type": "text", "text": "bold text", "marks": [ { "type": "bold" } ] }
```

### mathInline

```json
{ "type": "mathInline", "attrs": { "latex": "x^2 + y^2 = r^2" } }
```

## Mark Types

| Mark | Attrs | Example |
|---|---|---|
| `bold` | — | `{ "type": "bold" }` |
| `italic` | — | `{ "type": "italic" }` |
| `underline` | — | `{ "type": "underline" }` |
| `strike` | — | `{ "type": "strike" }` |
| `code` | — | `{ "type": "code" }` |
| `link` | `href`, `target`, `rel`, `class` | `{ "type": "link", "attrs": { "href": "https://example.com" } }` |
| `subscript` | — | `{ "type": "subscript" }` |
| `superscript` | — | `{ "type": "superscript" }` |
| `textStyle` | `color` | `{ "type": "textStyle", "attrs": { "color": "#ff0000" } }` |
| `highlight` | `color` | `{ "type": "highlight", "attrs": { "color": "#ffff00" } }` |

Multiple marks can be combined:
```json
{ "type": "text", "text": "important", "marks": [ { "type": "bold" }, { "type": "italic" } ] }
```

### Internal Cross-Reference Links

Use `link` mark with `href` starting with `#` to reference headings, figures, or tables:
```json
{ "type": "text", "text": "See Table 1", "marks": [ { "type": "link", "attrs": { "href": "#table-1" } } ] }
```

## Attribute Naming Convention

JSON attributes use **clean camelCase** — never `data-*` prefixes:

| ✅ Correct (JSON) | ❌ Wrong |
|---|---|
| `caption` | `data-caption` |
| `align` | `data-align` |
| `colwidth` | `data-colwidth` |

## Rules for AI Editing

1. **Always preserve the envelope**: Never output a bare `doc` node without the `sdoc`, `meta`, and `doc` wrapper.
2. **Update `modified`**: Set `meta.modified` to the current ISO 8601 timestamp when editing content.
3. **Do not invent node types**: Only use the types listed above.
4. **Pretty-print JSON**: Use 2-space indentation for Git-friendly diffs.
5. **Relative image paths**: Use `./images/filename.png` style paths for `src`.
6. **Block nodes only at top level**: `doc.content` only contains block nodes, never inline nodes directly.
7. **Paragraphs wrap inline content**: Text inside `listItem`, `tableCell`, and `tableHeader` must be wrapped in a `paragraph` node.
8. **Empty content**: An empty paragraph is `{ "type": "paragraph" }` (no `content` key), not `{ "type": "paragraph", "content": [] }`.
