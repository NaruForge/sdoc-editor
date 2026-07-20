# PRODUCT.md — Structured Doc Editor 제품/기술 명세서

> 이 문서는 **다른 개발자가 이 프로젝트를 처음부터 동일한 형태로 재구현(clone)할 수 있도록** 작성된 완전한 기술·제품 명세서입니다.
> 목적, 사용자 경험(UX/UI), 데이터 모델, 아키텍처, 각 기능의 구현 방식, 빌드/배포 방법까지 재현에 필요한 모든 정보를 포함합니다.

---

## 1. 제품 개요

### 1.1 한 줄 정의

**Structured Doc Editor**는 `.sdoc` / `.tiptap.json` 이라는 자체 JSON 기반 문서 포맷을 위한 **WYSIWYG 구조화 문서 에디터**입니다. VS Code 커스텀 에디터 확장(Extension)과, VS Code 없이도 쓸 수 있는 **Tauri 기반 독립 데스크톱 앱** 두 가지 형태로 배포됩니다.

### 1.2 왜 만들어졌는가 (문제 정의)

- 사내 기술 문서(설계 문서, 보고서, 회의록 등)는 보통 Word/한글 바이너리 포맷이나 Markdown으로 작성되는데,
  - Word/한글은 **Git diff가 불가능**하고 버전 관리에 부적합함
  - Markdown은 diff에는 좋지만 **표/그림/수식/다이어그램 등 서식이 있는 문서** 작성 UX가 나쁨(WYSIWYG 아님)
- 따라서 **JSON 기반의 구조화된 문서 트리**(Tiptap/ProseMirror 스키마)를 소스 포맷으로 채택하여:
  - Git으로 버전 관리 가능(pretty-printed JSON → 라인 단위 diff 가능)
  - WYSIWYG 편집 UX 제공(Notion/Confluence 스타일)
  - 필요 시 Markdown/AsciiDoc/HTML/PDF/Slide 등 다양한 포맷으로 **무손실에 가깝게 내보내기**
- 기술 문서(IEEE 논문 스타일 캡션, 수식 자동 번호, 그림/표 자동 번호, 다이어그램)에 특화되어 있으며, 회사 브랜딩(로고/색상/폰트)을 적용한 HTML/PDF/슬라이드 내보내기를 지원하여 **사내 표준 문서 도구**로 사용하는 것을 목표로 합니다.

### 1.3 타깃 사용자 및 사용 시나리오

- VS Code를 사용하는 개발자/엔지니어가 설계 문서, 기술 보고서, 회의록을 작성
- Git 저장소에 `.sdoc` 파일을 커밋하여 팀과 리뷰/협업
- 작성한 문서를 고객사/경영진 공유용 HTML, PDF 또는 발표용 슬라이드로 내보내기

### 1.4 배포 형태 두 가지

| 배포 형태 | 설명 | 대상 사용자 |
|---|---|---|
| **VS Code Extension** (`vscode-structed-doc` 루트) | `.vsix`로 패키징, VS Code 커스텀 에디터로 `.sdoc`/`.tiptap.json`/`.sdocbook` 파일을 열면 자동 실행 | VS Code 사용자 |
| **Tauri 데스크톱 앱** (`tauri-app/`) | Rust(Tauri) + React 기반 독립 실행형 데스크톱 앱(`.msi`/포터블) | VS Code를 쓰지 않는 일반 사용자 |

두 배포판은 **동일한 에디터 코어(Tiptap 확장, 변환기)를 공유**하며 UI 셸(메시징 계층, 파일 탐색기, 메뉴바)만 다릅니다.

---

## 2. 리포지토리 구조

