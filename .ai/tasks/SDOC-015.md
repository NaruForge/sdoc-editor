---
ats: "0.1"
id: SDOC-015
title: "코드베이스 리팩토링 — 하네스 엔지니어링 기반 구축"
status: in-progress
priority: high
created: 2026-04-09T00:00:00+09:00
modified: 2026-04-10T02:00:00+09:00
author: "@contributor-01"
---

# SDOC-015: 코드베이스 리팩토링 — 하네스 엔지니어링 기반 구축

## Context

100% AI Agent가 작성한 코드베이스를 전면 감사한 결과, **스파게티 수준은 "중상"** 으로 판정됩니다.

### 감사 요약 (스파게티 지수)

| 영역 | 심각도 | 핵심 문제 |
|------|--------|-----------|
| Converter 이중화 | 🔴 Critical | `src/converter/` ↔ `shared/converter/` 2,534줄 완전 복제, 일부 드리프트로 **버그 발생** |
| SdocEditorProvider | 🔴 Critical | 1,389줄 God Class — 15가지 이상의 책임이 한 파일에 집중 |
| 유틸리티 복제 | 🔴 Critical | `convertWebviewUrisToRelativePaths` 5벌, `embedImagesAsBase64` 4벌, `getMimeType` 4벌 |
| Editor.tsx (웹뷰) | 🔴 Critical | 790줄 God Component — 15개 useState, 11종 메시지 핸들러 |
| 타입 안전성 | 🟠 High | `any` 남용 — `TiptapNode.attrs`, 메시지 프로토콜, `window.*` 글로벌 전부 무타입 |
| 인터페이스 중복 | 🟠 High | `TiptapNode`/`TiptapMark` 10벌, `SdocMeta` 9벌, `ExportSettings` 6벌 |
| Linting 부재 | 🟠 High | ESLint/Prettier 설정 0개 — 코드 품질 자동 검증 없음 |
| tauri-app 동기화 | 🟠 High | `BubbleMenuBar` 색상 기능 누락, `EditorContext` 폰트 시스템 미동기화, CSS 760줄 차이 |
| 의존성 관리 | 🟠 High | webview-ui ↔ tauri-app 간 12개 패키지 버전 불일치, `npm-run-all` 미관리 |
| TS 설정 | 🟡 Medium | 3개 패키지간 strictness 불일치 (`noUnusedLocals`, `noUnusedParameters`) |
| Converter 상태 관리 | 🟠 High | 모듈 레벨 변경 가능 카운터 — 동시 호출 시 넘버링 오류 |
| 인라인 스타일 | 🟡 Medium | 다이얼로그 6개 컴포넌트에 과도한 inline style (Tailwind 미활용) |
| 빈 catch 블록 | 🟡 Medium | SdocEditorProvider에 5곳 이상 에러 묵살 |

### 발견된 실제 버그

1. **`shared/converter/markdownToJson.ts`**: 다이어그램 펜스 코드 블록 파싱 순서 오류 → MCP `sdoc_import` 도구가 `diagram` 노드를 `codeBlock`으로 잘못 변환
2. **`src/converter/jsonToAdoc.ts`**: `textStyle`/`highlight` 마크 핸들러 누락 → VS Code AsciiDoc 내보내기 시 텍스트 색상/형광펜 서식 소실

## Scope

### In Scope

**Phase 0: 즉시 버그 수정**
- `shared/converter/markdownToJson.ts` 다이어그램 파싱 순서 수정
- `src/converter/jsonToAdoc.ts` 누락 마크 핸들러 추가

**Phase 1: 기반 인프라 (Linting & Types)**
- ESLint + Prettier 설정 (root, webview-ui, tauri-app)
- 공유 타입 추출 (`shared/types.ts`)
- 메시지 프로토콜 타입 정의 (`shared/types/messages.ts`)
- `window.*` 글로벌 타입 선언 (`webview-ui/src/types/globals.d.ts`)
- TypeScript 설정 통일 (3개 패키지 strictness 일치)

**Phase 2: Converter 통합**
- `src/converter/` 삭제 → `shared/converter/`로 단일화
- `src/commands/*.ts` 임포트 경로 전환
- Converter 모듈 레벨 상태 → 컨텍스트 객체 패턴으로 전환
- 공유 유틸 추출 (`escapeHtml`, `convertInlineContent`)

**Phase 3: Extension Host 분해**
- `SdocEditorProvider` 분해:
  - `src/utils/imageUtils.ts` (이미지 임베딩, MIME 타입, 웹뷰 URI 변환)
  - `src/utils/fontUtils.ts` (폰트 로딩, 가중치 매핑)
  - `src/utils/themeUtils.ts` (테마/설정 읽기, 로고 해석)
  - `src/utils/exportUtils.ts` (내보내기 공통 로직)
  - `src/utils/sdocMigration.ts` (레거시 마이그레이션)
