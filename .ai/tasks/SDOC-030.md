---
ats: "0.1"
id: SDOC-030
title: "Callout / Admonition 블록 구현"
status: done
priority: high
created: 2026-04-14T22:10:00+09:00
modified: 2026-04-14T22:30:00+09:00
author: "@copilot"
---

# SDOC-030: Callout / Admonition 블록 구현

## Context
기술 문서의 Note/Warning/Tip/Danger 등 시각적 강조 블록 기능을 추가한다.
커스텀 Tiptap Node Extension으로 구현하며 5개 variant(note, info, tip, warning, danger)를 지원한다.

## Scope
### In Scope
- Callout 커스텀 Tiptap Node Extension (webview-ui + tauri-app)
- 5개 variant: note, info, tip, warning, danger
- CSS 스타일링 (아이콘 + 배경색 + 테두리)
- JSON Schema 추가
- Converter 4종 수정
- Markdown 변환: GitHub Alerts(`> [!NOTE]`) 매핑
- AsciiDoc 변환: `NOTE:`, `WARNING:` 등 Admonition 매핑
- Toolbar 버튼 (슬래시 메뉴 또는 드롭다운)
- BubbleMenu에서 variant 변경

### Out of Scope
- 커스텀 아이콘 입력 UI
- 슬래시 명령(`/callout`) 구현 (Slash Commands 확장은 별도 태스크)

## Approach
DiagramBlock의 NodeView 패턴을 참고하여 커스텀 Node로 구현한다.
block content(`"block+"`)를 허용하여 내부에 paragraph, list, code block 등 중첩 가능.

## Progress
- [x] Callout Node Extension 구현 (webview-ui/src/extensions/Callout.ts)
- [x] NodeView 구현 (아이콘+레이블 헤더 + 콘텐츠 영역)
- [x] CSS 스타일링 (5 variant × 아이콘/배경/테두리)
- [x] sdoc.schema.json calloutNode 추가 (variant enum)
- [x] jsonToHtml.ts callout 처리 (class="callout callout-{variant}")
- [x] jsonToMarkdown.ts callout → GitHub Alerts (`> [!TYPE]`)
- [x] jsonToAdoc.ts callout → AsciiDoc Admonition (NOTE/TIP/WARNING/CAUTION)
- [x] jsonToSlides.ts callout 처리
- [x] markdownToJson.ts GitHub Alerts 파싱 (`> [!NOTE]` 등)
- [x] Toolbar Insert 메뉴 내 Callout 서브메뉴 (5 variant)
- [x] BubbleMenu variant 변경 버튼 (callout 활성 시 표시)
- [x] Tauri 동기화 (extensions/Callout.ts 복사, tiptapExtensions.ts, BubbleMenuBar.tsx, Toolbar.tsx, tauri-theme.css)
