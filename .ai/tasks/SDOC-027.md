---
ats: "0.1"
id: SDOC-027
title: "방정식 태그와 CrossRef 레이블 분리"
status: done
created: 2026-04-14
modified: 2026-04-14
author: copilot
---

# SDOC-027: 방정식 태그와 CrossRef 레이블 분리

## Context

캡션 프리셋 시스템(SDOC-026) 도입 후, 방정식 우측에 렌더링되는 번호 태그까지
프리셋 prefix/parens 설정을 따르게 되어 `Equation 1`, `식 (1)` 등으로 표시되었다.

국제 표준 문서 관행상 방정식 우측 태그는 항상 `(N)` 형태이며,
CrossRef에서 참조할 때만 프리셋 스타일이 적용되어야 한다.

## Scope

### 변경 규칙
| 위치 | 이전 | 이후 |
|---|---|---|
| 방정식 우측 렌더링 태그 | 프리셋 따름 (`Equation 1`, `식 (1)` 등) | 항상 `(N)` 또는 `(H1.N)` |
| CrossRef 레이블 | 프리셋 따름 | 프리셋 따름 (유지) |
| Sequential/Hierarchical | 태그/CrossRef 모두 적용 | 동일 (유지) |

### 변경 파일
- `webview-ui/src/extensions/MathBlock.ts` — `_setEqNumber`에서 prefix/parens 제거, 항상 `(label)` 고정
- `tauri-app/src/extensions/MathBlock.ts` — 동일

## Progress

- [x] `webview-ui/src/extensions/MathBlock.ts` — `_setEqNumber` 수정
- [x] `tauri-app/src/extensions/MathBlock.ts` — 동일
- [x] 빌드 검증 (webview-ui: 에러 0)
