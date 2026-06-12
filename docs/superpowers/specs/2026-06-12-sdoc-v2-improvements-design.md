# SDOC v2 Improvements — Design Spec

**Date**: 2026-06-12  
**Author**: @contributor-01 + @copilot  
**Status**: Approved  

---

## Overview

Two improvements for the Structured Doc Editor extension:

1. **Custom CSS File Support** — Replace inline CSS string settings with file-based CSS selection in the editor's built-in Settings panel
2. **AI Setup Optimization** — Reduce token consumption by slimming instructions, auto-registering skills via chatSkills contribution, and enhancing MCP schema responses

---

## Part A: Custom CSS File Support for Export

### Problem

Currently `structuredDocEditor.theme.customStyles` requires pasting raw CSS into VS Code's `settings.json`. This is:
- Poor UX for large stylesheets
- Not document-specific (workspace-global only)
- Not discoverable (hidden in settings.json)

### Solution

Add **Slide CSS** and **HTML CSS** file selection buttons to the editor's internal Settings panel (⚙️ sidebar). Selected file paths are stored per-document in `meta.settings`.

### Data Model

```typescript
// Added to DocumentSettings (shared/types.ts or settingsResolver.ts)
interface DocumentSettings {
  // existing fields...
  slideCssPath?: string;  // workspace-relative path, e.g., "./theme/slide.css"
  htmlCssPath?: string;   // workspace-relative path, e.g., "./theme/html.css"
}
```

### Architecture Flow

```
┌─────────────────────────────────────────────────┐
│ Settings Panel (Webview)                        │
│                                                 │
│ [스타일] section:                               │
│   Slide CSS: [./theme/slide.css] [선택][✕]     │
│   HTML CSS:  [./theme/html.css]  [선택][✕]     │
└───────────────────┬─────────────────────────────┘
                    │ postMessage('selectCssFile', {target: 'slide'|'html'})
                    ▼
┌─────────────────────────────────────────────────┐
│ Extension Host (SdocEditorProvider)             │
│                                                 │
│ 1. vscode.window.showOpenDialog({              │
│      filters: {'CSS Files': ['css']},          │
│      canSelectMany: false                       │
│    })                                           │
│ 2. Calculate workspace-relative path            │
│ 3. Update meta.settings.slideCssPath            │
│ 4. postMessage('settingsUpdate', newSettings)   │
└───────────────────┬─────────────────────────────┘
                    │ (on export)
                    ▼
┌─────────────────────────────────────────────────┐
│ Export Pipeline (exportToSlides / exportToHtml) │
│                                                 │
│ 1. Read meta.settings.slideCssPath              │
│ 2. Resolve to absolute path (workspace-based)   │
│ 3. fs.promises.readFile(absolutePath, 'utf-8')  │
│ 4. Inject into theme.customStyles               │
│ 5. Falls back to VS Code settings if no file    │
└─────────────────────────────────────────────────┘
```

### Priority Logic

```
1. meta.settings.slideCssPath file content → highest priority
2. VS Code settings "theme.customStyles" → fallback
3. Empty string → default
```

Same for HTML: `htmlCssPath` > `theme.customStyles` > empty.

### UI Design (Settings Panel)

New collapsible section **"스타일 (Style)"** in the Settings sidebar:

```
┌─────────────────────────────────┐
│ ▼ 스타일                        │
│                                 │
│ Slide Export CSS                │
│ ┌───────────────────────┐ ┌──┐│
│ │ ./theme/my-slides.css │ │📁││
│ └───────────────────────┘ └──┘│
│                           [✕] │
│                                 │
│ HTML Export CSS                 │
│ ┌───────────────────────┐ ┌──┐│
│ │ (설정 안됨)            │ │📁││
│ └───────────────────────┘ └──┘│
└─────────────────────────────────┘
```

- 📁 button triggers file dialog via Extension Host message
- ✕ button clears the path (sets to empty/undefined)
- Path display shows workspace-relative path or "(설정 안됨)"

### Message Protocol

```typescript
// Webview → Extension Host
interface SelectCssFileMessage {
  type: 'selectCssFile';
  target: 'slide' | 'html';
}

// Extension Host → Webview (response via settingsUpdate)
// Updates meta.settings.slideCssPath or meta.settings.htmlCssPath
```

### Export Integration

In `exportToSlides.ts` and `exportToHtml.ts`:

```typescript
// Resolve custom CSS: file path takes priority over settings string
async function resolveCustomCss(
  cssPath: string | undefined,
  workspacePath: string,
  fallbackCss: string
): Promise<string> {
  if (cssPath) {
    const absolutePath = path.resolve(workspacePath, cssPath);
    try {
      return await fs.promises.readFile(absolutePath, 'utf-8');
    } catch {
      console.warn(`Custom CSS file not found: ${absolutePath}`);
    }
  }
  return fallbackCss;
}
```

### Converter Changes (shared/converter/)

No changes to `shared/converter/`. The CSS resolution happens in `src/commands/exportTo*.ts` (Extension Host side) which already passes `customStyles` as a string to the converter. The converter continues to receive a CSS string — it doesn't need to know whether it came from a file or settings.

### Error Handling

- File not found → `console.warn` + fall back to settings.json value
- File read error → same fallback behavior
- Empty path string → treated as "not configured"

---

## Part B: AI Setup Optimization

### Problem

- `sdoc-format.instructions.md` (234 lines) loads on every `.sdoc` file interaction → high token cost
- `setupAgent()` requires manual command execution to copy files
- MCP server path in `.github/mcp.json` is version-dependent

