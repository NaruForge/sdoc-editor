---
ats: "0.1"
id: SDOC-013
title: "Markdown Export RAG 최적화 — Pandoc 앵커 + Converter 동기화"
status: done
priority: high
created: 2026-04-09T00:00:00+09:00
modified: 2026-04-09T00:00:00+09:00
author: "copilot"
---

# SDOC-013: Markdown Export RAG 최적화

## Context
Markdown 변환 시 헤딩 앵커가 `<a id="..."></a>` 형태의 HTML로 출력되어 RAG 파이프라인에서 노이즈가 됨.
또한 `src/converter/jsonToMarkdown.ts`와 `shared/converter/jsonToMarkdown.ts`의 기능 불일치 발견 (정렬/색상/하이라이트 누락).

## Scope
### In Scope
- 헤딩 앵커를 Pandoc 스타일 `{#id}`로 전환 (RAG 친화적)
- `src/converter/jsonToMarkdown.ts`를 `shared/` 버전과 동기화 (정렬, 색상, 하이라이트)

### Out of Scope
- GFM 자동 앵커 호환 (분석 결과 현재 `<a id>` 방식도 GFM에서 동작 안함)
- RAG 전용 별도 export 모드

## Approach
1. 헤딩 앵커: `<a id="id"></a>Text` → `Text {#id}` (Pandoc heading attributes)
2. src/converter를 shared/converter와 동기화: paragraph alignment, textStyle color, highlight mark

## Progress
- [x] shared/converter/jsonToMarkdown.ts: `<a id>` → `{#id}` 전환
- [x] src/converter/jsonToMarkdown.ts: `<a id>` → `{#id}` + 누락 기능 동기화
- [x] 빌드 검증
- [x] v0.4.0 버전업
