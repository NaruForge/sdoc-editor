---
ats: "0.1"
id: SDOC-042
title: "Tauri 앱 문서 설정 패널 Export CSS 경로 입력 동기화"
status: done
priority: medium
created: 2026-06-12T11:59:04+09:00
modified: 2026-06-12T12:00:00+09:00
author: "@copilot"
---

# SDOC-042: Tauri 앱 문서 설정 패널 Export CSS 경로 입력 동기화

## Context

`webview-ui`의 `DocumentSettingsPanel`에는 문서별 Export CSS 경로를 설정하는 UI가 추가되었지만,
Tauri 앱 버전은 아직 해당 섹션이 없어 두 구현 간 설정 패널이 어긋나 있었다.
Tauri는 VS Code의 파일 선택 API를 사용할 수 없으므로 동일한 기능을 텍스트 입력 기반으로 맞춰야 한다.

## Scope
### In Scope
- `tauri-app/src/components/DocumentSettingsPanel.tsx`에 "스타일 (Export CSS)" 섹션 추가
- `slideCssPath`, `htmlCssPath`용 Enter/blur 확정 텍스트 입력 추가
- Tauri 설정 패널 스타일 보강
- `tauri-app` TypeScript 타입체크 검증

### Out of Scope
- VS Code webview UI 변경
- Tauri 백엔드 파일 선택 다이얼로그 구현
- export 파이프라인 동작 변경

## Approach

- Tauri 쪽은 VS Code 메시지 브리지를 쓰지 않으므로 파일 선택 버튼 대신 경로를 직접 입력하는 방식으로 동기화했다.
- 기존 Tauri 입력 패턴과 맞추기 위해 로컬 draft 상태를 유지하고 `blur`/`Enter` 시점에만 설정을 반영하는 `DeferredTextInput`을 패널 내부에 추가했다.
- 입력값을 비우면 해당 문서 override를 삭제하고, 마지막 override까지 제거되면 `null`로 되돌려 전체 기본값 복원 흐름과 맞췄다.

## Progress
- [x] Tauri `DocumentSettingsPanel` 구조 및 동기화 규칙 확인
- [x] Export CSS 경로 입력 섹션 추가
- [x] Enter/blur 확정 입력 패턴 적용
- [x] Tauri 설정 패널 스타일 추가
- [x] `npx tsc --noEmit` 검증 완료
