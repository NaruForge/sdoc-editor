<p align="center">
  <img src="https://raw.githubusercontent.com/NaruForge/sdoc-editor/main/media/sdoc-editor-icon.png" alt="Structured Doc Editor" width="112" height="112">
</p>

<h1 align="center">Structured Doc Editor</h1>

<p align="center">
  Git으로 검토 가능한 구조화 기술 문서를 WYSIWYG로 작성하세요.
</p>

<p align="center">
  <a href="https://github.com/NaruForge/sdoc-editor/releases/latest"><img src="https://img.shields.io/github/v/release/NaruForge/sdoc-editor?style=flat-square&label=Release" alt="최신 GitHub 릴리스"></a>
  <a href="https://github.com/NaruForge/sdoc-editor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/NaruForge/sdoc-editor/ci.yml?branch=main&style=flat-square&label=CI" alt="CI 상태"></a>
  <a href="https://github.com/NaruForge/sdoc-editor/blob/main/LICENSE"><img src="https://img.shields.io/github/license/NaruForge/sdoc-editor?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=swbaek.structured-doc-editor">VS Code에 설치</a>
  · <a href="https://github.com/NaruForge/sdoc-editor/releases/latest">Windows 다운로드</a>
  · <a href="#빠른-시작">빠른 시작</a>
  · <a href="https://github.com/NaruForge/sdoc-editor/blob/main/cli/README.md">CLI</a>
  · <a href="#프로젝트-문서">문서</a>
</p>

<p align="center">
  <img src="media/readme/editor-overview-ko.png" alt="같은 한국어 기술 문서를 편집하는 VS Code 확장과 Windows 데스크톱 앱" width="1600">
</p>

Structured Doc Editor는 `.sdoc`와 레거시 `.tiptap.json` 문서를 위한 오픈 소스 편집기입니다. 제목·표·수식·다이어그램·캡션·교차 참조를 문서 화면에서 편집하면서, 원본은 사람이 검토하고 Git으로 추적하기 쉬운 JSON으로 저장합니다.

VS Code 확장과 Windows 데스크톱 앱은 같은 문서 코어와 에디터를 사용합니다. 저장 형식과 번호·참조의 의미는 같고, 각 host의 설치 방식과 일부 기능만 다릅니다.

## 왜 Structured Doc Editor인가

- **구조를 보며 편집합니다.** H1–H6 제목, 표와 그림, KaTeX 수식, 코드, 다이어그램과 콜아웃을 WYSIWYG로 다룹니다.
- **Git으로 검토할 수 있습니다.** `.sdoc`은 버전이 지정된 portable JSON이며 공개 [JSON Schema](sdoc.schema.json)로 검증할 수 있습니다.
- **참조가 문서와 함께 움직입니다.** 제목·그림·표의 안정적인 ID, 자동 번호와 교차 참조를 동기화합니다.
- **하나의 원본을 여러 형식으로 사용합니다.** Markdown·HTML을 가져오고 host가 지원하는 HTML·PDF·Markdown·AsciiDoc·reveal.js 형식으로 내보냅니다.
- **원본 보호를 우선합니다.** 잘못된 JSON, 지원하지 않는 미래 버전, stale revision과 문서 밖 asset 경로를 조용히 덮어쓰지 않습니다.

제품이 해결하려는 문제와 장기 원칙은 [제품 비전](PRODUCT.md)에서 확인할 수 있습니다.

## 사용 환경 선택

