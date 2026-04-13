---
ats: "0.1"
id: SDOC-020
title: "Heading 번호 매기기 버그 수정 — CSS counter reset 미작동"
status: done
priority: critical
created: 2026-04-13T16:00:00+09:00
modified: 2026-04-13T16:30:00+09:00
author: "@copilot"
---

# SDOC-020: Heading 번호 매기기 버그 수정 — CSS counter reset 미작동

## Context

SDOC-018/019 작업 이후 에디터 내 Heading 번호가 올바르게 리셋되지 않는 버그 발생.

**증상:**
- H1 → H2 → (새 H1) → H2 순서일 때, 두 번째 H2가 `2.1`이 아닌 `2.2`로 표시
- H3도 상위 Heading 변경 시 번호가 리셋되지 않음
- **TOC에서는** 올바른 번호가 표시됨 (JS 기반 카운팅은 정상)
- CSS counter 기반 에디터 렌더링만 문제

**영향 범위:** webview-ui, tauri-app 두 CSS 파일

## Scope

### In Scope
- webview-ui/src/styles/vscode-theme.css — heading counter 로직 수정
- tauri-app/src/styles/tauri-theme.css — 동일 수정 동기화
- shared/converter/jsonToHtml.ts — export HTML counter 정합성 확인

### Out of Scope
- TOC 번호 매기기 (정상 동작 중)
- Heading 색상/데코레이션 설정

## Approach

1. CSS counter-reset이 ProseMirror flat sibling 구조에서 작동하지 않는 근본 원인 분석
2. SDOC-018/019에서 변경된 CSS 확인하여 regression 포인트 특정
3. counter-reset / counter-set / counter-increment 조합 검증
4. webview-ui + tauri-app 동기화 수정

## Progress
- [x] 근본 원인 분석 (DOM 구조 vs CSS counter scope)
- [x] webview-ui CSS 수정
- [x] tauri-app CSS 동기화
- [x] export HTML counter 정합성 확인
- [x] 검증 완료
