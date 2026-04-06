# .sdoc Content Examples

## Math Equations — Backslash Escaping Rule

**JSON requires `\` → `\\`. Every LaTeX `\command` must be `\\command` in JSON.**

```json
// ✅ Correct — each LaTeX backslash is doubled in JSON
{ "type": "mathBlock", "attrs": { "latex": "G(s) = \\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}" } }

// ❌ Wrong — triple backslash (\\\) is never correct
{ "type": "mathBlock", "attrs": { "latex": "G(s) = \\\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\\omega_n^2}" } }
```

More examples:
```json
{ "type": "mathBlock", "attrs": { "latex": "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}" } }
{ "type": "mathBlock", "attrs": { "latex": "F(s) = \\frac{K}{s(Ts+1)}" } }
{ "type": "mathBlock", "attrs": { "latex": "\\dot{x} = Ax + Bu,\\quad y = Cx + Du" } }
{ "type": "mathInline", "attrs": { "latex": "\\omega_n = \\sqrt{\\frac{k}{m}}" } }
```

Quick reference — LaTeX → JSON:

| LaTeX expression | JSON string |
|---|---|
| `\frac{a}{b}` | `"\\frac{a}{b}"` |
| `\omega_n^2` | `"\\omega_n^2"` |
| `\zeta` | `"\\zeta"` |
| `\sqrt{x}` | `"\\sqrt{x}"` |
| `\int_0^\infty` | `"\\int_0^\\infty"` |
| `\dot{x}` | `"\\dot{x}"` |
| `\begin{matrix}` | `"\\begin{matrix}"` |



```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "This is " },
    { "type": "text", "text": "bold", "marks": [{ "type": "bold" }] },
    { "type": "text", "text": " and " },
    { "type": "text", "text": "italic", "marks": [{ "type": "italic" }] },
    { "type": "text", "text": " text with a " },
    { "type": "text", "text": "link", "marks": [{ "type": "link", "attrs": { "href": "https://example.com" } }] },
    { "type": "text", "text": "." }
  ]
}
```

## Heading Hierarchy

> **IMPORTANT**: Never include numbers in heading text. The editor auto-generates numbering (e.g., `1.`, `1.1`, `1.1.1`) via CSS. Writing `"1. Main Title"` causes double numbering.

```json
[
  {
    "type": "heading",
    "attrs": { "level": 1 },
    "content": [{ "type": "text", "text": "Main Title" }]
  },
  {
    "type": "heading",
    "attrs": { "level": 2 },
    "content": [{ "type": "text", "text": "Section" }]
  },
  {
    "type": "paragraph",
    "content": [{ "type": "text", "text": "Section content." }]
  },
  {
    "type": "heading",
    "attrs": { "level": 3 },
    "content": [{ "type": "text", "text": "Subsection" }]
  }
]
```

❌ Wrong — AI must NEVER produce this:
```json
{ "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "1. Introduction" }] }
{ "type": "heading", "attrs": { "level": 3 }, "content": [{ "type": "text", "text": "1.1 Background" }] }
```

✅ Correct:
```json
{ "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Introduction" }] }
{ "type": "heading", "attrs": { "level": 3 }, "content": [{ "type": "text", "text": "Background" }] }
```

## Bullet List

```json
{
  "type": "bulletList",
  "content": [
    {
      "type": "listItem",
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "First item" }] }]
    },
    {
      "type": "listItem",
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Second item" }] }]
    }
  ]
}
```

## Ordered List

```json
{
  "type": "orderedList",
  "attrs": { "start": 1 },
  "content": [
    {
      "type": "listItem",
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Step one" }] }]
    },
    {
      "type": "listItem",
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Step two" }] }]
    }
  ]
}
```

## Nested List

```json
{
  "type": "bulletList",
  "content": [
    {
      "type": "listItem",
      "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "Parent item" }] },
        {
          "type": "bulletList",
          "content": [
            { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Child item" }] }] }
          ]
        }
      ]
    }
  ]
}
```

## Table with Caption

```json
{
  "type": "table",
  "attrs": {
    "caption": "Performance Comparison",
    "align": "center",
    "width": "100%"
  },
  "content": [
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableHeader",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Method" }] }]
        },
        {
          "type": "tableHeader",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Accuracy" }] }]
        },
        {
          "type": "tableHeader",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Speed (ms)" }] }]
        }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Algorithm A" }] }]
        },
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "95.2%" }] }]
        },
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "12" }] }]
        }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Algorithm B" }] }]
        },
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "97.8%" }] }]
        },
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "45" }] }]
        }
      ]
    }
  ]
}
```

## Table with Merged Cells

```json
{
  "type": "table",
  "attrs": { "caption": "Merged cells example" },
  "content": [
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableHeader",
          "attrs": { "colspan": 2, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Spanning Header" }] }]
        }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Cell A" }] }]
        },
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Cell B" }] }]
        }
      ]
    }
  ]
}
```

## Image with Caption

```json
{
  "type": "image",
  "attrs": {
    "src": "./images/architecture.png",
    "alt": "System architecture diagram",
    "caption": "Overall system architecture",
    "align": "center"
  }
}
```

## Math Equations

### Inline math (inside a paragraph)

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "The equation " },
    { "type": "mathInline", "attrs": { "latex": "E = mc^2" } },
    { "type": "text", "text": " is famous." }
  ]
}
```

