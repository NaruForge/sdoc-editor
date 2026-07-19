---
ats: "0.1"
id: SDOC-053
title: "탐색기에서 모든 확장자 파일 표시 (drawio.svg 등 문서 외 파일 지원)"
status: done
priority: medium
created: 2026-07-02T16:25:00+09:00
modified: 2026-07-02T16:25:00+09:00
author: "@copilot"
---

# SDOC-053: 탐색기에서 모든 확장자 파일 표시 (drawio.svg 등 문서 외 파일 지원)

## Context

사용자가 좌측 사이드바(탐색기) 파일 목록에서 `.drawio.svg`와 같은 문서가 아닌 파일이
전혀 표시되지 않는다는 문제를 보고했다. 탐색기가 `.sdoc`/`.tiptap.json` 확장자만 필터링해
보여주고 있어, `drawio/`나 `images/` 하위에 생성된 다이어그램·이미지 파일은 폴더 자체가
`is_supported_document` 필터에 걸려 리스트에서 완전히 누락되었다.

## Investigation

- Rust `collect_explorer_entries`가 파일에 대해서만 `is_supported_document(&path)`(확장자가
  `.sdoc` 또는 `.tiptap.json`인 경우만 true)를 만족해야 `entries`에 추가하고 있어, VS Code
  탐색기처럼 폴더의 전체 내용을 보여주는 것과 달리 sdoc-app 탐색기는 편집 가능한 문서만
  보여주는 제한된 뷰였다.
- 단순히 필터를 제거하면 두 가지 파생 문제가 생김:
  1. 탐색기에서 이미지/drawio 파일을 클릭하면 기존 `onOpenFile` → `loadDocument(path)`가
     호출되어 sdoc JSON 파서가 이미지 바이너리를 파싱하려다 실패함.
  2. 기존 `rename_entry`가 폴더가 아닌 모든 파일에 대해 무조건 `.sdoc`/`.tiptap.json`
     확장자를 강제로 붙이고 있어, 이미지나 drawio 파일 이름을 바꾸면 확장자가
     `image.png` → `image.png.sdoc`처럼 손상되는 잠재적 버그가 있었음(이번에 함께 발견해 수정).

## Scope

### In Scope
- `tauri-app/src-tauri/src/commands.rs`:
  - `ExplorerEntry`에 `is_document: bool` 필드 추가 — `.sdoc`/`.tiptap.json`이면 true.
  - `collect_explorer_entries`: 파일 필터를 제거하고 모든 파일을 항목에 포함시키되,
    각 항목에 `is_document`를 채워 프론트엔드가 열기 동작을 분기할 수 있게 함.
  - `is_supported_document` → `is_document_path`로 이름 변경 (판별 대상이 더 이상
    "탐색기에 표시할 파일"이 아니라 "편집기에서 열 수 있는 문서"이므로).
  - `rename_entry`: 원본이 문서 파일(`is_document_path`)일 때만 `.sdoc`/`.tiptap.json`
    확장자를 강제하고, 그 외 파일은 사용자가 입력한 이름을 그대로 쓰되 확장자를 생략하면
    원본 확장자를 유지하도록 수정 (이미지/drawio 이름 변경 시 확장자 손상 버그 수정).
  - `create_folder` 등 나머지 `ExplorerEntry` 생성 지점에 `is_document: false` 채움.
- `tauri-app/src/App.tsx`: `ExplorerEntry` 타입에 `isDocument: boolean` 추가. 시작 화면의
  "열린 폴더" 최근 문서 목록 필터를 `entry.kind === 'file'` → `entry.isDocument`로 변경
  (그렇지 않으면 이미지/drawio 파일 클릭 시 `loadDocument`가 호출되어 파싱 오류 발생).
- `tauri-app/src/components/SidePanel.tsx`:
  - `handleEntryClick`: `entry.isDocument`이면 기존처럼 편집기에서 열고, 아니면
    `@tauri-apps/plugin-shell`의 `open(path)`로 시스템 기본 앱에서 열도록 분기.
  - 이미지 계열 파일(`.png/.jpg/.jpeg/.gif/.webp/.bmp/.svg`, `.drawio.svg` 포함)은
    `FileImage` 아이콘으로 구분 표시.
  - 빈 상태 안내 문구를 "표시할 .sdoc / .tiptap.json 파일이 없습니다" → "표시할 파일이
    없습니다"로 변경.

### Out of Scope
- 파일 타입별 미리보기(썸네일) — 아이콘 구분만 지원, 이미지 미리보기는 범위 밖.
- 탐색기에서 문서가 아닌 파일의 삭제/이동 등 세부 컨텍스트 메뉴 커스터마이징 — 기존
  `ExplorerContextMenu`(이름 변경/새 폴더/시스템 탐색기 보기/경로 복사)가 파일 종류와
  무관하게 이미 동작하므로 별도 변경 불필요.

## Approach

- 백엔드가 "이 파일을 편집기에서 열 수 있는가"라는 의미 있는 정보(`is_document`)를 명시적으로
  내려주도록 해서, 프론트엔드가 파일명 문자열을 다시 파싱해 문서 여부를 추측하지 않도록 했다
  (Rule 1.1 복제 금지 — 확장자 판별 로직을 Rust 쪽 한 곳에만 둠).
- `open(path)`는 SDOC-051/052에서 이미 `shell:allow-open` 권한과 함께 사용 중이던 API라
  새 권한 추가 없이 재사용 가능했다.

## Progress
- [x] `ExplorerEntry`에 `is_document` 필드 추가, 모든 생성 지점 갱신
- [x] `collect_explorer_entries`에서 파일 필터 제거 (모든 확장자 포함)
- [x] `rename_entry`가 문서 파일에만 확장자 강제 적용하도록 수정 (이미지/drawio 이름 변경 버그 수정)
- [x] `App.tsx`/`SidePanel.tsx`에서 `isDocument` 기반으로 열기 동작 분기
- [x] 이미지 계열 파일 아이콘 구분 표시
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- 탐색기에서 문서가 아닌 파일을 클릭하면 앱 내에서 열리지 않고 OS 기본 프로그램이 실행된다
  (VS Code가 텍스트 편집기가 아닌 파일을 클릭했을 때의 동작과 유사). Draw.io 파일은 이미지
  본문 더블클릭(SDOC-051/052에서 구현한 `window.__openDrawio`)과는 별개의 경로이며, 탐색기
  목록에서의 클릭은 시스템 기본 앱(보통 draw.io 데스크톱 또는 이미지 뷰어)으로 연다.
