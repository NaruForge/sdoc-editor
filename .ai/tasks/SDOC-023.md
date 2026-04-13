---
ats: "0.1"
id: SDOC-023
title: "수식 접두사 설정 + 캡션 번호-텍스트 구분자 설정"
status: done
priority: high
created: 2026-04-13T20:00:00+09:00
modified: 2026-04-13T21:00:00+09:00
author: "@contributor-01"
---

# SDOC-023: 수식 접두사 설정 + 캡션 번호-텍스트 구분자 설정

## Context

SDOC-022 이후 두 가지 설정 개선 요청:

1. **수식 접두사 부재**: 이미지(`captionImagePrefix`)와 표(`captionTablePrefix`)는 접두사 설정이 있지만, 수식(equation)은 번호만 표시 — `(1)`, `(1.2)` 형태로 고정. CrossRef 시 수식 접두사도 필요.

2. **번호-캡션 텍스트 구분자 고정**: 번호와 캡션 설명 사이의 구분 문자가 공백(`" "`)으로 하드코딩되어 있어, 사용자가 원하는 포맷을 지정할 수 없음:
   - `Fig. 1. Caption` (separator: `. `)
   - `Figure 1: Caption` (separator: `: `)
   - `Figure 1.1. Caption` (hierarchical + separator: `. `)
   - `Fig. 1: Caption`

## Scope

### In Scope

**1. `captionEquationPrefix` 설정 추가:**
- 수식 번호 앞에 붙는 접두사 (괄호 안에, 번호 앞)
- 기본값: `''` → `(1)`, prefix="Eq. " → `(Eq. 1)`, prefix="식 " → `(식 1.2)`
- 표시: 에디터 DOM(`eqNumber.textContent`), CrossRef 레이블, Export(`\tag{prefix+N}`)에 반영

**2. `captionSeparator` 설정 추가:**
- 이미지/표 캡션에서 번호(prefix+number)와 캡션 텍스트 사이의 구분 문자
- 기본값: `' '` (공백) → `Fig. 1 Caption`
- 예시: `. ` → `Fig. 1. Caption`, `: ` → `Figure 1: Caption`
- CSS `--caption-separator` 변수로 에디터 뷰에 반영, Export converters에도 반영

### Out of Scope
- 수식 표시 형태(괄호 등) 변경 — `(N)` 형태는 학술 관례로 유지
- 이미지/표 구분자를 각각 독립 설정으로 분리 — 공통 `captionSeparator` 단일 설정 사용

## Approach

### 설계 결정
- `captionEquationPrefix`: 괄호 안에 prefix 삽입 `(prefix+N)` 형태. "Eq. 1" 같이 괄호 없는 형태는 prefix에 직접 결합 (`"식 "`) → `(식 1)`.
- `captionSeparator`: `formatCaptionLabel()` 함수에 선택적 `separator` 파라미터 추가 (기본 `' '`). CSS는 `--caption-separator` 변수 추가.

### 변경 파일
1. `shared/types.ts` — `DocumentSettings`, `ExportSettings`, `SlideSettings`에 두 필드 추가
2. `shared/settingsResolver.ts` — 기본값 추가
3. `shared/types/messages.ts` — `EditorSettings`에 두 필드 추가
4. `shared/converter/utils.ts` — `formatCaptionLabel()` separator 파라미터 추가
5. 컨버터 4개 (jsonToHtml, jsonToMarkdown, jsonToAdoc, jsonToSlides) — separator/eqPrefix 적용
6. `webview-ui/src/extensions/MathBlock.ts` — `_setEqNumber`에서 prefix 읽기
7. `webview-ui/src/extensions/CrossReference.ts` — eqPrefix 반영
8. `webview-ui/src/styles/vscode-theme.css` — `--caption-separator` 변수 + content 규칙
9. `webview-ui/src/components/Editor.tsx` — CSS 변수 설정
10. `webview-ui/src/components/DocumentSettingsPanel.tsx` — UI 추가
11. `tauri-app` 4개 파일 동기화
12. `src/SdocEditorProvider.ts`, export commands — 새 필드 전달
13. `package.json` — VS Code 설정 기여 추가

## Progress
- [x] `shared/types.ts` 업데이트
- [x] `shared/settingsResolver.ts` 업데이트
- [x] `shared/types/messages.ts` 업데이트
- [x] `shared/converter/utils.ts` separator 파라미터 추가
- [x] 컨버터 4개 반영
- [x] webview-ui MathBlock.ts + CrossReference.ts
- [x] webview-ui CSS + Editor.tsx + DocumentSettingsPanel.tsx
- [x] tauri-app 동기화
- [x] SdocEditorProvider.ts + export commands
- [x] package.json VS Code 설정
- [x] 빌드 검증