```
vscode-structed-doc/
├── src/                      # VS Code Extension Host (TypeScript, Node.js)
│   ├── extension.ts          # activate() — 커맨드/커스텀에디터 등록
│   ├── SdocEditorProvider.ts # .sdoc/.tiptap.json 커스텀 에디터 Provider
│   ├── SdocBookProvider.ts   # .sdocbook 프로젝트(다중 문서) 에디터 Provider
│   ├── commands/             # 내보내기 커맨드 (exportToHtml/Adoc/Markdown/Pdf/Slides)
│   └── utils/                # browserDetect, cssUtils, fontUtils, imageUtils, themeUtils, webviewHelper
│
├── shared/                   # vscode API 의존 없는 순수 TS — Extension/Tauri가 공유
│   ├── converter/            # ★ 단일 소스 변환기 (jsonToHtml/Adoc/Markdown/Slides, markdownToJson)
│   ├── document/             # document envelope, migration, ID, cross-reference 처리
│   ├── editor/               # VS Code/Tauri 공용 React 컴포넌트와 Tiptap 확장
│   ├── types/messages.ts     # Extension ↔ Webview 메시지 프로토콜 타입 (discriminated union)
│   ├── types.ts              # TiptapNode/Mark, SdocMeta, DocumentSettings, ExportSettings 등 공유 타입
│   └── settingsResolver.ts   # 설정 병합(default → workspace → per-document) + 캡션 프리셋
│
├── webview-ui/                # VS Code 웹뷰 안에서 도는 React 에디터 (Vite)
│   └── src/
│       ├── extensions/       # Tiptap 커스텀 확장 (Callout, CustomImage, CustomTable, MathBlock 등)
│       ├── components/       # Toolbar, ActivityBar, SidePanel, 각종 Dialog/ContextMenu
│       ├── hooks/            # useVSCodeMessaging, useEditorMessages, useTiptapEditor, useDialogState
│       ├── context/          # EditorContext (useReducer 기반 상태)
│       └── styles/           # vscode-theme.css (Tailwind + VS Code CSS 변수)
│
├── tauri-app/                 # 독립 데스크톱 앱 (webview-ui 미러 + Tauri 셸)
│   ├── src/                  # webview-ui와 거의 동일한 구조 + 파일 탐색기/메뉴바/시작화면
│   └── src-tauri/             # Rust 백엔드 (commands.rs, document.rs, settings.rs)
│
├── sdoc.schema.json            # .sdoc JSON Schema (draft-07)
├── sdocbook.schema.json         # .sdocbook JSON Schema
├── esbuild.mjs                 # Extension host 빌드 (extension.js)
├── AGENTS.md                    # 저장소 작업 규칙과 검증 명령
├── docs/architecture.md         # 런타임 경계와 데이터 흐름
└── package.json                 # VS Code manifest + npm workspaces(webview-ui, tauri-app)
```

---

## 3. 문서 데이터 모델 (`.sdoc` 포맷)

### 3.1 파일 형식 개요

