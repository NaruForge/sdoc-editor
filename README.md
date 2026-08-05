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

## SDOC command-line interface

The repository includes the `sdoc` CLI for deterministic inspection,
validation, and semantic document changes on Node.js 22.22.2 or newer. The CLI
is distributed as the `sdoc-editor-cli-<version>.tgz` asset on
[GitHub Releases](https://github.com/NaruForge/sdoc-editor/releases); it is not
published to the npm registry.

### AI Agent installation guide

When a user gives an AI Agent this repository URL and asks it to install the
CLI, the Agent should:

1. Check that `node --version` is 22.22.2 or newer and that `npm` is available.
2. Inspect the latest non-prerelease GitHub Release and select the single asset
   whose name matches `sdoc-editor-cli-*.tgz`. Do not install the repository
   source archive or the root `structured-doc-editor` package.
3. Choose the installation scope:
   - **Local, recommended for one project:** use this when the current project
     has a `package.json`, when reproducibility matters, or when the user did
     not explicitly request a machine-wide command. Record the release asset
     URL as a development dependency and run it with `npx --no-install sdoc`.
   - **Global:** use this only when the user explicitly asks for a global
     installation or wants the same command across multiple unrelated
     projects. Run it directly as `sdoc`.
4. Verify the installed command and report the selected scope and version.

An authenticated GitHub CLI can discover the current release and asset URL:

```bash
gh release view --repo NaruForge/sdoc-editor --json tagName,assets
```

Without `gh` or authentication, use the anonymous Releases REST API. Both
examples require exactly one strict `sdoc-editor-cli-*.tgz` match and select
its `browser_download_url`.

```powershell
$release = Invoke-RestMethod `
  -Headers @{
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
  } `
  -Uri 'https://api.github.com/repos/NaruForge/sdoc-editor/releases/latest'
$assets = @($release.assets | Where-Object {
  $_.name -match '^sdoc-editor-cli-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$'
})
if ($assets.Count -ne 1) {
  throw "Expected exactly one sdoc-editor-cli-*.tgz asset, found $($assets.Count)."
}
$env:SDOC_CLI_TGZ_URL = $assets[0].browser_download_url
```

```bash
SDOC_CLI_TGZ_URL="$(
  curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    https://api.github.com/repos/NaruForge/sdoc-editor/releases/latest |
  jq -er '
    [.assets[] | select(.name | test("^sdoc-editor-cli-[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?[.]tgz$"))]
    | if length == 1 then .[0].browser_download_url
      else error("expected exactly one sdoc-editor-cli-*.tgz asset")
      end
  '
)"
export SDOC_CLI_TGZ_URL
```

Anonymous GitHub REST requests are rate-limited (typically 60 requests per
hour per source IP), so authenticate requests from busy shared runners. The
CLI is not published to npm and there is no unversioned `latest` asset alias;
always install the discovered versioned `browser_download_url`.

Set `SDOC_CLI_TGZ_URL` to the download URL discovered by either method above.
For a project-local installation:

```bash
npm install --save-dev "$SDOC_CLI_TGZ_URL"
npm ls sdoc-editor-cli --depth=0
npx --no-install sdoc --version
```

For an explicitly requested global installation:

```bash
npm install --global "$SDOC_CLI_TGZ_URL"
sdoc --version
npm list --global sdoc-editor-cli --depth=0
```

Do not silently switch from a local installation to a global installation. If
the current directory has no `package.json`, ask the user where the CLI should
be installed instead of creating a project or changing global state without
confirmation.

Clone and build the repository only when the user explicitly wants a
development build or no suitable release asset exists:

```bash
git clone https://github.com/NaruForge/sdoc-editor.git
cd sdoc-editor
npm ci
npm run package:cli
```

Mutation commands are previews unless `--write` is present. Every apply
request requires the byte revision returned by `inspect`; this prevents a
stale operation from overwriting a file that changed after inspection.

For a safe project-local quick start, run the following first from the project
that contains the local CLI dependency. If the binary is absent, stop and
install the intended `sdoc-editor-cli` release. Never remove `--no-install`:
npm could otherwise download and execute the unrelated registry package named
`sdoc`.

```powershell
Get-Location
npm ls sdoc-editor-cli --depth=0
npx --no-install sdoc --version
npx --no-install sdoc inspect document.sdoc --json
npx --no-install sdoc validate document.sdoc --json
```

```powershell
sdoc inspect document.sdoc --json
sdoc inspect document.sdoc --json --target-id intro
sdoc inspect document.sdoc --json --target-path /1/0
sdoc validate document.sdoc --json
sdoc apply document.sdoc --operations operations.json --json
sdoc apply document.sdoc --operations operations.json --write --json
Get-Content -Raw -Encoding utf8 operations.json |
  sdoc apply document.sdoc --operations - --write --json
sdoc rename-heading document.sdoc --id intro --title "시험 결과" `
  --expected-revision sha256:... --json
sdoc set-document-title document.sdoc --id title-h1 --title "한글 제목" `
  --expected-revision sha256:... --write --json
```

The installable package contains the document schema, the public
`sdoc.operations/1` schema, and one JSON request example for each of the 12
semantic operations. See the [complete CLI manual](cli/README.md) for command
help, `operationTarget`, supported nodes and attrs, atomic batch construction,
diagnostic recovery, legacy upgrades, and exit codes. The document-level
operations are `setDocumentTitle`, `updateDocumentMetadata`, and
`updateDocumentSettings`. One `inspect --json` revision can guard a multi-op
batch; re-inspect after a successful write, not between operations in that
batch.

Use `--dry-run` as an explicit preview alias. Legacy raw `.tiptap.json`
documents can be inspected and validated, but every mutation requires
`--upgrade-legacy`; persisting the converted envelope additionally requires
`--write`. JSON mode writes one result object to
stdout; structured errors go to stderr. Exit codes are `0` for success, `2`
for argument or operation-contract errors, `3` for document-contract or
invariant errors, `4` for stale revisions or precondition conflicts, and `5`
for file I/O errors.

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
2. 명령 팔레트에서 `Structured Doc: New .sdoc Document (Experimental Templates)`를 실행하거나 기존 `.sdoc`/`.tiptap.json` 파일을 엽니다.
3. WYSIWYG 에디터에서 문서를 편집하고 `Ctrl+S`로 저장합니다.

명령줄에서도 설치할 수 있습니다.

```bash
code --install-extension swbaek.structured-doc-editor
```

### 로컬 VSIX

릴리스 또는 직접 빌드한 `.vsix` 파일은 명령 팔레트의 `Extensions: Install from VSIX...`에서 설치할 수 있습니다.

### 문서 템플릿 — 실험적 기능

> [!IMPORTANT]
> 템플릿 기능은 아직 실험적입니다. 템플릿 형식과 사용자 흐름은 이후 버전에서 변경될 수 있으므로, 중요한 사용자 템플릿은 Git 등으로 별도 관리하세요.

새 문서 명령에서는 빈 문서, 기술 보고서, 설계 명세서, 시험·검증 보고서 중 하나를 선택하고 문서 제목을 입력할 수 있습니다. 템플릿으로 만든 문서는 원본과 독립된 `.sdoc` 파일이며 기존 파일을 덮어쓰지 않습니다.

VS Code Explorer에서 0바이트 또는 공백뿐인 `.sdoc` 파일을 만들면 질문이나 전환 화면 없이 즉시 빈 편집기로 열립니다. 왼쪽의 `템플릿` 패널에서 내장·워크스페이스 템플릿을 선택할 수 있으며, 적용 전에는 현재 본문과 문서 설정이 교체된다는 확인을 받습니다. 취소하거나 확인 중 문서가 변경되면 원본을 그대로 유지합니다. 손상된 JSON이나 지원하지 않는 미래 버전 문서는 템플릿으로 덮어쓰지 않고 읽기 전용 보호 상태를 유지합니다.

팀 전용 템플릿은 작업 폴더의 `.sdoc/templates/`에 유효한 `.sdoc` 파일로 저장합니다. VS Code와 Windows 데스크톱 앱이 이 폴더를 자동으로 찾아 내장 템플릿과 함께 표시하므로, 폴더를 Git에 커밋하면 별도 설치 과정 없이 같은 양식을 공유할 수 있습니다.

반복해서 사용하는 개인 양식은 왼쪽 `템플릿` 패널의 `현재 문서를 내 템플릿으로 저장`으로 등록할 수 있습니다. 로컬 VS Code와 Windows 데스크톱 앱은 사용자 홈의 `~/.sdoc/templates/`를 함께 사용합니다. 템플릿 이름·설명·분류를 수정하거나 복제·삭제할 수 있으며, 삭제한 파일은 관리 폴더의 `.trash/`로 이동합니다. VS Code Remote, WSL, SSH에서는 원격 extension host의 사용자 홈에 별도 저장되며 다른 PC와 자동으로 동기화되지 않습니다.

현재 개인·워크스페이스 템플릿은 본문 구조만 지원합니다. 이미지·Draw.io 노드가 있는 문서는 자산 경로가 잘못 연결되지 않도록 템플릿 저장 또는 로드가 거부되며, 파일을 함께 복사하는 템플릿 번들은 아직 지원하지 않습니다. 문서 설정은 템플릿에 유지되므로 사용자 CSS나 출력 경로처럼 컴퓨터별 값은 적용 후 확인해야 합니다.

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

- 왼쪽 Activity Bar의 Navigate, Design, Publish 허브에서 목차·그림·표, 화면·문서 설정, 가져오기·내보내기·템플릿을 전환합니다. 데스크톱 앱은 Workspace 허브도 제공합니다.
- `Design > View`에서 편집기 UI 언어를 Auto, 한국어, English 중 하나로 선택할 수 있습니다. 이 설정은 문서 언어를 바꾸거나 `.sdoc`에 저장되지 않습니다.
- 새 표는 기본적으로 내용에 맞춰 너비가 변하는 Auto 모드로 삽입됩니다. 표 속성에서 100%, 75%, 50% 같은 고정 폭으로 바꿀 수 있습니다.
- `@`를 입력해 제목·그림·표·수식에 대한 교차 참조를 삽입합니다.
- 이미지는 클립보드에서 바로 붙여 넣고 캡션·정렬을 지정할 수 있습니다.
- Mermaid는 에디터 안에서 로컬로 작성하고 미리 볼 수 있습니다. PlantUML, D2, Graphviz 미리보기는 기본적으로 꺼져 있으며, Kroki 렌더링을 켜면 다이어그램 소스가 설정한 서버로 전송됩니다. 서버를 사용할 수 없을 때는 소스를 보존한 형태로 표시하고 내보냅니다.
- Draw.io 편집에는 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio)이 필요합니다.
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

