---
ats: "0.1"
id: SDOC-012
title: "Export 폰트 임베딩 최적화 — 파일 크기 감소"
status: ready
priority: high
created: 2026-04-08T00:00:00+09:00
modified: 2026-04-08T23:00:00+09:00
author: "copilot"
---

# SDOC-012: Export 폰트 임베딩 최적화

## Context
Legacy Font 2.0 TTF 4종(총 ~13.6MB)을 base64로 임베딩하면 HTML 파일이 ~18MB가 됨. 거의 빈 문서라도 동일한 크기. HTML export, PDF export, Slides export 모두 영향받음.

## Scope
### In Scope
- 실제 사용하는 weight만 임베딩 (설정 기반 필터링)
- 또는 WOFF2 변환으로 파일 크기 대폭 감소 (TTF 대비 ~60-70% 절약)
- 선택적 CDN 참조 옵션

### Out of Scope
- 폰트 서브셋팅 (사용 글자만 추출 — 복잡도 높음)

## Approach
(분석 후 결정)

## Progress
- [ ] TTF vs WOFF2 크기 비교 분석
- [ ] 사용 weight만 임베딩 로직 구현
- [ ] WOFF2 변환 가능 여부 확인
- [ ] 구현 및 테스트
