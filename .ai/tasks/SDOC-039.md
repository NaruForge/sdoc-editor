---
ats: "0.1"
id: SDOC-039
title: "우클릭 컨텍스트 메뉴 — Toolbar 삽입 기능 통합"
status: done
created: 2026-04-14
modified: 2026-04-14
author: "@copilot"
---

## Context

에디터에서 마우스 우클릭 시 나타나는 `EditorContextMenu`는 현재 3가지만 지원한다:
- 이미지 삽입 / Draw.io 삽입 / 수식 삽입 (+ 링크 활성 시 Remove Link)

Toolbar 삽입 메뉴(`+ 삽입`)는 9가지를 지원한다:
표 / 이미지 / Draw.io / 수식 / 코드 블록 / 다이어그램(Mermaid) / 수평선 / 콜아웃 / 교차 참조

마우스로만 작업할 때 Toolbar까지 이동하지 않고도 우클릭으로 바로 삽입 기능에 접근할 수 있으면 UX가 크게 개선된다.

## Scope

- `webview-ui/src/components/EditorContextMenu.tsx`
  - `editor: TiptapEditor` prop 추가 (코드 블록, 수평선, 콜아웃 직접 실행)
  - `onInsertTable: (rows: number, cols: number) => void` prop 추가
  - `onInsertLink?: () => void` prop 추가
  - `onInsertDiagram?: () => void` prop 추가
  - `onInsertCrossRef?: () => void` prop 추가
  - 표 서브메뉴 (3×3 / 5×5 / 7×7 / 사용자 정의)
  - 콜아웃 서브메뉴 (5가지 variant)
  - "삽입" 섹션 헤더로 기존 항목과 구분
- `webview-ui/src/components/Editor.tsx`
  - EditorContextMenu에 추가 props 전달
  - `onInsertTable` 핸들러: 컨텍스트 메뉴 닫은 후 `editor.chain().focus().insertTable()` 실행
- `tauri-app` 동기화

## Approach

- 컨텍스트 메뉴는 React state로 서브메뉴 open/close 관리
- 서브메뉴는 hover시 우측에 열리는 플라이아웃(flyout) 방식
- 콜아웃 variant 목록은 Toolbar.tsx의 `CALLOUT_ICONS`/`CALLOUT_LABELS`와 동일한 값 사용 (단, 컨텍스트 메뉴 자체에서 정의 — 순환 import 방지)
- 기존 Remove Link / Image / Draw.io / Equation 항목 위에 구분선 추가하여 "편집" 영역과 "삽입" 영역 시각적 분리

## Progress

- [x] EditorContextMenu.tsx props 확장 + 서브메뉴 구현
- [x] Editor.tsx props 전달
- [x] tauri-app 동기화
- [x] STATUS.md 업데이트
