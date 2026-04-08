---
ats: "0.1"
id: SDOC-012
title: "Export 폰트 임베딩 최적화 — 파일 크기 감소"
status: done
priority: high
created: 2026-04-08T00:00:00+09:00
modified: 2026-04-09T00:00:00+09:00
author: "copilot"
---

# SDOC-012: Export 폰트 임베딩 최적화

## Context
Legacy Font 2.0 TTF 4종(총 ~13.6MB)을 base64로 임베딩하면 HTML 파일이 ~18MB가 됨. 거의 빈 문서라도 동일한 크기. HTML export, PDF export, Slides export 모두 영향받음.

## Scope
### In Scope
- TTF → WOFF2 변환으로 파일 크기 대폭 감소 (13.6MB → 5.1MB, ~63% 절약)
- 실제 사용하는 weight만 임베딩 (설정 기반 필터링)
- 기존 TTF 파일 삭제

### Out of Scope
- 폰트 서브셋팅 (사용 글자만 추출 — 복잡도 높음)
- CDN 참조 옵션 (현재 불필요)

## Approach
1. ttf2woff2 npm 패키지로 TTF → WOFF2 변환
2. BUNDLED_FONTS 배열, generateFontFaceCSS, loadBundledFontsAsBase64에서 파일명/MIME/format 업데이트
3. loadBundledFontsAsBase64에 weights 필터 파라미터 추가
4. Export 호출부에서 fontWeights 설정값 기반 Set<number> 전달
5. 4개 converter 파일 (src+shared, HTML+Slides) `format('truetype')` → `format('woff2')`

## Progress
- [x] TTF → WOFF2 변환 (ttf2woff2): 13.6MB → 5.1MB
- [x] 사용 weight만 임베딩 로직 구현 (loadBundledFontsAsBase64 weights 파라미터)
- [x] SdocEditorProvider.ts, SdocBookProvider.ts, exportToSlides.ts 업데이트
- [x] 4개 converter 파일 format 업데이트 (src+shared, HTML+Slides)
- [x] font-preview.html 업데이트
- [x] TTF 파일 삭제
- [x] v0.3.9 빌드 검증 (VSIX 7.78MB)
- [x] slide.transition 설정 추가 (none/fade/slide/convex/concave/zoom, 기본값 none)
