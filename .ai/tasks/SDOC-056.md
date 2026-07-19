---
ats: "0.1"
id: SDOC-056
title: "탐색기 파일/폴더 삭제 기능 추가 (휴지통으로 이동)"
status: done
priority: medium
created: 2026-07-03T08:31:00+09:00
modified: 2026-07-03T08:31:00+09:00
author: "@copilot"
---

# SDOC-056: 탐색기 파일/폴더 삭제 기능 추가 (휴지통으로 이동)

## Context

좌측 사이드바 탐색기에서 이름 변경/새 폴더/새 문서는 지원되지만 **삭제** 기능이 없어,
불필요한 파일을 정리하려면 OS 파일 탐색기로 전환해야 하는 불편함이 있었다.

## Scope

### In Scope
- `tauri-app/src-tauri/Cargo.toml`: `trash = "5"` 의존성 추가.
- `tauri-app/src-tauri/src/commands.rs`:
  - `delete_entry(path)` 커맨드 신규 추가 — `trash::delete()`로 **영구 삭제가 아닌 OS
    휴지통(Windows 휴지통/macOS 지움표/Linux Trash)으로 이동**시킨다.
  - 삭제 대상이 현재 열려 있는 문서(또는 그 상위 폴더)라면 `state.file_path`를 `None`으로
    비워, 이후 저장 시도가 존재하지 않는 경로에 쓰기를 시도하는 것을 방지.
  - `settings.recent_files`에서도 삭제된 경로(및 그 하위 문서)를 제거.
- `tauri-app/src-tauri/src/lib.rs`: `delete_entry` 커맨드 등록.
- `tauri-app/src/components/ExplorerContextMenu.tsx`: "삭제" 메뉴 항목 추가(`Trash2`
  아이콘), 루트(작업 폴더 빈 공간) 우클릭 시에는 이름 변경과 마찬가지로 숨김.
- `tauri-app/src/components/SidePanel.tsx`: `ExplorerPanel`에 `onDeleteEntry` prop 추가,
  컨텍스트 메뉴의 "삭제" 클릭 시 대상 엔트리를 찾아 콜백 호출.
- `tauri-app/src/components/Editor.tsx`: `onDeleteEntry` prop을 `SidePanel`까지 전달.
- `tauri-app/src/App.tsx`:
  - `handleDeleteEntry(entry)` 핸들러 추가 — 삭제 전 `window.confirm`으로 확인(폴더는 하위
    내용까지 함께 이동됨을 명시).
  - 삭제 대상이 현재 편집 중인 문서(또는 그 하위)였다면 편집기를 닫고 시작 화면으로 전환.
  - 삭제 후 `loadWorkspace()`로 탐색기 목록 갱신(SDOC-055의 워크스페이스 워처가 있어 곧
    자동으로도 갱신되지만, 즉시 반영을 위해 명시적으로도 호출).

### Out of Scope
- 다중 선택 삭제(여러 파일 동시 선택 후 일괄 삭제) — 탐색기가 아직 다중 선택 UI를 지원하지
  않으므로(현재는 단일 항목 우클릭만 가능) 범위 밖으로 둠.
- 휴지통에서 복원하는 UI 제공 — OS 휴지통 자체 UI(Windows 탐색기, macOS Finder 등)를 그대로
  활용하면 충분하다고 판단.

## Approach

- `fs::remove_file`/`remove_dir_all`로 영구 삭제하는 대신 `trash` 크레이트로 OS 휴지통에
  이동시켜, VS Code 탐색기의 "삭제"(기본적으로 휴지통 이동, Shift+Delete만 영구 삭제)와
  동일한 안전망을 제공했다 — 실수로 삭제해도 OS 휴지통에서 복구할 수 있다.
- 이름 변경(`rename_entry`)에서 이미 검증된 "삭제 대상이 열린 문서/그 상위 폴더인 경우 상태
  동기화" 패턴을 그대로 재사용해 일관성을 유지했다(Rule 1.1 복제 금지 — 동일한 문제를
  다른 방식으로 두 번 풀지 않음).

## Progress
- [x] `trash` 크레이트 추가
- [x] `delete_entry` 커맨드 구현 (휴지통 이동 + 열린 문서/최근 문서 상태 정리)
- [x] `lib.rs`에 커맨드 등록
- [x] `ExplorerContextMenu`에 "삭제" 메뉴 항목 추가
- [x] `SidePanel`/`Editor`/`App.tsx`에 `onDeleteEntry` 배선 및 확인 다이얼로그 + 편집기
      닫기 처리
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- 삭제 확인은 이름 변경과 마찬가지로 컨텍스트 메뉴 경유로만 제공한다(별도 삭제 키보드
  단축키는 이번 범위에 포함하지 않음).