`.sdoc`(및 동의어 확장자 `.tiptap.json`)은 JSON 파일이며 pretty-print(2-space indent)로 저장되어 **Git diff에 최적화**됩니다.

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "문서 제목",
    "author": "작성자",
    "version": "1.0",
    "created": "2026-01-01T00:00:00.000Z",
    "modified": "2026-03-27T00:00:00.000Z",
    "settings": { "...": "문서별 설정 오버라이드 (아래 4.4절)" }
  },
  "doc": { "type": "doc", "content": [ /* Tiptap 노드 트리 */ ] }
}
```

- `sdoc`: 스키마 버전 문자열(현재 `"1.0"`만 허용)
- `meta`: 문서 메타데이터. 에디터 상단 `DocumentHeader`에서 인라인 편집(제목은 H1에서 자동 추출, 날짜는 저장 시 자동 갱신)
- `doc`: 실제 편집 대상인 Tiptap/ProseMirror 문서 트리 (envelope를 벗겨낸 순수 문서)

레거시 마이그레이션: envelope 없이 `{ "type": "doc", ... }` 형태로 저장된 옛 파일이나 구식 `data-*` 속성을 가진 파일은 로드 시 자동으로 `unwrapSdoc()`/마이그레이션 로직을 통해 최신 포맷으로 변환됩니다.

### 3.2 지원 노드 타입 (JSON Schema 기준, `sdoc.schema.json`)

**블록 노드**
| 타입 | attrs | 설명 |
|---|---|---|
| `heading` | `level`(1~6), `id`, `textAlign` | 제목. `id`는 교차참조 앵커 |
| `paragraph` | `textAlign` | 일반 문단 |
| `bulletList` / `orderedList` | `start`, `type` | 목록, `listItem` 자식 포함 |
| `taskList` / `taskItem` | `checked` | 체크박스 할 일 목록 |
| `codeBlock` | `language` | 구문 강조 코드 블록 |
| `table` | `caption`, `align`, `width`, `id` | `tableRow` > `tableCell`/`tableHeader`(`colspan`/`rowspan`/`colwidth`) |
| `image` | `src`, `alt`, `title`, `caption`, `align`, `id` | 상대경로 이미지, 캡션/정렬/자동번호 |
| `mathBlock` | `latex`, `id` | 블록 수식(KaTeX), 자동 번호 |
| `mathInline`(inline) | `latex` | 인라인 수식 |
| `diagram` | `language`(mermaid/plantuml/d2/graphviz), `code` | 다이어그램 소스 (현재 mermaid만 실제 렌더링) |
| `blockquote` | — | 인용 블록 |
| `callout` | `variant`(note/info/tip/warning/danger) | 강조 admonition 블록 |
| `hardBreak` | — | 줄바꿈 |

**마크(inline 서식)**: `bold`, `italic`, `underline`, `strike`, `code`, `link`(href/target/rel/class), `textStyle`(색상), `highlight`(배경), `subscript`, `superscript`

### 3.3 자동 ID / 번호 부여 규칙

- 저장 시 `assignAutoIds()`가 실행되어:
  - heading → 텍스트를 슬러그화한 `id` 부여 (교차참조 앵커)
  - image → `figure-N` 형태의 `id`
  - table → `table-N` 형태의 `id`
- 저장 시 `syncCrossReferences()`가 실행되어 문서 내 모든 내부 링크(`href="#..."`)의 표시 텍스트를 최신 번호/라벨로 재동기화
- 헤딩/캡션 번호는 **저장하지 않고 항상 런타임에 계산**(CSS counter 또는 변환기 로직) — 사용자가 절대 수동으로 번호를 입력하면 안 됨(문서 편집 규칙)

### 3.4 캡션 스타일 프리셋 (IEEE 스타일 포함)

`shared/settingsResolver.ts`의 `getCaptionPreset(style)`이 4가지 프리셋을 제공합니다.

| 프리셋 | 그림 접두사 | 표 접두사 | 수식 | 구분자 | 표 번호 형식 |
|---|---|---|---|---|---|
| `ieee` (간결형) | `Fig.` | `Table`(로마숫자) | `(1)` | `. ` | 로마 숫자(I, II, III...) |
| `iso` (정석형) | `Figure` | `Table` | `Equation (1)` | ` — ` | 아라비아 숫자 |
| `modern` (현대형, 기본값) | `Figure` | `Table` | `Equation 1` | `: ` | 아라비아 숫자 |
| `korean` (한국형) | `그림` | `표` | `식 (1)` | ` ` | 아라비아 숫자 |

- IEEE 스타일은 학술 논문 관행을 따라 `Fig. 1`, `Table I`(로마숫자), 수식은 괄호로만 표기(`(1)`)하는 것이 특징입니다.
- `captionNumbering`/`equationNumbering`은 각각 `sequential`(문서 전체 연속 번호) 또는 `hierarchical`(H1 섹션 기준 `1.1`, `1.2`, `2.1`...) 모드를 지원합니다.
- 설정 병합 우선순위: **하드코딩 기본값 → VS Code(workspace) 설정 → 문서별(`meta.settings`) 오버라이드** (문서별 설정이 최우선).

---

## 4. 핵심 기능 상세 (재구현용 스펙)

### 4.1 WYSIWYG 편집 엔진

- **Tiptap 3 / ProseMirror** 기반. 확장 목록은 `webview-ui/src/extensions/tiptapExtensions.ts`에서 조립:
  - 표준: `StarterKit`(codeBlock 비활성화), `Underline`, `TaskList`/`TaskItem`, `Link`, `TableRow`/`TableHeader`/`TableCell`, `TextStyle`, `Color`, `Highlight`, `Subscript`, `Superscript`, `TextAlign`
  - 커스텀 노드: `Callout`, `CustomImage`, `CustomTable`, `MathInline`, `MathBlock`, `DiagramBlock`, `CustomCodeBlock`(CodeBlockLowlight 래핑)
  - 커스텀 플러그인(스키마 없음): `CrossReference`, `SectionFold`, `EquationNumbering`, `HeadingKeyboardShortcuts`, `BlockExit`, `CursorHistory`, `internalLinkClick`

### 4.2 노드뷰(NodeView) 렌더링 전략

성능을 위해 무거운 노드는 **바닐라 DOM NodeView**(React 아님)로 구현하고, 필요한 곳만 React NodeView 사용:

| 확장 | NodeView 종류 | 핵심 동작 |
|---|---|---|
| `CustomImage` | 바닐라 DOM | 캡션 인라인 편집, 정렬 툴바, 클릭→컨텍스트메뉴, 더블클릭→Draw.io 편집 오픈 |
| `CustomTable` | 바닐라 DOM (`contentDOM`은 `<tbody>`) | 캡션, 정렬/너비, 컨텍스트 메뉴로 행/열 삽입삭제 |
| `DiagramBlock` | 바닐라 DOM | `mermaid.render()`로 실시간 SVG 렌더링, 클릭 시 분할 편집 다이얼로그 |
| `MathInline`/`MathBlock` | 바닐라 DOM | KaTeX 렌더링, 클릭 시 인라인 편집(textarea+실시간 미리보기), `$...$`/`$$...$$` 입력 규칙(input rule) |
| `Callout` | 바닐라 DOM | variant별 아이콘/색상 헤더 + 콘텐츠 영역 |
| `CodeBlockView` | **React** NodeView | `NodeViewWrapper`/`NodeViewContent` + 언어 선택 드롭다운 + `lowlight` 구문강조 |

**바닐라 DOM ↔ React 통신 브릿지**: `window.__` 전역 함수를 통해 트리거
- `window.__editorSettings` — 현재 설정 스냅샷 (NodeView에서 참조)
- `window.__editorFlushUpdate()` — 디바운스 무시하고 즉시 저장 강제
- `window.__showImageProperties()`, `window.__showImageContextMenu()`, `window.__showMathDialog()`, `window.__showDiagramDialog()` — React 다이얼로그를 여는 콜백
- 타입은 `webview-ui/src/types/globals.d.ts`에 반드시 선언(any 캐스팅 금지)

### 4.3 교차 참조(Cross-Reference) 시스템

- 사용자가 문서에서 `@`를 입력하면 `Suggestion`(Tiptap) 기반 팝업이 뜨고, 문서 내 모든 heading/image/table을 후보로 나열
- 선택 시 `link` 마크(`href="#target-id"`)와 해당 대상의 현재 라벨(예: "Figure 2")을 텍스트로 삽입
- 저장할 때마다 `syncCrossReferences()`가 모든 내부 링크 텍스트를 최신 번호로 재작성 → 그림/표 순서가 바뀌어도 참조 텍스트가 항상 정확
- 클릭 시 `internalLinkClick` 플러그인이 해당 위치로 스크롤(같은 문서) 또는 `openDocument` 메시지 전송(다른 `.sdoc` 문서로 이동)

### 4.4 문서/워크스페이스 설정 시스템

`DocumentSettings`(문서별, `meta.settings`에 저장)와 VS Code 워크스페이스 설정(`structuredDocEditor.*`)이 있으며 `resolveSettings()`로 병합됩니다.

주요 설정 항목:
- **Heading**: `numbering`(자동 번호), `decoration`(H1 밑줄), `h1Color`/`h2Color`/`h3Color`(hex)
- **Caption**: `style`(ieee/iso/modern/korean), `numbering`(sequential/hierarchical), `crossRefIncludeCaption`
- **Equation**: `numbering`(sequential/hierarchical)
- **Image**: `defaultAlignment`
- **Export**: `imagePath`(relative/absolute), `selfContained`(none/images-only/full), `pdfScale`(10~200%, 기본 70%), `outputDir`
- **Theme**: `companyName`, `companyLogo`, `primaryColor`(기본 `#A50034`), `accentColor`, `fontFamily`, `customStyles`(원시 CSS)
- **Font weight**: body/bold/h1/h2/h3 별 Light/Regular/SemiBold/Bold
- **Slide**: `breakLevel`(h1-only/h1-h2-vertical), `showTitleSlide`, `primaryColor`/`accentColor`(슬라이드 전용), `transition`(none/fade/slide/convex/concave/zoom)
- **Custom CSS 파일**: 문서 설정 패널에서 Slide/HTML export용 CSS 파일을 파일별로 지정 가능(`slideCssPath`, `htmlCssPath`)

