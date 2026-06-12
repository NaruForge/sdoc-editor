/**
 * AI Authoring Quick Reference for .sdoc/.tiptap.json format.
 * Returned by sdoc_getSchema MCP tool alongside the JSON schema.
 * This is the detailed reference that was previously in the instructions file.
 */

export const AI_AUTHORING_GUIDE = `# .sdoc AI Authoring Quick Reference

## Block Node Types

### heading
\`\`\`json
{ "type": "heading", "attrs": { "level": 2, "id": "my-heading", "textAlign": "left" }, "content": [/* inline */] }
\`\`\`
- \`level\`: 1–6 (required)
- \`id\`: optional anchor for cross-references (auto-assigned on save)
- \`textAlign\`: "left" | "center" | "right" | "justify" | null

### paragraph
\`\`\`json
{ "type": "paragraph", "attrs": { "textAlign": "left" }, "content": [/* inline */] }
\`\`\`

### bulletList / orderedList
\`\`\`json
{ "type": "bulletList", "content": [
  { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Item" }] }] }
] }
\`\`\`
orderedList supports: \`start\` (integer), \`type\` (string).

### taskList
\`\`\`json
{ "type": "taskList", "content": [
  { "type": "taskItem", "attrs": { "checked": false }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Todo" }] }] }
] }
\`\`\`

### codeBlock
\`\`\`json
{ "type": "codeBlock", "attrs": { "language": "python" }, "content": [{ "type": "text", "text": "code here" }] }
\`\`\`

### table
\`\`\`json
{
  "type": "table",
  "attrs": { "caption": "Title", "align": "center", "width": "100%", "id": "table-1" },
  "content": [
    { "type": "tableRow", "content": [
      { "type": "tableHeader", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Header" }] }] }
    ] },
    { "type": "tableRow", "content": [
      { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 1 }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Data" }] }] }
    ] }
  ]
}
\`\`\`
Attrs: caption, align ("left"|"center"|"right"), width (CSS), id (auto "table-N"), colwidth (array).

### image
\`\`\`json
{ "type": "image", "attrs": { "src": "./images/diagram.png", "alt": "Alt text", "caption": "Caption", "align": "center", "id": "figure-1" } }
\`\`\`

### mathBlock
\`\`\`json
{ "type": "mathBlock", "attrs": { "latex": "E = mc^2" } }
\`\`\`
Remember: JSON requires \\\\\\\\ for each LaTeX backslash. Example: \`"\\\\\\\\frac{a}{b}"\`

### diagram
\`\`\`json
{ "type": "diagram", "attrs": { "language": "mermaid", "code": "graph TD\\\\n  A --> B" } }
\`\`\`

### blockquote
\`\`\`json
{ "type": "blockquote", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Quote" }] }] }
\`\`\`

### callout
\`\`\`json
{ "type": "callout", "attrs": { "variant": "info" }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Note content" }] }] }
\`\`\`
Variants: "info" | "warning" | "danger" | "tip"

### hardBreak
\`\`\`json
{ "type": "hardBreak" }
\`\`\`

## Inline Nodes

### text
\`\`\`json
{ "type": "text", "text": "Hello", "marks": [{ "type": "bold" }] }
\`\`\`

### mathInline
\`\`\`json
{ "type": "mathInline", "attrs": { "latex": "x^2" } }
\`\`\`

## Mark Types

| Mark | Attrs | Example |
|---|---|---|
| bold | — | \`{ "type": "bold" }\` |
| italic | — | \`{ "type": "italic" }\` |
| underline | — | \`{ "type": "underline" }\` |
| strike | — | \`{ "type": "strike" }\` |
| code | — | \`{ "type": "code" }\` |
| link | href, target, rel, class | \`{ "type": "link", "attrs": { "href": "url" } }\` |
| subscript | — | \`{ "type": "subscript" }\` |
| superscript | — | \`{ "type": "superscript" }\` |
| textStyle | color | \`{ "type": "textStyle", "attrs": { "color": "#ff0000" } }\` |
| highlight | color | \`{ "type": "highlight", "attrs": { "color": "#ffff00" } }\` |

Multiple marks can be combined in the marks array.

## Cross-References

Use link mark with href starting with # to reference headings, figures, or tables:
\`\`\`json
{ "type": "text", "text": "See Table 1", "marks": [{ "type": "link", "attrs": { "href": "#table-1" } }] }
\`\`\`
`;
