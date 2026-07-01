# Human UX Improvement Plan

**Date:** 2026-07-01  
**Scope:** VS Code extension, export/settings workflow, Tauri standalone app  
**Method:** GUI 실행이 제한된 환경에서 README, `package.json` contributions, VS Code host code, webview/Tauri UI code를 따라 인간 사용자의 클릭/저장/내보내기 흐름을 단계별로 시뮬레이션했다. Fleet mode에서 GPT-5.5와 Opus-4.8만 사용했다.

---

## Goal

현재 Structured Doc Editor를 실제 사용자가 문서 작성 도구로 사용할 때 겪을 수 있는 진입, 발견성, 저장 신뢰, export 결과 확인, Tauri parity 문제를 식별하고 후속 구현 우선순위를 정한다.

## Simulation Ledger

총 **14회**의 사용자 시뮬레이션을 수행했다.

| ID | 사용자 의도 | 시뮬레이션 흐름 | 발견한 불편 | 개선 방향 |
|---|---|---|---|---|
| UX-01 | 처음 설치 후 새 문서 작성 | VSIX 설치 후 Command Palette/Explorer에서 `.sdoc` 시작점을 찾음 | `.sdoc`를 여는 custom editor 매핑은 있지만 새 문서 생성 command/template가 없음 (`package.json` commands) | `Structured Doc: New Document` 명령, 템플릿, README 첫 문서 흐름 추가 |
| UX-02 | 기존 `.sdoc` 열기 | `.sdoc` 파일 열기 → custom editor init | JSON 파싱 실패 시 오류만 표시되고 복구/원본 보기/마이그레이션 제안이 없음 (`SdocEditorProvider.sendUpdate`) | 손상 문서 복구 UX, JSON 원본으로 열기, 백업 생성 |
| UX-03 | 일반 문서 편집과 삽입 | Toolbar `삽입` → 표/이미지/Draw.io/수식/다이어그램 | hover submenu와 아이콘 중심 UI라 초심자가 기능을 찾기 어려움 (`Toolbar.tsx`) | 검색형 삽입 메뉴, 키보드 접근성, 최근 사용 삽입 항목 |
| UX-04 | 문서 탐색 | Activity Bar → TOC/LOF/LOT | 초기에는 사이드패널이 숨김이고 아이콘만 보여 의미 파악이 느림 (`ActivityBar.tsx`) | 첫 실행 hint, 라벨 표시 모드, 빈 상태 설명 |
| UX-05 | 교차 참조 삽입 | CrossRef dialog에서 heading/figure/table 선택 | 외부 문서 anchor가 열기 이후 사용되지 않고, equation 분류/표시가 약함 (`openLinkedDocument`, `CrossReferenceDialog`) | anchor scroll 구현, equation 그룹/필터 추가 |
| UX-06 | 메타데이터 입력 | Header author/version, title input 편집 | VS Code와 Tauri의 title 처리 방식이 달라 사용자가 title/H1 관계를 예측하기 어려움 | title 자동 동기화 정책 명시, 수동/자동 토글 |
| UX-07 | PDF 첫 출력 | 파일 탭 → PDF export | Chrome/Edge 미설치 시 실패 메시지만 있음. `pdfScale`은 숨은 설정이라 결과가 작게 보여도 원인을 찾기 어려움 | 브라우저 설치/HTML 대체 액션, export 직전 scale 선택 |
| UX-08 | 한국형 캡션으로 HTML 공유 | 문서 설정에서 caption style 변경 → HTML export | 패널은 `meta.settings`를 바꾸지만 일부 export 경로는 전역 config 중심이라 결과 일관성이 불명확 | 모든 export 경로에서 `meta.settings > VS Code config > defaults` 우선순위 통일 |
| UX-09 | Slides custom CSS 적용 | 문서 설정 → Slide CSS 선택 → Slides export | CSS 경로만 보이고 미리보기 없음. 워크스페이스 밖 경로 선택 시 이식성 문제 경고가 없음 | CSS 경로 검증, 워크스페이스 내 복사 제안, preview/apply check |
| UX-10 | 오프라인 HTML 배포 | self-contained HTML 필요 | `export.selfContained`가 패널에 없고, full 모드 CDN fetch 실패 시 CDN 링크로 강등되어 오프라인 목적과 충돌 | self-contained 옵션 노출, KaTeX/Mermaid 번들 폴백 |
| UX-11 | 여러 포맷 연속 출력 | HTML/PDF/MD/AsciiDoc/Slides를 차례로 export | 출력 위치 선택 없이 소스 옆에 파일이 흩어지고 기존 파일 덮어쓰기 경고가 없음 | output directory 설정, Save As, overwrite confirm, batch export |
| UX-12 | Tauri 첫 실행 | standalone 앱 welcome → 새 문서/열기 | 시작 화면이 기능 학습을 돕지 못하고 샘플/최근 문서 관리가 부족함 (`tauri-app/src/App.tsx`) | 샘플 문서 열기, 최근 문서 삭제/핀, first-run guide |
| UX-13 | Tauri 저장 신뢰 | 편집 → menu save/Ctrl+S | 저장 성공/실패/dirty 상태 피드백이 부족함 (`save_document`, menu-save flush) | dirty indicator, last saved time, failure toast |
| UX-14 | Tauri export/settings | 파일 탭에서 PDF/Slides 클릭, CSS 경로 입력 | PDF/Slides 버튼은 보이나 미지원 alert. doc settings는 local state만 갱신되어 저장/export 반영이 불완전함 (`tauri-app/src/components/Editor.tsx`) | 미지원 버튼 비활성화 또는 구현, doc settings를 `meta.settings`에 저장 |

