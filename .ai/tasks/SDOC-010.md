---
ats: "0.1"
id: SDOC-010
title: "README 분리 + What's New 자동 표시"
status: done
priority: low
created: 2026-04-08T00:00:00+09:00
modified: 2026-04-08T23:00:00+09:00
author: "copilot"
---

# SDOC-010: README 분리 + What's New 자동 표시

## Context
README.md에 사용자 매뉴얼과 개발자 가이드가 혼재되어 있었음. VS Code Extension 상세 페이지에 개발 빌드 명령, 프로젝트 구조, Tauri 빌드 등이 노출되는 문제. 또한 Extension 업데이트 시 변경사항을 알려주는 기능이 없었음.

## Scope
### In Scope
- README.md → 사용자 매뉴얼만 (기능, 설치, 사용법, 설정)
- CONTRIBUTING.md → 개발자 가이드 (빌드, 프로젝트 구조, 기술 스택, Tauri)
- CHANGELOG.md 생성 (버전별 변경사항)
- Extension 업데이트 시 CHANGELOG 자동 표시 (What's New)
- .vscodeignore에 CONTRIBUTING.md 제외

### Out of Scope
- SETUP.md 제거 (기존 파일 유지)

## Approach
- `globalState`에 버전 저장, 활성화 시 비교하여 업데이트면 markdown preview로 CHANGELOG 표시
- 첫 설치 시에는 표시하지 않고 업데이트 시에만 표시

## Progress
- [x] README.md 사용자 매뉴얼로 재작성
- [x] CONTRIBUTING.md 개발자 가이드 생성
- [x] CHANGELOG.md 생성
- [x] What's New 자동 표시 기능 구현 (extension.ts)
- [x] .vscodeignore 업데이트
- [x] v0.3.7 릴리즈
