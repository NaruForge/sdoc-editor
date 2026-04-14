---
ats: "0.1"
id: SDOC-033
title: "레이아웃 고정 — Meta/Toolbar/Sidebar 스크롤 격리"
status: done
priority: high
created: 2026-04-15T04:10:00+09:00
modified: 2026-04-15T04:30:00+09:00
author: "@copilot"
---

# SDOC-033: 레이아웃 고정 — Meta/Toolbar/Sidebar 스크롤 격리

## Context

현재 구조에서 `body`가 전체 스크롤 컨테이너 역할을 함. 이로 인해:
1. **DocumentHeader (Meta 데이터)**: 본문 스크롤 시 함께 위로 사라짐
2. **ActivityBar + SidePanel**: 본문 스크롤 시 함께 스크롤됨

Toolbar에 `position: sticky; top: 0`이 있지만, `body` 기준 sticky이므로 DocumentHeader가 먼저 올라간 후에야 고정됨. 에디터 콘텐츠 영역만 단독으로 스크롤되어야 함.

## Scope

### In Scope
- `html, body, #root` height/overflow 설정
- `editor-shell` wrapper 클래스 추가
- `editor-body-layout` flex 레이아웃 정확한 overflow 처리
- `editor-content-area`만 단독 스크롤
- `activity-bar`, `side-panel` 스크롤 격리
- webview-ui + tauri-app 동기화

### Out of Scope
- 기능 변경
- BubbleMenu 위치 변경

## Approach

**목표 레이아웃:**
```
┌─ editor-shell (height: 100vh, overflow: hidden, flex-column) ──┐
│ ┌─ document-header (flex-shrink: 0) ────────────────────────┐  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌─ toolbar (flex-shrink: 0) ─────────────────────────────────┐  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌─ editor-body-layout (flex: 1, min-height: 0, overflow: hidden)┐│
│ │ [activity-bar: h:100%] [side-panel: h:100%, overflow-y:auto]  ││
│ │ [editor-content-area: flex:1, overflow-y:auto ← 유일한 스크롤]││
│ └──────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

## Progress

- [x] 문제 분석
- [x] CSS 수정 (webview-ui/src/styles/vscode-theme.css)
- [x] Editor.tsx: editor-shell 래퍼 div 추가
- [x] tauri-app 동기화
- [x] 빌드 검증