### 4.5 내보내기(Export) / 가져오기(Import)

모든 변환 로직은 **`shared/converter/`에 단일 소스**로 존재(“converter singleton” 규칙). VS Code 확장과 Tauri 앱이 동일한 함수를 import합니다. Converter는 순수 TypeScript이며 `vscode` API 의존성이 전혀 없습니다.

| 파일 | 대상 포맷 | 핵심 로직 |
|---|---|---|
| `jsonToHtml.ts` | HTML | 헤딩/캡션 자동 번호, KaTeX/Mermaid CDN 또는 self-contained 임베드, 테마(로고/색상/폰트) 적용 |
| `jsonToMarkdown.ts` | Markdown | frontmatter 생성, 복잡한 테이블(병합 셀)은 HTML 폴백, GitHub Alerts 매핑(callout), 상호참조는 `<a id>`+`[text](#id)` |
| `jsonToAdoc.ts` | AsciiDoc | `sectnums` 자동 번호, `[[id]]`/`<<id,text>>` xref, admonition/blockquote/표/이미지/수식/다이어그램 지원 |
| `jsonToSlides.ts` | reveal.js 슬라이드 HTML | H1 기준(또는 H1+H2 수직) 자동 분할, 타이틀 슬라이드 자동 생성, 테마/전환효과 적용 |
| `markdownToJson.ts` | Markdown → Tiptap JSON | YAML frontmatter 스킵, 헤딩/코드/수식블록/표/이미지/blockquote·GitHub Alerts/목록/인라인 서식 파싱 |