- 편집기 UI 언어(Auto, 한국어, English)
- PlantUML, D2, Graphviz용 Kroki 렌더링 사용 여부·서버 주소·사설 네트워크 허용 여부
- 새 이미지의 기본 정렬과 내보내기 이미지 경로 형식

UI 언어와 외부 렌더러 같은 호스트 설정은 VS Code 사용자 설정에 저장됩니다. 제목·캡션·폰트·색상·테마·슬라이드 같은 문서별 설정은 에디터의 `Design` 패널에서 편집하며 `.sdoc`의 `meta.settings`에 저장되어 다른 환경에서도 동일하게 재현됩니다.

VS Code는 확장을 제거해도 사용자가 기록한 `settings.json` 값을 자동 삭제하지 않습니다. v0.7.4 이하에서 사용한 디자인·슬라이드 설정이 남아 있으면 명령 팔레트에서 `Structured Doc Editor: Clean Up Legacy Settings`를 실행하세요. 명령은 삭제 대상과 User·Workspace·Workspace Folder 범위를 먼저 보여 주고 확인을 받은 뒤, 더 이상 지원하지 않는 Structured Doc Editor 설정만 제거합니다. 현재 지원되는 설정과 다른 확장의 설정은 변경하지 않습니다.

## Windows 데스크톱 앱

