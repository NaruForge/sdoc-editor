---
ats: "0.1"
id: SDOC-014
title: "Markdown Table 변환 개선 — 복잡 테이블 HTML 폴백 + 안정성 강화"
status: done
priority: high
created: 2026-04-09T00:00:00+09:00
modified: 2026-04-09T00:00:00+09:00
author: "copilot"
---

# SDOC-014: Markdown Table 변환 개선

## Context
sdoc을 Markdown으로 변환할 때 복잡한 테이블(colspan/rowspan 병합 셀, 멀티블록 셀 내용)이
GFM pipe 테이블 규격의 한계로 인해 구조가 깨지거나 데이터가 손실되는 문제.

### 심층 리스크 분석 결과

| 리스크 | 심각도 | 설명 |
|--------|--------|------|
| colspan/rowspan 무시 | **CRITICAL** | 병합 셀이 있으면 행마다 컬럼 수 불일치 → 테이블 렌더링 완전 파괴 |
| 컬럼 수 불일치 | **HIGH** | colspan > 1인 셀이 있으면 물리 셀 수 ≠ 논리 컬럼 수 → separator와 body 미스매치 |
| 파이프 문자 미이스케이프 | **MEDIUM** | 셀 내용에 `\|` 포함 시 테이블 구조 파괴 |
| 멀티블록 셀 내용 | **MEDIUM** | 리스트, 코드블록 등이 single-line으로 압축 → 구조 손실 |
| 셀 내 줄바꿈 | **MEDIUM** | hardBreak, 블록 요소가 행 경계 파괴 |
| 헤더 없는 테이블 | **LOW-MEDIUM** | GFM은 header + separator 필수 → 인식 실패 |
| HTML colspan/rowspan 누락 | **MEDIUM** | HTML 변환기에서도 colspan/rowspan 미출력 |

## Scope
### In Scope
- Markdown 테이블: 단순 테이블 GFM 파이프 + 복잡 테이블 HTML 폴백
- 파이프 문자 이스케이프, 헤더리스 테이블 빈 헤더 삽입
- HTML 변환기 colspan/rowspan 지원 추가
- src/converter ↔ shared/converter 동기화

### Out of Scope
- AsciiDoc 변환기 colspan/rowspan (별도 태스크)
- 셀 내용의 textAlign 보존 (GFM 한계)

## Approach
1. **isComplexTable** 감지: colspan > 1, rowspan > 1, 멀티블록 셀
2. **단순 테이블**: GFM pipe 유지 + 파이프 이스케이프 + 빈 헤더 row 삽입 + 컬럼 패딩
3. **복잡 테이블**: `<table>` HTML 폴백 (GFM/CommonMark에서 valid raw HTML)
4. **HTML 변환기**: `<th>` / `<td>`에 colspan/rowspan 속성 추가
5. **동기화**: shared/ → src/ 복사

## Progress
- [x] 리스크 심층 분석 (7개 리스크 식별)
- [x] shared/converter/jsonToMarkdown.ts: 복잡 테이블 HTML 폴백 구현
- [x] shared/converter/jsonToMarkdown.ts: 파이프 이스케이프, 빈 헤더, 컬럼 패딩
- [x] shared/converter/jsonToHtml.ts: colspan/rowspan 속성 출력
- [x] src/converter/ 동기화 (jsonToMarkdown.ts, jsonToHtml.ts)
- [x] 빌드 검증
- [x] v0.4.1 버전업