공통 아키텍처(구현 시 반드시 준수):
```typescript
// 모듈 레벨 mutable state 금지 — ConvertContext를 파라미터로 전달
interface ConvertContext {
  settings: ExportSettings;
  imageCounter: number;
  tableCounter: number;
  h1Counter: number;
}
```
- 공통 유틸: `escapeHtml()`, `formatDate()`(`YYYY-MM-DD`), `formatCaptionLabel(prefix, numbering, caption, separator)`, `toRoman()`
- Export 커맨드(`src/commands/`)는 파일을 읽고 envelope를 벗긴 뒤(webview URI → 상대경로 변환 포함) `shared/converter`를 호출하는 얇은 래퍼 역할만 함
- **PDF 내보내기**: 별도 PDF 라이브러리 없이, HTML을 생성한 뒤 시스템에 설치된 **Chrome/Edge/Chromium을 헤드리스 모드로 실행**하여 인쇄(print-to-pdf) — `browserDetect.ts`로 실행 파일 탐색
- **HTML Import**: 커스텀 파서 없이 Tiptap의 `editor.commands.setContent(htmlString)`을 그대로 사용

### 4.6 Draw.io 다이어그램 통합

- VS Code의 [Draw.io Integration 확장](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio)에 의존(별도 설치 필요)
- 에디터에서 "Draw.io 삽입" → 파일명 입력 다이얼로그 → `./drawio/이름.drawio.svg` 파일 생성 → 이미지 노드로 삽입
- 이미지 더블클릭 시 연결된 `.drawio.svg`를 Draw.io 확장으로 열어 편집
- 파일 시스템 워처가 `.drawio.svg` 변경을 감지하여 열려있는 웹뷰의 이미지를 자동 갱신
- Tauri 앱에서는 OS의 asset protocol(`resolve_asset_path`)로 상대 경로를 해석하고, Draw.io 데스크톱 앱을 외부 프로세스로 실행하는 방식으로 대체 구현

### 4.7 Mermaid 다이어그램

- `diagram` 노드(`language: "mermaid"`)를 `mermaid` npm 패키지로 실시간 SVG 렌더링
- 클릭 시 분할 창(코드 편집기 + 실시간 미리보기) 다이얼로그가 열리며 flowchart/sequence/ER/gantt 등 6종 프리셋 템플릿 제공
- `language` 필드는 plantuml/d2/graphviz 확장을 염두에 두고 설계되었으나 현재는 mermaid만 실제 렌더링 지원

## 5. UX / UI 상세 설계

### 5.1 전체 레이아웃

```
┌─────────────────────────────────────────────────────────┐
│ DocumentHeader (제목/저자/버전 — 항상 고정 표시)              │
├──┬──────────────────────────────────────────────┬───────┤
│A │ Toolbar (서식/삽입/Export/Import — 슬림화된 12개 버튼)  │       │
│c ├──────────────────────────────────────────────┤       │
│t │                                              │ Side  │
│i │         에디터 본문 (ProseMirror)               │ Panel │
│v │   (Bubble Menu, 우클릭 컨텍스트 메뉴 지원)          │(TOC/  │
│i │                                              │ LOF/  │
│t │                                              │ LOT/  │
│y │                                              │ 설정) │
│B │                                              │       │
│a ├──────────────────────────────────────────────┤       │
│r │      ZoomBar (우측하단 플로팅, 60~200%)          │       │
└──┴──────────────────────────────────────────────┴───────┘
```

