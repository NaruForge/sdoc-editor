# Change Log

All notable changes to the "Structured Doc Editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **Bundled Legacy Font 2.0**: Extension now includes 4 weight variants (Light 300, Regular 400, SemiBold 600, Bold 700)
- **Font Weight Configuration**: New VS Code Settings to customize font weights
  - `structuredDocEditor.font.body`: Body text weight (default: Regular)
  - `structuredDocEditor.font.bold`: Bold text weight (default: Bold)
  - `structuredDocEditor.font.h1`: H1 heading weight (default: Bold)
  - `structuredDocEditor.font.h2`: H2 heading weight (default: SemiBold)
  - `structuredDocEditor.font.h3`: H3 heading weight (default: SemiBold)
- **Font Embedding in Exports**: HTML/PDF exports now embed font files as base64 for self-contained documents

### Changed
- Default font family now includes 'Legacy Font 2.0' as primary font
- CSS system uses custom properties (`--font-weight-*`) for dynamic weight application

## [0.3.5] - 2026-04-07

### Added
- Previous version features (update history to be documented)

## [Unreleased]

### Planned
- Additional export format improvements
- Enhanced diagram editing workflow
