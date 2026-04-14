---
ats: "0.1"
id: SDOC-036
title: "TOC 클릭 스크롤 위치 개선 — center → start"
status: done
created: 2026-04-14
modified: 2026-04-14
author: "@copilot"
---

## Context

좌측 Sidebar의 TOC(목차) 항목을 클릭하면 에디터 커서가 해당 헤딩으로 이동하면서 화면이 스크롤된다.
현재 스크롤 동작은 `scrollIntoView({ block: 'center' })`로 헤딩이 뷰포트 **중앙**에 위치하도록 한다.

이 경우 헤딩 아래의 내용이 절반만 보여 문서 탐색 효율이 낮다.
헤딩이 **뷰포트 상단**에 위치(`block: 'start'`)하도록 변경하면 해당 섹션의 내용을 최대한 볼 수 있어 UX가 개선된다.

대상 파일:
- `webview-ui/src/components/TableOfContents.tsx` — `handleClick` 함수의 `scrollIntoView`
- `webview-ui/src/extensions/tiptapExtensions.ts` — 내부 앵커 링크 클릭 핸들러의 `scrollIntoView`
- `tauri-app/src/components/TableOfContents.tsx` — 동기화 대상 (존재 시)
- `tauri-app/src/extensions/tiptapExtensions.ts` — 동기화 대상 (존재 시)

## Scope

- `block: 'center'` → `block: 'start'` 변경 (4개소)
- 동작 영향: TOC 클릭, 문서 내 `#anchor` 링크 클릭 모두 포함

## Approach

`scrollIntoView`의 `block` 옵션을 `'start'`로 교체.
별도 오프셋 처리 없이 브라우저 기본 동작에 위임 (간결성 우선).

## Progress

- [x] TableOfContents.tsx 수정 (webview-ui)
- [x] tiptapExtensions.ts 수정 (webview-ui)
- [x] tauri-app 대응 파일 확인 및 동기화
- [x] STATUS.md 업데이트
