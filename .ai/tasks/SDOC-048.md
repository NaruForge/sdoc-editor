---
ats: "0.1"
id: SDOC-048
title: "Tauri 탐색기 폴더 접기/펼치기 + 하단 상태바 경로 표시"
status: done
priority: medium
created: 2026-07-02T13:00:00+09:00
modified: 2026-07-02T13:00:00+09:00
author: "@copilot"
---

# SDOC-048: Tauri 탐색기 폴더 접기/펼치기 + 하단 상태바 경로 표시

## Context

SDOC-046/047 이후에도 두 가지 문제가 남아 있었다:
1. 사이드바(탐색기)에서 폴더를 클릭해도 fold/unfold(접기/펼치기)가 되지 않음 — 백엔드가
   DFS pre-order flat list(`depth` 필드 포함)만 반환하고, 프론트엔드에 collapse 상태가 없었음.
2. 현재 UI에는 전체 경로를 확인할 방법이 없음 — 사용자가 최하단 가로 상태바 방식을 추천함.

## Scope

### In Scope
- `SidePanel.tsx`(`ExplorerPanel`): `collapsedFolders: Set<string>` state 추가, 폴더 클릭 시
  토글. `hideUntilDepth` 단일 변수 알고리즘으로 `visibleEntries`(useMemo)를 계산하여 접힌
  폴더의 하위 항목을 DFS flat list에서 필터링.
- 폴더 행에 Chevron(`ChevronRight`/`ChevronDown`, lucide-react) 아이콘 추가, 파일 행은
  `explorer-chevron-spacer`로 들여쓰기 정렬 유지.
- 탐색기 entry에 `onMouseEnter`/`onMouseLeave` → `onHoverPath` 콜백 배선(`SidePanel.tsx` prop
  체인: `ExplorerPanelProps.onHoverPath`, `SidePanelProps.onHoverPath`).
- `Editor.tsx`: `hoveredExplorerPath` state 추가, `editor-body-layout` 하단에 `.app-status-bar`
  전역 하단 상태바 신규 추가 — `hoveredExplorerPath ?? currentPath ?? workspaceFolder ?? '열린
  폴더 없음'` 순으로 표시.
- `tauri-theme.css`: `.explorer-entry-folder` 커서를 `pointer`로 변경 + hover 배경,
  `.explorer-chevron`/`.explorer-chevron-spacer`, `.app-status-bar`(+ `-icon`/`-path`) 스타일 추가.

### Out of Scope
- 활성 파일이 접힌 폴더 안에 있을 때 자동으로 펼쳐서 보여주는 auto-reveal 기능
- 접기 상태의 영속화(재시작/새로고침 시 초기화됨)
- Rust 백엔드 변경 (순수 프론트엔드 작업)

## Approach

- 백엔드 `list_folder_documents`가 반환하는 flat list는 이미 DFS pre-order이며 각 entry에
  부모 대비 상대적인 `depth`가 있으므로, 별도 트리 구조 변환 없이 단일 변수
  `hideUntilDepth`(초기값 Infinity)만으로 collapse를 표현할 수 있다: 순회 중
  `entry.depth >= hideUntilDepth`면 스킵, 아니면 표시하고 그 entry가 collapsed 폴더면
  `hideUntilDepth = entry.depth + 1`로 갱신. 중첩 collapse도 자연스럽게 처리된다.
- 상태바는 `.editor-shell`이 이미 flex column이므로 `.editor-body-layout` 다음에 flex item으로
  추가하면 별도 포지셔닝 없이 하단에 고정된다.

## Progress
- [x] `ExplorerPanel`에 `collapsedFolders` state + `visibleEntries` useMemo(hideUntilDepth 알고리즘) 추가
- [x] 폴더 행 Chevron 아이콘 추가, 파일 행 spacer로 정렬
- [x] `onHoverPath` 콜백 prop 체인 배선 (`ExplorerPanel` → `SidePanel` → `Editor`)
- [x] `Editor.tsx`에 `.app-status-bar` 하단 상태바 추가 (`FolderOpen` 아이콘 + 경로 텍스트)
- [x] `tauri-theme.css`에 chevron/status-bar 스타일 추가
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- 상태바 배경은 VS Code 상태바와 유사하게 `--button-bg`(강조 파란색)를 재사용했다.
- 향후 삭제/이동 등 파일 트리 조작이 늘어나면 flat list 대신 실제 트리 구조로 전환하는 것을
  고려할 수 있으나, 현재 규모(문서 폴더)에서는 flat list + depth 필터링으로 충분하다.