Tauri 기반 데스크톱 앱은 VS Code 없이 `.sdoc` 문서를 편집할 수 있도록 동일한 에디터와 문서 코어를 사용합니다. 작업 폴더 탐색, 최근 폴더 복원, 파일 감시, 휴지통 삭제와 실행 취소 같은 네이티브 기능을 제공합니다.

현재 네이티브 앱은 Windows를 대상으로 하며, 소스에서 실행하려면 Node.js, Rust, WebView2가 필요합니다.

```bash
npm ci
npm run tauri dev --workspace=sdoc-editor-tauri
```

## 개발

요구 사항은 Node.js 22.22.2 이상, npm 10 이상이며 데스크톱 개발에는 Rust 1.90과 WebView2가 추가로 필요합니다.

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
- [AI 에이전트용 이슈 작성 가이드](.github/AI_ISSUE_REPORTING.md)
- [보안 취약점 신고](SECURITY.md)
- [행동 규칙](CODE_OF_CONDUCT.md)
- [자산과 라이선스 범위](ASSETS.md)

## 기여하기

버그 제보와 기능 제안은 [GitHub Issues](https://github.com/NaruForge/sdoc-editor/issues)에 남겨 주세요. AI 에이전트는 이슈를 생성하거나 저장소의 `AGENTS.md`에 이슈 보고 규칙을 정리하기 전에 [AI 이슈 작성 가이드](.github/AI_ISSUE_REPORTING.md)와 해당 Issue Form을 읽어야 합니다. 코드 기여 전에는 [CONTRIBUTING.md](CONTRIBUTING.md)의 개발 환경, 아키텍처 경계, 검증 절차와 기여 권리 조건을 확인해 주세요. 보안 취약점은 공개 이슈로 올리지 말고 [보안 정책](SECURITY.md)을 따라 신고해 주세요.

## 라이선스

소스 코드는 기본적으로 [MIT License](LICENSE)로 배포됩니다. 제3자 의존성과 MIT 범위 밖 자산은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 [ASSETS.md](ASSETS.md)를 확인해 주세요.
