---
applyTo: "**/converter/**,src/commands/**"
---

# Converters & Import/Export

## Dual Converter Architecture

Two sets of identical converters exist for different runtime environments:

- **`src/converter/`** — Used by VS Code extension export commands. May use `vscode` API.
- **`shared/converter/`** — Used by MCP server and Tauri app. Pure TypeScript, no `vscode` dependency.

Both must stay in sync. When adding a node type, update **all 8 files**:
- `src/converter/`: `jsonToHtml.ts`, `jsonToAdoc.ts`, `jsonToMarkdown.ts`, `markdownToJson.ts`
- `shared/converter/`: `jsonToHtml.ts`, `jsonToAdoc.ts`, `jsonToMarkdown.ts`, `markdownToJson.ts`

## Export Formats

### HTML (`jsonToHtml.ts`)
- Includes KaTeX CDN for math rendering.
- Includes Mermaid CDN for diagram rendering (`<pre class="mermaid">`).
- Cross-references output as `id` attributes + `<a href="#...">`.
- Settings: `theme.*` for company branding, colors, fonts.

### Markdown (`jsonToMarkdown.ts`)
- Diagram blocks → fenced code blocks (` ```mermaid `).
- Cross-references → `<a id="...">` anchors + `[text](#id)` links.
- Math blocks → `$$..$$`, math inline → `$...$`.

### AsciiDoc (`jsonToAdoc.ts`)
- Diagram blocks → `[mermaid]\n....\n` literal blocks.
- Cross-references → `[[id]]` anchors + `<<id,text>>` xrefs.
- Tables → AsciiDoc table syntax with `cols`, header rows.

## Import

### Markdown → JSON (`markdownToJson.ts`)
- Recognizes `mermaid|plantuml|d2|graphviz` fenced code blocks as `diagram` nodes.
- Standard markdown elements → corresponding Tiptap nodes.
- Import replaces the current editor content via toolbar Import button.

### HTML Import
- Uses Tiptap's built-in `setContent(htmlString)` — no custom converter needed.

## Cross-Reference Output

Converters must handle internal links (`href` starting with `#`):
- **HTML**: `id` attrs on targets + `<a href="#...">` links.
- **Markdown**: `<a id="...">` on targets + `[text](#id)` links.
- **AsciiDoc**: `[[id]]` on targets + `<<id,text>>` xrefs.

## Rules

- Converters operate on the `doc` tree only — never the envelope.
- Export commands (`src/commands/`) must unwrap the envelope before converting.
- `export.imagePath` setting controls relative vs absolute image paths in output.