- **Activity Bar**(좌측 세로 아이콘 스트립, 6탭): 뷰 컨트롤 / TOC(목차) / 그림 목록(LOF) / 표 목록(LOT) / 문서 설정 / 파일 작업(Import/Export)
- **Side Panel**: Activity Bar에서 선택한 탭에 대응하는 패널을 우측에 표시. 목차는 클릭 시 해당 heading 위치로 스크롤, chevron 버튼으로 하위 계층 접기/펼치기 가능. LOF/LOT는 그림/표 캡션 목록을 클릭하면 해당 위치로 이동.
- **레이아웃 고정**: DocumentHeader/Toolbar/Sidebar는 스크롤 시 고정되고 에디터 본문만 스크롤(스크롤 격리)
- **Bubble Menu**(선택 영역 위에 뜨는 플로팅 툴바): bold/italic/underline/strike/색상/하이라이트/blockquote/callout variant 전환 등 인라인 서식
- **컨텍스트 메뉴**: 에디터 빈 공간 우클릭(삽입 메뉴: 표/이미지/Draw.io/수식/코드/다이어그램/callout/교차참조 등), 이미지 우클릭(속성/교체/경로복사/삭제), 표 안 우클릭(행·열 삽입삭제/속성) — 모든 플로팅 메뉴는 뷰포트 경계를 감지해 화면 밖으로 잘리지 않도록 위치를 재조정

### 5.2 특수 UX 기능

| 기능 | 설명 |
|---|---|
| **에디터 배율(Zoom) 슬라이더** | 우측 하단 플로팅 슬라이더, 60%~200%, `localStorage`(`sdoc-editor-zoom`)에 저장, CSS `zoom` 속성으로 적용 |
| **커서 히스토리 내비게이션** | 브라우저처럼 마우스 뒤로가기/앞으로가기 버튼(Button3/4) 및 `Alt+←`/`Alt+→`로 이전 커서 위치 복원. ProseMirror 플러그인이 스택으로 위치 이력 관리 |
| **섹션 접기(Fold)** | heading 옆 chevron 토글로 하위 콘텐츠 접기/펼치기. ProseMirror decoration + `.section-collapsed` 클래스로 구현 |
| **TOC Fold/Unfold** | 사이드패널 목차 항목별로 하위 계층 접기 |
| **이미지 클립보드 붙여넣기** | `Ctrl+V`로 클립보드 이미지를 바로 삽입, 파일명 지정 다이얼로그 노출 |
| **인라인 메타데이터 편집** | 제목/저자/버전을 문서 상단에서 바로 클릭하여 편집 (제목은 H1과 자동 동기화, 날짜는 자동 관리) |
| **수식/다이어그램 하이브리드 편집** | 단일 클릭 시 인라인 편집(실시간 미리보기), 더블클릭 시 확장 다이얼로그(분할 편집창) |
| **헤딩 Tab/Shift-Tab** | 커서가 heading에 있을 때 Tab/Shift-Tab으로 heading level 순환 변경 |
| **저장 흐름** | 300ms 디바운스로 자동 업데이트, `Ctrl/Cmd+S` 또는 VS Code `onWillSaveTextDocument` 시 `requestFlush`→`flushComplete` 핸드셰이크로 즉시 강제 반영 후 저장 |

### 5.3 시작 화면 / 워크스페이스 탐색기 (Tauri 전용)

- **시작(Welcome) 화면**: 새 문서 만들기, 폴더 열기, 최근 파일/최근 워크스페이스 목록, 마지막 워크스페이스 자동 복원
- **좌측 파일 탐색기**: 워크스페이스 폴더 트리(모든 확장자 표시), 폴더 접기/펼치기, 우클릭(새 폴더/새 문서/이름변경/삭제(OS 휴지통 이동 + Undo 토스트)/시스템 탐색기에서 보기/경로 복사/새로고침), 파일시스템 변경 실시간 반영(watcher)
- **상단 메뉴바**: File/Edit/View/Help 네이티브 스타일 메뉴
- **하단 상태바**: 현재 파일 경로, 저장 상태 표시

---

## 6. 아키텍처 상세

### 6.1 VS Code Extension ↔ Webview 통신 프로토콜

`shared/types/messages.ts`에 discriminated union으로 정의(양방향 모두 타입 가드로 처리, 문자열 비교 금지).

**Webview → Extension**: `ready`, `edit`, `flushComplete`, `viewJson`, `saveImage`, `createDrawio`, `importDrawio`, `openDrawio`, `insertExistingImage`, `replaceImage`, `export`(html/adoc/markdown/pdf/slides), `openDocument`, `browseSdocFiles`, `importMarkdown`, `importHtml`, `updateMeta`, `updateDocSettings`, `selectCssFile`, `clearCssFile`

