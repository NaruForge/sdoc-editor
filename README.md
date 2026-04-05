# Structured Doc Editor

> **v0.2.3** — Mermaid 다이어그램 지원, AI Agent(MCP) 통합

`.sdoc` / `.tiptap.json` 파일을 위한 WYSIWYG 구조화 문서 에디터입니다.
**VS Code 확장 프로그램**과 **독립형 데스크톱 앱(Tauri, Windows 전용)** 두 가지 형태로 제공됩니다.

---

## 목차

1. [주요 기능](#주요-기능)
2. [배포 형태](#배포-형태)
3. [.sdoc 파일 형식](#sdoc-파일-형식)
4. [VS Code 확장 프로그램](#vs-code-확장-프로그램)
   - [설치](#설치-vsix)
   - [사용법](#사용-방법)
   - [테마 커스터마이징](#테마-커스터마이징)
   - [개발 빌드](#개발-빌드)
5. [데스크톱 앱 (Tauri)](#데스크톱-앱-tauri--windows-전용)
   - [사전 요구사항](#사전-요구사항)
   - [빌드 및 배포](#빌드-및-배포)
   - [개발 모드](#개발-모드)
6. [프로젝트 구조](#프로젝트-구조)
7. [기술 스택](#기술-스택)
8. [라이선스](#라이선스)

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| WYSIWYG 편집 | Tiptap/ProseMirror 기반 리치 텍스트 에디터 |
| JSON 저장 | pretty-printed JSON으로 저장 — Git diff 최적화 |
| 내보내기 | Markdown, AsciiDoc, 테마 적용 HTML |
| 가져오기 | Markdown, HTML → `.sdoc` 변환 |
| 텍스트 꾸미기 | 굵게, 기울임, 밑줄, 취소선, 코드, **텍스트 색상**, **하이라이트(음영)** |
| 수학 수식 | KaTeX 인라인 / 블록 수식 |
| 코드 블록 | lowlight 기반 구문 강조 (100+ 언어) |
| 표 | 캡션, 정렬, 너비 설정 / 컨텍스트 메뉴로 행·열 조작 |
| 이미지 | 클립보드 붙여넣기, 캡션, 정렬 |
| Mermaid 다이어그램 | 플로우차트·시퀀스·ER·간트 등 라이브 렌더링 / 분할 편집 창 + 6종 템플릿 |
| Draw.io 다이어그램 | 삽입 및 편집 (VS Code: Draw.io Integration 확장 / 데스크톱: draw.io 앱 연동) |
| 교차 참조 | `@` 입력으로 heading·figure·table 참조 삽입 및 번호 자동 동기화 |
| 섹션 접기 | heading 옆 토글로 섹션별 접기/펼치기 |
| 할 일 목록 | 체크박스 태스크 리스트 |
| 문서 메타데이터 | Title, Author, Version 인라인 편집 |
| 자동 업데이트 | 공유 폴더 기반 사내 자동 업데이트 (VS Code 확장 전용) |
| AI Agent 지원 | MCP 서버 내장 — Copilot/Claude 등 AI Agent가 `.sdoc`·`.tiptap.json` 직접 생성·편집 가능 |

---

## 배포 형태

| 형태 | 경로 | 대상 플랫폼 |
|---|---|---|
| VS Code 확장 | `src/` + `webview-ui/` | Windows / Linux / macOS |
| 데스크톱 앱 (Tauri) | `tauri-app/` | **Windows 전용** |
| 공유 변환 로직 | `shared/converter/` | 두 형태 공통 사용 |

---

## .sdoc 파일 형식

`.sdoc` 파일은 다음 구조의 JSON입니다.

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "문서 제목",
    "author": "작성자",
    "version": "1.0",
    "created": "2026-01-01T00:00:00.000Z",
    "modified": "2026-03-27T00:00:00.000Z"
  },
  "doc": {
    "type": "doc",
    "content": [ ... ]
  }
}
```

- `sdoc` — 스키마 버전 (현재 `"1.0"`)
- `meta` — 문서 메타데이터 (에디터 헤더에서 인라인 편집)
- `doc` — Tiptap 문서 트리 (편집 내용)

스키마 전체 정의는 저장소 루트의 `sdoc.schema.json`을 참조하세요.

---

## VS Code 확장 프로그램

### 설치 (VSIX)

1. VS Code에서 `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
2. 배포된 `.vsix` 파일 선택 후 재시작

> **사내 사용자**: `structuredDocEditor.update.sharedFolder` 설정에 공유 폴더 경로를 지정하면 새 버전 출시 시 자동 업데이트 알림을 받을 수 있습니다.

### 사용 방법

1. `.sdoc` 파일을 열면 커스텀 에디터가 자동으로 실행됩니다.
2. `Ctrl+S`로 저장합니다.
3. **이미지 삽입**: 클립보드에서 직접 붙여넣기 (`Ctrl+V`)
4. **Draw.io 다이어그램**: 툴바 "Draw.io" 버튼 → 파일명 입력 → 더블클릭으로 재편집
5. **내보내기**: `Ctrl+Shift+P` → "Structured Doc: Export to ..."

### 테마 커스터마이징

`.vscode/settings.json`에 아래 설정을 추가합니다.

```json
{
  "structuredDocEditor.theme.companyName": "LG Magna e-Powertrain",
  "structuredDocEditor.theme.companyLogo": "legacy-brand-logo.png",
  "structuredDocEditor.theme.primaryColor": "#A50034",
  "structuredDocEditor.theme.accentColor": "#6b6b6b",
  "structuredDocEditor.heading.h1Color": "#A50034",
  "structuredDocEditor.caption.imagePrefix": "그림",
  "structuredDocEditor.caption.tablePrefix": "표"
}
```

### 개발 빌드

**사전 요구사항**: Node.js 18+

```bash
# 저장소 루트에서
npm install
npm run build        # 확장 + webview 동시 빌드
```

F5를 눌러 Extension Development Host를 실행하면 개발 버전을 바로 테스트할 수 있습니다.

**빌드 명령 목록**

| 명령 | 설명 |
|---|---|
| `npm run build` | 확장 + webview 모두 빌드 |
| `npm run build:ext` | 확장(TypeScript)만 빌드 |
| `npm run build:webview` | Webview(Vite)만 빌드 |
| `npm run package` | 빌드 후 VSIX 패키징 → `output/*.vsix` |
| `npm run watch` | 확장 + webview watch 모드 동시 실행 |

**권장 확장**

Draw.io 편집을 위해 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) 확장을 함께 설치하세요.

---

## 데스크톱 앱 (Tauri) — Windows 전용

VS Code 없이 독립형 앱으로 실행되는 버전입니다.

> **주의**: Tauri 데스크톱 앱은 **Windows에서만 빌드 및 배포합니다.**
> Linux/macOS 빌드는 지원하지 않습니다.

### 사전 요구사항

- [Node.js](https://nodejs.org) 18+
- [Rust (stable)](https://rustup.rs)
- WebView2 런타임 (Windows 11은 기본 내장, Windows 10은 필요 시 [설치](https://developer.microsoft.com/microsoft-edge/webview2/))

### 빌드 및 배포

```powershell
# 1. Rust 설치
winget install Rustlang.Rustup

# 2. 저장소 클론
git clone <repo-url>
cd vscode-ext-customeditor

# 3. 의존성 설치 및 빌드
cd tauri-app
npm install
npx tauri build
```

빌드 완료 후 산출물:

```
tauri-app/src-tauri/target/release/
  sdoc-editor.exe           ← 단독 실행 파일
  bundle/
    msi/  *.msi             ← Windows Installer 패키지
    nsis/ *.exe             ← NSIS 인스톨러
```

### 개발 모드

```powershell
cd tauri-app
npm install
npx tauri dev    # 핫 리로드 지원
```

### Draw.io 연동

데스크톱 앱에서 Draw.io 다이어그램을 편집하려면 [draw.io 데스크톱 앱](https://github.com/jgraph/drawio-desktop/releases)을 설치해야 합니다.

- Windows: `C:\Program Files\draw.io\draw.io.exe` 자동 감지
- 미설치 시 시스템 기본 SVG 뷰어로 폴백

---

## 프로젝트 구조

```
vscode-ext-customeditor/
├── src/                        # VS Code 확장 백엔드 (TypeScript)
│   ├── extension.ts            # 확장 진입점
│   ├── SdocEditorProvider.ts   # 커스텀 에디터 + 파일 I/O
│   ├── commands/               # 내보내기 명령 (HTML, Markdown, AsciiDoc)
│   ├── converter/              # VS Code 전용 변환기 (vscode API 사용)
│   └── mcp/server.ts           # MCP 서버 (stdio, AI Agent 연동)
│
├── webview-ui/                 # VS Code 웹뷰 UI (React + Vite)
│   └── src/
│       ├── components/         # React 컴포넌트 (Toolbar, Editor, BubbleMenu 등)
│       ├── extensions/         # Tiptap 확장 (CustomImage, MathBlock 등)
│       ├── hooks/              # useVSCodeMessaging, useTiptapEditor
│       └── styles/             # VS Code 테마 CSS
│
├── shared/                     # VS Code + Tauri 공유 코드 (vscode API 미사용)
│   ├── converter/
│   │   ├── jsonToHtml.ts       # HTML 내보내기
│   │   ├── jsonToMarkdown.ts   # Markdown 내보내기
│   │   ├── jsonToAdoc.ts       # AsciiDoc 내보내기
│   │   └── markdownToJson.ts   # Markdown 가져오기
│   └── mcp/                    # MCP 도구 구현 (AI Agent)
│
├── tauri-app/                  # 데스크톱 앱 (Tauri v2, Windows 전용)
│   ├── src/                    # 프론트엔드 (webview-ui와 동일 구조)
│   │   ├── App.tsx             # 앱 진입점
│   │   ├── adapters/           # Tauri IPC 어댑터
│   │   ├── components/         # UI 컴포넌트
│   │   ├── extensions/         # Tiptap 확장
│   │   └── styles/             # 독립형 다크 테마 CSS
│   └── src-tauri/              # Rust 백엔드
│       └── src/
│           ├── commands.rs     # IPC 커맨드 (파일, 이미지, Draw.io, 설정)
│           ├── document.rs     # .sdoc 문서 모델, auto-ID, cross-ref 동기화
│           └── settings.rs     # JSON 기반 앱 설정
│
├── sample/                     # 예제 .sdoc 파일
├── sdoc.schema.json            # .sdoc 파일 JSON 스키마
└── package.json                # 루트 npm workspace
```

---

## 기술 스택

| 레이어 | VS Code 확장 | Tauri 데스크톱 |
|---|---|---|
| 에디터 UI | React 18 + Tiptap v3 | React 18 + Tiptap v3 (동일) |
| 스타일링 | Tailwind CSS + VS Code CSS 변수 | Tailwind CSS + 독립 다크 테마 |
| 빌드 (프론트) | Vite | Vite |
| 백엔드 | TypeScript (Node.js) | Rust + Tauri v2 |
| 파일 I/O | VS Code TextDocument API | Tauri plugin-fs |
| IPC | VS Code postMessage | Tauri invoke/listen |
| 변환기 | `shared/converter/` | `shared/converter/` (공유) |
| 수식 렌더링 | KaTeX | KaTeX |
| 구문 강조 | lowlight (에디터) + highlight.js (HTML 내보내기) | 동일 |

---

## 라이선스

MIT
