---
ats: "0.1"
id: SDOC-026
title: "캡션 프리셋 시스템 — 자유 입력 → 4가지 표준 드롭다운"
status: done
created: 2025-07-15
modified: 2025-07-15
author: copilot
---

# SDOC-026: 캡션 프리셋 시스템

## Context

기존에 이미지/표/수식 접두사와 구분자를 자유 텍스트로 입력하는 6개 이상의 설정 필드가 있었으나,
사용자에게 지나친 자유도를 제공하여 일관성 없는 결과를 유발할 수 있었다.
이를 4가지 국제 표준 프리셋 드롭다운으로 교체하여 UX를 단순화한다.

## Scope

### 4가지 프리셋
| | IEEE (간결형) | ISO/IEC (정석형) | Modern (현대형) | Korean (한국형) |
|---|---|---|---|---|
| Figure | `Fig. ` | `Figure ` | `Figure ` | `그림 ` |
| Table | `Table ` | `Table ` | `Table ` | `표 ` |
| Equation | *(empty)* | `Equation ` | `Equation ` | `식 ` |
| Separator | `. ` | ` — ` | `: ` | ` ` |
| Table # | roman (I, II) | arabic | arabic | arabic |
| Eq parens | ✅ | ✅ | ❌ | ✅ |

### 변경 파일
- `shared/types.ts` — `CaptionStyleName` 타입, `DocumentSettings` 단순화
- `shared/settingsResolver.ts` — `CAPTION_PRESETS`, `getCaptionPreset()`, `toRoman()`
- `shared/converter/utils.ts` — `toRoman` re-export
- `shared/converter/jsonToHtml.ts` — 프리셋 기반 separator/roman/equationParens
- `shared/converter/jsonToMarkdown.ts` — 동일
- `shared/converter/jsonToAdoc.ts` — 동일
- `shared/converter/jsonToSlides.ts` — 동일 (equation 없음)
- `shared/mcp/sdocUtils.ts` — `syncCrossReferences` 프리셋 기반
- `src/SdocEditorProvider.ts` — config key 마이그레이션
- `webview-ui/src/context/EditorContext.tsx` — 인터페이스 단순화
- `webview-ui/src/extensions/CrossReference.ts` — `toRoman`, 통합 separator
- `webview-ui/src/extensions/MathBlock.ts` — `equationParens`
- `webview-ui/src/components/Editor.tsx` — CSS 변수 단순화, `data-table-number-style`
- `webview-ui/src/components/DocumentSettingsPanel.tsx` — 드롭다운 UI
- `webview-ui/src/styles/vscode-theme.css` — roman counter CSS
- `tauri-app/` — 위 webview 변경 동기화 (Editor, CSS, Panel, CrossRef, MathBlock, EditorContext)
- `package.json` — 7개 config → 2개 (`caption.style`, `caption.crossRefIncludeCaption`)

## Progress

- [x] `shared/types.ts` — CaptionStyleName, DocumentSettings 단순화
- [x] `shared/settingsResolver.ts` — CAPTION_PRESETS, getCaptionPreset, toRoman
- [x] `shared/converter/utils.ts` — toRoman re-export
- [x] EditorContext 업데이트 (webview + tauri)
- [x] SdocEditorProvider.ts 업데이트
- [x] CrossReference.ts + MathBlock.ts (webview + tauri)
- [x] Editor.tsx + vscode-theme.css (webview)
- [x] DocumentSettingsPanel.tsx (webview + tauri)
- [x] Editor.tsx + tauri-theme.css (tauri)
- [x] Converters (jsonToHtml, jsonToMarkdown, jsonToAdoc, jsonToSlides)
- [x] shared/mcp/sdocUtils.ts (syncCrossReferences)
- [x] package.json config contributions
- [x] 빌드 검증 (webview-ui: 에러 0, extension/tauri: 기존 에러만)
