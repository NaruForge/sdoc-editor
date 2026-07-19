---
ats: "0.1"
id: SDOC-057
title: "삭제 확인 다이얼로그 신뢰성 수정 + 삭제 되돌리기(Undo) 기능 추가"
status: done
priority: high
created: 2026-07-03T09:20:00+09:00
modified: 2026-07-03T09:20:00+09:00
author: "@copilot"
---

# SDOC-057: 삭제 확인 다이얼로그 신뢰성 수정 + 삭제 되돌리기(Undo) 기능 추가

## Context

SDOC-056에서 구현한 탐색기 삭제 기능에서 두 가지 문제가 보고되었다.

1. **버그**: 삭제 확인 다이얼로그에서 사용자가 "확인" 버튼을 누르기 **전에** 이미 파일
   삭제가 진행되는 현상. `window.confirm()`을 사용했는데, Tauri WebView(Windows
   WebView2)에서 네이티브 동기 dialog가 스펙대로 완전히 블로킹되지 않고 클릭 전에
   반환되는 사례가 있는 것으로 확인됨.
2. **개선 요청**: 실수로 삭제했을 때 되돌릴 수 있는 수단이 없음(SDOC-056에서는 OS
   휴지통 자체 UI로 복원 가능하다고 판단했으나, 앱 내에서 즉시 되돌리는 UX가 더 안전함).

## Scope

### In Scope
- `tauri-app/src-tauri/src/commands.rs`:
  - `MAX_RECENT_DELETIONS = 20` 상수, `DocState.recent_deletions: Mutex<Vec<trash::TrashItem>>`
    필드 추가.
  - `delete_entry`: 삭제 직전 타임스탬프를 기록하고, 삭제 후 `os_limited::list()`에서 방금
    생성된 `TrashItem`을 이름+원본 부모 경로+삭제 시각으로 매칭하여 `recent_deletions`
    스택에 push(최대 20개, FIFO로 초과분 제거).
  - `undo_last_delete` 커맨드 신규 추가: 스택 최상단 항목을 peek → `restore_all()`로 복원
    시도 → 성공 시에만 pop(실패 시 스택에 남겨 재시도 가능).
  - `find_trash_item`/`restore_trash_item` 헬퍼를 `cfg(any(windows, unix 중 macOS 제외))`로
    게이팅 — `trash::os_limited`가 Windows/Linux에서만 지원되므로, 그 외 플랫폼에서는
    조용히 `None`/`Err`를 반환하는 폴백을 둬 크로스플랫폼 컴파일을 보장.
- `tauri-app/src-tauri/src/lib.rs`: `recent_deletions: Mutex::new(Vec::new())` 초기화,
  `undo_last_delete` 커맨드 등록.
- `tauri-app/src-tauri/src/commands.rs`: `has_recent_deletions()` 조회 커맨드 신규 추가 —
  사이드바 우클릭 메뉴의 "삭제 취소" 항목 활성화 여부 판단에 사용.
- `tauri-app/src/components/ExplorerContextMenu.tsx`: "삭제 취소"(Undo2 아이콘) 메뉴 항목
  신규 추가. `hasDeletionHistory` prop이 false이면 비활성화(disabled) 상태로 표시. 삭제
  대상과 무관한 전역 동작이므로 루트(빈 공간) 우클릭에서도 항상 노출.
- `tauri-app/src/components/ConfirmDialog.tsx` (신규): 기존 `LinkDialog`/
  `DrawioInstallGuideDialog` 패턴을 재사용한 범용 확인 모달. `window.confirm` 대신
  React state 기반 콜백으로 사용자의 실제 버튼 클릭에만 반응.
- `tauri-app/src/components/UndoToast.tsx` (신규): 삭제 성공 후 하단에 표시되는 토스트.
  "실행 취소" 버튼, 남은 시간 프로그레스바, 일정 시간(6초) 후 자동 닫힘.
