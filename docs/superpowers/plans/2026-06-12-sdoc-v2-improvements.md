# SDOC v2 Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom CSS file selection to the Settings panel for Slide/HTML export, and optimize AI setup by slimming instructions, adding chatSkills contribution, and enhancing MCP schema responses.

**Architecture:** The custom CSS feature extends the existing document settings flow (Webview → Extension Host → meta.settings). The AI setup changes restructure how the extension distributes AI knowledge without changing the three-layer architecture.

**Tech Stack:** TypeScript, React, VS Code Extension API, MCP SDK

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/types.ts` | Add `slideCssPath` and `htmlCssPath` to `DocumentSettings` |
| `webview-ui/src/components/DocumentSettingsPanel.tsx` | Add CSS file selection UI section |
| `tauri-app/src/components/DocumentSettingsPanel.tsx` | Sync CSS file selection UI (Tauri variant — path input only) |
| `src/SdocEditorProvider.ts` | Handle `selectCssFile` message, open file dialog, return path |
| `src/commands/exportToSlides.ts` | Resolve CSS from file path before passing to converter |
| `src/commands/exportToHtml.ts` | Resolve CSS from file path before passing to converter |
| `src/utils/cssUtils.ts` | Shared `resolveCustomCss()` helper |
| `docs/agent/.github/instructions/sdoc-format.instructions.md` | Slim down to ~50 lines |
| `shared/mcp/aiAuthoringGuide.ts` | Extracted AI authoring reference (moved from instructions) |
| `shared/mcp/toolHandlers.ts` | Enhance `sdoc_getSchema` to include authoring guide |
| `src/mcp/server.ts` | Pass authoring guide content in schema response |
| `package.json` | Add `chatSkills` contribution, update `setupAgent` title |
| `src/extension.ts` | Simplify `setupAgent()` to MCP-only |

---

### Task 1: Add CSS Path Fields to DocumentSettings Type

**Files:**
- Modify: `shared/types.ts:26-36`

- [ ] **Step 1: Add fields to DocumentSettings interface**

In `shared/types.ts`, add two optional fields to `DocumentSettings`:

```typescript
/** Per-document settings that override VS Code workspace defaults. */
export interface DocumentSettings {
  headingNumbering?: boolean;
  headingDecoration?: boolean;
  headingH1Color?: string;
  headingH2Color?: string;
  headingH3Color?: string;
  captionStyle?: CaptionStyleName;
  captionNumbering?: 'sequential' | 'hierarchical';
  equationNumbering?: 'sequential' | 'hierarchical';
  crossRefIncludeCaption?: boolean;
  slideCssPath?: string;   // workspace-relative path to custom Slide CSS
  htmlCssPath?: string;    // workspace-relative path to custom HTML CSS
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors (the new fields are optional, nothing references them yet)

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add slideCssPath and htmlCssPath to DocumentSettings type"
```

---

### Task 2: Create CSS Resolution Utility

**Files:**
- Create: `src/utils/cssUtils.ts`

- [ ] **Step 1: Create the utility file**

Create `src/utils/cssUtils.ts`:

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Resolve custom CSS content from a workspace-relative file path.
 * Falls back to the provided fallback string if the file doesn't exist or is unreadable.
 */
export async function resolveCustomCss(
  cssPath: string | undefined,
  workspacePath: string,
  fallbackCss: string,
): Promise<string> {
  if (!cssPath) {
    return fallbackCss;
  }

  const absolutePath = path.resolve(workspacePath, cssPath);
  try {
    return await fs.readFile(absolutePath, 'utf-8');
  } catch {
    console.warn(`Custom CSS file not found or unreadable: ${absolutePath}`);
    return fallbackCss;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/cssUtils.ts
git commit -m "feat: add resolveCustomCss utility for file-based CSS loading"
```

---

### Task 3: Handle selectCssFile Message in Extension Host

**Files:**
- Modify: `src/SdocEditorProvider.ts:170-227` (message switch)
- Modify: `src/SdocEditorProvider.ts` (add new method)

- [ ] **Step 1: Add message case in the switch block**

In `src/SdocEditorProvider.ts`, inside the `switch (message.type)` block (around line 224, after `case 'updateDocSettings'`), add:

```typescript
          case 'selectCssFile': {
            const selectedPath = await this.selectCssFile(document);
            if (selectedPath !== undefined) {
              const target = message.target as 'slide' | 'html';
              const key = target === 'slide' ? 'slideCssPath' : 'htmlCssPath';
              const currentSettings = this.readDocSettings(document);
              const newSettings = { ...currentSettings, [key]: selectedPath || undefined };
              await this.updateDocSettings(document, webviewPanel, newSettings);
            }
            break;
          }
          case 'clearCssFile': {
            const target = message.target as 'slide' | 'html';
            const key = target === 'slide' ? 'slideCssPath' : 'htmlCssPath';
            const currentSettings = this.readDocSettings(document);
            const { [key]: _removed, ...rest } = currentSettings ?? {};
            const newSettings = Object.keys(rest).length > 0 ? rest : null;
            await this.updateDocSettings(document, webviewPanel, newSettings as Partial<DocumentSettings> | null);
            break;
          }
```

- [ ] **Step 2: Add selectCssFile method**

Add the following method to the `SdocEditorProvider` class (near the bottom, before the final `}`):

```typescript
  private async selectCssFile(document: vscode.TextDocument): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const defaultUri = workspaceFolder?.uri ?? vscode.Uri.file(path.dirname(document.uri.fsPath));

    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      defaultUri,
      filters: { 'CSS Files': ['css'] },
      title: 'Custom CSS 파일 선택',
    });

    if (!result || result.length === 0) {
      return undefined;
    }

    const selectedUri = result[0];
    const basePath = workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    const relativePath = './' + path.relative(basePath, selectedUri.fsPath).replace(/\\/g, '/');
    return relativePath;
  }
```

- [ ] **Step 3: Add readDocSettings helper method**

Add this helper to read current doc settings from the file:

```typescript
  private readDocSettings(document: vscode.TextDocument): Partial<DocumentSettings> | null {
    try {
      const text = document.getText();
      const parsed = text.trim() ? JSON.parse(text) : {};
      return parsed?.meta?.settings ?? null;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/SdocEditorProvider.ts
git commit -m "feat: handle selectCssFile/clearCssFile messages in Extension Host"
```

---

### Task 4: Add CSS File Selection UI to DocumentSettingsPanel (webview-ui)

**Files:**
- Modify: `webview-ui/src/components/DocumentSettingsPanel.tsx`

- [ ] **Step 1: Read the webview instructions**

Read `.github/instructions/webview.instructions.md` for any relevant patterns.

- [ ] **Step 2: Add the Style section to the panel**

In `webview-ui/src/components/DocumentSettingsPanel.tsx`, add a new `CollapsibleSection` before the footer (`settings-footer` div). The webview uses `postMessage` to communicate with the Extension Host via `window.vscodeApi` (accessible via context).

First, import the vscode API accessor. Check how other components send messages — look for `postMessage` usage patterns in the file or context.

Add this section before `<div className="settings-footer">`:

```tsx
      <CollapsibleSection title="스타일 (Export CSS)">
        <div className="settings-row settings-row-file">
          <label className="settings-label">Slide CSS</label>
          <div className="settings-file-picker">
            <span className="settings-file-path" title={mergedSettings.slideCssPath || ''}>
              {mergedSettings.slideCssPath || '(설정 안됨)'}
            </span>
            <button
              className="settings-file-btn"
              onClick={() => postMessage({ type: 'selectCssFile', target: 'slide' })}
              title="CSS 파일 선택"
            >📁</button>
            {mergedSettings.slideCssPath && (
              <button
                className="settings-file-clear-btn"
                onClick={() => postMessage({ type: 'clearCssFile', target: 'slide' })}
                title="제거"
              >✕</button>
            )}
          </div>
        </div>
        <div className="settings-row settings-row-file">
          <label className="settings-label">HTML CSS</label>
          <div className="settings-file-picker">
            <span className="settings-file-path" title={mergedSettings.htmlCssPath || ''}>
              {mergedSettings.htmlCssPath || '(설정 안됨)'}
            </span>
            <button
              className="settings-file-btn"
              onClick={() => postMessage({ type: 'selectCssFile', target: 'html' })}
              title="CSS 파일 선택"
            >📁</button>
            {mergedSettings.htmlCssPath && (
              <button
                className="settings-file-clear-btn"
                onClick={() => postMessage({ type: 'clearCssFile', target: 'html' })}
                title="제거"
              >✕</button>
            )}
          </div>
        </div>
      </CollapsibleSection>
```

- [ ] **Step 3: Wire up the postMessage function**

The `postMessage` function should delegate to the VS Code API. Check how the component currently sends messages. If `onUpdateSettings` is the only mechanism, you'll need direct postMessage access.

Look at how the webview communicates — likely via a `useVscodeApi()` hook or `window.acquireVsCodeApi()`. Add:

```typescript
const vscodeApi = useVscodeApi(); // or however the existing code accesses it
const postMessage = useCallback((msg: Record<string, unknown>) => {
  vscodeApi.postMessage(msg);
}, [vscodeApi]);
```

If the existing pattern uses a different approach (e.g., props callback), adapt accordingly.

- [ ] **Step 4: Add CSS for the file picker**

Find the settings panel CSS file and add styles:

```css
.settings-file-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.settings-file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  padding: 2px 6px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 3px;
}

.settings-file-btn,
.settings-file-clear-btn {
  flex-shrink: 0;
  padding: 2px 6px;
  font-size: 12px;
  cursor: pointer;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 3px;
}

.settings-file-btn:hover,
.settings-file-clear-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}
```

- [ ] **Step 5: Ensure mergedSettings includes the new fields**

The `mergedSettings` object (from `state.settings`) must flow the `slideCssPath` and `htmlCssPath` values from the Extension Host. Check the `settingsChanged` message handler in the webview and the `resolveSettings` function. The fields are already in `DocumentSettings` (from Task 1), so they should flow through `meta.settings` automatically via the existing `docSettings` state.

Verify that the `state.docSettings` in `EditorContext` passes these fields. Since `updateDocSettings` updates `meta.settings` and re-sends `settingsChanged`, and `mergedSettings` is derived from `state.settings` (which merges VS Code defaults with doc settings), the new fields should appear as long as:
1. The `settingsChanged` message from Extension Host includes them
2. The webview stores them in state

Check `updateDocSettings` in `SdocEditorProvider.ts` — it currently sends a `settingsChanged` message with specific fields. You'll need to add the CSS paths to this message OR read them directly from `state.docSettings` in the component.

Since CSS paths don't need VS Code default merging (they're document-only), read them directly from `state.docSettings`:

