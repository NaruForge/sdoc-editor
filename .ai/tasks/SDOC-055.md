---
ats: "0.1"
id: SDOC-055
title: "탐색기 자동 새로고침 — 워크스페이스 폴더 파일시스템 변경 실시간 반영"
status: done
priority: medium
created: 2026-07-03T07:52:00+09:00
modified: 2026-07-03T07:52:00+09:00
author: "@copilot"
---

# SDOC-055: 탐색기 자동 새로고침 — 워크스페이스 폴더 파일시스템 변경 실시간 반영

## Context

사이드바(탐색기)에서 파일이 추가/삭제/이름 변경되어도(예: draw.io 데스크톱 앱에서 다이어그램을
저장하는 등 **앱 외부**에서 발생한 변경) 사용자가 수동으로 "새로고침" 버튼을 누르기 전까지는
목록에 반영되지 않는 문제가 있었다. 사용자는 VS Code 탐색기가 외부 변경에도 즉각 반영되는
점을 참고해 근본적인 해결책을 요구했다.

## Investigation

- 기존에 이미 `start_file_watcher` 커맨드와 `notify` 워처가 존재했지만, 이는 **현재 열린
  문서의 `drawio/` 하위 폴더**만 감시해 이미 에디터에 삽입된 drawio 이미지의 썸네일을
  새로고침하는 용도(`drawio-file-updated` 이벤트)로만 쓰이고 있었다.
- 탐색기 파일 목록(`workspaceEntries`)은 오직 명시적인 액션(`onRefreshWorkspace` 버튼,
  파일 생성/이름 변경 등 앱 자체 조작 이후 수동 `loadWorkspace()` 호출) 시에만 다시
  조회되고 있어, **워크스페이스 루트 전체를 대상으로 한 파일시스템 감시가 아예 없었다**는
  것이 근본 원인이었다.

## Scope

### In Scope
- `tauri-app/src-tauri/src/commands.rs`:
  - `DocState`에 `workspace_watch_root: Mutex<Option<PathBuf>>`,
    `workspace_watch_generation: AtomicU64` 필드 추가 — 현재 감시 중인 루트와, 폴더 전환 시
    이전 감시 스레드가 스스로 멈춰야 함을 알리기 위한 세대 카운터.
  - `path_is_excluded(path)` 헬퍼 추가 — 기존 `EXCLUDED_DIRS`(`.git`/`node_modules`/`target`
    등) 안에서 발생한 이벤트는 노이즈이므로 무시.
  - `start_workspace_watcher(folder)` 커맨드 신규 추가:
    - 이미 동일 폴더를 감시 중이면 즉시 반환(no-op).
    - `notify::RecommendedWatcher`로 워크스페이스 루트를 재귀적으로 감시하는 스레드를 기동.
    - 파일 내용 수정(`Modify(Data)`)은 무시하고 생성/삭제/이름변경(`Create`/`Remove`/
      `Modify(Name)`)만 "구조적 변경"으로 취급해 노이즈(자동저장 등)를 걸러냄.
    - 400ms 디바운스 후 `workspace-changed` 이벤트를 프론트엔드에 emit.
    - 매 300ms 폴링마다 `workspace_watch_generation`이 자신이 시작될 때의 값과 다르면(=다른
      폴더로 전환되어 새 감시자가 시작됨) 루프를 벗어나 `notify::Watcher`를 드롭, 감시 종료.
  - `lib.rs`: `DocState` 초기값에 새 필드 추가, `start_workspace_watcher` 커맨드 등록.
- `tauri-app/src/App.tsx`:
  - `loadWorkspace()`가 폴더 목록을 불러온 뒤 `start_workspace_watcher`를 호출해 감시를
    시작(또는 이미 감시 중이면 no-op).
  - 마운트 시 1회 `workspace-changed` 이벤트를 구독해, 수신 시 `loadWorkspaceRef.current()`로
    탐색기 목록을 자동 재조회.

### Out of Scope
- 에디터에 이미 열려 있는 문서 내용 자체를 외부 변경 시 자동 리로드하는 기능(예: 외부
  편집기로 `.sdoc`을 직접 수정한 경우) — 이번 요청은 탐색기 파일 목록 반영에 한정.
- 크로스플랫폼 파일시스템 이벤트 세부 차이(예: 일부 네트워크 드라이브에서 `notify` 미지원)에
  대한 폴백 폴링 — 로컬 파일시스템 기준으로 충분하다고 판단해 범위 밖으로 둠.

## Approach

- 기존 `start_file_watcher`(문서별 drawio 썸네일 갱신)와 신규 `start_workspace_watcher`(탐색기
  목록 갱신)는 감시 대상(단일 `drawio/` 폴더 vs 워크스페이스 루트 전체)과 목적이 달라 별도
  커맨드로 분리했다 — 하나의 워처에 두 책임을 억지로 합치면 필터링 로직이 복잡해지고
  SRP(Rule 3.1)를 위반하게 된다.
- 폴더 전환 시 이전 감시 스레드를 명시적으로 kill하는 대신, "세대 카운터 비교 후 스스로
  종료"하는 방식을 택했다 — `notify::Watcher`를 스레드 경계 밖에서 안전하게 공유/중단시키려면
  `Arc`/채널 기반의 더 복잡한 동기화가 필요한데, 세대 비교는 다음 300ms 폴링에서 자연스럽게
  해소되어 훨씬 단순하면서도 리소스 누수가 없다.
- 디바운스(400ms)는 파일 저장 시 흔한 "임시 파일 생성 → rename" 등 연쇄 이벤트를 하나의
  새로고침으로 합치기 위함이며, 폴링 주기(300ms)와 별개로 동작해 CPU 사용량을 최소화했다.

## Progress
- [x] `DocState`에 워처 상태 필드 추가
- [x] `path_is_excluded` 헬퍼로 감시 노이즈 필터링
- [x] `start_workspace_watcher` 커맨드 구현 (디바운스 + 세대 기반 자동 종료)
- [x] `lib.rs`에 커맨드 등록 및 초기 상태 설정
- [x] `App.tsx`: `loadWorkspace`에서 감시 시작, `workspace-changed` 이벤트 구독 및 자동
      재조회 연결
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- 사이드바의 기존 수동 "새로고침" 버튼(`onRefreshWorkspace`)은 안전망으로 그대로 유지했다.
- 앱 자신이 파일을 생성/이름변경한 직후에도 이미 `loadWorkspace()`를 직접 호출하고 있어
  화면은 즉시 갱신되며, 약 0.4~0.7초 뒤 워처가 동일 변경을 감지해 한 번 더 조용히
  재조회하지만 목록 내용이 같으므로 사용자가 체감할 수 있는 부작용은 없다.