| 환경 | 적합한 용도 | 설치 | 현재 범위 |
|---|---|---|---|
| **VS Code 확장** | 코드와 기술 문서를 같은 workspace에서 관리 | [Marketplace](https://marketplace.visualstudio.com/items?itemName=swbaek.structured-doc-editor), VS Code 1.85 이상 | 전체 시각 편집, import/export, `.sdocbook` 관리 |
| **Windows Desktop** | VS Code 없이 로컬 기술 문서를 편집 | [최신 Windows x64 릴리스](https://github.com/NaruForge/sdoc-editor/releases/latest) | 전체 시각 편집, HTML·Markdown import, 일부 export; PDF·Slides·Book 제외 |
| **SDOC CLI** | 자동 검사와 revision-safe 의미 단위 변경 | GitHub Release의 `sdoc-editor-cli-*.tgz`, Node.js 22.22.2 이상 | 생성·검사·검증·의미 연산; 시각 편집과 변환 제외 |

> [!NOTE]
> Windows Desktop은 **Windows x64를 지원하며 일부 기능에 host 제한이 있습니다.** 일반 설치에는 `Structured.Doc.Editor_*_x64-setup.exe`를 권장합니다. MSI는 관리형 배포, portable ZIP은 설치 없는 실행에 사용할 수 있습니다.

> [!WARNING]
> 현재 Windows 설치 자산은 코드 서명되지 않아 Microsoft Defender SmartScreen이 경고할 수 있습니다. 파일은 반드시 이 저장소의 [공식 최신 Release](https://github.com/NaruForge/sdoc-editor/releases/latest)에서 받고, 출처와 릴리스 버전을 확인한 뒤 사용하세요.

## 빠른 시작

### VS Code

1. [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=swbaek.structured-doc-editor)에서 확장을 설치합니다.
2. 명령 팔레트에서 `Structured Doc: New .sdoc Document (Experimental Templates)`를 실행하거나 기존 `.sdoc`/`.tiptap.json`을 엽니다.
3. 문서를 편집하고 `Ctrl+S`로 저장합니다.

명령줄에서는 다음과 같이 설치할 수 있습니다.

```bash
code --install-extension swbaek.structured-doc-editor
```

직접 빌드한 `.vsix`는 명령 팔레트의 `Extensions: Install from VSIX...`에서 설치할 수 있습니다. GitHub Release에는 VSIX가 첨부되지 않으며 공개 배포는 Marketplace를 사용합니다.

### Windows Desktop

1. [최신 Release](https://github.com/NaruForge/sdoc-editor/releases/latest)에서 Windows x64 Setup EXE를 내려받아 설치합니다.
2. 앱에서 작업 폴더를 열고 새 `.sdoc` 문서를 만들거나 기존 `.sdoc`/`.tiptap.json`을 엽니다.
3. 같은 편집기에서 작성·저장하고 필요한 지원 형식으로 내보냅니다.

## 핵심 기능

| 영역 | 제공 기능 |
|---|---|
| 구조화 편집 | H1–H6, 자동 번호, 섹션 접기, 목차, 그림·표 목록, 문서 메타데이터 |
| 기술 콘텐츠 | 표와 병합 셀, 이미지와 캡션, KaTeX 수식, 코드 블록, Mermaid·Draw.io 다이어그램 |
| 문서 연결 | 제목·그림·표 교차 참조, 안정적인 ID, 참조 번호 자동 동기화 |
| 콘텐츠 블록 | 인용문, Note·Info·Tip·Warning·Danger 콜아웃, 체크리스트, 정렬과 텍스트 스타일 |
| 편집 경험 | 커서 이동 기록, 60–200% 확대/축소, 문서별 테마·폰트·캡션 설정, 사용자 CSS |

### Host별 형식 지원

| 작업 | VS Code | Windows Desktop | CLI |
|---|:---:|:---:|:---:|
| `.sdoc` / `.tiptap.json` 열기 | ✓ | ✓ | 검사·변경 |
| Markdown·HTML 가져오기 | ✓ | ✓ | — |
| HTML·Markdown·AsciiDoc 내보내기 | ✓ | ✓ | — |
| PDF·reveal.js Slides 내보내기 | ✓ | — | — |
| `.sdocbook` 편집·통합 export | ✓ | — | — |

## 템플릿

> [!IMPORTANT]
> 템플릿은 아직 실험적 기능입니다. 형식과 사용자 흐름이 변경될 수 있으므로 중요한 사용자 템플릿은 Git 등으로 별도 관리하세요.

- 새 문서 명령에서 빈 문서, 기술 보고서, 설계 명세서, 시험·검증 보고서를 선택할 수 있습니다.
- 팀 템플릿은 workspace의 `.sdoc/templates/*.sdoc`에 두고 Git으로 공유합니다.
- 개인 템플릿은 `~/.sdoc/templates/`에 저장되며 로컬 VS Code와 Windows 앱이 함께 사용합니다. Remote·WSL·SSH에서는 원격 사용자 홈에 별도로 저장됩니다.
- 현재 템플릿은 본문 구조와 문서 설정만 지원합니다. 이미지·Draw.io asset을 포함한 템플릿은 잘못된 경로 연결을 막기 위해 저장 또는 로드가 거부됩니다.
- 템플릿 적용은 현재 본문과 문서 설정을 교체하기 전에 확인을 받습니다. 손상되거나 지원하지 않는 문서는 템플릿으로 덮어쓰지 않습니다.

## 문서 작성과 설정

- 왼쪽 Navigate, Design, Publish 허브에서 탐색, 화면·문서 설정, 가져오기·내보내기·템플릿을 전환합니다. Desktop은 Workspace 허브도 제공합니다.
- `@`를 입력해 제목·그림·표·수식에 대한 교차 참조를 삽입합니다.
- 이미지는 클립보드에서 붙여 넣고 캡션·정렬을 지정할 수 있습니다.
- Mermaid는 로컬에서 렌더링합니다. PlantUML·D2·Graphviz용 Kroki는 기본적으로 꺼져 있으며, 활성화하면 다이어그램 소스가 설정한 서버로 전송됩니다.
- Draw.io 편집은 VS Code에서 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio), Windows Desktop에서 draw.io 데스크톱 애플리케이션이 필요합니다.
- UI 언어와 외부 renderer 같은 host 설정은 사용자 환경에 저장됩니다. 제목·캡션·폰트·색상·테마·슬라이드 같은 문서 설정은 `.sdoc`의 `meta.settings`에 저장됩니다.

VS Code는 확장을 제거해도 사용자가 기록한 `settings.json` 값을 자동으로 삭제하지 않습니다. v0.7.4 이하의 디자인·슬라이드 설정이 남아 있으면 명령 팔레트에서 `Structured Doc Editor: Clean Up Legacy Settings`를 실행하세요. 삭제 대상과 설정 범위를 확인받은 뒤 더 이상 지원하지 않는 Structured Doc Editor 설정만 제거합니다.

## `.sdoc` 형식과 데이터 안전성

`.sdoc`는 문서 메타데이터와 Tiptap JSON 트리를 버전이 지정된 envelope에 저장합니다.

```json
{
  "sdoc": "1.0",
  "meta": { "title": "시스템 설계서", "version": "1.0" },
  "doc": {
    "type": "doc",
    "content": [{ "type": "paragraph" }]
  }
}
```

저장 형식의 기준은 [`sdoc.schema.json`](sdoc.schema.json)입니다.

- 저장 전 최신 편집 내용과 문서 identity·revision을 확인해 지연된 저장이 다른 문서에 적용되지 않게 합니다.
- 잘못된 JSON이나 지원하지 않는 미래 버전은 원본 보호를 위해 VS Code에서 읽기 전용으로 열고, Windows Desktop에서는 열기를 거부합니다.
- 이미지와 Draw.io 파일은 portable 상대 경로만 저장하며 문서 경계 밖 경로와 symlink 탈출을 거부합니다.
- Command Palette와 편집기 Publish 패널은 같은 변환기와 설정 해석 규칙을 사용합니다.

## 여러 문서를 한 권으로 관리하기

`.sdocbook`은 여러 `.sdoc`의 순서와 책 메타데이터를 관리하고 하나의 HTML/PDF로 내보내는 manifest입니다. 현재 Book 편집, 진단과 통합 export는 **VS Code 확장 전용**입니다.

Book 화면은 누락되거나 잘못된 문서, 중복 ID, 깨진 참조를 진단하고 불완전한 export를 차단합니다. 열려 있는 `.sdoc`의 저장하지 않은 변경도 검증과 export에 사용합니다.

## SDOC CLI

`sdoc` CLI는 `.sdoc`을 생성·검사·검증하고 revision-safe 의미 연산을 수행하는 자동화 도구입니다. Node.js 22.22.2 이상이 필요하며 npm registry가 아니라 [GitHub Releases](https://github.com/NaruForge/sdoc-editor/releases/latest)의 `sdoc-editor-cli-*.tgz`로 배포됩니다. npm registry의 동명 `sdoc` 패키지는 이 프로젝트와 관련이 없습니다.

프로젝트 로컬 설치에서는 의도하지 않은 패키지 실행을 막기 위해 `npx --no-install sdoc`을 사용하세요. 변경 명령은 `--write`를 지정하지 않으면 preview이며, 적용할 때는 `inspect`가 반환한 exact-byte revision을 요구합니다.

설치, 전체 명령, 12개 operation 계약, target, 진단과 종료 코드는 [CLI 매뉴얼](cli/README.md)을 따릅니다.

## 프로젝트 문서

- [제품 비전과 범위](PRODUCT.md)
- [CLI 설치와 명령 계약](cli/README.md)
- [문서 JSON Schema](sdoc.schema.json)
- [기여 가이드](CONTRIBUTING.md)
- [아키텍처와 의존성 규칙](docs/architecture.md)
- [AI 에이전트용 이슈 작성 가이드](.github/AI_ISSUE_REPORTING.md)
- [보안 취약점 신고](SECURITY.md)
- [행동 규칙](CODE_OF_CONDUCT.md)
- [자산과 라이선스 범위](ASSETS.md)

> VS Code Marketplace 설명과 GitHub 프로젝트 소개는 이 루트 `README.md`를 함께 사용합니다. `npm run package`가 README를 VSIX에 포함하며 저장소 상대 링크와 이미지는 Marketplace용 GitHub HTTPS 주소로 변환합니다.

## 기여하기

버그 제보와 기능 제안은 [GitHub Issues](https://github.com/NaruForge/sdoc-editor/issues)에 남겨 주세요. 코드 기여 전에는 [CONTRIBUTING.md](CONTRIBUTING.md)의 개발 환경, 아키텍처 경계, 검증 절차와 기여 권리 조건을 확인해 주세요. 보안 취약점은 공개 이슈로 올리지 말고 [SECURITY.md](SECURITY.md)의 비공개 절차를 사용합니다.

AI 에이전트는 이슈를 생성하거나 수정하기 전에 [AI 에이전트용 이슈 작성 가이드](.github/AI_ISSUE_REPORTING.md)와 그 문서가 지정한 기여 가이드·보안 정책·Issue Form을 반드시 읽고 따라야 합니다.

## 라이선스

소스 코드와 프로젝트 문서는 기본적으로 [MIT License](LICENSE)로 배포됩니다. 제3자 의존성과 별도 자산 범위는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 [ASSETS.md](ASSETS.md)를 확인해 주세요.
