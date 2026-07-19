---
ats: "0.1"
id: SDOC-054
title: "시작 화면에 최근 작업 폴더(Workspace) 목록 표시 및 마지막 워크스페이스 자동 복원"
status: done
priority: medium
created: 2026-07-03T10:00:00+09:00
modified: 2026-07-03T10:00:00+09:00
author: "@copilot"
---

# SDOC-054: 시작 화면에 최근 작업 폴더(Workspace) 목록 표시 및 마지막 워크스페이스 자동 복원

## Context

사용자가 "프로그램 실행 후 최초 페이지가 '최근 문서'만을 나타낸다. 차라리 이전 작업
Workspace(작업 폴더) 리스트를 나타내는 게 좋지 않겠나"라는 개선안을 제기했다.

## Investigation

- `current_folder`는 `DocState`의 인메모리 `Mutex<Option<PathBuf>>`로만 관리되고
  `settings.json`에 영속화되지 않았다. 따라서 앱을 재시작하면 항상 `None`으로 초기화되어
  시작 화면에서 "열린 폴더" 섹션(이미 구현돼 있던 워크스페이스 문서 목록)이 전혀 나타나지
  않고, `recent_files`(문서 단위 히스토리)만 보이는 것이 사용자가 관찰한 현상의 원인이었다.
- VS Code의 "최근 워크스페이스" 목록처럼, 여러 개의 최근 작업 폴더를 기억해두고 사용자가
  선택해서 전환할 수 있어야 한다는 것이 사용자의 요구였다 (단순히 마지막 폴더 1개 자동
  복원만으로는 "리스트"라는 요구를 충족하지 못함).

## Scope

### In Scope
- `tauri-app/src-tauri/src/settings.rs`: `AppSettings`에 `recent_folders: Vec<String>` 필드
  추가 (기존 `recent_files`와 동일한 직렬화 패턴).
- `tauri-app/src-tauri/src/commands.rs`:
  - `remember_recent_folder(state, folder)` 헬퍼 추가 — 최근 목록에서 중복 제거 후 맨 앞에
    삽입, 최대 `MAX_RECENT_FOLDERS`(10)개로 제한, 즉시 `settings.json`에 저장.
  - `open_document`/`new_document`/`set_current_folder`에서 `current_folder`를 설정하는
    지점마다 `remember_recent_folder` 호출.
  - `get_recent_folders` 커맨드 추가 — 저장된 목록 중 실제로 디스크에 존재하는(`is_dir()`)
    폴더만 필터링해 반환 (이동/삭제된 폴더는 목록에서 자동으로 숨김).
- `tauri-app/src-tauri/src/lib.rs`:
  - `initial_folder` 계산 시, CLI 인자로 넘어온 파일이 없으면 `settings.recent_folders`에서
    실제로 존재하는 첫 번째 폴더를 찾아 시작 시 자동 복원 (VS Code가 마지막 워크스페이스를
    재오픈하는 것과 동일한 동작).
  - `get_recent_folders` 커맨드를 `invoke_handler`에 등록.
- `tauri-app/src/App.tsx`:
  - `recentFolders`/`recentFolderErrors` state 추가, 시작 시 `get_recent_folders` 호출로 로드.
  - `handleOpenRecentFolder(folder)` 핸들러 추가 — 클릭한 폴더를 `set_current_folder` +
    `loadWorkspace`로 워크스페이스 전환. 실패 시 인라인 오류 메시지 표시(기존 `recentErrors`
    패턴 재사용).
  - `handleSelectFolder`/`handleOpenRecentFolder` 성공 후 `get_recent_folders`로 목록 갱신.
  - 시작 화면에 "최근 작업 폴더" 섹션을 "열린 폴더"/"최근 문서" 섹션보다 위에 배치, 현재
    워크스페이스와 동일한 폴더는 중복 표시하지 않도록 필터링.
  - `normalizePath` 헬퍼를 `isPathInsideFolder`에서 분리해 재사용 가능하게 함.
- `tauri-app/src/styles/tauri-theme.css`: `.welcome-recent-folders` 스타일 추가.

### Out of Scope
- 여러 워크스페이스를 동시에 열어두는 진짜 멀티 워크스페이스(탭/윈도우) 지원 — 과거
  세그먼트에서 백엔드가 단일 폴더 구조(`current_folder: Option<PathBuf>`)라 범위가 크다고
  판단해 보류한 사안이며, 이번 요청은 "최근 폴더 목록에서 빠르게 재오픈"까지만 다룬다.
- 최근 폴더 목록에서 개별 항목 삭제(우클릭 "목록에서 제거") 기능 — 존재하지 않는 폴더는
  `get_recent_folders`가 자동으로 걸러내므로 당장은 필요성이 낮아 범위 밖으로 둠.

## Approach

- `current_folder`(인메모리, 단일값)와 `recent_folders`(영속, 목록)를 분리했다.
  `current_folder`는 여전히 "지금 활성화된 워크스페이스"를 나타내고, `recent_folders`는
  "과거에 열었던 워크스페이스들의 히스토리"를 나타내 책임을 명확히 분리했다(Rule 3.1).
- 확장자 판별 로직을 백엔드 한 곳에만 두었던 SDOC-053의 패턴과 동일하게, "이 폴더가 아직
  존재하는가"라는 판단도 `get_recent_folders` 안에서 한 번만 수행해 프론트엔드가 매번
  파일시스템 상태를 추측하지 않도록 했다.

## Progress
- [x] `AppSettings.recent_folders` 필드 추가
- [x] `remember_recent_folder` 헬퍼 추가 및 `open_document`/`new_document`/
      `set_current_folder`에 연결
- [x] `get_recent_folders` 커맨드 추가 (존재하지 않는 폴더 자동 필터링) 및 등록
- [x] `lib.rs`: CLI 파일 인자가 없을 때 최근 폴더로 `initial_folder` 자동 복원
- [x] `App.tsx`: 최근 작업 폴더 상태/핸들러/시작 화면 섹션 추가
- [x] `tauri-theme.css`: 새 섹션 스타일 추가
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- 시작 화면 문구를 "폴더를 열어 문서를 탐색하거나 최근 문서를 이어서 편집하세요"에서
  "이전에 작업하던 폴더를 이어서 열거나, 새 폴더/문서를 열어 시작하세요"로 변경해 새
  워크플로우를 반영했다.
