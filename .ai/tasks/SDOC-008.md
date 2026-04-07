---
ats: "0.1"
id: SDOC-008
title: "Rename .sdoc-project to .sdocbook"
status: done
priority: medium
created: 2026-04-07T16:00:00+09:00
modified: 2026-04-07T16:30:00+09:00
author: "@contributor-01"
---

# SDOC-008: Rename .sdoc-project to .sdocbook

## Context
`.sdoc-project`라는 확장자가 직관적이지 않고 사용성이 떨어진다.
여러 `.sdoc` 문서를 묶어 하나의 출판물로 만든다는 의미를 직관적으로 전달하기 위해
`.sdocbook` 확장자를 채택한다. "책(book)" 메타포가 직관적이고, mdBook/GitBook 등
기존 생태계에서도 유사 개념으로 사용되고 있다.

## Scope
### In Scope
- 파일 확장자: `.sdoc-project` → `.sdocbook`
- JSON 필드: `sdocProject` → `sdocBook`
- 스키마 파일 이름 및 내용 변경
- Provider 클래스/파일명: `SdocProjectProvider` → `SdocBookProvider`
- VS Code viewType: `structuredDocEditor.sdocProject` → `structuredDocEditor.sdocBook`
- package.json 등록 변경
- AI 태스크/결정 로그 업데이트

### Out of Scope
- 기존 `.sdoc-project` 파일 자동 마이그레이션 (아직 배포 전)
- Tauri 앱 변경 (별도 태스크)

## Approach
배포 전이므로 하위 호환 없이 일괄 변경한다.

## Progress
- [x] 스키마 파일 리네임 및 내용 변경
- [x] SdocProjectProvider → SdocBookProvider 리네임 및 내용 변경
- [x] package.json 등록 변경
- [x] extension.ts 임포트 변경
- [x] AI 태스크/결정 로그 업데이트
