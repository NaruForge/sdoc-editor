---
ats: "0.1"
id: SDOC-044
title: "인간 사용자 관점 UX 시뮬레이션 및 개선 계획"
status: done
priority: high
created: 2026-07-01T08:30:00+09:00
modified: 2026-07-01T08:45:00+09:00
author: "@copilot"
---

# SDOC-044: 인간 사용자 관점 UX 시뮬레이션 및 개선 계획

## Context

실제 GUI를 띄울 수 없는 환경에서 README, `package.json` contributions, VS Code host code,
webview UI, Tauri UI/backend 코드를 따라 인간 사용자 관점의 사용 흐름을 단계별로 시뮬레이션했다.
Fleet mode에서 GPT-5.5와 Opus-4.8만 사용했다.

- 수행한 시뮬레이션: 14개 독립 시나리오
- 산출물: [Human UX Improvement Plan](../../docs/superpowers/plans/2026-07-01-human-ux-improvement-plan.md)

## Scope

### In Scope
- VS Code 확장 설치/첫 문서/편집/저장/탐색/참조 흐름
- 문서별 설정, Export CSS, HTML/PDF/Markdown/AsciiDoc/Slides export
- Tauri standalone 앱의 첫 실행/저장/설정/export parity
- 오프라인/의존성 실패와 사용자 피드백

### Out of Scope
- 실제 구현 코드 수정

---

## Approach

VS Code core UX, export/settings UX, Tauri standalone UX를 병렬로 조사한 뒤
공통 불편 요소를 14개 시나리오와 5단계 로드맵으로 통합했다.

## Summary

- 최우선 개선: 새 문서 진입점, 저장/export 신뢰성, export 설정 우선순위 통일.
- 중기 개선: 검색형 삽입 메뉴, Activity Bar 라벨/빈 상태, CrossRef anchor/equation 보강.
- Tauri 개선: 미지원 기능 노출 정리, doc settings persistence, welcome/저장 피드백.

## Progress
- [x] VS Code core UX 시뮬레이션 5회
- [x] export/settings UX 시뮬레이션 5회
- [x] Tauri standalone UX 시뮬레이션 4회
- [x] 최소 10회 이상 시뮬레이션 근거 통합
- [x] 개선 계획서 작성

## Notes
- 후속 구현은 계획서의 Phase 0부터 별도 ATS task로 분할하는 것이 적절하다.
- 기존 결정(SDOC-019 설정 우선순위, SDOC-004/011/012 export 방침)을 뒤집지 않고 확장하는 방향으로 구성했다.
