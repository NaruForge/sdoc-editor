# Structured Doc Editor

`.sdoc` 파일을 위한 WYSIWYG 에디터입니다. **VS Code 확장 프로그램**과 **독립형 데스크톱 앱(Tauri)** 두 가지 형태로 제공됩니다.

---

## 배포 형태

| 형태 | 경로 | 비고 |
|---|---|---|
| VS Code 확장 | `src/` + `webview-ui/` | `.vsix` 패키징, VS Code 전용 |
| 데스크톱 앱 (Tauri) | `tauri-app/` | Windows/Linux/macOS 네이티브 앱 |
| 공유 변환 로직 | `shared/converter/` | 두 형태가 공통으로 사용 |

---

## 주요 기능

- **WYSIWYG 편집**: Tiptap/ProseMirror 기반 리치 텍스트 에디터
- **JSON 저장**: pretty-printed JSON 형식으로 저장하여 Git diff 최적화
- **다양한 내보내기**: Markdown, AsciiDoc, 테마 적용 HTML
- **Markdown/HTML 가져오기**: `.sdoc`으로 변환
- **Draw.io 다이어그램**: 삽입 및 편집 (VS Code: Draw.io Integration 확장 / 데스크톱: draw.io 앱 연동)
- **수학 수식**: KaTeX 인라인/블록 수식
- **교차 참조**: `@` 입력으로 heading, figure, table 참조 삽입 및 자동 번호 동기화
- **섹션 접기**: heading 옆 토글로 섹션별 접기/펼치기
- **문서 메타데이터**: Title, Author, Version 인라인 편집
- **코드 블록**: lowlight 기반 구문 강조 (100+ 언어)
- **할 일 목록**: 체크박스 태스크 리스트
- **표**: 캡션/정렬/너비, 컨텍스트 메뉴로 행/열 조작
- **이미지**: 클립보드 붙여넣기, 캡션, 정렬
- **자동 업데이트** (VS Code 전용): 공유 폴더 기반 사내 자동 업데이트

---

## VS Code 확장 프로그램

### 설치 (VSIX)

