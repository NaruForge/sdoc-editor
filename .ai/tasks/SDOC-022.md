---
ats: "0.1"
id: SDOC-022
title: "캡션 포맷 통일 + CrossRef hierarchical 번호 지원"
status: done
priority: high
created: 2026-04-13T18:00:00+09:00
modified: 2026-04-13T18:30:00+09:00
author: "@contributor-01"
---

# SDOC-022: 캡션 포맷 통일 + CrossRef hierarchical 번호 지원

## Context

SDOC-021 이후 남은 두 가지 문제:

1. **CrossRef 번호 방식 무시**: `captionNumbering`을 Hierarchical로 설정해도 CrossRef에서는 항상 Simple 번호만 표시. CSS와 Export는 이미 hierarchical을 지원하지만 CrossRef의 `collectTargets()`/`buildIdMap()`에는 미반영.
2. **캡션 포맷 경직**: 접두사에 `": "` 구분자가 하드코딩되어 "Figure 1: 제목" 형식으로 고정. 사용자가 "Fig. 1 제목", "그림 1 제목", "1 제목" 등 자유로운 포맷을 원함.

## Scope

### In Scope

**1. CrossRef hierarchical 번호:**
- `collectTargets()`/`buildIdMap()`에서 `captionNumbering` 설정 읽기
- hierarchical 모드: `h1.imgCount` 형식 (예: "1.3")
- simple 모드: 순차 번호 (기존 동작)

**2. 캡션 포맷 통일:**
- 공유 헬퍼 `formatCaptionLabel(prefix, numbering, caption?)` 추가
- 포맷: `prefix + numbering + " " + caption` (prefix에 사용자가 원하는 구분 문자 포함)
- 기본 prefix를 빈 문자열로 변경 ("Image"/"Table" → "")
- CSS에서 `": "` 구분자 제거
- 전체 컨버터(HTML, Markdown, AsciiDoc, Slides) 통일

**3. 기본값 변경:**
- `package.json`, `settingsResolver.ts`, `SdocEditorProvider.ts`, export 커맨드 전체

**4. tauri-app 동기화**

### Out of Scope
- 캡션 CSS 카운터 로직 변경 (counter-set 등은 SDOC-020에서 해결됨)
- CrossRef mark 스키마 변경

## Approach

### 1. 공유 유틸리티
- `shared/converter/utils.ts`에 `formatCaptionLabel()` 추가
- 4개 컨버터에서 동일 함수 사용 → 중복 제거

### 2. CrossRef hierarchical 지원
- `window.__editorSettings?.captionNumbering` 읽기
- H1 통과 시 H1 카운터 증가, 이미지/표 카운터 리셋
- hierarchical: `{h1}.{count}`, simple: `{count}`

### 3. CSS 캡션 포맷
- `content: var(--image-caption-prefix) counter(image-counter) " ";`
- 기본 CSS 변수: `--image-caption-prefix: '';`, `--table-caption-prefix: '';`

### 4. 기본값 통일
- 모든 fallback에서 `'Image'`/`'Table'` → `''`

## Progress
- [x] `formatCaptionLabel()` 헬퍼 추가 (shared/converter/utils.ts)
- [x] 4개 컨버터 캡션 포맷 적용 (jsonToHtml, jsonToMarkdown, jsonToAdoc, jsonToSlides)
- [x] CrossRef hierarchical 번호 지원 (webview-ui)
- [x] CSS 캡션 포맷 정리 - ": " 제거 (webview-ui)
- [x] tauri-app 동기화 (CrossReference.ts + CSS)
- [x] 기본값 변경 (package.json, settingsResolver, SdocEditorProvider, export commands)
- [x] 빌드 검증
