---
name: sdoc-editing
description: "Create, edit, and manage .sdoc/.tiptap.json structured documents. Use when: writing technical documents, inserting math equations, building tables with captions, adding images, creating cross-references, importing from Markdown, or understanding .sdoc format conventions."
argument-hint: "Describe what you want to create or edit in the .sdoc document"
---

# .sdoc Document Editing Skill

This skill helps you author and edit `.sdoc` / `.tiptap.json` (Structured Document) files — a JSON-based document format with WYSIWYG editing backed by Tiptap/ProseMirror. Both file extensions use the identical format.

## When to Use

- Creating a new `.sdoc` or `.tiptap.json` document from scratch
- Adding or editing content: headings, paragraphs, lists, tables, images, math, code blocks
- Converting Markdown content into `.sdoc`/`.tiptap.json` format
- Understanding how to structure `.sdoc`/`.tiptap.json` JSON correctly
- Working with cross-references between headings, figures, and tables

## File Format Overview

See [sdoc-format.instructions.md](../../.github/instructions/sdoc-format.instructions.md) for the full schema reference. Key points:

- Every `.sdoc` file has an envelope: `{ "sdoc": "1.0", "meta": {...}, "doc": {...} }`
- The `doc` tree follows Tiptap/ProseMirror node structure
- JSON attributes use clean camelCase (never `data-*` prefixes)
- Files are pretty-printed with 2-space indentation

## Critical Rules

### Heading Numbers — NEVER Add Manually

The editor **automatically generates heading numbers** (e.g., `1.`, `1.1`, `2.3.1`) via CSS counters based on heading level. This is controlled by the `structuredDocEditor.heading.numbering` setting.

**DO NOT** prefix heading text with numbers. It causes double numbering.

| ❌ Wrong | ✅ Correct |
|---|---|
| `"1. Introduction"` | `"Introduction"` |
| `"2.1 System Overview"` | `"System Overview"` |
| `"3.2.1 API Design"` | `"API Design"` |

Always write only the bare title in heading content.

### Excluding a Heading from Numbering (`numbered: false`)

Some sections conventionally have **no number** — e.g. `Introduction`, `Glossary`, `References`, `Appendix` in IEEE/ISO-style documents. Use the heading's `numbered` attribute instead of skipping/hacking the counter:

```json
{ "type": "heading", "attrs": { "level": 1, "numbered": false }, "content": [{ "type": "text", "text": "Introduction" }] }
```

- Omit `numbered` (or set it to `null`) for normal, numbered headings — this is the default.
- Set `numbered: false` only for headings that must never show a number.
- The heading still nests normally for TOC/cross-reference purposes; only its own number prefix is suppressed, and its own level's counter is not incremented (so later numbered headings don't skip a number).
- Do NOT rename the heading or prefix it with placeholder text to hide numbering — always use this attribute so it stays consistent across the editor view, TOC, cross-references, and all exports (HTML/Markdown/AsciiDoc).

## Procedures

### Creating a New Document

1. Create a file with `.sdoc` or `.tiptap.json` extension
2. Use the envelope template from [new-document-template.md](./references/new-document-template.md)
3. Set `meta.title`, `meta.author`, `meta.version`
4. Set `meta.created` and `meta.modified` to current ISO 8601 timestamp
5. Add content nodes inside `doc.content`

> **Comprehensive Example**: See [example-full-features.sdoc](./references/example-full-features.sdoc) for a complete document demonstrating **every** supported node type, mark, and attribute — including headings (H1–H6), text formatting (bold, italic, underline, strike, code, color, highlight, subscript, superscript), bullet/ordered/task lists, code blocks with syntax highlighting, tables with captions and merged cells, images with captions and alignment, inline and block math equations, Mermaid diagrams (flowchart, sequence, class, gantt, pie, ER), cross-references, and hard breaks.

### Adding a Math Equation

