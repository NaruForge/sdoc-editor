---
ats: "0.1"
id: SDOC-017
title: "버그 수정 모음 — 날짜 포맷 / BubbleMenu 활성 상태 / CrossRef 자동 동기화"
status: done
priority: high
created: 2026-04-13T23:30:00+09:00
modified: 2026-04-13T23:30:00+09:00
author: "copilot"
---

# SDOC-017: 버그 수정 모음 — 날짜 포맷 / BubbleMenu 활성 상태 / CrossRef 자동 동기화

## Context
세션 진행 중 발견된 3가지 버그를 수정한 모음 태스크.
SDOC-016 완료 직후 사용자 피드백으로 보고된 이슈들.

## Scope
### In Scope
1. **Export 날짜 포맷** — HTML/Markdown/AsciiDoc 내보내기 시 ISO 타임스탬프(`2026-04-13T01:16:20.722Z`)가 그대로 노출되는 문제
2. **BubbleMenu 활성 상태** — 텍스트 선택 시 Floating Toolbar에 현재 적용된 서식(Bold, Italic 등)이 표시되지 않는 문제
3. **CrossReference 자동 동기화** — `@` 삽입 후 원본(Table 캡션, 헤딩 등) 변경 시 Reference 텍스트가 실시간으로 업데이트되지 않는 문제

### Out of Scope
- webview watch 자동 실행 설정
- BubbleMenu UI 디자인 변경

## Approach

### 1. Export 날짜 포맷
- `shared/converter/utils.ts`에 `formatDate(isoString: string): string` 헬퍼 추가
- ISO 날짜 → `YYYY-MM-DD` 로컬 포맷
- 실패 시 원본 반환 (safe fallback)
- `jsonToHtml.ts`, `jsonToMarkdown.ts`, `jsonToAdoc.ts` 3곳에 적용

### 2. BubbleMenu 활성 상태
- **1차 시도**: `editor.on('transaction')` 구독 → tiptap v3 BubbleMenu의 portal 렌더링 특성으로 효과 없음
- **최종 수정**: tiptap v3 공식 API `useEditorState()` 훅으로 교체
  - selector로 bold/italic 등 active 상태를 reactive state slice로 구독
  - `useSyncExternalStore` 기반으로 portal 내부에서도 정확히 리렌더
- 결론: `webview watch`가 실행 중이지 않아 빌드 미반영이 근본 원인이기도 했음

### 3. CrossReference 자동 동기화
- **원인**: `syncCrossReferences()`는 Extension Host에서만 실행되고, echo suppression(`pendingApplyEdits`, `pendingEditRef`)으로 에디터에 결과가 전달되지 않음
- **수정**: `CrossReference` Extension에 ProseMirror `appendTransaction` 플러그인 추가
  - `buildIdMap(doc)`: ProseMirror `Node`에서 heading/image/table id→label 맵 빌드
  - 매 doc 변경 시 `#...` href를 가진 `link` mark 텍스트를 idMap과 비교하여 자동 교정
  - 실시간 업데이트 (별도 저장 불필요)

## Progress
- [x] `formatDate()` 헬퍼 추가 (`shared/converter/utils.ts`)
- [x] HTML/Markdown/AsciiDoc export에 날짜 포맷 적용
- [x] `shared/converter/index.ts`에 `formatDate` 재내보내기 추가
- [x] BubbleMenu `useEditorState()` 적용 (webview-ui + tauri-app)
- [x] webview 수동 빌드 (`dist/webview/` 최신화)
- [x] CrossReference `appendTransaction` 플러그인 추가 (webview-ui + tauri-app)
- [x] `buildIdMap()` 헬퍼 추가
- [x] 빌드 검증 (tsc --noEmit 0 errors, webview 빌드 성공)
- [x] 커밋 및 푸시
  - `87eb3dc`: fix(export): format dates as YYYY-MM-DD in all converters
  - `cf907ea`: fix(bubble-menu): reflect active formatting state on text selection (1차, 미작동)
  - `debe96c`: fix(bubble-menu): use useEditorState for reactive active state (최종)
  - `2fdf3a0`: fix(crossref): auto-sync cross-reference text on source change
