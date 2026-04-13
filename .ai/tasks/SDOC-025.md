---
ats: "0.1"
id: SDOC-025
title: "구분자 미적용 버그 수정 + CrossRef 캡션 표시 여부 설정"
status: done
priority: high
created: 2026-04-13T23:00:00+09:00
modified: 2026-04-13T23:30:00+09:00
author: "@contributor-01"
---

# SDOC-025: 구분자 미적용 버그 수정 + CrossRef 캡션 표시 여부 설정

## Context

두 가지 문제 보고:

1. **구분자 미적용 버그**: `updateDocSettings` 및 `exportDocument`에서 `captionImageSeparator`, `captionTableSeparator`, `captionEquationSeparator`를 VS Code config에서 읽지 않고 settingsChanged 메시지에도 포함하지 않아 구분자 변경이 반영되지 않음.

2. **CrossRef 캡션 포함 여부 선택**: 현재 CrossRef는 항상 캡션 텍스트를 포함 (예: "Fig 8.1 시스템 개요도"). 사용자가 번호만 표시하거나 캡션 포함 표시를 선택하고 싶음.
   - `false` (기본값): "Fig 8.1은..." (번호만)
   - `true`: "Fig 8.1 시스템 개요도는..." (번호+캡션)

## Scope

### In Scope

**1. 구분자 버그 수정:**
- `SdocEditorProvider.updateDocSettings` → `vscodeDefaults`에 3개 구분자 필드 추가
- `SdocEditorProvider.updateDocSettings` → `settingsChanged` 메시지에 3개 필드 추가
- `SdocEditorProvider.exportDocument` → `vscodeDefaults`에 3개 구분자 필드 추가
- `SdocEditorProvider.exportDocument` → `exportSettings`에 3개 필드 추가
- `SdocEditorProvider.sendSettings` → `settingsChanged`에 `crossRefIncludeCaption` 추가
- 에디터 `sendSettings` (첫 번째)에도 `crossRefIncludeCaption` 추가

**2. CrossRef 캡션 표시 여부:**
- `shared/types.ts`: `DocumentSettings`에 `crossRefIncludeCaption?: boolean` 추가 (기본값: `false`)
- `shared/settingsResolver.ts`: `SETTINGS_DEFAULTS`에 `crossRefIncludeCaption: false` 추가
- `webview-ui/src/context/EditorContext.tsx`: `EditorSettings`에 `crossRefIncludeCaption: boolean` 추가 (기본: `false`)
- `webview-ui/src/extensions/CrossReference.ts`: `collectTargets`/`buildIdMap`에서 `crossRefIncludeCaption` 체크
- `webview-ui/src/components/DocumentSettingsPanel.tsx`: 캡션 섹션에 토글 추가
- `tauri-app` 동기화: CrossReference.ts, EditorContext.tsx, DocumentSettingsPanel.tsx

### Out of Scope
- server-side `syncCrossReferences` (sdocUtils.ts) 수정 — 에디터 내 webview만 수정
- package.json VS Code 설정 기여 추가 (crossRefIncludeCaption은 문서별 설정이므로)

## Approach

- `crossRefIncludeCaption` 기본값 `false` → CrossRef에 번호만 표시 (더 간결한 기본 UX)
- 기존 캡션 포함 포맷 사용자들은 설정 패널에서 활성화 가능
- `SdocEditorProvider`의 `sendSettings` 함수는 여러 곳에 중복 — 공통 helper로 통합하는 것이 이상적이나 이번 범위에서는 버그 수정에만 집중

## Progress
- [x] `shared/types.ts` 업데이트
- [x] `shared/settingsResolver.ts` 업데이트
- [x] `webview-ui/src/context/EditorContext.tsx` 업데이트
- [x] `src/SdocEditorProvider.ts` 3개소 수정
- [x] `webview-ui/src/extensions/CrossReference.ts` 수정
- [x] `webview-ui/src/components/DocumentSettingsPanel.tsx` 수정
- [x] tauri-app 동기화
- [x] 빌드 검증