- `tauri-app/src/App.tsx`:
  - `handleDeleteEntry`가 즉시 삭제하지 않고 `pendingDelete` state만 설정하도록 변경.
  - `ConfirmDialog`에서 사용자가 명시적으로 "삭제" 버튼을 클릭한 경우에만 `performDelete`가
    실제로 `invoke('delete_entry', ...)`를 호출.
  - 삭제 성공 시 `undoInfo` state를 설정해 `UndoToast`를 노출, "실행 취소" 클릭 시
    `invoke('undo_last_delete')` 호출 후 `loadWorkspace()`로 갱신.
  - `overlays`(ConfirmDialog + UndoToast)를 모든 뷰(`json`/`welcome`/`editor`) 공통으로
    렌더링하도록 각 return 분기를 Fragment로 감쌈.
  - `hasDeletionHistory` state 추가 — 삭제 성공 시 `true`, 되돌리기 실행 후
    `has_recent_deletions` 커맨드로 재조회해 갱신. `handleUndoDelete`를 토스트와 탐색기
    컨텍스트 메뉴가 공유.
- `tauri-app/src/styles/tauri-theme.css`: `.btn-danger`(위험 동작 강조 버튼), `.undo-toast*`
  (토스트 레이아웃 및 프로그레스바) 스타일 신규 추가.

### Out of Scope
- macOS에서의 되돌리기 지원 — `trash` 크레이트가 `os_limited` API를 Windows/Linux에서만
  제공하므로 범위 밖으로 둠(이 프로젝트의 번들 타겟이 Windows 전용이라 실사용에는 영향 없음).
- 다중 항목 일괄 되돌리기 — 현재 UX는 "가장 최근 삭제 1건"만 되돌리는 것으로 충분하다고
  판단(스택은 최대 20개까지 보관하지만 UI 노출은 최신 1건).

## Approach

- **근본 원인**: `window.confirm`/`alert`/`prompt`는 Tauri WebView2 환경에서 신뢰할 수
  없는 것으로 확인되어, 이 코드베이스의 다른 다이얼로그들과 동일하게 React state +
  버튼 onClick 콜백 패턴으로 통일했다. 이렇게 하면 "확인 버튼을 실제로 클릭해야만"
  후속 로직이 실행됨이 컴파일 타임/런타임 모두에서 보장된다.
- **되돌리기**: `trash::delete()`는 삭제된 항목의 식별자를 반환하지 않으므로, 삭제 직전
  타임스탬프를 기록해두고 삭제 후 `os_limited::list()`에서 이름/원본 경로/시각으로
  매칭해 `TrashItem`을 찾는 방식을 택했다. "peek → restore → 성공 시에만 pop" 패턴으로
  복원 실패(예: 원래 위치에 동일 이름 파일이 이미 존재) 시에도 재시도할 수 있게 했다.

## Progress
- [x] `commands.rs`: `recent_deletions` 상태, `undo_last_delete`, 매칭/복원 헬퍼 구현
- [x] `lib.rs`: 상태 초기화 및 커맨드 등록
- [x] `cargo check --quiet` 통과
- [x] `ConfirmDialog.tsx` 신규 작성, `App.tsx`의 `window.confirm` 제거
- [x] `UndoToast.tsx` 신규 작성 및 `App.tsx` 연동
- [x] 사이드바 탐색기 우클릭 메뉴에 "삭제 취소" 항목 추가(삭제 내역 없으면 비활성화)
- [x] `tauri-theme.css`에 `.btn-danger`/`.undo-toast*` 스타일 추가
- [x] `tsc --noEmit`, `npm run build` 통과 확인

## Notes
- `overlays`를 세 개의 최상위 return 분기(`json`/`welcome`/`editor`) 각각에 렌더링해야
  하므로 기존 `return <div>...</div>;`/`return <Editor .../>;` 형태를 `<>...</>` Fragment로
  감싸는 리팩터링이 함께 발생했다(Rule 1.1 위반 방지 — 확인 모달/토스트 렌더링 로직을
  세 곳에 복제하지 않고 `overlays` 변수 하나로 공유).
