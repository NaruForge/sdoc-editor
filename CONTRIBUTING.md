# Contributing — Structured Doc Editor

개발 환경 설정, 빌드, 프로젝트 구조 등 개발자를 위한 가이드입니다.

---

## 배포 형태

| 형태 | 경로 | 대상 플랫폼 |
|---|---|---|
| VS Code 확장 | `src/` + `webview-ui/` | Windows / Linux / macOS |
| 데스크톱 앱 (Tauri) | `tauri-app/` | **Windows 전용** |
| 공유 변환 로직 | `shared/converter/` | 두 형태 공통 사용 |

---

## 개발 환경 설정

### 사전 요구사항

- Node.js 18+
- VS Code 1.85.0 이상
- (Tauri 빌드 시) [Rust (stable)](https://rustup.rs)

### 의존성 설치 및 빌드

```bash
npm install
npm run build        # 확장 + webview 동시 빌드
```

F5를 눌러 Extension Development Host를 실행하면 개발 버전을 바로 테스트할 수 있습니다.

### Watch 모드

개발 중 파일 변경 시 자동으로 재빌드하려면:

```bash
npm run watch        # 확장 + webview watch 모드 동시 실행
```

### 빌드 명령 목록

| 명령 | 설명 |
|---|---|
| `npm run build` | 확장 + webview 모두 빌드 |
| `npm run build:ext` | 확장(TypeScript)만 빌드 |
| `npm run build:webview` | Webview(Vite)만 빌드 |
| `npm run package` | 빌드 후 VSIX 패키징 → `output/*.vsix` |
| `npm run watch` | 확장 + webview watch 모드 동시 실행 |

### 권장 확장

Draw.io 편집을 위해 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) 확장을 함께 설치하세요.

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

## 데스크톱 앱 (Tauri) — Windows 전용

VS Code 없이 독립형 앱으로 실행되는 버전입니다.

> **주의**: Tauri 데스크톱 앱은 **Windows에서만 빌드 및 배포합니다.**
> Linux/macOS 빌드는 지원하지 않습니다.

### 사전 요구사항

- WebView2 런타임 (Windows 11은 기본 내장, Windows 10은 필요 시 [설치](https://developer.microsoft.com/microsoft-edge/webview2/))

### Rust 버전 고정 정책

Tauri 빌드 안정성을 위해 Rust 툴체인을 고정합니다.

- 기준 버전: `1.90.0`
- 위치: `tauri-app/rust-toolchain.toml`
- 확인 명령:

```powershell
cd tauri-app
rustup show active-toolchain
rustc --version
```

`1.90.0-x86_64-pc-windows-msvc`가 보이지 않으면:

```powershell
rustup toolchain install 1.90.0
rustup override set 1.90.0
```

### 빌드 및 배포

```powershell
# 1. Rust 설치
winget install Rustlang.Rustup

# 2. (최초 1회) 툴체인 고정
rustup toolchain install 1.90.0

# 3. 의존성 설치 및 빌드
cd tauri-app
npm install
$env:CARGO_BUILD_JOBS="1"
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

## 테스트

### 검증 체크리스트

- [ ] 확장 프로그램이 오류 없이 빌드됨
- [ ] Webview가 오류 없이 빌드됨
- [ ] `.sdoc` 파일이 커스텀 에디터에서 열림
- [ ] 툴바 버튼이 작동하고 활성 상태 표시됨
- [ ] Ctrl+S로 문서가 저장됨
- [ ] Markdown / AsciiDoc / HTML 내보내기 작동
- [ ] 테마 설정이 HTML 출력에 반영됨
- [ ] 실행 취소/다시 실행이 올바르게 작동함
- [ ] 에디터가 VS Code 테마 변경에 적응함
- [ ] 이미지 붙여넣기가 작동함

### 문제 해결

**확장 프로그램이 활성화되지 않음**
- 출력 패널 확인 (보기 > 출력) 및 "Structured Doc Editor" 선택
- 재빌드: `npm run build`
- VS Code 재시작

**Webview가 로드되지 않음**
- Webview 브라우저 콘솔 확인 (도움말 > 개발자 도구 전환)
- `dist/webview/`에 index.html, index.js, index.css가 있는지 확인
- Webview 재빌드: `npm run build:webview`

**변경사항이 반영되지 않음**
- Watch 모드 사용 시 두 watcher가 모두 실행 중인지 확인
- Extension Development Host를 중지하고 다시 시작

**Tauri 빌드 중 `STATUS_STACK_BUFFER_OVERRUN (0xc0000409)` 발생**
- Rust 버전 확인: `rustup show active-toolchain`
- `tauri-app`에서 `1.90.0`으로 고정되어 있는지 확인
- 미고정 시:
  - `rustup toolchain install 1.90.0`
  - `rustup override set 1.90.0`
- 병렬 빌드 축소 후 재시도: `$env:CARGO_BUILD_JOBS="1"; npx tauri build`

**`Blocking waiting for file lock on build directory`로 오래 대기함**
- 같은 디렉터리에서 중복 `cargo/tauri build`가 동시에 실행 중인지 확인
- 중복 터미널 프로세스를 종료한 뒤 단일 빌드만 실행

**Vite 경고가 많아 빌드 실패처럼 보임**
- `dynamic import ... also statically imported` 및 `Some chunks are larger than 500 kB`는 경고이며 실패 원인이 아님
- 실제 실패 여부는 마지막 Exit Code와 `Finished ...`/`failed to build app` 문구로 판단

**Rust warning(`unused import`, `unused variable`)이 출력됨**
- 현재는 warning 수준이며 바이너리/설치 파일 생성에는 영향 없음
- 필요하면 `cargo fix --lib -p sdoc-editor`로 정리 가능
