---
ats: "0.1"
id: SDOC-059
title: "헤딩 H4~H6 렌더링 개선 — 전체 레벨 굵게 + 크기 스케일 통일"
status: done
priority: medium
created: 2026-07-16T09:00:00+09:00
modified: 2026-07-16T09:00:00+09:00
author: "@copilot"
---

# SDOC-059: 헤딩 H4~H6 렌더링 개선 — 전체 레벨 굵게 + 크기 스케일 통일

## Context

VS Code Editor View에서 헤딩이 H3까지만 정상적으로 렌더링되고 H4~H6은 본문과 구분되지
않는 평범한 텍스트로 표시되는 문제가 보고되었다. 원인은 Tailwind preflight가 브라우저
기본 헤딩 폰트 크기/굵기를 초기화하는데, `vscode-theme.css`/`tauri-theme.css`에는 H1~H3
전용 오버라이드만 존재하고 H4~H6에는 대응 규칙이 없었기 때문이다.

요청 사항: H6은 본문과 동일한 크기, H1~H5는 H6 기준 2pt씩 증가, H1~H6 전체 굵게(bold)
고정 적용.

## Scope

### In Scope
- `webview-ui/src/styles/vscode-theme.css`, `tauri-app/src/styles/tauri-theme.css`:
  - `--heading-size-h6: 1em`부터 `calc(1em + 2pt/4pt/6pt/8pt/10pt)`로 H5~H1까지 정의하는
    CSS 커스텀 프로퍼티 도입.
  - `--heading-font-weight: 700` 고정값 도입(레벨별 커스터마이즈 변수 대체).
  - `counter-reset`/`counter-set` 체인을 h4/h5/h6까지 확장, `::before` 넘버링 규칙 추가.
  - fold-toggle hover/collapsed 등 기존 h1~h3 전용 셀렉터를 h4~h6까지 확장.
- `webview-ui/src/extensions/tiptapExtensions.ts`, `tauri-app/src/extensions/tiptapExtensions.ts`:
  - `SectionFold`(레벨 제한 정규식 `/^H[1-3]$/`)와 `HeadingKeyboardShortcuts`(Tab/Shift-Tab
    사이클링)를 레벨 6까지 확장.

### Out of Scope
- `markdownToJson.ts`, `CrossReference.ts`, `TableOfContents.tsx`는 이미 레벨 1~6을 완전히
  지원하고 있어 변경 불필요(확인만 수행).
- HTML 내보내기(`jsonToHtml.ts`)의 임베디드 CSS 카운터는 여전히 h1~h4까지만 지원 —
  기존부터 존재하던 별개의 격차이며 이번 작업 범위 밖.

## Approach

브라우저 기본 헤딩 스타일이 아니라 CSS 커스텀 프로퍼티(`--heading-size-h1..h6`)를
`:root`/`.ProseMirror`에 단일 소스로 정의해 매직 넘버 없이 크기 스케일을 관리했다(Rule
3.3). 굵기는 사용자가 명시적으로 "H1~H6 모두 굵게"를 요청했으므로, 기존 레벨별 커스터마이즈
변수(`--font-weight-h1/h2/h3`, 사용자 설정과 연동)는 헤딩 CSS에서 더 이상 참조하지 않고
고정값 `--heading-font-weight: 700`으로 대체했다(기존 변수는 문서 제목 입력 등 다른 곳에서
여전히 사용되므로 제거하지 않음).

## Progress
- [x] `vscode-theme.css`/`tauri-theme.css`에 H1~H6 크기/굵기/카운터 CSS 추가
- [x] `SectionFold`/`HeadingKeyboardShortcuts` 레벨 6까지 확장(webview-ui/tauri-app)
- [x] `markdownToJson.ts`/`CrossReference.ts`/`TableOfContents.tsx` 레벨 1~6 지원 확인(수정 불필요)
- [x] `tsc --noEmit`(양쪽) 통과, `npm run build:webview` 통과
