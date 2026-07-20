# Change Log

All notable changes to the "Structured Doc Editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.13] - 2026-07-20

### Changed
- Unified document migration, normalization, stable IDs, numbering, and cross-reference rendering in the TypeScript document core used by both hosts
- Moved shared Tiptap behavior, editor UI, and structural CSS into `shared/editor/`
- Replaced implicit `window` callbacks with typed host bridges, extension runtimes, and validated message boundaries
- Split the VS Code provider and Tauri backend monoliths into focused asset, export, file, settings, watcher, and workspace modules
- Aligned both frontend workspaces on one Tiptap 3.28.0 and highlight.js 11.11.1 dependency graph

### Added
- Shared document contract fixtures and regression tests for migration, IDs, cross-references, settings, converters, and host messages
- Architecture decision record for typed editor host bridges

### Fixed
- Ensured the retired `Check for Extension Update` and `Setup AI Support` commands are absent from the published extension
- Moved the image alignment toolbar outside the image hit area so Draw.io diagrams remain easy to open with a double-click
- Disposed Tauri event listeners safely across app teardown and React remounts

## [0.4.12] - 2026-07-20

### Changed
- Rebuilt the README as a concise open-source project landing page shared by GitHub and the VS Code Marketplace
- Added Marketplace, CI, license, repository, issue tracker, homepage, and discovery metadata
- Clarified installation, supported formats, AI integration, desktop usage, document format, and contributor workflows
- Verified that VSIX packaging embeds the root README as the Marketplace description

### Removed
- Removed the redundant shared-folder extension updater and its activation-time check, command, setting, and `version.json` artifact
- Removed the `Setup AI Support` command and all workspace mutation for copied instructions or MCP configuration
- Removed the bundled Chat Skill, MCP server, AI authoring assets, and their runtime dependencies

## [0.4.11] - 2026-07-20

### Added
- Marketplace icon using the LG Active Red and Heritage Red color palette with an original structured-document symbol
- Repository-wide `AGENTS.md`, architecture guide, and ADRs for durable contributor guidance
- GitHub Actions checks, Dependabot configuration, version synchronization, and core document tests

### Changed
- Unified the VS Code and Tauri packages under one npm workspace and upgraded the build/test toolchain
- Moved shared editor components and Tiptap extensions into `shared/editor/`
- Strengthened document, MCP, host-message, and image-path type boundaries
- Lazy-loaded Mermaid to reduce editor startup work
- Replaced machine-specific packaging scripts with a portable, pinned VSIX workflow

### Removed
- Retired the completed `.ai` task database, stale planning archives, duplicate ESLint configs, and obsolete build scripts

### Security
- Updated runtime and development dependencies; `npm audit` now reports zero known vulnerabilities

## [0.4.10] - 2026-07-20

