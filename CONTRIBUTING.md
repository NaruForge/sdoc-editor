# Structured Doc Editor에 기여하기

이 저장소는 VS Code 확장, React 웹뷰, SDOC CLI, 공용 문서 코어를 하나의 npm workspace로 관리합니다. Windows Desktop은 v0.7.8을 마지막으로 지원이 종료되었으며 v0.8.0 이후 기여·빌드·검증 대상이 아닙니다. 작업 전에는 루트의 `AGENTS.md`와 `docs/architecture.md`를 먼저 읽어 주세요. 프로젝트에 참여하면 [행동 규칙](CODE_OF_CONDUCT.md)을 따라야 합니다.

## 이슈와 보안 보고

버그와 재현 가능한 기능 제안은 [GitHub Issues](https://github.com/NaruForge/sdoc-editor/issues)에 해당 양식을 선택해 작성해 주세요. 현재 동작, 기대 동작, 재현 절차, 대상(VS Code/CLI), 운영체제와 가능하다면 최소 fixture를 포함하면 분석이 빨라집니다. AI 에이전트가 이슈를 생성하거나 수정할 때는 [AI 이슈 작성 가이드](.github/AI_ISSUE_REPORTING.md)도 따라야 합니다.

이슈 종류는 `bug` 또는 `enhancement`로 분류하고 영향받는 배포면에 따라 `area: cli`와 `area: vscode`를 적용합니다. CLI 버그 양식은 `area: cli`를 자동으로 추가하며, 범용 기능 요청과 VS Code 버그는 작성자나 유지보수자가 선택한 대상에 맞춰 영역 라벨을 추가합니다. EOL Desktop에서만 재현되는 문제는 지원 범위 밖이며, 현재 공용 코드에도 영향을 주는 경우에만 지원 배포면 기준으로 보고합니다.

경로 탈출, 임의 파일 읽기/쓰기, 문서 손실, 코드 실행처럼 악용 가능한 문제는 공개 이슈를 만들지 말고 [SECURITY.md](SECURITY.md)의 비공개 신고 절차를 사용해 주세요.

## 개발 환경

- Node.js 22.22.2 이상 (`.node-version` 참고)
- npm 10 이상
- VS Code 1.85 이상

처음 한 번만 루트에서 의존성을 설치합니다. 하위 workspace에서 별도로 `npm install`하지 않습니다.

```bash
npm ci
npm run check
npm run build:all
```

`npm run check`는 버전 정합성, 디자인 계약, 생성된 validator, TypeScript, ESLint, 단위 테스트를 순서대로 검사합니다. VS Code 확장만 빌드하려면 `npm run build`, VS Code 확장과 CLI를 모두 빌드하려면 `npm run build:all`을 사용합니다.

## 작업 흐름

1. 기존 이슈를 검색하고, 큰 변경은 구현 전에 범위와 문서 계약 영향을 논의합니다.
2. `main`의 최신 상태에서 작업 브랜치를 만듭니다.
3. 변경 동작을 보호하는 테스트를 추가하고 필수 검증을 실행합니다.
4. 하나의 명확한 목적을 가진 Pull Request를 만들고 변경 이유, 검증 결과, 수동 확인 항목을 적습니다.
5. 리뷰 중 추가 커밋은 가능하면 기존 이력을 강제로 덮어쓰지 않고 작게 유지합니다.

관련 없는 포맷 변경이나 생성 파일을 같은 PR에 포함하지 마세요. 저장 형식, migration, ID, 교차 참조, converter를 바꾸는 경우는 `AGENTS.md`의 행동 테스트 우선 규칙을 따릅니다.

## 자주 쓰는 명령

| 명령 | 용도 |
|---|---|
| `npm run watch` | Extension host와 VS Code 웹뷰 동시 감시 |
| `npm run typecheck` | 루트와 모든 workspace 타입 검사 |
| `npm run lint` | 모든 TypeScript/React 소스 린트 |
| `npm test` | Vitest 단위 테스트 |
| `npm run build` | Extension host와 VS Code 웹뷰 빌드 |
| `npm run build:all` | VS Code 확장과 CLI 빌드 |
| `npm run package` | `output/`에 VSIX 생성 |
| `npm run build:cli` | Node.js CLI 단일 ESM bundle 빌드 |
| `npm run package:cli` | 설치 가능한 CLI `.tgz`를 `output/`에 생성 |
| `npm run licenses:check` | npm 라이선스와 제3자 고지 검증 |

`npm run package`와 `npm run package:cli`는
`SDOC_OUTPUT_DIR` 환경 변수나 Git에서 제외되는 루트 `.sdoc-output-dir`
파일이 지정되어 있으면 생성한 배포 패키지를 해당 폴더에도 복사합니다.
환경 변수가 로컬 파일보다 우선합니다.

### CLI 빌드와 패키징

호스트 중립 operation 의미는 `shared/document/operations/`에 두고 파일
시스템 동작은 별도 `cli/` npm workspace에 둡니다. CLI 패키지 버전은 루트
패키지 버전에 맞춰 유지합니다.

저장소 루트에서 CLI 빌드와 패키징을 검증합니다.

```powershell
npm run build:cli
npm run package:cli
```

`package:cli`는 설치 가능한 `.tgz`를 `output/`에 생성합니다. 소스를 직접
실행하는 대신 실제 패키지 내용을 검사하고 전역 임시 설치를 smoke
test합니다.

```powershell
$package = Get-ChildItem output -Filter '*.tgz' | Select-Object -First 1
npm install --global $package.FullName
sdoc --version
```

기능 PR에서 공개 npm registry에 게시하지 마세요. CI는 workflow artifact로
패키지를 업로드하고, 태그 기반 `.github/workflows/release-cli.yml`은 GitHub
Release에 패키지를 첨부합니다. 수동 실행은 Release를 변경하지 않고 workflow
artifact만 생성합니다.

### 릴리스 (유지보수자 전용)

버전 상승, 태그, Marketplace 및 GitHub Release는 유지보수자가 별도로 승인한 릴리스 작업에서만 수행합니다. 일반 기여 PR에서는 버전을 올리거나 태그를 만들지 마세요.

릴리스가 승인되면 루트와 npm workspace 버전을 맞추고 `npm run version:check`를 통과시킨 뒤 동일한 `v*` 태그를 사용합니다. `.github/workflows/release-cli.yml`은 CLI `.tgz`를 패키징해 GitHub Release에 첨부합니다.

같은 태그로 `.github/workflows/release-vscode.yml`도 실행되어 VSIX를 만든 뒤 Visual Studio Marketplace에 게시합니다. 이 워크플로는 GitHub OIDC와 Microsoft Entra 관리 ID를 사용하며 PAT 또는 장기 보관 클라이언트 비밀을 사용하지 않습니다.

## 코드 구조와 경계

- `src/`: VS Code Extension host와 파일 I/O
- `shared/`: VS Code API에 의존하지 않는 문서 타입, 변환기, 문서 코어
- `shared/book/`: `.sdocbook` 파싱, 합본, 경로 처리, 진단
- `shared/editor/`: VS Code 웹뷰가 사용하는 재사용 가능한 에디터 컴포넌트와 Tiptap 확장
- `webview-ui/src/`: VS Code 전용 메시징과 UI 조합
- `cli/`: 비시각 문서 검사, 검증과 의미 연산을 제공하는 Node.js CLI
- `tests/`: 호스트 독립 코어의 단위 테스트

재사용 가능한 에디터 동작은 `shared/editor/`에 두고 VS Code 통합은 `src/` 또는 `webview-ui/`에 둡니다. 호스트 API는 어댑터 뒤에 두고, `shared/`에서는 `vscode`를 import하지 않습니다. `.sdoc` 저장 형식을 바꿀 때는 `shared/types.ts`, `shared/document/sdocUtils.ts`, `sdoc.schema.json`, 변환기, 테스트를 함께 갱신합니다.

공통 에디터는 `EditorHostBridge`와 `EditorExtensionRuntime`만 통해 호스트 기능을 호출합니다. 전역 `window` 속성으로 기능을 노출하거나 메시지 payload에 임의 필드를 추가하지 마세요. VS Code 구현은 `src/`의 서비스와 어댑터 또는 `webview-ui/`의 조합 계층에 둡니다. 공통 레이아웃 CSS는 `shared/editor/styles/`에서 수정하고 웹뷰 통합 파일에는 테마 토큰과 shell 전용 스타일만 둡니다.

Book 조합 규칙은 `shared/book/`에서만 변경합니다. 코어는 파일 시스템을 직접 읽지 않고 `BookDocumentLoader`를 주입받아야 하며, preview와 export가 서로 다른 병합 결과를 만들지 않도록 같은 `composeBook()` 결과를 사용합니다.

## 수동 검증

UI 또는 파일 I/O 변경은 자동 검사 외에도 해당 배포면에서 확인합니다.

1. VS Code에서 F5로 Extension Development Host를 실행합니다.
2. `.sdoc` 파일을 열고 편집·저장·재열기를 확인합니다.
3. 관련된 import/export 형식을 왕복 검증합니다.
4. 이미지, 수식, Mermaid, 교차 참조를 건드렸다면 저장 후 경로와 ID가 유지되는지 확인합니다.

## 변경 제출 체크리스트

- 변경 범위가 한 가지 목적에 집중되어 있는가
- 새 동작 또는 회귀 위험에 테스트가 있는가
- `npm run check`와 관련 빌드가 통과하는가
- 사용자 기능 변경이 `README.md`와 `CHANGELOG.md`에 반영되었는가
- 구조적 결정이 필요했다면 `docs/adr/`에 짧은 ADR을 남겼는가
- 생성물, 로컬 설정, 비밀 정보가 커밋에 포함되지 않았는가
- 추가한 자산과 의존성을 배포할 권리가 있고, 필요한 고지가 반영되었는가

작업 상태는 GitHub 이슈/PR을 기준으로 관리합니다. 저장소 내부에 별도의 AI 작업 데이터베이스를 만들지 않습니다.

## 기여 라이선스와 권리

이 프로젝트에 코드, 문서, 이미지 또는 다른 자산을 제출함으로써 기여자는 다음을 확인합니다.

- 제출물을 제공하고 프로젝트의 [MIT License](LICENSE)로 배포할 권리가 있습니다.
- 타인 또는 소속 조직이 권리를 가지는 작업은 필요한 허가를 받았습니다.
- 제3자 코드나 자산을 포함한 경우 출처, 라이선스, 저작권 고지를 함께 제공합니다.

기여자는 자신의 기여에 대한 저작권을 유지하며, 프로젝트와 하위 사용자에게 MIT License 조건으로 사용할 수 있는 권한을 제공합니다. 사용 권리가 불분명한 자산은 PR에 포함하지 마세요. 프로젝트 자산의 현재 범위는 [ASSETS.md](ASSETS.md)를 참고하세요.