```typescript
const slideCssPath = docSettings?.slideCssPath ?? '';
const htmlCssPath = docSettings?.htmlCssPath ?? '';
```

Then use `slideCssPath` and `htmlCssPath` in the JSX instead of `mergedSettings.slideCssPath`.

- [ ] **Step 6: Verify build**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor/webview-ui && npm run build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/components/DocumentSettingsPanel.tsx
git add webview-ui/src/  # any CSS file changed
git commit -m "feat: add CSS file selection UI to DocumentSettingsPanel (webview-ui)"
```

---

### Task 5: Sync CSS UI to Tauri App

**Files:**
- Modify: `tauri-app/src/components/DocumentSettingsPanel.tsx`

- [ ] **Step 1: Read Tauri instructions**

Read `.github/instructions/tauri.instructions.md` for sync rules.

- [ ] **Step 2: Add equivalent CSS section to Tauri panel**

In `tauri-app/src/components/DocumentSettingsPanel.tsx`, add the same "스타일 (Export CSS)" section. Since Tauri doesn't have VS Code's `showOpenDialog`, use a text input for path entry instead of a file dialog button:

```tsx
      <CollapsibleSection title="스타일 (Export CSS)">
        <div className="settings-row">
          <label className="settings-label">Slide CSS 경로</label>
          <DeferredTextInput
            value={docSettings?.slideCssPath ?? ''}
            onCommit={(val) => updateField('slideCssPath', val || undefined)}
            placeholder="./theme/slide.css"
          />
        </div>
        <div className="settings-row">
          <label className="settings-label">HTML CSS 경로</label>
          <DeferredTextInput
            value={docSettings?.htmlCssPath ?? ''}
            onCommit={(val) => updateField('htmlCssPath', val || undefined)}
            placeholder="./theme/html.css"
          />
        </div>
      </CollapsibleSection>