**Extension → Webview**: `init`(content), `update`, `requestFlush`, `settingsChanged`, `docSettingsChanged`, `metaUpdate`, `importContent`, `importHtml`, `imageSaved`, `drawioCreated`, `imageInserted`, `drawioFileUpdated`, `imageReplaced`, `exportStarted`, `exportDone`

`.sdocbook`(프로젝트) 전용 메시지: `openDocument`, `addDocument`, `moveDocument`, `exportProject` 등

### 6.2 `SdocEditorProvider`(핵심 Provider) 동작

1. `vscode.CustomTextEditorProvider` 구현, webview 옵션: `retainContextWhenHidden: true`, local resource roots에 `dist/webview`/`media/fonts`/문서 폴더 포함
2. 최초 로드: 문서 텍스트 파싱 → `unwrapSdoc()`(레거시 마이그레이션 포함) → 이미지 경로를 webview URI로 변환 → `init`/`metaUpdate`/`settingsChanged`/`docSettingsChanged` 순으로 postMessage
3. 저장(`updateDocument()`): webview URI를 다시 상대경로로 역변환 → 텍스트 노드 정리 → 기존 `meta` 보존하며 `modified` 갱신 → 설정 병합 → `assignAutoIds()` → `syncCrossReferences()` → envelope로 감싸 pretty JSON write
4. 외부 변경 동기화: `onDidChangeTextDocument`가 확장 자신의 쓰기가 아닌 외부 변경을 감지하면 `update` 메시지로 webview에 반영
5. CSP(Content-Security-Policy)에 `${webview.cspSource}`를 script-src에 포함하여 동적 import 허용

### 6.3 `SdocBookProvider`(.sdocbook 다중 문서 프로젝트)

- `{ sdocBook: "1.0", title, author, version, documents: [{path, label}] }` 구조(스키마: `sdocbook.schema.json`)
- 프로젝트 내 문서 목록 UI(추가/삭제/순서변경), 클릭 시 개별 문서 열기
- Export 시 프로젝트 내 모든 `.sdoc`을 하나의 트리로 병합, 이미지 경로를 프로젝트 폴더 기준으로 재계산(rebase), `./file.sdoc#id` 형태의 문서간 링크를 병합 문서 내 `#id`로 재해석 후 통합 HTML/PDF 생성

### 6.4 웹뷰 프론트엔드 아키텍처 (`webview-ui`)

- `App.tsx` → `EditorProvider`(Context, `useReducer`) → `Editor.tsx`(메인 컴포지션)
- 상태: `EditorContext`가 `doc`, `isReady`, 전역 `settings`, 문서별 `docSettings` 보유
- `useTiptapEditor.ts`: Tiptap 에디터 인스턴스 생성(확장 목록 주입), 300ms 디바운스 업데이트, `flushUpdate()`로 강제 플러시
- `useVSCodeMessaging.ts`: `window.acquireVsCodeApi()` 취득 → `window.vscode`에 저장, `message` 이벤트 리스닝, 최초 `ready` 전송
- `useEditorMessages.ts`: 확장→웹뷰 메시지 타입별 처리(라우터 패턴 지향)
- 스타일: Tailwind + `vscode-theme.css`(VS Code CSS 변수 `--vscode-editor-background` 등과 자체 CSS 변수 `--image-caption-prefix`, `--heading-h1Color` 등을 결합)

### 6.5 Tauri 데스크톱 앱 아키텍처

- `tauri-app/src`는 `webview-ui/src`의 **미러 구조**(확장/컴포넌트/훅 대부분 동일 파일명) — **동기화 규칙**: webview-ui의 extensions/컴포넌트 변경은 반드시 tauri-app에도 반영
- 메시징 계층만 대체: `hooks/useTauriMessaging.ts` + `adapters/tauriMessaging.ts`가 Tauri `invoke()`로 Rust 커맨드를 호출
- CSS 변수도 `--vscode-*` 대신 독립적인 `tauri-theme.css`로 별도 정의
- **Rust 백엔드**(`src-tauri/src/commands.rs`, 플러그인: dialog/fs/shell/process):
  - 문서 I/O: `open_document`, `save_document`, `new_document`, `get_current_file_path`
  - 워크스페이스 탐색기: `get_recent_folders`, `list_folder_documents`, `create_document_in_folder`, `rename_entry`, `delete_entry`(휴지통 이동, `trash` crate), `undo_last_delete`, `create_folder`
  - OS 통합: `reveal_in_file_explorer`
  - 이미지/Draw.io: `save_image`, `copy_image_to_doc`, `create_drawio_file`, `open_drawio_external`
  - 파일 워처: `start_file_watcher`, `start_workspace_watcher`(`notify` crate)
  - 설정: `get_settings`/`update_settings`/`get_editor_settings`
  - 내보내기/가져오기: `write_export_file`, `read_import_file`
  - 자산 경로 해석(asset protocol): `resolve_asset_path`, `resolve_document_relative_path`
