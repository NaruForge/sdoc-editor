---
ats: "0.1"
id: SDOC-046
title: "Tauri 좌측 탐색기 — 우클릭 이름 변경/새 문서/VS Code식 정렬"
status: done
priority: medium
created: 2026-07-02T09:16:37+09:00
modified: 2026-07-02T09:16:37+09:00
author: "@copilot"
---

# SDOC-046: Tauri 좌측 탐색기 — 우클릭 이름 변경/새 문서/VS Code식 정렬

## Context

SDOC-045에서 Tauri 좌측 side-bar 폴더 제어(탐색기)를 도입했으나 다음 세 가지가 VS Code
탐색기 대비 부족했다.

1. 탐색기에서 파일을 우클릭해 이름을 바꿀 수 없음
2. 탐색기에서 우클릭으로 새 문서를 생성할 수 없음 (전역 "새 문서" 버튼만 존재, 특정 하위 폴더 지정 불가)
3. 폴더/파일 정렬이 VS Code(폴더 우선 + 대소문자 무시 이름순)와 다름 (경로 문자열 그대로 정렬)

## Scope

### In Scope
- Rust: `list_folder_documents` 정렬을 폴더 우선 + 대소문자 무시 이름순으로 변경
- Rust: `rename_entry` 커맨드 추가 (파일/폴더 이름 변경, 현재 열린 문서/최근 문서 목록 상태 동기화)
- React: 탐색기 항목 우클릭 컨텍스트 메뉴(`ExplorerContextMenu`) 추가 — 새 문서(해당 폴더 기준)/이름 바꾸기
- React: 탐색기 인라인 이름 변경 입력 UI
- `onCreateInFolder`가 특정 폴더 경로를 인자로 받을 수 있도록 시그니처 확장

### Out of Scope
- 파일/폴더 삭제, 이동(드래그 앤 드롭), 새 폴더 생성 — 이번 요청 범위 밖
- webview-ui(VS Code extension) 쪽 탐색기는 별도 구현이며 이번 변경 대상 아님

## Approach

- 백엔드 상태(`DocState.file_path`, `recent_files`)는 이름 변경 시에도 일관되게 유지되도록
  `rename_entry`에서 직접 갱신한다.
- 프론트엔드는 기존 `ImageContextMenu`/`TableContextMenu` 패턴(고정 위치 팝업, `context-menu-item`
  공통 클래스)을 재사용해 새 `ExplorerContextMenu`를 추가한다.
- 정렬은 VS Code 기본 규칙(폴더가 파일보다 먼저, 각 그룹 내 대소문자 무시 이름순)을 따른다.

## Progress
- [x] Rust `collect_explorer_entries` 정렬 로직을 폴더 우선 + 대소문자 무시로 변경
- [x] Rust `rename_entry` 커맨드 추가 및 `lib.rs` 등록
- [x] `ExplorerContextMenu` 컴포넌트 추가
- [x] `SidePanel.tsx` ExplorerPanel에 우클릭 메뉴/인라인 이름 변경 연결
- [x] `App.tsx`/`Editor.tsx`에 `onRenameEntry`, `onCreateInFolder(folder?)` 배선
- [x] `cargo check`, `tsc --noEmit` 통과 확인

## Notes
- 폴더 자체(탐색기 루트) 이름 변경은 지원하지 않는다 — 컨텍스트 메뉴가 루트 빈 공간에서
  열릴 때는 "새 문서"만 제공한다.
- 파일 이름 변경 시 확장자를 생략하면 원본 파일의 확장자 스타일(`.sdoc` 또는 `.tiptap.json`)을
  유지한다.