```

Note: If `DeferredTextInput` already exists in the Tauri app (for debounced text inputs), use it. Otherwise, a standard text input with `onBlur` commit is acceptable.

- [ ] **Step 3: Copy CSS styles if needed**

Ensure the file picker styles are also reflected in Tauri's CSS file (or use the simpler text input that uses existing `.settings-row` + `.settings-input` styling).

- [ ] **Step 4: Verify Tauri build**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor/tauri-app && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add tauri-app/src/components/DocumentSettingsPanel.tsx
git commit -m "feat: sync CSS path settings to Tauri app

sync: tauri-app"
```

---

### Task 6: Integrate CSS File Resolution into Export Commands

**Files:**
- Modify: `src/commands/exportToSlides.ts:48-70`
- Modify: `src/commands/exportToHtml.ts:52-64`

- [ ] **Step 1: Update exportToSlides.ts**

In `src/commands/exportToSlides.ts`, after parsing the document and reading meta (around line 38-39), resolve custom CSS from the file path:

```typescript
import { resolveCustomCss } from '../utils/cssUtils';
```

After `const meta = ...` and before building the theme (around line 49), add:

```typescript
    // Resolve custom Slide CSS: file path (meta.settings) takes priority over settings string
    const docSettings = meta?.settings as Partial<import('../../shared/types').DocumentSettings> | undefined;
    const workspacePath = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath
      ?? path.dirname(documentUri.fsPath);
    const fallbackCustomCss = config.get<string>('theme.customStyles') || '';
    const resolvedSlideCss = await resolveCustomCss(
      docSettings?.slideCssPath,
      workspacePath,
      fallbackCustomCss,
    );
```

