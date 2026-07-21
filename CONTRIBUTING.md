# Structured Doc Editor에 기여하기

이 저장소는 VS Code 확장, React 웹뷰, Tauri 데스크톱 앱, 공용 문서 코어를 하나의 npm workspace로 관리합니다. 작업 전에는 루트의 `AGENTS.md`와 `docs/architecture.md`를 먼저 읽어 주세요.

## 개발 환경

- Node.js 22.13 이상 (`.node-version` 참고)
- npm 10 이상
- VS Code 1.85 이상
- 데스크톱/Rust 작업 시 Rust 1.90과 Windows WebView2

처음 한 번만 루트에서 의존성을 설치합니다. 하위 workspace에서 별도로 `npm install`하지 않습니다.

```bash
npm ci
npm run check
npm run build:all
```

`npm run check`는 버전 정합성, TypeScript, ESLint, 단위 테스트를 순서대로 검사합니다. VS Code 확장만 빌드하려면 `npm run build`, Tauri 프런트엔드까지 포함하려면 `npm run build:all`을 사용합니다.

## 자주 쓰는 명령

| 명령 | 용도 |
|---|---|
| `npm run watch` | Extension host와 VS Code 웹뷰 동시 감시 |
| `npm run typecheck` | 루트와 모든 workspace 타입 검사 |
| `npm run lint` | 모든 TypeScript/React 소스 린트 |
| `npm test` | Vitest 단위 테스트 |
| `npm run build` | Extension host와 VS Code 웹뷰 빌드 |
| `npm run build:desktop` | Tauri 프런트엔드 빌드 |
| `npm run build:all` | 두 배포면의 프런트엔드 전체 빌드 |
| `npm run package` | `output/`에 VSIX 생성 |
| `npm run tauri:build --workspace=sdoc-editor-tauri` | Windows 설치 패키지·portable EXE 로컬 빌드 |

### 데스크톱 릴리스 (GitHub Actions)

버전을 `package.json` / `tauri-app` / `Cargo.toml`에 맞춘 뒤 (`npm run version:check`), 태그를 푸시하면 Windows 산출물이 Release에 올라갑니다.

```bash
# 예: package.json version 이 0.4.13 일 때
git tag v0.4.13
git push origin v0.4.13
```

워크플로: `.github/workflows/release-desktop.yml`  
첨부 파일: NSIS 설치 EXE, MSI, portable EXE  

태그 없이 빌드만 확인하려면 Actions에서 **Release Desktop** → **Run workflow**를 사용합니다 (아티팩트만 업로드, Release 미생성).

Rust 백엔드를 변경했다면 다음 검증도 수행합니다.

```powershell
cargo fmt --manifest-path tauri-app/Cargo.toml --all -- --check
cargo clippy --manifest-path tauri-app/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path tauri-app/Cargo.toml --workspace
```

## 코드 구조와 경계

- `src/`: VS Code Extension host와 파일 I/O
- `shared/`: VS Code API에 의존하지 않는 문서 타입, 변환기, 문서 코어
- `shared/book/`: `.sdocbook` 파싱, 합본, 경로 처리, 진단
- `shared/editor/`: VS Code와 Tauri가 함께 쓰는 에디터 컴포넌트와 Tiptap 확장
- `webview-ui/src/`: VS Code 전용 메시징과 UI 조합
- `tauri-app/src/`: Tauri 전용 메시징, 탐색기, 데스크톱 UI 조합
- `tauri-app/src-tauri/`: Rust IPC와 운영체제 통합
- `tests/`: 호스트 독립 코어의 단위 테스트

두 UI에 같은 구현을 복사하지 말고 `shared/editor/`로 올립니다. 호스트 API는 어댑터 뒤에 두고, `shared/`에서는 `vscode`나 Tauri API를 import하지 않습니다. `.sdoc` 저장 형식을 바꿀 때는 `shared/types.ts`, `shared/document/sdocUtils.ts`, `sdoc.schema.json`, 변환기, 테스트를 함께 갱신합니다.

공통 에디터는 `EditorHostBridge`와 `EditorExtensionRuntime`만 통해 호스트 기능을 호출합니다. 전역 `window` 속성으로 기능을 노출하거나 메시지 payload에 임의 필드를 추가하지 마세요. VS Code 구현은 `src/`의 서비스와 어댑터에, Tauri 구현은 `tauri-app/src/`와 `tauri-app/src-tauri/`의 기능별 모듈에 둡니다. 공통 레이아웃 CSS는 `shared/editor/styles/`에서 수정하고 호스트별 파일에는 테마 토큰과 shell 전용 스타일만 둡니다.

Book 조합 규칙은 `shared/book/`에서만 변경합니다. 코어는 파일 시스템을 직접 읽지 않고 `BookDocumentLoader`를 주입받아야 하며, preview와 export가 서로 다른 병합 결과를 만들지 않도록 같은 `composeBook()` 결과를 사용합니다.

## 수동 검증

UI 또는 파일 I/O 변경은 자동 검사 외에도 해당 배포면에서 확인합니다.

1. VS Code에서 F5로 Extension Development Host를 실행합니다.
2. `.sdoc` 파일을 열고 편집·저장·재열기를 확인합니다.
3. 관련된 import/export 형식을 왕복 검증합니다.
4. Tauri 변경은 `npm run tauri dev --workspace=sdoc-editor-tauri`로 확인합니다.
5. 이미지, 수식, Mermaid, 교차 참조를 건드렸다면 저장 후 경로와 ID가 유지되는지 확인합니다.

## 변경 제출 체크리스트

- 변경 범위가 한 가지 목적에 집중되어 있는가
- 새 동작 또는 회귀 위험에 테스트가 있는가
- `npm run check`와 관련 빌드가 통과하는가
- 사용자 기능 변경이 `README.md`와 `CHANGELOG.md`에 반영되었는가
- 구조적 결정이 필요했다면 `docs/adr/`에 짧은 ADR을 남겼는가
- 생성물, 로컬 설정, 비밀 정보가 커밋에 포함되지 않았는가

작업 상태는 GitHub 이슈/PR을 기준으로 관리합니다. 저장소 내부에 별도의 AI 작업 데이터베이스를 만들지 않습니다.
