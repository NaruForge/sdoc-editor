---
ats: "0.1"
id: SDOC-050
title: "Tauri 상단 메뉴바(File/Edit/View/Help) 신규 도입"
status: done
priority: medium
created: 2026-07-02T14:35:00+09:00
modified: 2026-07-02T14:35:00+09:00
author: "@copilot"
---

# SDOC-050: Tauri 상단 메뉴바(File/Edit/View/Help) 신규 도입

## Context

사용자가 tauri-app 편집 화면 최상단에 File/Edit 같은 전통적인 가로 메뉴바를 도입하면
향후 기능 확장에 유리할 것 같다는 의견을 제시했다. 검토 결과 두 가지 구현 방식(네이티브
Tauri Menu API vs 커스텀 HTML 컴포넌트)을 제안했고, 사용자는 플랫폼 무관하게 동일한 모양을
보장하는 **커스텀 HTML 컴포넌트** 방식을 선택했다.

조사 중 `App.tsx`에 `menu-new`/`menu-open`/`menu-save` 이벤트 리스너가 이미 존재했으나
이를 emit하는 Rust 네이티브 메뉴가 없어 완전히 죽은 코드였음을 확인해 함께 정리했다.

## Scope

### In Scope
- `MenuBar.tsx` 신규 컴포넌트: 선언적 `MenuDef[]` 배열을 받아 렌더링하는 범용 드롭다운
  메뉴바 (라벨 클릭으로 열림/닫힘, 열린 상태에서 다른 라벨에 hover 시 전환, 바깥 클릭/Esc로
  닫힘 — 항목 추가는 배열에 추가만 하면 되므로 확장 용이)
- `Editor.tsx`에 File/Edit/View/Help 4개 메뉴 배치:
  - File: 새 문서/문서 열기/폴더 열기/저장/HTML·Markdown·AsciiDoc 내보내기/Markdown·HTML
    가져오기/JSON 소스 보기/종료
  - Edit: 실행 취소/다시 실행 (editor.can() 기반 활성/비활성)
  - View: 사이드바 토글/확대·축소·초기화/번호 매기기 토글/헤딩 장식 토글
  - Help: 정보(앱 버전 표시, `@tauri-apps/api/app`의 `getVersion()` 사용)
- File/View 메뉴 항목에 대응하는 실제 키보드 단축키 추가: Ctrl+N/O, Ctrl+=/-/0
  (Ctrl+S/Z/Shift+Z는 기존 `useTiptapEditor` 훅과 Tiptap History 확장이 이미 처리 중이라
  중복 등록하지 않음)
- `App.tsx`에 `handleExit`(`@tauri-apps/plugin-process`의 `exit(0)`) 추가, `onNewDocument`/
  `onOpenDocument`/`onExit`를 `Editor`에 prop으로 배선
- 죽은 코드 정리: emit되지 않던 `menu-new`/`menu-open`/`menu-save` 리스너 제거
  (`tauri://file-drop` 리스너는 유지)
- `tauri-theme.css`에 `.app-menu-bar`, `.app-menu-dropdown` 등 스타일 추가

### Out of Scope
- 네이티브 OS 메뉴(Tauri Menu API) — 사용자가 커스텀 HTML 방식을 선택하여 제외
- Edit 메뉴의 잘라내기/복사/붙여넣기/찾기 — 브라우저 네이티브 클립보드 권한/Tiptap 검색
  기능이 아직 없어 범위 밖으로 미룸
- webview-ui 동기화 — 이 메뉴바는 tauri-app 전용 UI이며 VS Code 확장은 이미 자체 메뉴/커맨드
  팔레트를 제공하므로 동기화 대상 아님

## Approach

- SDOC-032에서 Toolbar를 29개 → 12개로 슬림화한 결정과 이번 메뉴바 도입은 상충하지 않는다.
  Toolbar는 서식/삽입 등 문서 편집 액션에 집중하고, 메뉴바는 파일/앱 수준 액션(새 문서, 내보내기,
  종료 등)을 전담하는 별개의 UI 레이어이기 때문이다.
- `MenuBar`는 상태(`openIndex`)만 내부에서 관리하고 메뉴 구성은 부모(`Editor.tsx`)가 선언적
  배열로 주입하므로, 새로운 메뉴나 항목이 필요해지면 `menuBarMenus` 배열에 추가하는 것만으로
  확장 가능하다 (Rule 3.1 SRP 준수: 메뉴 UI 로직과 메뉴 콘텐츠를 분리).

## Progress
- [x] `MenuBar.tsx` 신규 컴포넌트 구현 (드롭다운 열기/닫기, 바깥 클릭/Esc 닫힘, hover 전환)
- [x] `Editor.tsx`에 File/Edit/View/Help 메뉴 배선 및 렌더링
- [x] `App.tsx`에 `handleExit`, `onNewDocument`/`onOpenDocument`/`onExit` prop 배선
- [x] Ctrl+N/O/=/-/0 키보드 단축키 추가
- [x] 죽은 `menu-new`/`menu-open`/`menu-save` 리스너 제거
- [x] `tauri-theme.css`에 메뉴바 스타일 추가
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- Help 메뉴의 "정보" 항목은 `getVersion()`으로 `tauri.conf.json`의 버전을 동적으로 읽어와
  하드코딩된 버전 문자열이 stale해지는 것을 방지했다.
- 향후 네이티브 OS 메뉴로 전환이 필요해지면 `menuBarMenus` 배열을 Tauri `Menu`/`Submenu`
  빌더 입력으로 재사용할 수 있도록 구조를 단순하게 유지했다.
