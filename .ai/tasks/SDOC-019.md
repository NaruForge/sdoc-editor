---
ats: "0.1"
id: SDOC-019
title: "Settings 아키텍처 리팩토링 — 문서별 설정 분리 + 설정 패널 UI"
status: done
priority: high
created: 2026-04-13T12:36:00+09:00
modified: 2026-04-13T15:30:00+09:00
author: "@contributor-01"
---

# SDOC-019: Settings 아키텍처 리팩토링 — 문서별 설정 분리 + 설정 패널 UI

## Context

현재 모든 에디터 설정(26개)이 VS Code Preference(`structuredDocEditor.*`)에 있으며, 워크스페이스 전역으로 동일하게 적용된다.
그러나 캡션 접두사(Image vs 그림), 번호 매김 방식, 제목 색상 등은 **문서마다 달라야 하는** 속성이다.

예: 한국어 보고서는 "그림 1", 영문 보고서는 "Figure 1" — 같은 워크스페이스에 두 문서가 공존할 수 없는 문제.

이 태스크는 문서별로 달라야 하는 9개 설정을 sdoc 파일의 `meta.settings`로 이동하고,
에디터 내 사이드바 패널 UI를 통해 문서별로 설정을 편집할 수 있게 한다.

## Scope

### In Scope

**대상 설정 9개 (meta.settings로 이동):**

| 그룹 | 설정 | 타입 | 기본값 |
|------|------|------|--------|
| 제목 | `headingNumbering` | boolean | `true` |
| 제목 | `headingDecoration` | boolean | `true` |
| 제목 | `headingH1Color` | string (hex) | `"#A50034"` |
| 제목 | `headingH2Color` | string (hex) | `"#A50034"` |
| 제목 | `headingH3Color` | string (hex) | `"#A50034"` |
| 캡션 | `captionImagePrefix` | string | `"Image"` |
| 캡션 | `captionTablePrefix` | string | `"Table"` |
| 캡션 | `captionNumbering` | `"simple" \| "hierarchical"` | `"simple"` |
| 방정식 | `equationNumbering` | `"sequential" \| "hierarchical"` | `"sequential"` |

**스키마 변경:**
- sdoc 파일에 `meta.settings` 필드 추가
- 설정 우선순위: `문서 meta.settings` > `VS Code Preference` > `하드코딩 기본값`

**설정 패널 UI:**
- 오른쪽 사이드바 패널 (TOC와 동일 위치, 탭으로 전환)
- Toolbar에 ⚙️ 아이콘 버튼 추가 (TOC 버튼 옆)
- 3개 접이식 그룹: 제목/번호, 캡션, 방정식
- 컬러피커: `<input type="color">` (시스템 컬러피커 팝업)
- '기본값 불러오기' 버튼으로 전체 초기화 (meta.settings 삭제 → VS Code 폴백)

**Export 연동:**
- Export commands에서 meta.settings 우선 읽기

**Tauri 동기화:**
- tauri-app에 동일 설정 패널 반영

### Out of Scope
- 폰트 설정(font.body/bold/h1~h3, theme.fontFamily) — 조직 단위 설정으로 유지
- Export 전용 설정(export.*, slide.*) — 실행 시점 결정이므로 전역 유지
- 조직 브랜딩(theme.companyLogo/Name/primaryColor/accentColor) — 전역 유지
- 인프라 설정(update.sharedFolder) — 전역 유지
- image.defaultAlignment — 에디터 동작 설정이므로 전역 유지

## Approach

### 설정 우선순위 체계

```
문서 meta.settings (최우선)
  ↓ 없으면
VS Code Preference (폴백)
  ↓ 없으면
하드코딩 기본값
```

- 기존 문서(meta.settings 없음): VS Code 설정으로 동작 → **하위호환 100%**
- 새 문서 생성: VS Code 설정값을 meta.settings 초기값으로 복사
- 사용자가 설정 패널에서 변경: meta.settings만 업데이트

### UI 설계 — 설정 패널

```
┌──────────────────────────────────────────────────────┐
│ Toolbar:  ... [📑 TOC] [⚙️ Settings]                │
├──────────────────────────┬───────────────────────────┤
│                          │ [📑 TOC | ⚙️ Settings]   │ ← 탭 헤더
│                          ├───────────────────────────┤
│                          │ ▼ 제목 / 번호             │
│                          │   번호 매김    [✓]        │
│                          │   데코레이션   [✓]        │
│                          │   H1 색상    [■] #A50034  │
│     에디터 영역           │   H2 색상    [■] #A50034  │
│                          │   H3 색상    [■] #A50034  │
│                          ├───────────────────────────┤
│                          │ ▼ 캡션                    │
│                          │   이미지 접두사  [Image ]  │
│                          │   표 접두사      [Table ]  │
│                          │   번호 방식   (•) simple   │
│                          │              ( ) hierarchi │
│                          ├───────────────────────────┤
│                          │ ▼ 방정식                   │
│                          │   번호 방식   (•) sequenti │
│                          │              ( ) hierarchi │
│                          ├───────────────────────────┤
│                          │ [🔄 기본값 불러오기]       │
│                          │   ↑ VS Code 설정으로 복원  │
└──────────────────────────┴───────────────────────────┘
```

