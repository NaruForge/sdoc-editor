---
ats: "0.1"
id: SDOC-007
title: "Cross-Document References & Project Manifest"
status: done
priority: high
created: 2026-04-07T11:00:00+09:00
modified: 2026-04-07T15:00:00+09:00
author: "@contributor-01"
---

# SDOC-007: Cross-Document References & Project Manifest

## Context
공식 기술 문서 작성 시 상위/하위 문서 간 상호 참조가 필요하다.
현재 시스템은 단일 문서 내 `#id` 앵커 참조만 지원한다.
방안 3(프로젝트 매니페스트 + 문서간 링크)을 단계적으로 구현한다.

## Scope
### In Scope
**1단계: 문서간 링크**
- 링크 형식: `./other.sdoc#section-id` (상대 경로)
- internalLinkClick 확장에서 cross-doc 링크 감지 → postMessage → extension에서 파일 열기
- LinkDialog에 문서 선택 기능 추가
- 내보내기 컨버터에서 cross-doc 링크 처리

**2단계: 프로젝트 매니페스트**
- `.sdoc-project` 파일 형식 정의 (문서 목록 + 순서)
- customEditor 등록하여 매니페스트 UI 표시

**3단계: 통합 내보내기**
- 매니페스트 기반 다문서 병합 → 단일 HTML/PDF
- 연속 번호 매기기

### Out of Scope
- AsciiDoc-style include (실시간 임베딩)
- Tauri 앱 프로젝트 매니페스트 (별도 태스크)

## Approach
편집은 독립 문서별, 출판만 합쳐서 ("편집은 따로, 출판은 합쳐서" 패턴)

## Progress
### 1단계: 문서간 링크
- [x] internalLinkClick에 cross-doc 링크 처리 추가 (webview-ui + tauri-app)
- [x] SdocEditorProvider에 openDocument 메시지 핸들러 추가
- [x] LinkDialog에 문서 선택(.sdoc 파일 탐색) 기능 추가
- [x] 내보내기 컨버터에서 cross-doc 링크 처리

### 2단계: 프로젝트 매니페스트
- [x] .sdoc-project 스키마 정의
- [x] SdocProjectProvider 커스텀 에디터 등록
- [x] 매니페스트 UI (문서 목록, 순서 변경, 추가/삭제)
- [x] 프로젝트 통합 내보내기 (HTML/PDF) 구현

### 3단계: 통합 내보내기
- [x] 매니페스트 기반 다문서 병합 로직
- [x] 통합 HTML/PDF 내보내기
- [x] 연속 번호 매기기 (기존 convertJsonToHtml 카운터가 병합 문서에서 자동 연속)
- [x] Cross-doc 링크 해소 (./file.sdoc#id → #id)
- [x] 이미지 경로 rebase (문서 기준 → 프로젝트 기준)