Then when building `theme`, replace the `customStyles` from `buildHtmlTheme()` with the resolved CSS:

```typescript
    const theme = {
      ...buildHtmlTheme(config, companyLogo, fontWeights, embeddedFonts),
      customStyles: resolvedSlideCss,
      primaryColor: config.get<string>('slide.primaryColor') || config.get<string>('theme.primaryColor') || '#A50034',
      accentColor: config.get<string>('slide.accentColor') || config.get<string>('theme.accentColor') || '#6b6b6b',
    };
```

- [ ] **Step 2: Update exportToHtml.ts**

In `src/commands/exportToHtml.ts`, add the same import and resolution. After line 46 (`let json = ...`), add:

```typescript
import { resolveCustomCss } from '../utils/cssUtils';
```

(Put this import at the top of the file with other imports.)

After reading `meta` and before building the theme (around line 52), add:

```typescript
    const docSettings = meta?.settings as Partial<import('../../shared/types').DocumentSettings> | undefined;
    const workspacePath = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath
      ?? path.dirname(documentUri.fsPath);
    const fallbackCustomCss = config.get<string>('theme.customStyles') || '';
    const resolvedHtmlCss = await resolveCustomCss(
      docSettings?.htmlCssPath,
      workspacePath,
      fallbackCustomCss,
    );
```

Then replace the `customStyles` in the theme object:

```typescript
    const theme = {
      companyLogo,
      companyName: config.get<string>('theme.companyName') || '',
      primaryColor: config.get<string>('theme.primaryColor') || '#A50034',
      accentColor: config.get<string>('theme.accentColor') || '#6b6b6b',
      fontFamily: config.get<string>('theme.fontFamily') || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      customStyles: resolvedHtmlCss,
    };
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/exportToSlides.ts src/commands/exportToHtml.ts src/utils/cssUtils.ts
git commit -m "feat: resolve custom CSS from file path in Slide/HTML export"
```

---

### Task 7: Slim Down Instructions File

**Files:**
- Modify: `docs/agent/.github/instructions/sdoc-format.instructions.md`

- [ ] **Step 1: Replace instructions with condensed version**

Replace the entire content of `docs/agent/.github/instructions/sdoc-format.instructions.md` with:

```markdown
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
```

- [ ] **Step 2: Verify the file is ~40 lines (target: under 50)**

Run: `wc -l docs/agent/.github/instructions/sdoc-format.instructions.md`
Expected: ~35-45 lines

- [ ] **Step 3: Commit**

```bash
git add docs/agent/.github/instructions/sdoc-format.instructions.md
git commit -m "refactor: slim instructions to essential rules only (~40 lines from 234)

Detailed schema reference moved to MCP sdoc_getSchema response.
Reduces token consumption by ~80% on every .sdoc file interaction."
```

---

### Task 8: Create AI Authoring Guide Module

**Files:**
- Create: `shared/mcp/aiAuthoringGuide.ts`

- [ ] **Step 1: Create the authoring guide module**

Create `shared/mcp/aiAuthoringGuide.ts` with the detailed schema reference extracted from the old instructions:

```typescript
/**
 * AI Authoring Quick Reference for .sdoc/.tiptap.json format.
 * Returned by sdoc_getSchema MCP tool alongside the JSON schema.
 * This is the detailed reference that was previously in the instructions file.
 */

export const AI_AUTHORING_GUIDE = `
# .sdoc AI Authoring Quick Reference

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
Remember: JSON requires \\\\ for each LaTeX backslash. Example: \`"\\\\frac{a}{b}"\`

### diagram
\`\`\`json
{ "type": "diagram", "attrs": { "language": "mermaid", "code": "graph TD\\n  A --> B" } }
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add shared/mcp/aiAuthoringGuide.ts
git commit -m "feat: extract AI authoring guide for MCP schema response"
```

---

### Task 9: Enhance MCP sdoc_getSchema Response

**Files:**
- Modify: `shared/mcp/toolHandlers.ts`
- Modify: `src/mcp/server.ts:124-148`

