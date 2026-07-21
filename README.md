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

## 여러 문서를 한 권으로 관리하기

`.sdocbook`은 여러 `.sdoc` 문서의 순서와 책 메타데이터를 관리하고 하나의 HTML/PDF로 내보내는 manifest입니다. VS Code에서 `.sdocbook`을 열면 문서를 추가·제거·정렬하고 각 장을 개별 편집할 수 있습니다.

Book 화면은 포함 문서를 자동으로 검사합니다. 누락되거나 잘못된 문서, 중복 ID, 깨진 참조가 있으면 진단을 표시하고 불완전한 통합 export를 차단합니다. 열려 있는 `.sdoc`의 아직 저장하지 않은 변경도 검증과 export에 사용됩니다. 현재 Book 관리 화면과 통합 export는 VS Code 확장에서 지원합니다.

각 장은 병렬로 불러오되 manifest 순서대로 합성되며, 장 링크와 로컬 이미지 경로는 book 경계 안에서 안전하게 다시 계산됩니다. 손상된 장은 다른 장의 미리보기를 지우지 않고 해당 장의 진단으로 표시됩니다.

## 데이터 안전성

- 저장 전 최신 편집 내용을 flush하고 문서 identity와 revision을 확인해, 이전 문서의 지연 저장이 새 문서에 적용되지 않게 합니다.
- 잘못된 JSON이나 지원하지 않는 미래 버전은 원본 보호를 위해 읽기 전용으로 열립니다.
- 이미지와 Draw.io 파일은 portable 상대 경로만 저장하며, export와 파일 작업은 문서 경계 밖 경로와 symlink 탈출을 거부합니다.
- Command Palette와 편집기 toolbar export는 동일한 변환기와 설정 해석 규칙을 사용합니다.

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
| `npm run package` | `output/`에 VSIX 생성 |
| `npm run licenses:check` | npm/Cargo 라이선스와 고지 검증(Rust 필요) |

저장소 구조와 의존성 방향은 [아키텍처 문서](docs/architecture.md), 자세한 작업 규칙은 [기여 가이드](CONTRIBUTING.md)를 참고하세요.

> VS Code Marketplace 설명과 GitHub 프로젝트 소개는 이 루트 `README.md`를 함께 사용합니다. `npm run package`가 README를 VSIX의 `extension/readme.md`로 포함하므로 두 문서를 따로 관리하지 않습니다.

## 프로젝트 문서

- [제품 비전과 범위](PRODUCT.md)
- [아키텍처와 의존성 규칙](docs/architecture.md)
- [기여 가이드](CONTRIBUTING.md)
- [보안 취약점 신고](SECURITY.md)
- [행동 규칙](CODE_OF_CONDUCT.md)
- [자산과 라이선스 범위](ASSETS.md)

## 기여하기

버그 제보와 기능 제안은 [GitHub Issues](https://github.com/NaruForge/sdoc-editor/issues)에 남겨 주세요. 코드 기여 전에는 [CONTRIBUTING.md](CONTRIBUTING.md)의 개발 환경, 아키텍처 경계, 검증 절차와 기여 권리 조건을 확인해 주세요. 보안 취약점은 공개 이슈로 올리지 말고 [보안 정책](SECURITY.md)을 따라 신고해 주세요.

## 라이선스

소스 코드는 기본적으로 [MIT License](LICENSE)로 배포됩니다. 제3자 의존성과 MIT 범위 밖 자산은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 [ASSETS.md](ASSETS.md)를 확인해 주세요.
