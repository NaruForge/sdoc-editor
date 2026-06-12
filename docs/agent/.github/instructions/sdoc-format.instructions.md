---
description: "Essential rules for editing .sdoc/.tiptap.json files. For detailed schema reference, use the sdoc_getSchema MCP tool."
applyTo: "**/*.{sdoc,tiptap.json}"
---

# .sdoc Format — Essential Rules

`.sdoc` (alias `.tiptap.json`) is a JSON-based document format using Tiptap/ProseMirror structure.

## Envelope Structure

```json
{ "sdoc": "1.0", "meta": { "title": "", "author": "", "version": "1.0", "created": "ISO8601", "modified": "ISO8601" }, "doc": { "type": "doc", "content": [] } }
```

## Critical Rules — DO NOT VIOLATE

1. **NEVER prefix heading text with numbers** — The editor auto-generates numbering via CSS counters. Writing "1. Introduction" causes double numbering.
2. **JSON backslash escaping** — Every LaTeX `\` must appear as exactly `\\` in JSON. Never 1 (`\`) or 3+ (`\\\`).
3. **Attributes use camelCase** — Never `data-*` prefixes (`caption`, not `data-caption`).
4. **Update `meta.modified`** — Set to current ISO 8601 timestamp on every edit.
5. **Pretty-print JSON** — 2-space indentation for Git-friendly diffs.
6. **Relative image paths** — Use `./images/filename.png` style for `src`.
7. **Block nodes only at top level** — `doc.content` only contains block nodes (heading, paragraph, table, image, etc.).
8. **Paragraphs wrap inline content** — Text inside listItem, tableCell, tableHeader must be in a paragraph node.
9. **Empty content** — Use `{ "type": "paragraph" }` (no `content` key), not `{ "type": "paragraph", "content": [] }`.

## For Detailed Schema Reference

Use the `sdoc_getSchema` MCP tool to get the full node type reference with examples.
It returns all block/inline node types, mark types, attribute specifications, and cross-reference conventions.

Do NOT guess node structures from memory — always verify with `sdoc_getSchema` if unsure.
