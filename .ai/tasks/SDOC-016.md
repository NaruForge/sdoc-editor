---
ats: "0.1"
id: SDOC-016
title: "Math 편집 UX 개선 — 하이브리드 편집 + Inline/Block 토글"
status: done
priority: medium
created: 2026-04-13T22:00:00+09:00
modified: 2026-04-13T23:30:00+09:00
author: "copilot"
---

# SDOC-016: Math 편집 UX 개선 — 하이브리드 편집 + Inline/Block 토글

## Context
현재 MathBlock/MathInline 노드는 클릭 시 순수 텍스트 입력(LaTeX 소스)만 표시하고 라이브 프리뷰가 없다.
또한 Inline ↔ Block 타입 변환이 불가능하다. MathDialog는 신규 삽입 전용이다.

Notion/Obsidian 스타일의 하이브리드 편집 UX를 적용하여:
1. 클릭 → 인라인 편집 + 라이브 KaTeX 프리뷰
2. 더블클릭 → MathDialog 열기 (고급 편집 + 예제 + Inline/Block 토글)
3. 인라인 편집 중 Inline/Block 토글 버튼으로 즉시 타입 전환

## Scope
### In Scope
- MathBlock NodeView: 라이브 프리뷰 + 편집 툴바 (토글, Dialog 버튼)
- MathInline NodeView: 라이브 프리뷰 플로팅 패널 + 편집 툴바
- Inline ↔ Block 타입 전환 (ProseMirror delete+insert)
- handleMathConfirm Dialog 기반 타입 전환 버그 수정
- CSS 클래스 추가 (inline style 최소화)
- webview-ui ↔ tauri-app 동기화

### Out of Scope
- MathDialog UI 변경 (기존 그대로 사용)
- 키보드 단축키 추가
- 수식 자동완성/스니펫

## Approach
- 하이브리드 편집: click → inline edit (with preview), dblclick → dialog
- Inline/Block 토글: NodeView 편집 툴바에 전환 버튼 추가
- 타입 전환: `tr.replaceWith()`로 노드 삭제+재삽입 (setNodeMarkup는 group이 달라 실패)
- Block→Inline: Block을 paragraph(inline) 로 교체
- Inline→Block: 부모 paragraph의 유일한 자식이면 paragraph 자체를 block으로 교체, 아니면 inline 삭제 후 paragraph 뒤에 block 삽입
- CSS: `.math-edit-*` 클래스 시리즈

## Progress
- [x] SDOC-016 태스크 파일 생성
- [x] handleMathConfirm 타입 전환 수정 (webview-ui + tauri-app)
- [x] Math 편집 CSS 클래스 추가 (vscode-theme.css + tauri-theme.css)
- [x] MathBlock NodeView 재작성 (라이브 프리뷰 + 툴바 + 더블클릭)
- [x] MathInline NodeView 재작성 (플로팅 패널 + 툴바 + 더블클릭)
- [x] tauri-app 동기화 (MathBlock, MathInline, Editor.tsx, tauri-theme.css)
- [x] 빌드 검증 (tsc --noEmit 0 errors, VSIX 빌드 성공 v0.4.2)
- [x] 커밋 및 푸시 (2c1c4d7)
- [x] tauri-app 동기화
- [x] 빌드 검증 및 STATUS.md 갱신
