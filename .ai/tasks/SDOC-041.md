---
ats: "0.1"
id: SDOC-041
title: "문서 설정 패널 Export CSS 파일 선택 UI 추가"
status: done
created: 2026-06-12
modified: 2026-06-12
author: "@copilot"
---

## Context

문서별 Export CSS 경로(`slideCssPath`, `htmlCssPath`)가 Extension Host 쪽에는 이미 처리되지만,
webview `DocumentSettingsPanel`에는 이를 선택/해제할 UI가 없어 사용자가 문서 단위 CSS를 지정할 수 없었다.

## Scope

### In Scope
- `DocumentSettingsPanel`에 Export CSS 접이식 섹션 추가
- Slide CSS / HTML CSS 경로 표시, 선택, 해제 버튼 추가
- `SidePanel`/`Editor`를 통해 `postMessage` 전달 연결
- settings 패널용 파일 선택 스타일 추가
- `webview-ui` 타입체크 검증

### Out of Scope
- Extension Host의 CSS 파일 선택 로직 변경
- export 동작 자체 변경
- Tauri 앱 동기화 작업

## Approach

- 기존 callback-props 패턴을 유지하기 위해 `DocumentSettingsPanel`에 선택적 `onPostMessage` prop을 추가했다.
- 경로 값은 merge된 settings가 아닌 `state.docSettings`에서 직접 읽어 문서별 설정만 표시하도록 했다.
- 중복 JSX를 줄이기 위해 CSS 대상 정의 배열을 만들고 공통 렌더링으로 처리했다.

## Progress

- [x] `DocumentSettingsPanel`에 스타일 섹션과 CSS 파일 선택/해제 UI 추가
- [x] `SidePanel`에서 `onPostMessage` prop 전달
- [x] `Editor`에서 `postMessage`를 `SidePanel`로 연결
- [x] settings 패널 CSS 스타일 추가
- [x] `webview-ui` 타입체크 검증
- [x] `STATUS.md` 업데이트
- [x] `decisions.md` 업데이트