1. VS Code에서 `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
2. `.vsix` 파일 선택 후 재시작

> **사내 사용자**: `structuredDocEditor.update.sharedFolder` 설정에서 자동 업데이트 경로를 확인하세요.

### 개발 빌드

```bash
# 루트에서
npm install
npm run build   # 확장 + webview 동시 빌드
```

F5를 눌러 Extension Development Host 실행.

### VS Code 빌드 명령

| 명령 | 설명 |
|---|---|
| `npm run build` | 확장 + webview 모두 빌드 |
| `npm run build:ext` | 확장만 빌드 |
| `npm run build:webview` | Webview만 빌드 |
| `npm run package` | 빌드 + VSIX 패키징 (`output/*.vsix`) |
| `npm run watch` | watch 모드 |

### 필수 권장 확장

Draw.io 편집을 위해 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) 설치.

### 사용 방법

1. `.sdoc` 파일 생성 → 커스텀 에디터 자동 실행
2. `Ctrl+S`로 저장
3. **이미지**: 클립보드에서 직접 붙여넣기
4. **Draw.io**: 툴바 "Draw.io" 버튼 → 파일명 입력 → 더블클릭으로 재편집
5. **내보내기**: `Ctrl+Shift+P` → "Structured Doc: Export to ..."

### 테마 커스터마이징

`.vscode/settings.json`:
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

---

## 데스크톱 앱 (Tauri) — `feature/tauri-desktop` 브랜치

VS Code 없이 독립형 앱으로 실행되는 버전입니다.

### 사전 요구사항

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (stable)

### Windows에서 빌드

```powershell
# 1. Rust 설치 (https://rustup.rs)
winget install Rustlang.Rustup   # 또는 rustup.rs에서 직접 설치

# 2. WebView2 런타임 (Windows 11은 기본 내장, Windows 10은 필요시 설치)
# https://developer.microsoft.com/microsoft-edge/webview2/

# 3. 저장소 클론 및 브랜치 전환
git clone <repo-url>
cd vscode-ext-customeditor
git checkout feature/tauri-desktop

# 4. 프론트엔드 의존성 설치
cd tauri-app
npm install

# 5. 빌드
npx tauri build
```

빌드 완료 후 산출물:
```
tauri-app/src-tauri/target/release/
  sdoc-editor.exe               ← 실행파일
  bundle/
    msi/  *.msi                 ← Windows 설치 패키지
    nsis/ *.exe                 ← NSIS 인스톨러
```

### Linux에서 빌드

```bash
# 의존성 설치 (Ubuntu/Debian)
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  build-essential

cd tauri-app
npm install
npx tauri build
```

### 개발 모드 실행

```bash
cd tauri-app
npm install
npx tauri dev   # 핫 리로드 지원
```

### Draw.io 데스크톱 연동

데스크톱 앱에서 Draw.io 다이어그램 편집 시 [draw.io 데스크톱 앱](https://github.com/jgraph/drawio-desktop/releases)을 시스템에 설치해야 합니다.
- Windows: `C:\Program Files\draw.io\draw.io.exe` 자동 감지
- 미설치 시 시스템 기본 SVG 뷰어로 폴백

---

## 프로젝트 구조

```
├── src/                        # VS Code 확장 백엔드 (TypeScript)
│   ├── extension.ts            # 확장 진입점
│   ├── SdocEditorProvider.ts   # 커스텀 에디터 + 파일 I/O
│   ├── converter/              # (레거시) VS Code 전용 변환기
│   └── commands/               # 내보내기 명령
│
├── webview-ui/                 # VS Code 웹뷰 UI (React)
│   └── src/
│       ├── components/         # React 컴포넌트 (Toolbar, Editor 등)
│       ├── extensions/         # Tiptap 확장 (CustomImage, MathBlock 등)
│       ├── hooks/              # useVSCodeMessaging, useTiptapEditor
│       └── styles/             # VS Code 테마 CSS
│
├── shared/                     # VS Code + Tauri 공유 코드
│   └── converter/
│       ├── jsonToHtml.ts       # HTML 내보내기 (highlight.js 포함)
│       ├── jsonToMarkdown.ts   # Markdown 내보내기
│       ├── jsonToAdoc.ts       # AsciiDoc 내보내기
│       └── markdownToJson.ts   # Markdown 가져오기
│
└── tauri-app/                  # 데스크톱 앱 (Tauri v2)
    ├── src/                    # 프론트엔드 (React, webview-ui와 동일 구조)
    │   ├── App.tsx             # 앱 진입점 (환영 화면 + 에디터)
    │   ├── adapters/           # Tauri IPC 어댑터 (VS Code messaging 대체)
    │   ├── components/         # UI 컴포넌트 (webview-ui에서 포팅)
    │   ├── extensions/         # Tiptap 확장
    │   └── styles/             # 독립형 다크 테마 CSS
    └── src-tauri/              # Rust 백엔드
        └── src/
            ├── main.rs         # 진입점
            ├── lib.rs          # Tauri 플러그인 설정, 메뉴
            ├── commands.rs     # IPC 커맨드 (파일, 이미지, Draw.io, 설정 등)
            ├── document.rs     # .sdoc 문서 모델, auto-ID, cross-ref 동기화
            └── settings.rs     # JSON 기반 앱 설정 (OS config 디렉토리 저장)
```

---

## .sdoc 파일 형식

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

---

## 기술 스택

| 레이어 | VS Code 확장 | Tauri 데스크톱 |
|---|---|---|
| 에디터 UI | React 18 + Tiptap | React 18 + Tiptap (동일) |
| 스타일링 | Tailwind CSS + VS Code CSS 변수 | Tailwind CSS + 독립 다크 테마 |
| 빌드 (프론트) | Vite | Vite |
| 백엔드 | TypeScript (Node.js) | Rust + Tauri v2 |
| 파일 I/O | VS Code TextDocument API | Tauri plugin-fs |
| IPC | VS Code postMessage | Tauri invoke/listen |
| 변환기 | `shared/converter/` | `shared/converter/` (공유) |
| 수식 | KaTeX | KaTeX |
| 구문 강조 | lowlight (에디터) + highlight.js (HTML 내보내기) | 동일 |

## 라이선스

MIT