- Export 커맨드 중복 제거 (공유 유틸 사용)
- `SdocBookProvider` 중복 코드 공유 유틸로 전환

**Phase 4: Webview 분해**
- `Editor.tsx` 분해:
  - `useEditorMessages.ts` (메시지 라우팅 훅)
  - `useDialogState.ts` (다이얼로그 상태 리듀서 훅)
  - `preprocessImportedHtml.ts` (유틸리티 분리)
- 공유 상수 추출 (`TEXT_COLORS`, `HIGHLIGHT_COLORS`)
- `TableNodeView.tsx` 삭제 (데드 코드)
- `Toolbar.tsx` 내부 `Button` 컴포넌트 외부 이동 + 성능 최적화
- 인라인 스타일 → CSS 클래스 전환 (다이얼로그 6개)
- `console.log` 제거

**Phase 5: 의존성 & 빌드 정리**
- webview-ui ↔ tauri-app 패키지 버전 동기화
- `npm-run-all` → `npm-run-all2` 교체
- `asciidoctor` 외부 설정 및 미사용 devDependency 정리
- Tauri 플러그인 버전 범위 구체화 (`^2` → `^2.x.y`)
- 경로 별칭 통일 (root + webview-ui에 `@shared` 추가)

### Out of Scope
- Tauri-app 기능 완전 동기화 (별도 태스크로 분리)
- i18n 시스템 도입 (한/영 UI 텍스트 혼재 문제)
- CSS 완전 리팩토링 (vscode-theme.css 분할)
- 테스트 코드 작성 (별도 태스크)

## Approach

**점진적 리팩토링** 전략을 채택합니다. 각 Phase는 독립적으로 커밋 가능하며, 기능 회귀를 방지하기 위해 Phase 완료 시마다 빌드 검증을 수행합니다.

Phase 순서 근거:
1. Phase 0이 최우선 — 실제 버그 수정
2. Phase 1이 먼저인 이유: Linting과 타입 인프라가 없으면 이후 리팩토링에서 새로운 `any`와 스타일 불일치가 재발
3. Phase 2가 Phase 3보다 먼저인 이유: Converter 통합이 가장 큰 중복(2,534줄)을 제거하며 위험도가 낮음
4. Phase 3~4는 가장 복잡한 작업이므로 인프라가 갖춰진 후 진행
5. Phase 5는 기능 변경 없는 환경 정리로 마지막

## Progress

### Phase 0: 즉시 버그 수정
- [x] `shared/converter/markdownToJson.ts` 다이어그램 펜스 파싱 순서 수정
- [x] `src/converter/jsonToAdoc.ts` textStyle/highlight 마크 핸들러 추가

### Phase 1: 기반 인프라
- [x] ESLint 설정 추가 (root + webview-ui + tauri-app)
- [x] Prettier 설정 추가
- [x] `shared/types.ts` 생성 — `TiptapNode`, `TiptapMark`, `SdocMeta`, `ExportSettings`
- [x] `shared/types/messages.ts` 생성 — 웹뷰 ↔ 확장 메시지 discriminated union
- [x] `webview-ui/src/types/globals.d.ts` — window 글로벌 타입 선언
- [x] TypeScript 설정 통일 (noUnusedLocals, noUnusedParameters 등)

### Phase 2: Converter 통합
- [x] `src/converter/` 삭제, `src/commands/` 임포트를 `shared/converter/`로 전환
- [x] Converter 모듈 레벨 mutable state → 컨텍스트 객체 패턴으로 전환
- [x] `shared/converter/utils.ts` 추출 — `escapeHtml`, 공통 유틸

### Phase 3: Extension Host 분해
- [x] `src/utils/imageUtils.ts` 추출
- [x] `src/utils/fontUtils.ts` 추출
- [x] `src/utils/themeUtils.ts` 추출
- [ ] `src/utils/exportUtils.ts` 추출
- [x] Export 커맨드 중복 제거
- [x] `SdocBookProvider` 공유 유틸 전환

### Phase 4: Webview 분해
- [x] `useEditorMessages.ts` 훅 추출
- [x] `useDialogState.ts` 훅 추출
- [x] `preprocessImportedHtml.ts` 유틸 분리
- [x] 공유 상수 추출, 데드 코드 삭제, Toolbar 최적화
- [ ] 인라인 스타일 → CSS 클래스 전환
- [x] `console.log` 제거

### Phase 5: 의존성 & 빌드 정리
- [ ] 패키지 버전 동기화 (webview-ui ↔ tauri-app)
- [ ] `npm-run-all` → `npm-run-all2` 교체
- [ ] 미사용 의존성 정리 (`asciidoctor` external 등)
- [ ] 경로 별칭 통일 (`@shared`)
