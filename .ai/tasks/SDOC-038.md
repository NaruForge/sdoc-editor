---
ats: "0.1"
id: SDOC-038
title: "LOF/LOT — 그림 목록 / 표 목록 사이드패널"
status: done
created: 2026-04-14
modified: 2026-04-14
author: "@copilot"
---

## Context

학술·기술 문서에서는 TOC 외에 LOF(List of Figures, 그림 목록)와 LOT(List of Tables, 표 목록)이 표준 구성요소이다.
이미지/표에는 이미 caption attr이 있고 번호 시스템도 갖춰져 있어 구현 비용이 낮다.

사용자 요청: TOC와 별개의 메뉴(탭)로 LOF/LOT 지원.

## Scope

- `webview-ui/src/components/ListOfFigures.tsx` — 신규 생성
  - doc에서 image 노드 스캔, caption attr 표시
  - 클릭 시 해당 이미지로 이동 + 스크롤
  - 빈 caption은 "(캡션 없음)" 표시
- `webview-ui/src/components/ListOfTables.tsx` — 신규 생성
  - doc에서 table 노드 스캔, caption attr 표시
  - 클릭 시 해당 표로 이동 + 스크롤
- `webview-ui/src/components/ActivityBar.tsx`
  - ActivityTab 타입에 `'lof' | 'lot'` 추가
  - TABS 배열에 Image(Image 아이콘), Table2(표 아이콘) 추가
- `webview-ui/src/components/SidePanel.tsx`
  - ActivityTab 타입 업데이트
  - lof/lot 패널 렌더링
- `tauri-app` — 동기화

## Approach

- TOC 패턴을 그대로 따라 구현 (editor 'update' 이벤트로 목록 재빌드)
- doc.descendants()로 전체 트리 탐색 (`doc.forEach`는 top-level만 탐색하므로 table 내부는 무시)
- `shared/settingsResolver.ts`의 prefix 설정을 읽어 "Figure 1. caption" 형식으로 표시

## Progress

- [x] ListOfFigures.tsx 생성
- [x] ListOfTables.tsx 생성
- [x] ActivityBar.tsx 탭 추가
- [x] SidePanel.tsx 패널 연결
- [x] CSS 스타일 추가
- [x] tauri-app 동기화