- [ ] **Step 1: Add authoring guide to getSchema in server.ts**

In `src/mcp/server.ts`, import the guide and append it to the schema response. Modify the `sdoc_getSchema` tool handler:

```typescript
import { AI_AUTHORING_GUIDE } from '../../shared/mcp/aiAuthoringGuide';
```

Replace the `sdoc_getSchema` tool handler's success return (around line 137-139) with:

```typescript
        const schema = fs.readFileSync(candidate, 'utf-8');
        const combined = `# JSON Schema\n\n${schema}\n\n# AI Authoring Quick Reference\n\n${AI_AUTHORING_GUIDE}`;
        return { content: [{ type: 'text' as const, text: combined }] };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts shared/mcp/aiAuthoringGuide.ts
git commit -m "feat: enhance sdoc_getSchema to include AI authoring quick reference"
```

---

### Task 10: Add chatSkills Contribution to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add chatSkills contribution point**

In `package.json`, find the `"contributes"` section and add a `"chatSkills"` entry. Look for the existing `"contributes"` block (which has `"customEditors"`, `"commands"`, `"configuration"`, etc.) and add:

```json
    "chatSkills": [
      {
        "path": "./docs/agent/.github/skills/sdoc-editing/SKILL.md"
      }
    ]
```

Place this after the existing contribution points (e.g., after `"configuration"` or at the end of `"contributes"`).

- [ ] **Step 2: Update setupAgent command title**

In `package.json`, find the command entry for `structuredDocEditor.setupAgent` and update its title:

```json
{
  "command": "structuredDocEditor.setupAgent",
  "title": "Setup AI Support (MCP + Instructions)",
  "category": "Structured Doc"
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add chatSkills contribution for auto-registered /sdoc-editing skill"
```

---

### Task 11: Simplify setupAgent Command

**Files:**
- Modify: `src/extension.ts:156-215`

- [ ] **Step 1: Simplify the setupAgent function**

Replace the `setupAgent` function in `src/extension.ts` with a simplified version that only:
1. Copies the slim instructions file (still needed for applyTo auto-loading)
2. Registers MCP server

```typescript
async function setupAgent(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('워크스페이스 폴더가 열려 있지 않습니다.');
    return;
  }

  const workspaceFsPath = workspaceFolder.uri.fsPath;

  // 1. Copy slim instructions file
  const srcInstructionsDir = path.join(context.extensionPath, 'docs', 'agent', '.github', 'instructions');
  const destInstructionsDir = path.join(workspaceFsPath, '.github', 'instructions');
  const instructionsFile = 'sdoc-format.instructions.md';
  const srcPath = path.join(srcInstructionsDir, instructionsFile);
  const destPath = path.join(destInstructionsDir, instructionsFile);

  if (fs.existsSync(srcPath)) {
    if (fs.existsSync(destPath)) {
      const answer = await vscode.window.showWarningMessage(
        `${instructionsFile} 파일이 이미 존재합니다. 덮어쓰시겠습니까?`,
        '덮어쓰기', '건너뛰기'
      );
      if (answer === '덮어쓰기') {
        fs.mkdirSync(destInstructionsDir, { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    } else {
      fs.mkdirSync(destInstructionsDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // 2. Register MCP server
  setupMcpInWorkspace(context, workspaceFsPath);

  vscode.window.showInformationMessage(
    'AI Support 설정 완료! Instructions 복사 + MCP 서버 등록 완료.',
    '확인'
  );
}
```

- [ ] **Step 2: Remove collectFilePairs function**

Delete the `collectFilePairs` function (lines ~203-215) as it's no longer needed.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "refactor: simplify setupAgent to instructions copy + MCP registration only

Skills are now auto-registered via chatSkills contribution point.
File copying is reduced to the slim instructions file only."
```

---

### Task 12: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full TypeScript compilation**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npx tsc --noEmit --project tsconfig.json`
Expected: No errors

- [ ] **Step 2: Build webview-ui**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor/webview-ui && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Build extension**

Run: `cd /home/NaruForge/projects/vscode-ext-customeditor && npm run build` (or `node esbuild.mjs`)
Expected: Build succeeds

- [ ] **Step 4: Verify .vscodeignore includes new files**

Check that `docs/superpowers/` is excluded from VSIX (shouldn't be packaged), and `docs/agent/.github/` is included (needed for setupAgent and chatSkills).

Run: `grep -n "docs" .vscodeignore`

If `docs/superpowers/` is not excluded, add it. If `docs/agent/` is incorrectly excluded, remove the exclusion.

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: build verification and packaging adjustments"
```