---

## Top User Pain Points

1. **첫 문서 진입이 약함** — 설치 후 바로 만들 수 있는 명령/템플릿이 없다.
2. **발견성이 낮음** — Activity Bar, Toolbar, file/export 기능이 아이콘과 숨은 패널 중심이다.
3. **저장과 export 결과를 신뢰하기 어렵다** — dirty 상태, 덮어쓰기, output 위치, 완료 액션이 일관되지 않다.
4. **문서별 설정과 export 결과의 연결이 불투명하다** — 패널 설정과 export 설정 경로가 일부 이원화되어 있다.
5. **오프라인/의존성 실패가 늦게 드러난다** — 브라우저, CSS, CDN 실패가 결과물 확인 단계에서야 드러난다.
6. **Tauri와 VS Code 기능 parity가 어긋난다** — 같은 UI처럼 보이지만 PDF/Slides, doc settings persistence가 다르다.

---

## Improvement Roadmap

### Phase 0 — Trust and entry points

- `Structured Doc: New Document` command 추가.
- 첫 문서 템플릿과 README quick start를 추가.
- export overwrite 확인과 공통 `Reveal in Explorer` 액션을 추가.
- dirty indicator, last saved status, 저장 실패 toast를 VS Code/Tauri에 추가.
- Tauri에서 미지원 PDF/Slides 버튼을 비활성화하거나 "지원 예정" 설명을 명확히 표시.

### Phase 1 — Export/settings consistency

- 모든 export 경로에서 `resolveSettings()` 기반 우선순위를 통일한다.
- `DocumentSettings`에 export 관련 문서별 옵션을 확장한다: `pdfScale`, `selfContained`, `slideBreakLevel`, `slideTransition`, `showTitleSlide`, `outputDir`.
- Export 패널에 실제 결과 미리보기 텍스트를 표시한다: caption label, output path, self-contained level.
- CSS 파일 경로 검증을 추가하고 워크스페이스 밖 경로는 경고/복사 제안을 제공한다.

### Phase 2 — Discoverability and accessibility

- Activity Bar에 라벨 표시/접기 옵션과 빈 상태 설명을 추가한다.
- Toolbar 삽입 메뉴를 검색형 command menu로 보강한다.
- Hover submenu에 키보드 탐색과 ARIA label을 보강한다.
- CrossRef dialog에 equation 그룹, 검색 필터, 외부 문서 anchor 이동을 추가한다.

### Phase 3 — Offline/export robustness

- KaTeX/Mermaid assets를 번들 폴백으로 제공해 `selfContained: full`이 네트워크 없이 동작하게 한다.
- Chrome/Edge 미검출 시 설치 링크와 HTML 대체 export 액션을 제공한다.
- CSS/CDN 읽기 실패는 silent fallback 대신 사용자에게 명확히 알린다.
- "모두 내보내기" batch export와 export queue를 추가한다.

### Phase 4 — Tauri parity

- Tauri doc settings를 `meta.settings`에 저장하고 export에 반영한다.
- Tauri CSS 선택을 VS Code처럼 file picker 기반으로 보강한다.
- Tauri PDF/Slides 지원 여부를 명확히 분기한다: 구현 전까지 UI 숨김/disabled, 구현 시 동일 converter/options 사용.
- Welcome screen에 샘플 문서, 최근 문서 관리, 초보자 안내를 추가한다.

---

## Acceptance Criteria

- 신규 사용자가 README만 보고 2분 안에 새 `.sdoc` 문서를 만들 수 있다.
- 같은 문서별 caption/export 설정이 HTML/PDF/Markdown/AsciiDoc/Slides에 동일하게 반영된다.
- export 시 output path와 overwrite 여부를 사용자가 예측/제어할 수 있다.
- 오프라인 full HTML은 네트워크 없이 수식과 Mermaid를 렌더링한다.
- Tauri에서 표시되는 export/settings 기능은 실제 지원 범위와 일치한다.

