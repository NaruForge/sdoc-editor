<p align="center">
  <img src="https://raw.githubusercontent.com/NaruForge/sdoc-editor/main/media/sdoc-editor-icon.png" alt="Structured Doc Editor" width="128" height="128">
</p>

<h1 align="center">Structured Doc Editor</h1>

<p align="center">
  구조를 잃지 않고 기술 문서를 편집하는 WYSIWYG 에디터
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=swbaek.structured-doc-editor"><img src="https://img.shields.io/visual-studio-marketplace/v/swbaek.structured-doc-editor?style=flat-square&logo=visualstudiocode&label=Marketplace" alt="Visual Studio Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=swbaek.structured-doc-editor"><img src="https://img.shields.io/visual-studio-marketplace/i/swbaek.structured-doc-editor?style=flat-square&logo=visualstudiocode&label=Installs" alt="Visual Studio Marketplace installs"></a>
  <a href="https://github.com/NaruForge/sdoc-editor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/NaruForge/sdoc-editor/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/NaruForge/sdoc-editor/blob/main/LICENSE"><img src="https://img.shields.io/github/license/NaruForge/sdoc-editor?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=swbaek.structured-doc-editor">설치</a>
  · <a href="https://github.com/NaruForge/sdoc-editor/releases">릴리스</a>
  · <a href="https://github.com/NaruForge/sdoc-editor/issues">이슈</a>
  · <a href="https://github.com/NaruForge/sdoc-editor/blob/main/CONTRIBUTING.md">기여하기</a>
</p>

---

Structured Doc Editor는 `.sdoc`와 `.tiptap.json` 문서를 위한 오픈 소스 편집기입니다. 문서는 사람이 검토하고 Git으로 추적하기 쉬운 JSON으로 저장하면서, 편집할 때는 제목·표·수식·다이어그램·교차 참조를 갖춘 문서 화면을 제공합니다.

동일한 문서 코어와 에디터를 **VS Code 확장**과 **Windows 데스크톱 앱**에서 함께 사용합니다.

## 핵심 기능

| 영역 | 제공 기능 |
|---|---|
| 구조화 편집 | H1–H6, 자동 번호, 섹션 접기, 목차, 그림/표 목록, 문서 메타데이터 |
| 기술 콘텐츠 | 표와 병합 셀, 이미지와 캡션, KaTeX 수식, 코드 블록, Mermaid·Draw.io 다이어그램 |
| 문서 연결 | 제목·그림·표 교차 참조, 안정적인 ID, 참조 번호 자동 동기화 |
| 콘텐츠 블록 | 인용문, Note·Info·Tip·Warning·Danger 콜아웃, 체크리스트, 정렬과 텍스트 스타일 |
| 가져오기/내보내기 | Markdown·HTML 가져오기, HTML·PDF·Markdown·AsciiDoc·reveal.js 슬라이드 내보내기 |
| 편집 경험 | 커서 뒤로/앞으로, 60–200% 확대/축소, 문서별 테마·폰트·캡션 설정, 사용자 CSS |
| AI 지원 | 문서 스키마 지침, `/sdoc-editing` Chat Skill, 검증·변환·조회용 내장 MCP 서버 |

## 빠른 시작

### VS Code Marketplace

1. [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=swbaek.structured-doc-editor)에서 확장을 설치합니다.
2. 명령 팔레트에서 `Structured Doc: New .sdoc Document`를 실행하거나 기존 `.sdoc`/`.tiptap.json` 파일을 엽니다.
3. WYSIWYG 에디터에서 문서를 편집하고 `Ctrl+S`로 저장합니다.

명령줄에서도 설치할 수 있습니다.

```bash
code --install-extension swbaek.structured-doc-editor
```

### 로컬 VSIX

릴리스 또는 직접 빌드한 `.vsix` 파일은 명령 팔레트의 `Extensions: Install from VSIX...`에서 설치할 수 있습니다.

## 지원 형식

| 형식 | 열기/편집 | 가져오기 | 내보내기 |
|---|:---:|:---:|:---:|
| `.sdoc` / `.tiptap.json` | ✓ | — | — |
| Markdown | — | ✓ | ✓ |
| HTML | — | ✓ | ✓ |
| AsciiDoc | — | — | ✓ |
| PDF | — | — | ✓ |
| reveal.js 슬라이드 | — | — | ✓ |

내보내기는 명령 팔레트 또는 에디터 왼쪽의 파일 작업 패널에서 실행합니다. HTML은 이미지만 포함하거나 모든 런타임 자산까지 포함하는 self-contained 출력도 지원합니다.

## 문서 작성

