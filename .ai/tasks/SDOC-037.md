---
ats: "0.1"
id: SDOC-037
title: "TOC Fold/Unfold — 하위 계층 접기/펼치기"
status: done
created: 2026-04-14
modified: 2026-04-14
author: "@copilot"
---

## Context

TOC 항목이 많은 대형 문서에서 특정 섹션의 하위 항목들을 접어 두면 원하는 섹션만 빠르게 탐색할 수 있다.
현재 TOC는 모든 항목이 항상 펼쳐진 평면 리스트(flat list)로 표시된다.

헤딩 계층(H1 > H2 > H3)을 기반으로 부모 헤딩에 토글 버튼을 추가하여 Fold/Unfold를 지원한다.

## Scope

- `webview-ui/src/components/TableOfContents.tsx`
  - `collapsed: Set<number>` 상태 추가 (pos를 키로 사용)
  - `hasChildren()` 헬퍼: 다음 항목들 중 높은 level이 있으면 true
  - `computeVisibility()` 헬퍼: stack 기반으로 숨김 여부 계산
  - 부모 항목에 chevron 토글 버튼 렌더링 (ChevronRight / ChevronDown)
- `tauri-app/src/components/TableOfContents.tsx` — 동기화

## Approach

stack 순회 알고리즘:
1. entry 처리 시 stack에서 `level >= entry.level`인 항목 pop
2. 남은 stack 중 collapsed set에 있는 항목이 있으면 해당 entry는 숨김
3. 현재 entry를 stack에 push

## Progress

- [x] hasChildren / computeVisibility 헬퍼 구현
- [x] collapsed state + toggleCollapse 핸들러
- [x] chevron 토글 버튼 렌더링
- [x] CSS 스타일 추가
- [x] tauri-app 동기화
