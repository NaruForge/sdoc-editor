# Change Log

All notable changes to the "Structured Doc Editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-04-14

### Added
- **캡션 프리셋 시스템**: 접두사·구분자 자유 입력 대신 4가지 표준 프리셋 드롭다운으로 변경
  - **IEEE (간결형)**: Fig. 1, Table I (로마 숫자), (1)
  - **ISO/IEC (정석형)**: Figure 1, Table 1, Equation (1)
  - **Modern (현대형)**: Figure 1, Table 1, Equation 1
  - **Korean (한국형)**: 그림 1, 표 1, 식 (1)
- **로마 숫자 표 번호 (IEEE)**: IEEE 프리셋 선택 시 표 번호가 I, II, III 형식으로 표시
- **번호 방식 통합**: 이미지·표·수식 번호 방식(Sequential/Hierarchical)을 단일 컨트롤로 통합
- **`caption.style` VS Code 설정**: `ieee` / `iso` / `modern` / `korean` 중 선택
- **`caption.crossRefIncludeCaption` 설정**: 교차 참조에 캡션 텍스트 포함 여부 제어

### Changed
- **문서 설정 패널 간소화**: 6개 이상의 텍스트 입력 필드 → 캡션 스타일 드롭다운 1개
- **번호 방식 용어 통일**: `Simple` → `Sequential` 으로 전체 교체 (UI, 타입, 설정값, 스키마)
- **방정식 우측 태그 고정**: 에디터 내 방정식 우측 번호는 프리셋에 관계없이 항상 `(N)` / `(H1.N)` 형태로 표시
- **교차 참조 레이블**: 프리셋에 따라 `(1)` / `Equation (1)` / `Equation 1` / `식 (1)` 형태로 표시
- **구분자 통합**: 이미지·표·수식 각각이던 구분자 설정을 프리셋의 단일 구분자로 통합

### Removed
- **설정 제거**: `caption.imagePrefix`, `caption.tablePrefix`, `caption.equationPrefix`, `caption.separator`, `caption.imageSeparator`, `caption.tableSeparator`, `caption.equationSeparator`

## [0.4.1] - 2026-04-09

### Fixed
- **복잡 테이블 Markdown 변환 개선**: colspan/rowspan 병합 셀, 멀티블록 셀 내용 있는 테이블을 HTML `<table>` 폴백으로 정확하게 변환
- **테이블 셀 파이프 문자 이스케이프**: 셀 내용의 `|` 문자가 테이블 구조를 파괴하는 문제 수정
- **헤더 없는 테이블 GFM 호환성**: 빈 헤더 row 자동 삽입으로 GFM 렌더러 인식 보장
- **HTML export colspan/rowspan 속성 추가**: `<th>` / `<td>` 태그에 병합 셀 속성 정상 출력

## [0.4.0] - 2026-04-09

### Changed
- **Markdown 앵커 Pandoc 스타일 전환**: `<a id="..."></a>` → `{#id}` 형태로 변경하여 RAG 파이프라인 노이즈 최소화
- **Markdown Converter 동기화**: `src/converter`에 누락된 정렬/색상/하이라이트 지원 추가

## [0.3.9] - 2026-04-08

### Changed
- **폰트 포맷 WOFF2 전환**: TTF → WOFF2 변환으로 폰트 파일 크기 ~63% 감소 (13.6MB → 5.1MB)
- **사용 weight만 임베딩**: Export 시 설정에서 실제 사용하는 font-weight만 base64 임베딩하여 HTML/PDF/Slides 파일 크기 대폭 감소

### Removed
- TTF 폰트 파일 제거 (WOFF2로 대체)

## [0.3.8] - 2026-04-08

### Added
- **Export to Slides**: .sdoc 문서를 reveal.js 기반 HTML 슬라이드로 변환
  - H1 제목 기준 슬라이드 자동 분리
  - H1 수평 + H2 수직 슬라이드 모드 옵션 (`slide.breakLevel`)
  - 문서 메타데이터 기반 타이틀 슬라이드 자동 생성 옵션 (`slide.showTitleSlide`)
  - 슬라이드 전용 테마 색상 설정 (`slide.primaryColor`, `slide.accentColor`)
  - KaTeX 수식, Mermaid 다이어그램, 코드 뺨록, 표, 이미지 모두 지원
  - 내장 폰트 base64 임베딩으로 독립적 HTML 출력
  - Toolbar Export 메뉴 및 `Ctrl+Shift+P` 명령 모두 지원
  - 브라우저에서 바로 열기 (키보드 탐색, 전체 화면, 슬라이드 오버뷰)

## [0.3.7] - 2026-04-08

### Changed
- **README 분리**: 사용자 매뉴얼(README.md)과 개발자 가이드(CONTRIBUTING.md) 분리
- **What's New 자동 표시**: Extension 업데이트 시 CHANGELOG를 자동으로 보여줍니다

## [0.3.6] - 2026-04-08

### Added
- **Bundled Legacy Font 2.0**: Extension now includes 4 weight variants (Light 300, Regular 400, SemiBold 600, Bold 700)
- **Font Weight Configuration**: New VS Code Settings to customize font weights
  - `structuredDocEditor.font.body`: Body text weight (default: Regular)
  - `structuredDocEditor.font.bold`: Bold text weight (default: Bold)
  - `structuredDocEditor.font.h1`: H1 heading weight (default: Bold)
  - `structuredDocEditor.font.h2`: H2 heading weight (default: SemiBold)
  - `structuredDocEditor.font.h3`: H3 heading weight (default: SemiBold)
- **Font Embedding in Exports**: HTML/PDF exports now embed font files as base64 for self-contained documents

### Changed
- Default font family now includes 'Legacy Font 2.0' as primary font
- CSS system uses custom properties (`--font-weight-*`) for dynamic weight application

## [0.3.5] - 2026-04-07

### Added
- Previous version features (update history to be documented)

## [Unreleased]

### Planned
- Additional export format improvements
- Enhanced diagram editing workflow
