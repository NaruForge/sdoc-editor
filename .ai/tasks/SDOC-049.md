---
ats: "0.1"
id: SDOC-049
title: "Tauri 탐색기 워크스페이스 폴더 전환/문서 열기 버그 수정"
status: done
priority: high
created: 2026-07-02T14:00:00+09:00
modified: 2026-07-02T14:00:00+09:00
author: "@copilot"
---

# SDOC-049: Tauri 탐색기 워크스페이스 폴더 전환/문서 열기 버그 수정

## Context

SDOC-048 이후 사용자가 "폴더 열기 버튼으로 새 폴더를 선택해도 잠시 나타났다가 기존 폴더로
되돌아간다"는 회귀를 보고했다. 원인을 조사한 결과 두 가지 독립적인 버그가 확인되었다.

## Scope

### 버그 1: 폴더 전환이 즉시 이전 폴더로 되돌아감
- `App.tsx`의 "앱 시작 시 CLI 인자 확인" `useEffect`가 `[loadDocument, loadWorkspace]`에
  의존하고 있었는데, 두 콜백 모두 내부적으로 `workspaceFolder` state에 의존하는 `useCallback`이라
  `workspaceFolder`가 바뀔 때마다(=폴더를 새로 열 때마다) 이 "시작 시 1회만 실행되어야 할" effect가
  재실행되었다.
- 재실행 시 `get_current_file_path`를 다시 조회하는데, 이는 Rust 백엔드에 남아있는 **이전에
  열려 있던 문서의 경로**(폴더만 바꿨을 뿐 문서를 안 바꿨으므로 그대로 남아 있음)를 반환한다.
  이 경로로 `loadDocument()`가 재호출되면서 내부적으로 `setWorkspaceFolder(이전 문서의 폴더)`를
  실행해 방금 선택한 새 폴더를 덮어썼다.

### 버그 2: 하위 폴더 문서를 열면 탐색기 루트가 좁혀짐
- `loadDocument`가 문서를 열 때마다 무조건 `setWorkspaceFolder(파일의 직속 부모 폴더)`를
  실행했다. 워크스페이스 루트가 이미 열려 있고 그 하위 폴더에 있는 문서를 클릭해서 열어도
  탐색기 루트가 그 문서의 부모 폴더로 좁혀지는 문제가 있었다.

## Approach

- **버그 1 수정**: 시작 시 1회만 실행되어야 하는 effect를 빈 의존성 배열(`[]`)로 변경하고,
  `loadDocument`/`loadWorkspace`의 최신 참조는 `useRef`(`loadDocumentRef`, `loadWorkspaceRef`)로
  우회해서 사용하도록 했다. 이렇게 하면 effect 자체는 마운트 시 한 번만 실행되지만, 내부에서
  호출하는 함수는 항상 최신 클로저를 참조한다.
- **버그 2 수정**: `isPathInsideFolder(filePath, folder)` 헬퍼를 추가해, 열려는 문서가 현재
  워크스페이스 루트(`workspaceFolderRef.current`) 내부에 있는지(임의 depth 포함) 판별한다.
  이미 워크스페이스 내부의 문서라면 `setWorkspaceFolder`/`loadWorkspace`를 호출하지 않고 기존
  루트를 유지한다. 워크스페이스가 아예 없거나 워크스페이스 밖의 문서(최근 문서, 파일 드롭 등)를
  열 때는 기존처럼 그 문서의 부모 폴더를 워크스페이스로 자동 설정한다.
- `loadDocument`의 `useCallback` 의존성 배열은 변경하지 않고 `workspaceFolderRef`를 통해
  최신 `workspaceFolder` 값을 읽도록 해서, 폴더 전환마다 `loadDocument` identity가 바뀌어
  다른 effect(메뉴 이벤트 리스너 등)가 불필요하게 재구독되는 부작용을 피했다.

## Progress
- [x] 시작 시 1회 실행 effect를 빈 deps + ref 패턴으로 수정 (버그 1)
- [x] `isPathInsideFolder` 헬퍼 추가, `loadDocument`에서 워크스페이스 내부 문서 여부 판별 후
      불필요한 workspaceFolder 재설정 방지 (버그 2)
- [x] `tsc --noEmit`, `cargo check` 통과 확인
- [x] 사용자 테스트로 버그 1 해결 확인, 버그 2는 이번 수정으로 해결

## Notes
- 사용자가 "폴더 추가(Multi-workspace)" 아이디어를 제안했으나, 백엔드가 단일
  `current_folder: Mutex<Option<PathBuf>>` 구조라 별도의 더 큰 작업(백엔드 자료구조를
  `Vec<PathBuf>`로 변경 등)이 필요하다고 판단해 이번 작업 범위에서는 제외하고 후속 논의로
  넘겼다.
