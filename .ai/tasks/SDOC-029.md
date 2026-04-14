---
ats: "0.1"
id: SDOC-029
title: "Blockquote 인용 블록 구현"
status: done
priority: high
created: 2026-04-14T22:10:00+09:00
modified: 2026-04-14T22:30:00+09:00
author: "@copilot"
---

# SDOC-029: Blockquote 인용 블록 구현

## Context
현재 SDOC 에디터에 blockquote 노드가 없어 Markdown Import 시 인용문이 손실된다.
Tiptap의 `@tiptap/extension-blockquote`가 이미 존재하므로 등록 + 스타일링 + Converter 추가로 구현한다.

## Scope
### In Scope
- Tiptap Blockquote 확장 등록 (webview-ui + tauri-app)
- CSS 스타일링 (왼쪽 테두리, 들여쓰기, 배경)
- JSON Schema 추가
- Converter 4종 수정 (HTML, Markdown, AsciiDoc, Slides)
- Markdown Import 파싱 지원
- Toolbar 버튼 추가
- BubbleMenu 토글 버튼

### Out of Scope
- `cite` 속성 URL 입력 UI (추후 구현)

## Approach
1. webview-ui/src/extensions/tiptapExtensions.ts에 Blockquote 확장 추가
2. CSS 스타일링
3. JSON Schema blockquote 노드 추가
4. Converter 4종에 blockquote case 추가
5. Markdown Import에서 `> ` 파싱 지원 (md-to-json)
6. Toolbar에 인용 버튼 추가
7. BubbleMenu에 토글 버튼 추가
8. Tauri 동기화

## Progress
- [x] tiptapExtensions.ts에 Blockquote 등록 (StarterKit 기본 제공)
- [x] CSS 스타일링 추가 (blockquote)
- [x] sdoc.schema.json blockquoteNode 추가
- [x] jsonToHtml.ts blockquote 처리
- [x] jsonToMarkdown.ts blockquote 처리 (`> ` 형식)
- [x] jsonToAdoc.ts blockquote 처리 (`[quote]\n____` 형식)
- [x] jsonToSlides.ts blockquote 처리
- [x] markdownToJson.ts blockquote 파싱 (`> ` 인식)
- [x] Toolbar 버튼 추가 (Quote 아이콘)
- [x] BubbleMenu 토글 추가
- [x] Tauri 동기화 (tiptapExtensions.ts, BubbleMenuBar.tsx, Toolbar.tsx, tauri-theme.css)
