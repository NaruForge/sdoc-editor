---
ats: "0.1"
id: SDOC-047
title: "Tauri 탐색기 빈 공간 우클릭 메뉴 — 새 폴더/시스템 탐색기/경로 복사/새로고침"
status: done
priority: medium
created: 2026-07-02T11:18:01+09:00
modified: 2026-07-02T11:18:01+09:00
author: "@copilot"
---

# SDOC-047: Tauri 탐색기 빈 공간 우클릭 메뉴 — 새 폴더/시스템 탐색기/경로 복사/새로고침

## Context

SDOC-046 이후, VS Code Explorer의 빈 공간 우클릭 메뉴(`microsoft/vscode`
`fileActions.contribution.ts`, `explorerView.ts` 조사 결과)를 기준으로 sdoc 탐색기 맥락에
맞는 4개 항목이 부족함을 확인했다: 새 폴더 생성, 시스템 파일 탐색기에서 보기, 경로 복사,
컨텍스트 메뉴 내 새로고침. (Cut/Copy/Paste, 통합 터미널 열기, 멀티 루트 워크스페이스 추가는
sdoc 단일 폴더 문서 편집기 특성상 Out of Scope로 제외했다.)

## Scope

### In Scope
- Rust: `create_folder(parent, folder_name)` 커맨드 추가 — 지정 상위 폴더 아래 새 폴더 생성
- Rust: `reveal_in_file_explorer(path)` 커맨드 추가 — Windows(`explorer /select,`),
  macOS(`open -R`), 기타 플랫폼(상위 폴더 열기 폴백)
- React: `ExplorerContextMenu`에 "새 폴더", "파일 탐색기에서 보기", "경로 복사", "새로고침" 메뉴 항목 추가
- `onCreateFolder`, 파일 탐색기 열기/경로 복사(클립보드)/새로고침 콜백을
  `App.tsx` → `Editor.tsx` → `SidePanel.tsx` → `ExplorerContextMenu`로 배선

### Out of Scope
- Cut/Copy/Paste, 통합 터미널에서 열기, 멀티 루트 워크스페이스 추가 — sdoc 탐색기 맥락에 불필요
- 파일/폴더 삭제, 드래그 앤 드롭 이동

## Approach

- VS Code 조사 결과, 탐색기 빈 공간 우클릭은 내부적으로 "루트 폴더 자체"를 대상으로 한
  컨텍스트로 처리되며 이름 변경/삭제 등은 조건(`ExplorerRootContext.toNegated()`)에 의해
  자동 숨김 처리된다. 동일하게 `ExplorerContextMenuTarget.isRoot`가 true일 때 "이름 바꾸기"는
  숨기고, 새 문서/새 폴더/시스템 탐색기 보기/경로 복사/새로고침은 항상 노출한다.
- "파일 탐색기에서 보기"는 Rust 백엔드에서 플랫폼별 명령을 실행한다(웹 클립보드/파일
  다이얼로그로 대체 불가능하므로). "경로 복사"는 기존 `ImageContextMenu`와 동일하게
  `navigator.clipboard.writeText`로 프론트엔드에서 직접 처리한다.

## Progress
- [x] Rust `create_folder` 커맨드 추가 및 `lib.rs` 등록
- [x] Rust `reveal_in_file_explorer` 커맨드 추가 (Windows/macOS/기타 분기) 및 `lib.rs` 등록
- [x] `ExplorerContextMenu`에 새 폴더/파일 탐색기 보기/경로 복사/새로고침 메뉴 항목 추가
- [x] `SidePanel.tsx` ExplorerPanel에 `onCreateFolder`, reveal/copyPath/refresh 핸들러 연결
- [x] `App.tsx`에 `handleCreateFolder` 추가, `Editor.tsx`/`SidePanel.tsx`에 `onCreateFolder` prop 배선
- [x] `cargo check`, `tsc --noEmit` 통과 확인

## Notes
- 새로고침 메뉴 항목은 기존 툴바 새로고침 버튼과 동일하게 `onRefreshWorkspace`를 재사용한다.
- 향후 파일/폴더 삭제나 이동이 필요해지면 이 작업에서 정의한 `ExplorerContextMenuTarget`
  구조를 그대로 확장하면 된다.