### B-1. Instructions Slimming

**Current**: 234 lines (full schema reference with JSON examples for every node type)

**Target**: ~50 lines — critical rules only:

```markdown
---
description: "..."
applyTo: "**/*.{sdoc,tiptap.json}"
---

# .sdoc Format — Essential Rules

## Structure
- Envelope: `{ "sdoc": "1.0", "meta": {...}, "doc": {...} }`
- `doc.content` contains only block nodes

## Critical Rules (DO NOT VIOLATE)
1. NEVER prefix heading text with numbers (CSS auto-numbers)
2. JSON backslash: every LaTeX `\` → `\\` in JSON (exactly 2 chars)
3. Attributes use camelCase (never `data-*` prefixes)
4. Update `meta.modified` to current ISO 8601 on every edit
5. Pretty-print with 2-space indentation
6. Image `src` uses relative paths (`./images/...`)
7. Inline content must be wrapped in `paragraph` nodes

## For Detailed Schema
Use MCP tool `sdoc_getSchema` to retrieve full node type reference,
attribute specs, and examples. Do NOT guess node structures from memory.
```

**Removed content** relocates to MCP `sdoc_getSchema` response enhancement (B-4).

### B-2. chatSkills Contribution Point

Add to `package.json`:

```json
{
  "contributes": {
    "chatSkills": [
      {
        "path": "./docs/agent/.github/skills/sdoc-editing/SKILL.md"
      }
    ]
  }
}
```

This auto-registers `/sdoc-editing` for all users who install the extension. No `setupAgent()` file-copying needed for skills.

### B-3. setupAgent() Simplification

**Before**: Copies instructions + skills + registers MCP  
**After**: Registers MCP only (instructions/skills come from Extension directly)

Changes:
1. Rename command title: "Setup AI Agent" → "Setup MCP Server"
2. Remove file-copying logic (no longer needed)
3. Keep `setupMcpInWorkspace()` — uses `context.extensionPath` (already dynamic)
4. Auto-invoke on extension activation if workspace doesn't have `sdoc` in `.github/mcp.json`

**Alternative considered**: Auto-register MCP on activation without any command. However, writing to `.github/mcp.json` should remain opt-in to avoid surprising users.

### B-4. Enhanced MCP Schema Response

`sdoc_getSchema` currently returns raw JSON Schema. Enhance it to also include an AI-friendly authoring guide:

```typescript
server.tool('sdoc_getSchema', ..., async () => {
  const schema = readSchemaFile();
  const guide = readAuthoringGuide(); // relocated from instructions

  return {
    content: [
      { type: 'text', text: `# JSON Schema\n\n${schema}` },
      { type: 'text', text: `\n\n# AI Authoring Quick Reference\n\n${guide}` },
    ]
  };
});
```

The "AI Authoring Quick Reference" contains:
- All block node types with JSON examples (moved from instructions)
- All mark types with attrs (moved from instructions)
- Cross-reference link conventions
- Table/image/math detailed attributes

This is only loaded when AI explicitly calls `sdoc_getSchema` — zero token cost when not needed.

### B-5. Instruction Auto-Loading via Extension (Future Consideration)

VS Code may add `contributes.chatInstructions` contribution point in the future. When available, the extension can register instructions directly without file-based `.github/instructions/`. For now, the slimmed instructions file remains the mechanism.

**Decision**: Keep `docs/agent/.github/instructions/sdoc-format.instructions.md` as the distribution source. The `setupAgent()` (now "Setup MCP Server") can optionally copy this slim file, or users can manually copy it.

Actually — since chatSkills handles skills and MCP handles tools, the instructions file is the only remaining piece that needs file-copying. Options:
- Keep a minimal `setupAgent` that copies only the slim instructions file + registers MCP
- Or document manual copy in README

**Decision**: Keep `setupAgent` but rename to "Setup AI Support" — copies slim instructions + registers MCP. No skills copying.

---

## Scope Summary

| Item | Area | Files Affected |
|---|---|---|
| A-1 | Data model | `shared/types.ts` or `shared/settingsResolver.ts` |
| A-2 | Settings UI | `webview-ui/src/components/Settings*` + `tauri-app/` sync |
| A-3 | Message bridge | `src/SdocEditorProvider.ts` |
| A-4 | Export integration | `src/commands/exportToSlides.ts`, `src/commands/exportToHtml.ts` |
| B-1 | Instructions slim | `docs/agent/.github/instructions/sdoc-format.instructions.md` |
| B-2 | chatSkills registration | `package.json` |
| B-3 | setupAgent simplification | `src/extension.ts` |
| B-4 | MCP schema enhancement | `shared/mcp/toolHandlers.ts`, `src/mcp/server.ts` |

---

## Out of Scope

- Tauri-app CSS file selection (Tauri has no `showOpenDialog` equivalent in this flow — future work)
- AGENTS.md cross-agent compatibility file (low priority, future work)
- MCP server path auto-resolution via `contributes.mcpServers` (VS Code feature not yet available)
- Removing `theme.customStyles` setting from package.json (kept for backward compatibility)

---

## Testing Strategy

- **A**: Manual test — select CSS file, export slides/HTML, verify CSS applied
- **B-1**: Verify instructions token count reduction (before/after comparison)
- **B-2**: Install VSIX, verify `/sdoc-editing` appears without running any command
- **B-3**: Run "Setup AI Support" command, verify `.github/mcp.json` created correctly
- **B-4**: Call `sdoc_getSchema` via MCP, verify enhanced response includes authoring guide
