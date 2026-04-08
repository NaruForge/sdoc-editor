# Change Log

All notable changes to the "Structured Doc Editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