### Added
- **헤딩 번호 제외 (`numbered: false`)**: Introduction, Glossary 등 번호가 필요 없는 헤딩을 툴바 토글(#, "번호 제외")로 지정 가능
  - 스키마(`sdoc.schema.json`)에 `numbered` 속성 추가, 에디터/CrossRef/목차(TOC)/HTML·Markdown·AsciiDoc·Slides 내보내기·MCP 문서 구조 조회 전체에 반영
  - 무번호 헤딩도 하위 레벨 카운터는 정상적으로 리셋되어 번호 밀림 없음
- **Tauri 탐색기 대폭 강화**
  - 우클릭 이름 변경, VS Code식 정렬, 새 문서/새 폴더, 빈 공간 컨텍스트 메뉴(시스템 탐색기 열기/경로 복사/새로고침)
  - 폴더 접기/펼치기 + 하단 상태바 경로 표시
  - 파일/폴더 삭제 → OS 휴지통 이동 + 커스텀 확인 다이얼로그 + 되돌리기(Undo) 토스트
  - 워크스페이스 폴더 파일시스템 변경 자동 감지 및 탐색기 새로고침(외부 프로그램 변경 포함)
  - 시작 화면 최근 작업 폴더 목록 + 마지막 워크스페이스 자동 복원
  - 문서 외 파일(이미지, drawio.svg 등) 탐색기 표시 지원
- **Tauri 상단 메뉴바** (File/Edit/View/Help) 신규 도입
- **PRODUCT.md**: 다른 AI/개발자가 프로젝트를 동일하게 재현할 수 있도록 UX/UI, 아키텍처, 지원 포맷 전체를 정리한 재구현 가이드 문서 추가

### Changed
- **헤딩 렌더링 H1~H6 전 레벨 지원**: 기존 H1~H3만 정상 렌더링되던 문제 해결
  - H1~H6 모두 굵게(bold) 고정, H6 = 본문 크기, H1~H5는 H6 기준 2pt씩 증가하는 크기 스케일 적용
  - 헤딩 접기(Fold), Tab/Shift-Tab 레벨 순환 단축키도 H6까지 확장

### Fixed
- **Draw.io 다이어그램**: 빈 이미지 생성 및 더블클릭 미실행 버그 수정 (`assetProtocol` 설정 누락), 경로 파싱 근본 수정(Windows 백슬래시 인코딩 버그)
- **Tauri 탐색기**: 워크스페이스 폴더 전환/문서 열기 버그, 확장자 손상 없는 이름 변경 버그 수정

## [0.4.8] - 2026-06-16

### Added
- **Custom CSS 파일 지원**: 에디터 내부 설정 패널(⚙️)에서 Slide/HTML Export용 CSS 파일을 직접 선택 가능
  - 문서별 `meta.settings.slideCssPath` / `meta.settings.htmlCssPath`에 워크스페이스 상대 경로 저장
  - 기존 `theme.customStyles` (settings.json 문자열) 대비 사용성 대폭 개선
  - 파일이 지정되면 파일 내용 우선, 없으면 settings.json 폴백
- **chatSkills 자동 등록**: Extension 설치만으로 `/sdoc-editing` 슬래시 커맨드 사용 가능 (setupAgent 실행 불필요)

### Changed
- **AI Instructions 경량화**: `.sdoc` 파일 작업 시 자동 로딩되는 instructions를 234줄에서 33줄로 축소 (토큰 소비 ~86% 감소)
- **MCP `sdoc_getSchema` 강화**: JSON Schema와 함께 AI Authoring Quick Reference (노드/마크 타입 예시) 반환
- **"Setup AI Agent" → "Setup AI Support"**: MCP 등록 + 슬림 instructions 복사로 단순화 (스킬 파일 복사 제거)

## [0.4.7] - 2026-06-12

### Fixed
- **MCP 설정 경로 마이그레이션**: Copilot CLI가 `.vscode/mcp.json` 지원을 제거함에 따라, "Setup AI Agent" 커맨드가 이제 `.github/mcp.json`에 MCP 서버를 등록합니다.
  - 기존에 `.vscode/mcp.json`을 사용 중인 프로젝트는 자동으로 마이그레이션됩니다. (`sdoc` 항목 제거, 빈 파일은 삭제)
  - `.github/mcp.json` 경로는 Copilot CLI 공식 문서([GitHub Copilot CLI 설정 레퍼런스](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference))에서 지원하는 프로젝트 레벨 MCP 설정 경로입니다.

## [0.4.6] - 2026-04-14

### Added
- **TOC Fold/Unfold**: 목차 항목 좌측 chevron 버튼으로 하위 계층 접기/펼치기
  - 하위 항목이 있는 헤딩에만 토글 버튼 표시 (없으면 공간 유지, 레이아웃 흔들림 없음)
  - Stack 기반 알고리즘으로 직·간접 하위 항목 모두 숨김 처리
- **LOF (그림 목록)**: Activity Bar에 📸 그림 목록 탭 추가
  - 문서 내 모든 이미지를 "그림 N. 캡션" 형식으로 나열
  - 항목 클릭 시 해당 이미지로 커서 이동 + 스크롤 (캡션 없는 경우 *캡션 없음* 표시)
- **LOT (표 목록)**: Activity Bar에 표 목록 탭 추가
  - 문서 내 모든 표를 "표 N. 캡션" 형식으로 나열
  - 항목 클릭 시 해당 표로 커서 이동 + 스크롤

### Changed
- **Activity Bar 4탭 → 6탭**: 뷰컨트롤 / TOC / **그림 목록** / **표 목록** / 문서 설정 / 파일 작업

### Fixed
- **TOC 클릭 스크롤 위치**: `block: 'center'` → `block: 'start'` 변경. 클릭한 헤딩이 뷰포트 상단에 위치하여 섹션 내용을 최대한 볼 수 있음. 앵커 링크(`#id`) 클릭도 동일 적용

## [0.4.5] - 2026-04-15

### Added
- **커서 히스토리 네비게이션**: 마우스 뒤로가기/앞으로가기 버튼(Button3/4) 및 `Alt+←` / `Alt+→` 단축키로 이전·다음 커서 위치 복원
  - 마우스 클릭 이동 자동 기록 (교차 참조 점프, 섹션 이동 등 포함)
  - 타이핑 중 매 글자 이동은 기록 생략 (불필요한 히스토리 방지)
  - ProseMirror Plugin + Tiptap Extension — 원본 데이터 무변경
- **에디터 배율(Zoom) 조절 슬라이더**: 우측 하단 플로팅 pill 위젯으로 60%~200% 범위를 5% 단계로 조절
  - `−` / `+` 버튼, range 슬라이더, `120%` 텍스트 클릭 시 100% 리셋
  - `localStorage`에 배율 저장 — 재시작 후에도 유지
  - 평소 반투명(opacity 0.55), hover 시 전체 표시 — 에디터 방해 최소화
  - CSS `zoom` 프로퍼티 적용 — 원본 데이터 무변경
- **문서 하단 스크롤 여백**: 에디터 최하단에 뷰포트 40% 높이의 여백 추가. Enter 반복 입력 없이 편리하게 문서 말미를 편집 가능. 원본 데이터 무변경 (CSS `padding-bottom` 처리)
- **내보내기 진행 표시 + 중복 방지**: 대용량 문서(Slides 등) 변환 시 VS Code 상태 표시줄에 진행률 표시. 중복 실행 방지 락으로 완료 알림 중복 제거
- **Activity Bar** (VS Code 스타일 세로 아이콘 스트립): 에디터 좌측에 항상 표시되는 4탭 Activity Bar 추가
  - `🔢` 뷰 컨트롤: 헤딩 번호 매김 / 헤딩 장식(색상·선) 토글 — SidePanel로 이동
  - `📑` 목차 (TOC): 문서 내 헤딩 트리 탐색
  - `⚙️` 문서 설정: 개별 문서별 캡션·폰트·색상 설정
  - `📥` 파일 작업: 내보내기(HTML/PDF/Markdown/AsciiDoc/Slides) + 가져오기(Markdown/HTML) + JSON 소스 보기
  - 같은 탭 아이콘 재클릭 시 SidePanel 닫힘 (토글)

### Changed
- **Toolbar 슬림화 (29개 → 12개 컨트롤)**:
  - `Aa▾` 드롭다운: 취소선 / 위 첨자 / 아래 첨자 통합
  - `≡▾` 정렬 드롭다운: 현재 활성 정렬 아이콘 표시 + 4종 선택
  - Export / Import / View JSON → Activity Bar `📥 파일` 탭으로 이동
  - 번호 매김 / 헤딩 장식 토글 → Activity Bar `🔢 뷰` 탭으로 이동
  - TOC / Settings 버튼 → Activity Bar 아이콘으로 대체

### Fixed
- **Meta 데이터(작성자/버전/일시) 영역 고정**: 본문 스크롤 시 Meta 헤더가 함께 올라가던 문제 수정
- **Activity Bar / SidePanel 스크롤 격리**: 본문 스크롤 시 좌측 SideBar도 함께 스크롤되던 문제 수정
  - `editor-shell` 컨테이너 (`height: 100vh, overflow: hidden`) 도입
  - `editor-content-area` 만 독립 스크롤 영역으로 지정

## [0.4.4] - 2026-04-14

### Added
- **Blockquote 인용 블록**: StarterKit 기본 blockquote 활성화, Markdown export 시 `> line` 형식, AsciiDoc 표준 quote block 형식으로 변환
- **Callout / Admonition 블록**: 5가지 variant (note/info/tip/warning/danger) with 이모지 헤더
  - **Markdown export**: GitHub Alerts 형식 (`> [!NOTE]` 등)
  - **AsciiDoc export**: 표준 Admonition 타입(NOTE/TIP/IMPORTANT/WARNING/CAUTION)으로 매핑
  - **BubbleMenu variant picker**: Callout 내부 커서 시 variant 변경 가능
- **BlockExit 키보드 단축키**: Blockquote/Callout 탈출 메커니즘 개선
  - Enter (빈 마지막 문단) → 블록 밖으로 탈출 후 새 paragraph 생성
  - Backspace (빈 첫 문단) → 블록 해제/삭제

### Fixed
- **[Critical] 저장 시 입력 내용 소실 버그 (Race Condition)**:
  - `onWillSaveTextDocument` + `requestFlush`로 저장 전 webview 상태 강제 동기화
  - `saveRequested` 플래그로 dirty 상태 정확한 추적 및 재저장 트리거 가능
  - 메시지 처리 순차 큐(`Promise.then` 체이닝)로 edit→save 순서 보장
- **pendingApplyEdits 카운터 공유 문제**: 싱글턴 Provider에서 복수 문서 열 때 카운터 간섭 → `Map<string, number>`로 문서별 분리
- **pendingEditRef boolean 가드 한계**: 연속 edit 전송 시 echo-back 소실 → number 카운터로 개별 추적
- **블록 객체 간 텍스트 삽입 불가**: 연속 blockquote/callout 사이 또는 내부에서 일반 텍스트 줄 добавитиが 불가능 → BlockExit 확장으로 통합 해결

## [0.4.3] - 2026-04-14

### Added
- **캡션 프리셋 시스템**: 접두사·구분자 자유 입력 대신 4가지 표준 프리셋 드롭다운으로 변경
  - **IEEE (간결형)**: Fig. 1, Table I (로마 숫자), (1)
  - **ISO/IEC (정석형)**: Figure 1, Table 1, Equation (1)
  - **Modern (현대형)**: Figure 1, Table 1, Equation 1
  - **Korean (한국형)**: 그림 1, 표 1, 식 (1)
- **로마 숫자 표 번호 (IEEE)**: IEEE 프리셋 선택 시 표 번호가 I, II, III 형식으로 표시
- **번호 방식 통합**: 이미지·표·수식 번호 방식(Sequential/Hierarchical)을 단일 컨트롤로 통합
- **`caption.style` VS Code 설정**: `ieee` / `iso` / `modern` / `korean` 중 선택
- **`caption.crossRefIncludeCaption` 설정**: 교차 참조에 캡션 텍스트 포함 여부 제어

### Changed
- **문서 설정 패널 간소화**: 6개 이상의 텍스트 입력 필드 → 캡션 스타일 드롭다운 1개
- **번호 방식 용어 통일**: `Simple` → `Sequential` 으로 전체 교체 (UI, 타입, 설정값, 스키마)
- **방정식 우측 태그 고정**: 에디터 내 방정식 우측 번호는 프리셋에 관계없이 항상 `(N)` / `(H1.N)` 형태로 표시
- **교차 참조 레이블**: 프리셋에 따라 `(1)` / `Equation (1)` / `Equation 1` / `식 (1)` 형태로 표시
- **구분자 통합**: 이미지·표·수식 각각이던 구분자 설정을 프리셋의 단일 구분자로 통합

### Removed
- **설정 제거**: `caption.imagePrefix`, `caption.tablePrefix`, `caption.equationPrefix`, `caption.separator`, `caption.imageSeparator`, `caption.tableSeparator`, `caption.equationSeparator`

## [0.4.1] - 2026-04-09

### Fixed
- **복잡 테이블 Markdown 변환 개선**: colspan/rowspan 병합 셀, 멀티블록 셀 내용 있는 테이블을 HTML `<table>` 폴백으로 정확하게 변환
- **테이블 셀 파이프 문자 이스케이프**: 셀 내용의 `|` 문자가 테이블 구조를 파괴하는 문제 수정
- **헤더 없는 테이블 GFM 호환성**: 빈 헤더 row 자동 삽입으로 GFM 렌더러 인식 보장
- **HTML export colspan/rowspan 속성 추가**: `<th>` / `<td>` 태그에 병합 셀 속성 정상 출력

## [0.4.0] - 2026-04-09

### Changed
- **Markdown 앵커 Pandoc 스타일 전환**: `<a id="..."></a>` → `{#id}` 형태로 변경하여 RAG 파이프라인 노이즈 최소화
- **Markdown Converter 동기화**: `src/converter`에 누락된 정렬/색상/하이라이트 지원 추가

## [0.3.9] - 2026-04-08

### Changed
- **폰트 포맷 WOFF2 전환**: TTF → WOFF2 변환으로 폰트 파일 크기 ~63% 감소 (13.6MB → 5.1MB)
- **사용 weight만 임베딩**: Export 시 설정에서 실제 사용하는 font-weight만 base64 임베딩하여 HTML/PDF/Slides 파일 크기 대폭 감소

### Removed
- TTF 폰트 파일 제거 (WOFF2로 대체)

## [0.3.8] - 2026-04-08

### Added
- **Export to Slides**: .sdoc 문서를 reveal.js 기반 HTML 슬라이드로 변환
  - H1 제목 기준 슬라이드 자동 분리
  - H1 수평 + H2 수직 슬라이드 모드 옵션 (`slide.breakLevel`)
  - 문서 메타데이터 기반 타이틀 슬라이드 자동 생성 옵션 (`slide.showTitleSlide`)
  - 슬라이드 전용 테마 색상 설정 (`slide.primaryColor`, `slide.accentColor`)
  - KaTeX 수식, Mermaid 다이어그램, 코드 뺨록, 표, 이미지 모두 지원
  - 내장 폰트 base64 임베딩으로 독립적 HTML 출력
  - Toolbar Export 메뉴 및 `Ctrl+Shift+P` 명령 모두 지원
  - 브라우저에서 바로 열기 (키보드 탐색, 전체 화면, 슬라이드 오버뷰)

## [0.3.7] - 2026-04-08

### Changed
- **README 분리**: 사용자 매뉴얼(README.md)과 개발자 가이드(CONTRIBUTING.md) 분리
- **What's New 자동 표시**: Extension 업데이트 시 CHANGELOG를 자동으로 보여줍니다

## [0.3.6] - 2026-04-08

### Added
- **Bundled font support**: Added configurable font weight variants (Light 300, Regular 400, SemiBold 600, Bold 700)
- **Font Weight Configuration**: New VS Code Settings to customize font weights
  - `structuredDocEditor.font.body`: Body text weight (default: Regular)
  - `structuredDocEditor.font.bold`: Bold text weight (default: Bold)
  - `structuredDocEditor.font.h1`: H1 heading weight (default: Bold)
  - `structuredDocEditor.font.h2`: H2 heading weight (default: SemiBold)
  - `structuredDocEditor.font.h3`: H3 heading weight (default: SemiBold)
- **Font Embedding in Exports**: HTML/PDF exports now embed font files as base64 for self-contained documents

### Changed
- Default font family now supports configurable embedded fonts
- CSS system uses custom properties (`--font-weight-*`) for dynamic weight application

## [0.3.5] - 2026-04-07

### Added
- Previous version features (update history to be documented)

## [Unreleased]

### Planned
- Additional export format improvements
- Enhanced diagram editing workflow
