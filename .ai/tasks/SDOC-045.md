---
ats: "0.1"
id: SDOC-045
title: "UX 개선 구현 — 진입/Export/Tauri 폴더 사이드바"
status: done
priority: high
created: 2026-07-01T08:37:05+09:00
modified: 2026-07-01T08:50:17+09:00
author: "@copilot"
---

# SDOC-045: UX 개선 구현 — 진입/Export/Tauri 폴더 사이드바

## Context

SDOC-044의 인간 사용자 관점 UX 시뮬레이션에서 새 문서 진입, 저장/Export 신뢰성,
Export 설정 통일, Tauri standalone parity가 반복 마찰로 확인되었다.
이번 작업은 사용자 요청 "문제점을 모두 개선 + Tauri 앱 좌측 side-bar 폴더 제어 추가"를
후속 구현 에이전트들이 충돌 없이 나눠 진행할 수 있도록 ATS 작업과 공유 타입 기반을 준비한다.

## Scope

### In Scope
- 새 문서 진입/초기 빈 상태 UX 개선
- Export 설정 우선순위와 문서별 설정 UI 확장
- HTML/PDF/Slides Export 옵션의 공유 타입 기반 정리
- Tauri 앱 좌측 side-bar 폴더 제어 추가
- VS Code webview와 Tauri 앱 간 관련 UI/설정 동기화

### Out of Scope
- 이번 기반 작업에서 VS Code/Tauri 구체 구현을 완료하지 않는다.
- converter 구현, Rust backend, UI 컴포넌트 변경은 후속 병렬 구현 범위로 둔다.

## Approach

SDOC-019의 설정 우선순위(`meta.settings` > 외부 기본값 > 하드코딩 기본값)를 유지한다.
공유 타입은 `shared/types.ts`를 단일 소스로 사용하고, 후속 구현이 사용할 optional 필드만 먼저 추가한다.
Tauri side-bar 폴더 제어는 별도 구현 에이전트가 Rust 파일 I/O와 React UI를 함께 반영한다.

## Progress
- [x] ATS 작업 파일 생성
- [x] `.ai/STATUS.md` In Progress 등록
- [x] Export 개선용 공유 타입 optional 필드 추가
- [x] 새 문서 진입/초기 빈 상태 UX 구현
- [x] VS Code Extension 새 .sdoc 생성 명령 구현
- [x] VS Code webview Export outputDir/overwrite/reveal/PDF fallback/custom CSS warning 구현
- [x] Export 설정 UI/명령 동기화 구현
- [x] Tauri 좌측 side-bar 폴더 제어 구현
- [x] webview-ui ↔ tauri-app 발견성/빈 상태/교차참조/삽입 검색 UI 동기화
- [x] Export 옵션 패널을 VS Code webview와 Tauri 설정 패널에 동기화
- [x] VS Code/Tauri parity 검증
- [x] webview-ui 발견성 UX 개선 (ActivityBar 라벨/접근성, 패널 빈 상태, 삽입 메뉴 검색, 교차참조 수식 보강) — ux-webview-discoverability

## Notes
- 후속 에이전트는 `DocumentSettings`의 `pdfScale`, `selfContained`, `slideBreakLevel`,
  `slideTransition`, `showTitleSlide`, `outputDir`를 문서별 Export 설정 기반으로 사용한다.
- 기존 `SlideSettings.slideBreak`/`transition`은 호환성을 위해 유지했으며,
  신규 UI에서는 `slideBreakLevel`/`slideTransition` 별칭을 우선 사용해도 된다.
- Tauri는 폴더 선택/문서 목록/새 문서 생성/파일 열기를 좌측 탐색기와 Welcome 화면에서 지원한다.
- Tauri PDF/Slides Export는 미지원 상태를 버튼 disabled로 명확히 표시한다.
