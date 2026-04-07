---
ats: "0.1"
id: SDOC-004
title: "HTML 내보내기 Self-Contained 단일 파일"
status: done
priority: high
created: 2026-04-07T09:00:00+09:00
modified: 2026-04-07T09:00:00+09:00
author: "@contributor-01"
---

# SDOC-004: HTML 내보내기 Self-Contained 단일 파일

## Context
현재 HTML 내보내기는 이미지를 상대 경로(`./images/...`)로 참조하고, KaTeX/Mermaid를 CDN으로 로드한다.
다른 사람에게 HTML 파일 하나만 전달했을 때 이미지가 보이지 않고, 오프라인에서는 수식/다이어그램도 렌더링되지 않는 문제가 있다.

## Scope
### In Scope
- 이미지를 base64 data URI로 임베딩 (기본 동작)
- `export.selfContained` 설정 추가 (`images-only` | `full`)
  - `images-only` (기본): 이미지만 base64 임베딩, KaTeX/Mermaid는 CDN 유지
  - `full`: KaTeX CSS/JS + 폰트, Mermaid JS도 인라인 임베딩 (~2MB 증가)
- `src/converter/jsonToHtml.ts`와 `shared/converter/jsonToHtml.ts` 양쪽 업데이트
  - 이미지 리졸버 콜백(async) 지원: 파일 시스템 접근은 호출자가 제공
- `src/commands/exportToHtml.ts`에서 문서 디렉토리 기준 이미지 파일 읽기 → base64 변환

### Out of Scope
- Drawio/SVG 특수 이미지 형식 처리 (추후)
- Tauri 앱 내보내기 연동 (별도 태스크)

## Approach
1. `ExportSettings`에 `selfContained` 옵션 추가
2. converter의 `convertImage()`에 이미지 리졸버 콜백 패턴 도입
   - `imageResolver?: (src: string) => Promise<string>` — src를 받아 data URI 반환
   - VS Code 측: `vscode.workspace.fs.readFile()` + base64 변환
   - shared 측: 추상화된 콜백 (호출자가 Node fs 등 제공)
3. `generateHtmlDocument()`에서 `selfContained: 'full'`이면 CDN 대신 인라인 스크립트/스タイル 삽입
4. KaTeX/Mermaid 번들은 node_modules에서 읽어서 인라인

## Progress
- [x] ExportSettings 인터페이스에 selfContained 옵션 추가
- [x] convertJsonToHtml에 embeddedAssets 파라미터 지원
- [x] generateScriptTags로 CDN/인라인 스크립트 분기
- [x] src/commands/exportToHtml.ts에서 embedImagesAsBase64 구현
- [x] src/commands/exportToHtml.ts에서 fetchCdnAssets (full 모드) 구현
- [x] package.json에 export.selfContained 설정 추가
- [x] shared/converter/jsonToHtml.ts 동기화
- [ ] 테스트