- `tauri.conf.json`: 창 크기 1200×800(최소 800×600), CSP에 `asset:`/`blob:`/`data:`/`ipc:`/`asset.localhost` 허용, `assetProtocol` scope `["**"]`, `.sdoc`/`.tiptap.json` 파일 연결(file association), 번들 타깃 msi/nsis

---

## 7. 빌드 & 배포

### 7.1 VS Code Extension

- `esbuild.mjs`: `src/extension.ts` → `dist/extension.js` 단일 엔트리 번들
- 웹뷰는 Vite로 별도 빌드 → `dist/webview/`
- 루트 `package.json`은 `webview-ui`, `tauri-app` 두 npm workspace를 통합 관리
- 패키징: `npm run package` → 고정 버전의 로컬 `@vscode/vsce`로 `output/`에 VSIX 생성
- 업데이트: Visual Studio Marketplace와 VS Code의 표준 확장 업데이트 흐름 사용

### 7.2 Tauri 앱

- `npm run build:desktop`은 Tauri 프런트엔드를 빌드하며, 설치 패키지는 `npm run tauri build --workspace=sdoc-editor-tauri`로 생성
- Rust 툴체인은 `tauri-app/rust-toolchain.toml`에 고정
- 출력물: `src-tauri/target/release/bundle/`에 `.msi`/`.nsis` 인스톨러

### 7.3 폰트/에셋

- Legacy Font 2.0(Light/Regular/SemiBold/Bold) 4종 웨이트를 `media/fonts`에 번들, HTML/PDF export 시 WOFF2로 임베드(가중치 필터링으로 용량 최적화)
- Export 시 이미지/폰트는 base64 data URI로 self-contained 옵션(`images-only`/`full`) 적용 가능

---

## 8. 개발 협업 체계

- `AGENTS.md`는 사람과 AI 도구가 함께 따르는 짧고 안정적인 저장소 규칙의 단일 진입점입니다.
- `docs/architecture.md`는 Extension, 공용 코어, 웹뷰, Tauri 사이의 의존 방향을 설명합니다.
- 장기적인 구조 결정은 `docs/adr/`에 기록합니다.
- 작업 상태와 토론은 GitHub 이슈/PR에서 관리하며, 완료 작업을 저장소 안의 별도 데이터베이스에 중복 기록하지 않습니다.
- `.github/instructions/*.instructions.md`에는 영역별로 필요한 최소한의 추가 규칙만 둡니다.

---

## 9. 재구현 체크리스트 (요약)

이 프로젝트를 처음부터 다시 만든다면 다음 순서를 권장합니다:

1. **데이터 모델 확정**: `sdoc.schema.json` 스타일의 JSON Schema로 노드/마크 타입 정의, `shared/types.ts`에 TS 인터페이스 미러링
2. **Tiptap 에디터 코어**: StarterKit + 커스텀 노드(Image/Table/Math/Diagram/Callout) 구현, 무거운 노드는 바닐라 NodeView로
3. **설정 해석기**: 기본값 → workspace 설정 → 문서별 설정 병합 로직 + 캡션 프리셋(ieee/iso/modern/korean) 정의
4. **변환기(Converter) 단일화**: `shared/converter/`에 HTML/Markdown/AsciiDoc/Slides 변환기를 ConvertContext 패턴으로 구현, vscode API 의존 금지
5. **VS Code Extension 셸**: `CustomTextEditorProvider` + 메시지 프로토콜(discriminated union) + envelope 마이그레이션
6. **Tauri 데스크톱 앱**: webview-ui를 미러링하고 메시징만 Tauri invoke 계층으로 교체, Rust 백엔드에 파일탐색기/트래시/워처 구현
7. **UX 폴리시**: Activity Bar/TOC/LOF/LOT, Zoom 슬라이더, 커서 히스토리, 섹션 접기 등 편의 기능은 후순위로 점진 추가

---

*이 문서는 2026-07 시점의 리포지토리 상태(v0.4.12)를 기준으로 작성되었습니다. 최신 기능 목록은 `README.md`와 `CHANGELOG.md`를 참고하세요.*
