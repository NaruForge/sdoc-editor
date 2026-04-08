---
ats: "0.1"
id: SDOC-011
title: "Export to Slides (reveal.js)"
status: done
priority: medium
created: 2026-04-08T00:00:00+09:00
modified: 2026-04-08T23:00:00+09:00
author: "copilot"
---

# SDOC-011: Export to Slides (reveal.js)

## Context
.sdoc 문서를 프레젠테이션으로 활용하려는 요구. 기존 Marp/Slidev/reveal.js 등의 도구는 모두 Markdown 기반이며, WYSIWYG 에디터에서 직접 슬라이드를 생성하는 도구는 부재. Sdoc의 Tiptap JSON을 직접 reveal.js HTML로 변환하는 것이 정보 손실 없이 가장 효과적.

## Scope
### In Scope
- `jsonToSlides.ts`: Tiptap JSON → reveal.js HTML 변환 (shared + src 이중 구조)
- H1 기준 슬라이드 자동 분리
- H1 수평 + H2 수직 슬라이드 옵션 (`slide.breakLevel`)
- 메타데이터 기반 타이틀 슬라이드 자동 생성 (`slide.showTitleSlide`)
- 슬라이드 전용 테마 색상 (`slide.primaryColor`, `slide.accentColor`)
- KaTeX, Mermaid, highlight.js, 표, 이미지, 교차참조 모두 지원
- 내장 폰트 base64 임베딩
- Toolbar Export 메뉴 + Ctrl+Shift+P 명령
- 브라우저 자동 열기

### Out of Scope
- 슬라이드 전용 편집 모드 (확장 가능성만 열어둠)
- PPTX 내보내기
- 프레젠테이션 모드 (reveal.js 내장 기능으로 충분)
- 단계별 빌드 (fragment)

## Approach
- `jsonToHtml.ts` 기반으로 `jsonToSlides.ts` 작성
- H1 노드 기준으로 `<section>` 래핑, 수직 모드 시 H2 기준 중첩 `<section>`
- reveal.js v5 CDN 포함
- 기존 테마 설정 재활용 + 슬라이드 전용 오버라이드 옵션

## Known Issues
- 폰트 4종 base64 임베딩으로 HTML 파일 ~18MB (SDOC-012에서 해결 예정)

## Progress
- [x] 기존 도구 생태계 분석 (Marp, Slidev, reveal.js, Asciidoctor)
- [x] 변환 전략 결정 (jsonToSlides.ts, reveal.js HTML 직접 변환)
- [x] shared/converter/jsonToSlides.ts 구현
- [x] src/converter/jsonToSlides.ts 구현
- [x] src/commands/exportToSlides.ts 구현
- [x] SdocEditorProvider 연동 (slides format 추가)
- [x] package.json 명령 + 설정 등록
- [x] extension.ts 명령 등록
- [x] Toolbar Export 메뉴에 Slides 추가 (webview + tauri)
- [x] 빌드 검증 및 v0.3.8 릴리즈
