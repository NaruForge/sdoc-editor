---
ats: "0.1"
id: SDOC-009
title: "에디터 폰트 시스템 개선 — 시스템 폰트 지원 및 인에디터 폰트 선택"
status: draft
priority: medium
created: 2026-04-08T00:00:00+09:00
modified: 2026-04-08T00:00:00+09:00
author: "copilot"
---

# SDOC-009: 에디터 폰트 시스템 개선

## Context
현재 sdoc 에디터의 폰트 시스템은 **편집 화면**과 **내보내기**가 완전히 분리되어 있으며, 사용자가 에디터 내에서 폰트를 선택할 수 있는 방법이 없습니다. 사용자가 VS Code Settings를 직접 수정하는 것은 접근성이 낮으므로, 에디터 UI에서 직접 폰트를 선택하고, 그것이 편집 화면과 내보내기 모두에 일관되게 적용되어야 합니다.

## Scope
### In Scope
- 시스템 폰트 목록 조회 및 에디터 내 폰트 선택 UI
- 선택한 폰트의 에디터 편집 화면 실시간 반영
- 선택한 폰트의 HTML/PDF 내보내기 적용
- Tauri 앱에도 동일 기능 지원
- 문서별 폰트 설정 저장 (envelope meta 또는 VS Code 설정)

### Out of Scope
- 폰트 파일 자체를 익스텐션에 번들링 (라이선스 이슈)
- 웹폰트(Google Fonts 등) 연동 (향후 확장)

## Approach
(분석 보고서 기반으로 결정 예정)

## Progress
- [x] 현재 폰트 시스템 분석
- [ ] 개선 방향 결정
- [ ] 구현
