---
ats: "0.1"
id: SDOC-024
title: "제목 폰트 적용 + 이미지/표 구분자 분리 + 수식 접두사 형태 개선"
status: done
priority: high
created: 2026-04-13T22:00:00+09:00
modified: 2026-04-13T22:30:00+09:00
author: "@contributor-01"
---

# SDOC-024: 제목 폰트 적용 + 이미지/표 구분자 분리 + 수식 접두사 형태 개선

## Context

SDOC-023 이후 세 가지 개선 요청:

1. **제목(Title) 폰트 미적용**: `editor-title-input`이 `Georgia, 'Times New Roman', serif` 하드코딩 폰트를 사용 중 — 문서 본문 폰트(`Legacy Font 2.0`)가 적용되지 않음. CSS 변수(`--font-weight-h1`)도 `.ProseMirror`에만 설정되어 제목 입력 필드에 상속되지 않음.

2. **이미지/표 구분자 공유**: 현재 `captionSeparator` 하나로 이미지·표 모두 공유 — 개별 설정 불가.

3. **수식 접두사 형태 불편**: 현재 포맷 `(Eq. 1)` — 원하는 포맷 `Eq. (1)`, `Equation (1)`. 형태: `{접두사}({번호}){구분자}`.

## Scope

### In Scope

**1. 제목 폰트 통일:**
- `editor-title-input` CSS: `font-family` → `'Legacy Font 2.0', var(--vscode-font-family), sans-serif`
- `font-weight: var(--font-weight-h1, 700)` 사용
- `Editor.tsx` JS: CSS 변수를 `document.documentElement`에도 설정하여 제목 입력 필드 상속 가능

**2. 이미지/표 구분자 분리:**
- `captionImageSeparator` 추가 (기본값: `' '`)
- `captionTableSeparator` 추가 (기본값: `' '`)
- 기존 `captionSeparator`는 하위 호환성 유지용으로 유지
- CSS: `--image-caption-separator`, `--table-caption-separator` 변수로 분리
- `content:` 규칙에서 분리된 변수 사용
- CrossReference: 타입별 개별 구분자 사용

**3. 수식 접두사 형태 변경:**
- 에디터 표시: `(${prefix}${label})` → `${prefix}(${label})`
- 예: prefix="Eq. " → 표시: `Eq. (1)` (이전: `(Eq. 1)`)
- CrossRef 라벨: `(${eqPrefix}${eqLabel})` → `${eqPrefix}(${eqLabel})`
- HTML/MD/Adoc 내보내기: KaTeX `\tag{}`에서 `\tag*{${prefix}(${label})}` 형태 사용
  - prefix="" 시: `\tag{${label}}` (기존 `(N)` 렌더링 유지)
  - prefix 있을 시: `\tag*{${prefix}(${label})}` (parens 없이 렌더링)
- `captionEquationSeparator` 추가 (기본값: `''`): 수식 레이블 뒤 구분자

### Out of Scope
- 수식 caption text 기능 신규 추가 (에디터에 수식 텍스트 입력 필드 추가 등)
- 폰트 패밀리 VS Code 설정 연동 (fontFamily는 별도 설정으로 관리됨)

## Approach

### 설계 결정

1. **CSS 변수 범위 확장**: `--font-weight-h1` 등을 `.ProseMirror`뿐만 아니라 `document.documentElement`에도 설정
2. **구분자 우선순위**: `captionImageSeparator ?? captionSeparator ?? ' '` 패턴으로 기존 설정 하위 호환
3. **KaTeX `\tag*{}`**: prefix 유무에 따라 `\tag{}` / `\tag*{}` 분기 사용

### 변경 파일
1. `shared/types.ts` — `DocumentSettings`, `ExportSettings`, `SlideSettings`에 세 필드 추가
2. `shared/settingsResolver.ts` — 기본값 추가
3. `shared/types/messages.ts` — `EditorSettings`에 세 필드 추가
4. 컨버터 4개 (jsonToHtml, jsonToMarkdown, jsonToAdoc, jsonToSlides) — 분리 구분자 + 수식 format 변경
5. `webview-ui/src/context/EditorContext.tsx` — 새 필드 추가
6. `webview-ui/src/styles/vscode-theme.css` — 폰트 수정 + CSS 변수 분리
7. `webview-ui/src/components/Editor.tsx` — documentElement에 CSS 변수 설정, prevPrefixRef 추가
8. `webview-ui/src/extensions/MathBlock.ts` — `${prefix}(${label})` 포맷
9. `webview-ui/src/extensions/CrossReference.ts` — 포맷 변경 + 개별 구분자
10. `webview-ui/src/components/DocumentSettingsPanel.tsx` — UI 분리
11. `tauri-app` 4개 파일 동기화
12. `src/SdocEditorProvider.ts` — 새 필드 전달
13. `package.json` — VS Code 설정 기여 추가

## Progress
- [x] `shared/types.ts` 업데이트
- [x] `shared/settingsResolver.ts` 업데이트
- [x] `shared/types/messages.ts` 업데이트
- [x] 컨버터 4개 반영
- [x] `webview-ui/src/context/EditorContext.tsx`
- [x] `webview-ui` CSS + Editor.tsx
- [x] MathBlock.ts + CrossReference.ts
- [x] DocumentSettingsPanel.tsx
- [x] tauri-app 동기화
- [x] SdocEditorProvider.ts + package.json
- [x] 빌드 검증