**패널 동작:**
- TOC 탭 활성 시: 기존 TOC 패널 표시
- Settings 탭 활성 시: 설정 패널 표시
- 동시에 두 탭이 활성화되지 않음 (상호 배타)
- Toolbar의 ⚙️ 버튼: Settings 탭 토글 (이미 열려있으면 사이드바 전체 닫기)
- Toolbar의 📑 버튼: TOC 탭 토글 (기존 동작 유지)

**설정 변경 흐름:**
```
사용자가 패널에서 설정 변경
  → React state 업데이트
  → postMessage('updateDocSettings', { settings })
  → SdocEditorProvider.updateDocSettings()
  → meta.settings 업데이트 + 파일 저장
  → settingsChanged 메시지로 webview에 확인 전달
  → CSS 변수 + window.__editorSettings 즉시 반영
```

### 구현 Phase 분할

#### Phase 1: 인프라 — 타입 + 머지 로직
- `DocumentSettings` 인터페이스 정의 (`shared/types.ts`)
- `SdocMeta.settings?: Partial<DocumentSettings>` 추가
- `resolveSettings()` 머지 함수 구현 (`shared/utils/settingsResolver.ts`)
- sdoc JSON 스키마 업데이트 (`sdoc.schema.json`)

#### Phase 2: Extension Host 연동
- `SdocEditorProvider.sendSettings()` 변경: meta.settings + VS Code 머지
- `updateDocSettings` 메시지 핸들러 추가
- 새 문서 생성 시 VS Code 설정 → meta.settings 초기값 복사
- `unwrapSdoc()` 마이그레이션에 settings 호환 처리

#### Phase 3: 설정 패널 UI (webview-ui)
- `DocumentSettingsPanel` 컴포넌트 구현
  - 3개 접이식 섹션 (제목, 캡션, 방정식)
  - 토글 스위치, 텍스트 입력, 라디오 버튼, 컬러피커
  - '기본값 불러오기' 버튼
- 기존 TOC 패널과 탭 전환 구조 구현
  - `SidePanel` 래퍼 컴포넌트 (탭 헤더 + 패널 전환)
- Toolbar에 ⚙️ 버튼 추가
- EditorContext에 `docSettings` 상태 추가
- `updateDocSettings` 메시지 전송 로직

#### Phase 4: Export 연동
- `src/commands/` Export 커맨드에서 meta.settings 우선 읽기
- `shared/converter/` 함수에 resolved settings 전달
- `syncCrossReferences()`에서 meta.settings 활용

#### Phase 5: Tauri 동기화 + 정리
- `tauri-app/src/`에 설정 패널 동기화
- `tauri-app/src/adapters/tauriMessaging.ts`에 설정 메시지 추가
- `tauri-theme.css`에 설정 패널 스타일 추가
- Rust backend에 settings 저장/읽기 추가

## Progress

### Phase 1: 인프라
- [x] `DocumentSettings` 인터페이스 정의 (`shared/types.ts`)
- [x] `SdocMeta.settings` 필드 추가
- [x] `resolveSettings()` 머지 함수 구현
- [x] `sdoc.schema.json` 스키마 업데이트
- [x] MCP tool handlers에 settings 반영

### Phase 2: Extension Host
- [x] `SdocEditorProvider.sendSettings()` meta.settings 머지 적용
- [x] `updateDocSettings` 메시지 핸들러 구현
- [x] 새 문서 생성 시 meta.settings 초기값 복사
- [x] `unwrapSdoc()` settings 호환 처리

### Phase 3: 설정 패널 UI
- [x] `SidePanel` 탭 전환 래퍼 컴포넌트
- [x] `DocumentSettingsPanel` 컴포넌트 (3 접이식 섹션)
- [x] 제목 섹션: 토글 스위치 2개 + 컬러피커 3개
- [x] 캡션 섹션: 텍스트 입력 2개 + 라디오 2개
- [x] 방정식 섹션: 라디오 2개
- [x] '기본값 불러오기' 버튼
- [x] Toolbar ⚙️ 버튼 추가
- [x] EditorContext `docSettings` 상태 연동
- [x] CSS 스타일링 (vscode-theme.css)

### Phase 4: Export 연동
- [x] Export commands에서 resolveSettings() 사용
- [x] Converter 함수에 resolved settings 전달

### Phase 5: Tauri 동기화
- [x] tauri-app 컴포넌트 동기화
- [x] tauri-theme.css 설정 패널 스타일
- [ ] Rust backend settings 처리 (향후 — 현재는 클라이언트 측 dispatch만)
