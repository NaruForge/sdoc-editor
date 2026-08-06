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
  · <a href="#빠른-시작">빠른 시작</a>
  · <a href="https://github.com/NaruForge/sdoc-editor/blob/main/cli/README.md">CLI</a>
  · <a href="#프로젝트-문서">문서</a>
</p>

Structured Doc Editor는 `.sdoc`와 레거시 `.tiptap.json` 문서를 위한 오픈 소스 편집기입니다. 제목·표·수식·다이어그램·캡션·교차 참조를 문서 화면에서 편집하면서, 원본은 사람이 검토하고 Git으로 추적하기 쉬운 JSON으로 저장합니다.

v0.8.0부터 지원하는 배포면은 VS Code 확장과 SDOC CLI입니다. VS Code는 시각 편집과 import/export를 제공하고, CLI는 같은 문서 계약 위에서 자동 검사와 revision-safe 의미 연산을 제공합니다.

> [!WARNING]
> Windows Desktop은 **v0.7.8을 마지막으로 지원이 종료(EOL)** 되었습니다. [v0.7.8 릴리스](https://github.com/NaruForge/sdoc-editor/releases/tag/v0.7.8)의 기존 바이너리는 기록 보존용이며 보안 수정, 호환성 업데이트, 사용자 지원을 받지 않습니다. 기존 `.sdoc` 문서와 `~/.sdoc/templates/` 데이터는 삭제되지 않으므로 백업한 뒤 v0.8.0 이상 VS Code 확장으로 여세요.

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
| **SDOC CLI** | 자동 검사와 revision-safe 의미 단위 변경 | GitHub Release의 `sdoc-editor-cli-*.tgz`, Node.js 22.22.2 이상 | 생성·검사·검증·의미 연산; 시각 편집과 변환 제외 |

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

## 핵심 기능

| 영역 | 제공 기능 |
|---|---|
| 구조화 편집 | H1–H6, 자동 번호, 섹션 접기, 목차, 그림·표 목록, 문서 메타데이터 |
| 기술 콘텐츠 | 표와 병합 셀, 이미지와 캡션, KaTeX 수식, 코드 블록, Mermaid·PlantUML·D2·Graphviz 텍스트 다이어그램과 Draw.io |
| 문서 연결 | 제목·그림·표 교차 참조, 안정적인 ID, 참조 번호 자동 동기화 |
| 콘텐츠 블록 | 인용문, Note·Info·Tip·Warning·Danger 콜아웃, 체크리스트, 정렬과 텍스트 스타일 |
| 편집 경험 | 커서 이동 기록, 60–200% 확대/축소, 문서별 테마·폰트·캡션 설정, 사용자 CSS |

### 배포면별 형식 지원

| 작업 | VS Code | CLI |
|---|:---:|:---:|
| `.sdoc` / `.tiptap.json` 열기 | ✓ | 검사·변경 |
| Markdown·HTML 가져오기 | ✓ | — |
| HTML·Markdown·AsciiDoc 내보내기 | ✓ | — |
| PDF·reveal.js Slides 내보내기 | ✓ | — |
| `.sdocbook` 편집·통합 export | ✓ | — |

## 템플릿

> [!IMPORTANT]
> 템플릿은 아직 실험적 기능입니다. 형식과 사용자 흐름이 변경될 수 있으므로 중요한 사용자 템플릿은 Git 등으로 별도 관리하세요.

- 새 문서 명령에서 빈 문서, 기술 보고서, 설계 명세서, 시험·검증 보고서를 선택할 수 있습니다.
- 팀 템플릿은 workspace의 `.sdoc/templates/*.sdoc`에 두고 Git으로 공유합니다.
- 개인 템플릿은 `~/.sdoc/templates/`에 저장됩니다. Remote·WSL·SSH에서는 원격 사용자 홈에 별도로 저장됩니다.
- 현재 템플릿은 본문 구조와 문서 설정만 지원합니다. 이미지·Draw.io asset을 포함한 템플릿은 잘못된 경로 연결을 막기 위해 저장 또는 로드가 거부됩니다.
- 템플릿 적용은 현재 본문과 문서 설정을 교체하기 전에 확인을 받습니다. 손상되거나 지원하지 않는 문서는 템플릿으로 덮어쓰지 않습니다.

## 문서 작성과 설정

- 왼쪽 Navigate, Design, Templates, Publish 허브에서 탐색, 화면·문서 설정, 가져오기·내보내기·템플릿을 전환합니다.
- `@`를 입력해 제목·그림·표·수식에 대한 교차 참조를 삽입합니다.
- 이미지는 클립보드에서 붙여 넣고 캡션·정렬을 지정할 수 있습니다.
- Mermaid는 로컬에서 렌더링합니다. PlantUML·D2·Graphviz의 온라인 미리보기는 최초 사용 시 원문 전송과 엔드포인트를 안내하고 동의를 받은 뒤 활성화됩니다. 거절해도 소스는 그대로 편집·저장·내보낼 수 있습니다.
- Draw.io 편집은 VS Code의 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio)이 필요합니다.
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
- 잘못된 JSON이나 지원하지 않는 미래 버전은 편집기 대신 진단과 원본 JSON 열기 동작만 표시합니다. 유효하게 열었던 문서가 외부 변경으로 손상되면 로컬 초안은 보존하되 쓰기를 즉시 차단하며, 원본 복구 또는 명시적으로 확인한 로컬 초안 복원을 선택할 수 있습니다.
- 이미지와 Draw.io 파일은 portable 상대 경로만 저장하며 문서 경계 밖 경로와 symlink 탈출을 거부합니다.
- 문서·가져오기는 32 MiB, 개별 asset은 32 MiB로 제한합니다. 자체 포함 export는 최대 1,024개 asset 참조와 256 MiB를 처리합니다.
- 전체 자체 포함 HTML/PDF export에 필요한 KaTeX·Mermaid runtime과 글꼴은 확장에 포함되어 CDN 연결 없이 동작합니다.
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
