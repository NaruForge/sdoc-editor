# New .sdoc / .tiptap.json Document Template

Use this template when creating a new `.sdoc` or `.tiptap.json` file:

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "Document Title",
    "author": "Author Name",
    "version": "0.1",
    "created": "{{ISO_8601_TIMESTAMP}}",
    "modified": "{{ISO_8601_TIMESTAMP}}"
  },
  "doc": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 1 },
        "content": [{ "type": "text", "text": "Document Title" }]
      },
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Start writing here." }]
      }
    ]
  }
}
```

## Notes

- Replace `{{ISO_8601_TIMESTAMP}}` with the current date-time (e.g., `"2026-04-03T09:00:00.000Z"`)
- The H1 heading text should match `meta.title` — the editor auto-syncs title from H1 on save
- Default version for new documents is `"0.1"`
- Use 2-space indentation for Git-friendly diffs
