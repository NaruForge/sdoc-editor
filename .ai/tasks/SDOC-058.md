---
ats: "0.1"
id: SDOC-058
title: "헤딩 번호 제외(numbered: false) 기능 추가"
status: done
priority: medium
created: 2026-07-20T06:54:00+09:00
modified: 2026-07-20T06:54:00+09:00
author: "@copilot"
---

# SDOC-058: 헤딩 번호 제외(numbered: false) 기능 추가

## Context

H1은 항상 1번부터 자동 번호가 매겨지는데, "Introduction/Glossary처럼 번호가 필요 없는
헤딩"을 지원해달라는 요청이 있었다. "0번부터 시작하는 옵션"이 claim으로 제시되었으나,
SDOC(IEEE/ISO 스타일 문서)의 취지를 분석한 결과 0-시작은 실제 니즈(번호 없는 전/후주
섹션)를 해결하지 못한다고 판단했고, 대신 헤딩별 `numbered: false` 속성을 도입하는
방향으로 개선했다.

## Scope

### In Scope
- `sdoc.schema.json`: `headingNode.attrs`에 `numbered: boolean|null` 속성 추가.
- Tiptap 확장(`webview-ui`/`tauri-app` 공통 `tiptapExtensions.ts`): `Extension.create`의
  `addGlobalAttributes()`로 `heading` 노드에 `numbered` 전역 속성 부여. `false`일 때만
  `data-numbered="false"` HTML 속성으로 직렬화(기본값은 속성 생략으로 diff 노이즈 최소화).
- 에디터 CSS(`vscode-theme.css`/`tauri-theme.css`): `[data-numbered="false"]` 헤딩은
  `counter-increment: none`, `::before` 넘버링 텍스트 `content: none`으로 억제. 단, 하위
  레벨 카운터 리셋(`counter-set`)은 그대로 유지해 이후 중첩 섹션 번호가 어긋나지 않게 함.
- `CrossReference.ts`(`collectTargets`/`buildIdMap`): `numbered === false`인 헤딩은 자기
  레벨 카운터를 증가시키지 않고 번호 없는 텍스트를 라벨로 사용.
- `TableOfContents.tsx`(`computeNumbering`/`buildEntries`): 동일한 규칙으로 목차 번호 생략.
- `Toolbar.tsx`: H1~H3 버튼 옆에 "번호 제외" 토글 버튼 추가(현재 커서가 헤딩일 때만 활성).
- `shared/converter/jsonToHtml.ts`: 내보내기 HTML에도 `data-numbered="false"` 속성과 대응
  CSS 규칙(h1~h4, 기존 내보내기 CSS의 지원 범위) 추가.
- `shared/converter/jsonToMarkdown.ts`/`jsonToAdoc.ts`/`jsonToSlides.ts`: 번호 제외 헤딩은
  `h1Counter`(캡션 하이어라키 넘버링용) 증가를 건너뜀.
- `shared/mcp/sdocUtils.ts`의 `queryDocumentStructure`: 동일 규칙 반영.
- `docs/agent/.github/skills/sdoc-editing/SKILL.md`,
  `docs/agent/.github/instructions/sdoc-format.instructions.md`: AI 에이전트가
  `numbered: false`를 사용하도록 안내 추가.

### Out of Scope
- "0번부터 시작" 옵션 자체는 채택하지 않음(분석 결과 실제 니즈를 해결하지 못함).
- HTML 내보내기의 H5/H6 CSS 카운터 지원 확장 — 기존에도 h1~h4까지만 지원하던 사전
  존재 격차이며 이번 작업 범위 밖.
- `@tiptap/extension-heading`을 별도 의존성으로 추가하는 접근은 시도했으나, npm이 해당
  패키지 추가 시 `@tiptap/core`를 3.22.2 → 3.28.0으로 재해석하며 `@tiptap/react`와의
  호환성이 깨져(내부 API 불일치로 빌드 실패) 폐기. 대신 `Extension.addGlobalAttributes()`
  로 기존 StarterKit 번들 Heading에 속성만 추가하는 방식으로 전환해 의존성 변경 없이 구현.

## Approach

`Heading` 노드 자체를 교체하지 않고 별도 `Extension`에서 `addGlobalAttributes()`로
`numbered` 속성만 주입하는 방식을 택했다. 이는 (1) 새 npm 의존성을 추가하지 않아 기존
tiptap 패키지 버전 조합을 건드리지 않고, (2) StarterKit이 제공하는 Heading의 기본 동작
(레벨 1~6, 커맨드, 키보드 단축키, 마크다운 파싱 등)을 그대로 재사용할 수 있어 가장
안전한 접근이었다.

번호 제외 헤딩도 하위 레벨 카운터는 정상적으로 리셋하도록 설계했다(자기 자신의 번호만
숨기고, 그 아래 중첩된 일반 헤딩들은 정상적으로 1부터 다시 번호가 매겨짐). 이는 실제
IEEE/ISO 문서에서 Introduction 같은 섹션 아래에 번호 붙은 하위 섹션이 거의 없다는 점을
감안한 단순화이며, 필요 시 추후 조정 가능하다.

## Progress
- [x] `sdoc.schema.json`에 `numbered` 속성 추가
- [x] `tiptapExtensions.ts`(webview-ui/tauri-app) `addGlobalAttributes` 구현
- [x] 에디터 CSS `[data-numbered="false"]` 규칙 추가(양쪽 테마 파일)
- [x] `CrossReference.ts` 카운터 로직 갱신(양쪽)
- [x] `TableOfContents.tsx` 넘버링 로직 갱신(양쪽)
- [x] `Toolbar.tsx` "번호 제외" 토글 버튼 추가(양쪽)
- [x] 4개 컨버터(`jsonToHtml`/`jsonToMarkdown`/`jsonToAdoc`/`jsonToSlides`) 갱신
- [x] `shared/mcp/sdocUtils.ts` `queryDocumentStructure` 갱신
- [x] `docs/agent` Skill/Instructions 문서 갱신
- [x] `tsc --noEmit`(webview-ui, tauri-app, 루트) 통과 확인
- [x] `npm run build:webview` 통과 확인