> **CRITICAL — Backslash escaping in JSON**: JSON requires `\` to be written as `\\`.
> Every LaTeX command (which starts with `\`) must use **exactly two backslashes** `\\` in the JSON string.
>
> | LaTeX (what KaTeX sees) | JSON string (what you write) | ❌ Wrong |
> |---|---|---|
> | `\frac{a}{b}` | `"\\frac{a}{b}"` | `"\\\frac"` or `"\frac"` |
> | `\omega_n^2` | `"\\omega_n^2"` | `"\\\omega_n^2"` |
> | `\zeta` | `"\\zeta"` | `"\\\zeta"` |
> | `\int_0^\infty` | `"\\int_0^\\infty"` | `"\\\int_0^\\\infty"` |

**Inline math** (within a paragraph):
```json
{ "type": "mathInline", "attrs": { "latex": "E = mc^2" } }
```
Place it alongside text nodes inside a paragraph's `content` array.

**Block math** (standalone equation):
```json
{ "type": "mathBlock", "attrs": { "latex": "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}" } }
```

**Transfer function example:**
```json
{ "type": "mathBlock", "attrs": { "latex": "G(s) = \\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}" } }
```
Place block math as a top-level block in `doc.content`. Uses KaTeX syntax.

### Adding a Table

Tables require `tableRow` > `tableHeader`/`tableCell` > `paragraph` nesting.
See the complete example in [examples.md](./references/examples.md#table-with-caption).

Key attributes:
- `caption`: descriptive text (auto-numbered by the editor)
- `align`: `"left"` | `"center"` | `"right"`
- `width`: CSS value like `"100%"` or `"80%"`

### Adding an Image

```json
{
  "type": "image",
  "attrs": {
    "src": "./images/my-image.png",
    "alt": "Description for accessibility",
    "caption": "A descriptive caption",
    "align": "center"
  }
}
```
- Use relative paths for `src`
- `caption` is optional but recommended for numbered figures
- `align` defaults to `"center"`

### Adding Cross-References

Reference any heading, figure, or table by its `id`:
```json
{ "type": "text", "text": "See Figure 1", "marks": [{ "type": "link", "attrs": { "href": "#figure-1" } }] }
```

ID conventions (auto-assigned by the editor on save):
- Headings: slugified from text (e.g., `"introduction"`, `"system-design"`)
- Images: `"figure-1"`, `"figure-2"`, ...
- Tables: `"table-1"`, `"table-2"`, ...

### Adding a Code Block

```json
{
  "type": "codeBlock",
  "attrs": { "language": "python" },
  "content": [{ "type": "text", "text": "def hello():\n    print('world')" }]
}
```
Supports 100+ languages via lowlight/highlight.js syntax highlighting.

### Adding a Task List

```json
{
  "type": "taskList",
  "content": [
    { "type": "taskItem", "attrs": { "checked": false }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "TODO item" }] }] },
    { "type": "taskItem", "attrs": { "checked": true }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Done item" }] }] }
  ]
}
```

### Adding a Diagram (Mermaid, PlantUML, etc.)

```json
{
  "type": "diagram",
  "attrs": {
    "language": "mermaid",
    "code": "graph TD\n  A[Start] --> B[Process]\n  B --> C[End]"
  }
}
```
- `language`: `"mermaid"`, `"plantuml"`, `"d2"`, `"graphviz"`, etc.
- `code`: diagram source code as a string
- Rendered visually in the editor; exported as fenced code blocks

### Text Alignment

Headings and paragraphs support `textAlign` attribute:
```json
{ "type": "paragraph", "attrs": { "textAlign": "center" }, "content": [{ "type": "text", "text": "Centered text" }] }
```
Values: `"left"` | `"center"` | `"right"` | `"justify"` | `null`

### Subscript and Superscript

```json
{ "type": "text", "text": "2", "marks": [{ "type": "subscript" }] }
{ "type": "text", "text": "n", "marks": [{ "type": "superscript" }] }
```

### Text Color and Highlight

```json
{ "type": "text", "text": "red text", "marks": [{ "type": "textStyle", "attrs": { "color": "#ff0000" } }] }
{ "type": "text", "text": "highlighted", "marks": [{ "type": "highlight", "attrs": { "color": "#ffff00" } }] }
```

### Converting from Markdown

The editor supports Markdown import. The converter handles:
- Headings (`#`–`######`) → `heading` nodes
- Bold/italic/code/strikethrough → marks
- Bullet/ordered/task lists → list nodes
- Fenced code blocks → `codeBlock` with language
- `$$...$$` → `mathBlock`, `$...$` → `mathInline`
- Tables (pipe syntax) → `table` nodes with auto-detected captions
- Images (`![alt](src)`) → `image` nodes with caption detection
- Links → `link` marks
- YAML frontmatter is skipped

## Common Mistakes to Avoid

1. **Missing paragraph wrapper**: Text inside `listItem` or `tableCell` MUST be wrapped in a `paragraph` node
2. **Bare doc tree**: Always include the full envelope (`sdoc`, `meta`, `doc`)
3. **Using `data-*` attributes**: JSON uses clean names (`caption`, not `data-caption`)
4. **Inline nodes at top level**: `doc.content` only accepts block nodes
5. **Forgetting `modified` timestamp**: Update `meta.modified` on every edit
6. **Empty arrays for empty content**: Use no `content` key instead of `"content": []`