- 왼쪽 Activity Bar에서 목차, 그림 목록, 표 목록, 문서 설정, 파일 작업을 전환합니다.
- `@`를 입력해 제목·그림·표·수식에 대한 교차 참조를 삽입합니다.
- 이미지는 클립보드에서 바로 붙여 넣고 캡션·정렬을 지정할 수 있습니다.
- Mermaid는 에디터 안에서 작성하고 미리 볼 수 있습니다. Draw.io 편집에는 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio)이 필요합니다.
- `Alt+←` / `Alt+→` 또는 마우스 탐색 버튼으로 이전·다음 커서 위치로 이동합니다.

## AI 지원

확장에는 `.sdoc` 구조를 안전하게 다루기 위한 지침, Chat Skill, MCP 서버가 포함되어 있습니다.

1. 명령 팔레트에서 `Structured Doc: Setup AI Support (MCP + Instructions)`를 실행합니다.
2. 프로젝트에 생성된 `.github/mcp.json`과 문서 지침을 검토합니다.
3. AI 채팅에서 문서 생성·편집을 요청하거나 `/sdoc-editing`을 호출합니다.

MCP 서버는 스키마 검증, 문서 생성, import/export, ID 할당, 교차 참조 동기화, 마이그레이션, 구조 조회 도구를 제공합니다. 자세한 내용은 [AI Agent 가이드](docs/agent/README.md)를 참고하세요.

## `.sdoc` 형식

`.sdoc`는 버전이 지정된 envelope 안에 문서 메타데이터와 Tiptap JSON 트리를 저장합니다.

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "시스템 설계서",
    "author": "작성자",
    "version": "1.0"
  },
  "doc": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "첫 문단" }]
      }
    ]
  }
}
```

저장 형식의 기준은 [JSON Schema](sdoc.schema.json)입니다. 포맷을 변경할 때는 스키마, 타입, 변환기, 예제와 테스트를 함께 갱신합니다.

## 설정

VS Code 설정에서 `Structured Doc Editor`를 검색하면 다음 항목을 조정할 수 있습니다.

- 제목 번호·장식·색상
- IEEE, ISO/IEC, Modern, Korean 캡션 스타일과 번호 방식
- 본문·굵게·제목 폰트 굵기
- HTML/PDF 이미지 포함 방식과 출력 경로
- HTML/PDF/슬라이드 테마와 사용자 CSS
- 슬라이드 분할 수준, 타이틀 슬라이드, 전환 효과

문서별 설정은 `.sdoc`의 `meta.settings`에 저장되어 다른 환경에서도 동일하게 재현됩니다.

## Windows 데스크톱 앱

Tauri 기반 데스크톱 앱은 VS Code 없이 `.sdoc` 문서를 편집할 수 있도록 동일한 에디터와 문서 코어를 사용합니다. 작업 폴더 탐색, 최근 폴더 복원, 파일 감시, 휴지통 삭제와 실행 취소 같은 네이티브 기능을 제공합니다.

현재 네이티브 앱은 Windows를 대상으로 하며, 소스에서 실행하려면 Node.js, Rust, WebView2가 필요합니다.

```bash
npm ci
npm run tauri dev --workspace=sdoc-editor-tauri
```

## 개발

요구 사항은 Node.js 22.13 이상, npm 10 이상이며 데스크톱 개발에는 Rust 1.90과 WebView2가 추가로 필요합니다.

```bash
git clone https://github.com/NaruForge/sdoc-editor.git
cd sdoc-editor
npm ci
npm run check
npm run build:all
```

| 명령 | 설명 |
|---|---|
| `npm run watch` | Extension host와 VS Code 웹뷰 감시 빌드 |
| `npm run check` | 버전, 타입, 린트, 단위 테스트 검사 |
| `npm run build:all` | VS Code 확장과 Tauri 프런트엔드 빌드 |
| `npm run package` | `output/`에 VSIX와 `version.json` 생성 |

저장소 구조와 의존성 방향은 [아키텍처 문서](docs/architecture.md), 자세한 작업 규칙은 [기여 가이드](CONTRIBUTING.md)를 참고하세요.

> VS Code Marketplace 설명과 GitHub 프로젝트 소개는 이 루트 `README.md`를 함께 사용합니다. `npm run package`가 README를 VSIX의 `extension/readme.md`로 포함하므로 두 문서를 따로 관리하지 않습니다.

## 기여하기

버그 제보와 기능 제안은 [GitHub Issues](https://github.com/NaruForge/sdoc-editor/issues)에 남겨 주세요. 코드 기여 전에는 [CONTRIBUTING.md](CONTRIBUTING.md)의 개발 환경, 아키텍처 경계, 검증 절차를 확인해 주세요.

## 라이선스

[MIT](LICENSE) © contributor-01