### Block math (standalone)

```json
{
  "type": "mathBlock",
  "attrs": {
    "latex": "\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"
  }
}
```

### Multi-line math

```json
{
  "type": "mathBlock",
  "attrs": {
    "latex": "\\begin{aligned}\n  \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\\n  \\nabla \\cdot \\mathbf{B} &= 0\n\\end{aligned}"
  }
}
```

## Code Block

```json
{
  "type": "codeBlock",
  "attrs": { "language": "typescript" },
  "content": [
    {
      "type": "text",
      "text": "function greet(name: string): string {\n  return `Hello, ${name}!`;\n}"
    }
  ]
}
```

## Cross-Reference Link

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "As shown in " },
    { "type": "text", "text": "Table 1", "marks": [{ "type": "link", "attrs": { "href": "#table-1" } }] },
    { "type": "text", "text": ", the results demonstrate..." }
  ]
}
```

## Task List

```json
{
  "type": "taskList",
  "content": [
    {
      "type": "taskItem",
      "attrs": { "checked": true },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Design review" }] }]
    },
    {
      "type": "taskItem",
      "attrs": { "checked": false },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Implementation" }] }]
    },
    {
      "type": "taskItem",
      "attrs": { "checked": false },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Testing" }] }]
    }
  ]
}
```

## Complete Minimal Document

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "Quick Start Guide",
    "author": "Team",
    "version": "0.1",
    "created": "2026-04-03T00:00:00.000Z",
    "modified": "2026-04-03T00:00:00.000Z"
  },
  "doc": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 1 },
        "content": [{ "type": "text", "text": "Quick Start Guide" }]
      },
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "This document demonstrates the " },
          { "type": "text", "text": ".sdoc", "marks": [{ "type": "code" }] },
          { "type": "text", "text": " format." }
        ]
      },
      {
        "type": "heading",
        "attrs": { "level": 2 },
        "content": [{ "type": "text", "text": "Math Example" }]
      },
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Euler's identity: " },
          { "type": "mathInline", "attrs": { "latex": "e^{i\\pi} + 1 = 0" } }
        ]
      },
      {
        "type": "mathBlock",
        "attrs": { "latex": "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}" }
      }
    ]
  }
}
```

## Diagram (Mermaid)

```json
{
  "type": "diagram",
  "attrs": {
    "language": "mermaid",
    "code": "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[Cancel]"
  }
}
```

## Text Alignment

```json
{
  "type": "heading",
  "attrs": { "level": 2, "textAlign": "center" },
  "content": [{ "type": "text", "text": "Centered Heading" }]
}
```

```json
{
  "type": "paragraph",
  "attrs": { "textAlign": "right" },
  "content": [{ "type": "text", "text": "Right-aligned paragraph." }]
}
```

## Subscript and Superscript

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "H" },
    { "type": "text", "text": "2", "marks": [{ "type": "subscript" }] },
    { "type": "text", "text": "O is water. E = mc" },
    { "type": "text", "text": "2", "marks": [{ "type": "superscript" }] },
    { "type": "text", "text": "." }
  ]
}
```

## Text Color (textStyle mark)

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "This is " },
    { "type": "text", "text": "red text", "marks": [{ "type": "textStyle", "attrs": { "color": "#ff0000" } }] },
    { "type": "text", "text": "." }
  ]
}
```

## Highlight (background color)

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "This is " },
    { "type": "text", "text": "highlighted text", "marks": [{ "type": "highlight", "attrs": { "color": "#ffeb3b" } }] },
    { "type": "text", "text": "." }
  ]
}
```
