---
ats: "0.1"
id: SDOC-034
title: "에디터 배율(Zoom) 조절 슬라이더"
status: done
priority: medium
created: 2026-04-14T10:00:00+09:00
modified: 2026-04-14T11:00:00+09:00
author: "@copilot"
---

# SDOC-034: 에디터 배율(Zoom) 조절 슬라이더

## Context

긴 문서 편집 시 텍스트 크기를 사용자가 자유롭게 조절할 수 없어 불편함이 있음.
에디터 하단에 항상 표시되는 슬라이더로 60%~200% 범위에서 % 단위로 배율 조정 가능하도록 개선 요청.
원본 데이터에는 전혀 영향 없는 순수 View 레이어 개선.

## Scope

### In Scope
- 에디터 하단 `ZoomBar` 컴포넌트 (슬라이더 + `-`/`+` 버튼 + % 표시/리셋)
- 배율 범위: 60% ~ 200%, step: 5%
- `localStorage`로 배율 값 영속 저장
- CSS `zoom` 프로퍼티로 콘텐츠 영역(제목 + 본문) 스케일 적용
- `editor-content-area` 구조: flex column → scroll area + zoom bar 분리
- webview-ui + tauri-app 동기화

### Out of Scope
- VS Code 설정(`settings.json`)에 zoom 값 저장
- Ctrl+`+`/`-` 키보드 단축키 (별도 태스크)

## Approach

`editor-content-area`를 flex column으로 변경:
```
.editor-content-area (flex column, overflow: hidden)
  └─ .editor-scroll-area (flex: 1, overflow-y: auto)  ← 스크롤 영역
       └─ zoom-content-wrapper (zoom: X% — CSS zoom)
            ├─ .editor-title-area
            └─ EditorContent (ProseMirror)
  └─ .editor-zoom-bar (height: 28px, flex-shrink: 0)  ← 고정 하단 바
```

CSS `zoom` 프로퍼티 선택 이유:
- `transform: scale()`보다 레이아웃 공간을 자연스럽게 처리
- `font-size` 변경과 달리 이미지·다이어그램 등 모든 요소 균일 스케일

## Progress
- [x] SDOC-034 태스크 파일 생성
- [x] CSS: `.editor-scroll-area`, `.editor-zoom-bar` 스타일 추가
- [x] Editor.tsx: `zoom` 상태 + `localStorage` 영속화 + 레이아웃 수정
- [x] ZoomBar 컴포넌트 구현 (슬라이더 + 버튼 + 리셋)
- [x] tauri-app 동기화
- [x] 빌드 확인 + 커밋
