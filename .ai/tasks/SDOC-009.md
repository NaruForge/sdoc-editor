---
ats: "0.1"
id: SDOC-009
title: "에디터 폰트 시스템 개선 — Legacy Font 2.0 번들 + 가중치 설정"
status: done
priority: medium
created: 2026-04-08T00:00:00+09:00
modified: 2026-04-08T23:00:00+09:00
author: "copilot"
---

# SDOC-009: 에디터 폰트 시스템 개선

## Context
sdoc 에디터의 폰트 시스템이 편집 화면(VS Code CSS 변수)과 내보내기(config 기반)로 분리되어 있었음. 사용자가 폰트를 직접 선택할 수 있는 방법이 제한적이었음.

## Scope
### In Scope
- Legacy Font 2.0 TTF 4종(Light, Regular, SemiBold, Bold) Extension 번들링
- VS Code Settings 드롭다운으로 요소별(body, bold, h1, h2, h3) 폰트 가중치 설정
- CSS custom properties 시스템으로 에디터 실시간 반영
- HTML/PDF 내보내기에 base64 폰트 임베딩

### Out of Scope
- 시스템 폰트 목록 조회 (복잡도 대비 가치 낮음 → 드롭다운으로 대체)
- 웹폰트(Google Fonts) 연동

## Approach
- Extension `media/fonts/`에 TTF 파일 번들
- `package.json`에 5개 enum 설정 추가 (font.body, font.bold, font.h1, font.h2, font.h3)
- webview에서 CSS custom property (`--font-weight-*`) 동적 적용
- HTML export 시 `embeddedFonts` 배열로 base64 `@font-face` 삽입
- CSP에 `font-src` 추가, `localResourceRoots`에 media/fonts 포함

## Progress
- [x] 현재 폰트 시스템 분석
- [x] 폰트 번들링 전략 결정 (Legacy Font 2.0 내장)
- [x] media/fonts/ 에 TTF 4종 배치
- [x] VS Code Settings 드롭다운 구현
- [x] CSS custom properties 시스템 구현
- [x] webview 에디터 실시간 반영
- [x] HTML/PDF export base64 폰트 임베딩
- [x] Tauri 앱 폰트 지원
- [x] 빌드 검증 및 v0.3.6 릴리즈
