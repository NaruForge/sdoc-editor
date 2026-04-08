# Change Log

All notable changes to the "Structured Doc Editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
