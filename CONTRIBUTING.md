# Structured Doc Editor에 기여하기

이 저장소는 VS Code 확장, React 웹뷰, SDOC CLI, 공용 문서 코어를 하나의 npm workspace로 관리합니다. Windows Desktop은 v0.7.8을 마지막으로 지원이 종료되었으며 v0.8.0 이후 기여·빌드·검증 대상이 아닙니다. 작업 전에는 루트의 `AGENTS.md`와 `docs/architecture.md`를 먼저 읽어 주세요. 프로젝트에 참여하면 [행동 규칙](CODE_OF_CONDUCT.md)을 따라야 합니다.

## 이슈와 보안 보고

버그와 재현 가능한 기능 제안은 [GitHub Issues](https://github.com/NaruForge/sdoc-editor/issues)에 해당 양식을 선택해 작성해 주세요. 현재 동작, 기대 동작, 재현 절차, 대상(VS Code/CLI), 운영체제와 가능하다면 최소 fixture를 포함하면 분석이 빨라집니다. AI 에이전트가 이슈를 생성하거나 수정할 때는 [AI 이슈 작성 가이드](.github/AI_ISSUE_REPORTING.md)도 따라야 합니다.

이슈 종류는 `bug` 또는 `enhancement`로 분류하고 영향받는 배포면에 따라 `area: cli`와 `area: vscode`를 적용합니다. CLI 버그 양식은 `area: cli`를 자동으로 추가하며, 범용 기능 요청과 VS Code 버그는 작성자나 유지보수자가 선택한 대상에 맞춰 영역 라벨을 추가합니다. EOL Desktop에서만 재현되는 문제는 지원 범위 밖이며, 현재 공용 코드에도 영향을 주는 경우에만 지원 배포면 기준으로 보고합니다.

경로 탈출, 임의 파일 읽기/쓰기, 문서 손실, 코드 실행처럼 악용 가능한 문제는 공개 이슈를 만들지 말고 [SECURITY.md](SECURITY.md)의 비공개 신고 절차를 사용해 주세요.

## 개발 환경

- `.node-version`에 선언된 Node.js와 그 배포판의 npm을 사용합니다.
- 지원하는 VS Code 범위는 `package.json#engines.vscode`가 기준입니다.

처음 한 번만 루트에서 의존성을 설치합니다. 하위 workspace에서 별도로 `npm install`하지 않습니다.

```bash
npm ci
```

생성 validator(`shared/document/generated/`)는 `.gitattributes`의 `text eol=lf`
규칙으로 저장·checkout 줄바꿈을 LF로 고정합니다. Windows의
`core.autocrlf=true`에서도 새 checkout은 재생성 없이 `npm run validators:check`를
통과해야 합니다. 기존 작업 폴더에 CRLF 파일이 남아 있다면
`npm run validators:generate`로 갱신하고 `npm run validators:check`로 확인합니다.
생성 파일은 직접 편집하지 않으며, schema 변경 후에는 생성기로 갱신합니다.
검사는 줄바꿈을 정규화하지 않고 정확히 비교하므로 오래된 생성물도 계속 거부합니다.
Windows·Linux CI는 build가 생성물을 갱신하기 전에 이 검사를 실행합니다.

## Verification contract

`package.json`의 `verify:*` script가 로컬과 CI가 공유하는 검증 계약입니다.
`npm run check`는 기존 자동화 호환성을 위한 `verify:fast` 별칭입니다.

| 명령 | 권위 있는 검증 범위 |
|---|---|
| `npm run verify:fast` | 반복 작업용: 버전·의존성 고지·repository knowledge/architecture·디자인·생성 validator 계약, TypeScript, ESLint, Vitest |
| `npm run verify:build` | VS Code extension, webview, CLI build |
| `npm run verify:ui` | Chromium 준비 후 Playwright의 UI 품질·접근성·visual·responsive/theme 검증 |
| `npm run verify:vscode` | build 후 실제 VS Code Extension Host 통합 검증 |
| `npm run verify:vscode:minimum` | manifest의 최소 지원 버전에서 build 후 동일한 전체 Host 통합 검증 |
| `npm run verify:vscode:compatibility` | 한 번 build한 결과를 최소 버전·최신 stable의 독립 Host 세션에서 순차 검증 |
| `npm run verify:package:vscode` | 의존성 고지 검사·version-checked VSIX 생성 후 필수 extension/webview asset과 canonical CSS 검증 |
| `npm run verify:package:vscode:host` | 생성된 VSIX를 풀어 실제 Extension Host에서 실행하는 release smoke 검증 |
| `npm run verify:package:cli` | 의존성 고지 검사·CLI `.tgz` 생성, contents·설치·UTF-8 smoke 검증; Windows에서는 PowerShell 7·5.1과 `cmd.exe` shim까지 검증 |
| `npm run verify:all` | material change 완료 전 현재 OS에서 실행 가능한 reusable deterministic surface 전체 |

작업 중에는 `verify:fast`와 영향받은 targeted command를 실행하고, material
change를 완료하기 전에는 저장소 루트에서 `npm run verify:all`을 실행합니다.
UI나 파일 I/O처럼 사람의 판단이 필요한 항목은 아래 수동 검증도 추가합니다.

파일 symlink containment 테스트는 링크 생성 권한 또는 파일시스템 지원이 없으면
오류 코드와 검증 미실행 이유를 출력하고 명시적으로 skip합니다. 그 밖의 생성 오류는
실패로 처리합니다. Linux CI의 `verify:fast`는 `SDOC_REQUIRE_FILE_SYMLINK=1`로
실행하므로 링크 생성과 containment assertion을 반드시 통과해야 합니다. 로컬에서도
같은 환경 변수를 지정하면 skip 없이 실행을 요구할 수 있습니다. 실패 주입 테스트는
별도 Vitest 프로세스에서 실제 skip/실패 집계와 종료 코드를 확인합니다.

`verify:vscode`는 기본적으로 최신 stable을 실행합니다. 특정 버전을 진단할 때는
`VSCODE_TEST_VERSION=1.85.0`처럼 환경 변수로 선택할 수 있으며, `minimum`은
검증 대상 extension의 `package.json#engines.vscode`에서 하한을 읽습니다.
현재 지원 범위는 `^1.85.0`입니다. 하한 선택기는 단일 `^major.minor.patch` 형식만
허용하며, 범위 형식을 변경하면 추측하거나 stable로 대체하지 않고 실패합니다.

Windows CI의 Host matrix는 `minimum`과 `stable`에서 같은 전체 시나리오를 실행합니다.
`verify:all`도 `verify:vscode:compatibility`를 포함하므로 두 버전을 모두 확인하며,
이 명령과 `verify:vscode:minimum`은 로컬 `VSCODE_TEST_VERSION` 설정보다 우선합니다.
확장 활성화, 정상 문서 열기, 실제 webview 편집, dirty 상태와 저장 결과를 검증하고
각 Host의 실제 VS Code·내장 Node 버전을 출력합니다. 고정 버전은 요청 버전과
일치해야 합니다. 실행마다 workspace·user-data·extensions 폴더를 임시 생성해
격리하며 다운로드·설치·실행 실패를 skip이나 성공으로 처리하지 않습니다.
최신 stable의 전체 Host 검증 범위도 그대로 유지합니다.

의존성이나 번들 자산을 변경했다면 `npm ci` 후 `npm run licenses:generate`로
`THIRD_PARTY_NOTICES.md`를 재생성하고 diff를 함께 검토합니다. 일반 CI의
`verify:fast`와 `package`·`package:cli` 진입점은 같은 `licenses:check`를 실행합니다.
고지가 없거나 오래됐으면 패키지 생성 전에 실패하며 자동으로 고치지 않습니다.
릴리스 workflow도 이 패키징 진입점을 사용합니다.

## 작업 흐름

1. 기존 이슈를 검색하고, 큰 변경은 구현 전에 범위와 문서 계약 영향을 논의합니다.
2. `main`의 최신 상태에서 작업 브랜치를 만듭니다.
3. 변경 동작을 보호하는 테스트를 추가하고 필수 검증을 실행합니다.
4. 하나의 명확한 목적을 가진 Pull Request를 만들고 변경 이유, 검증 결과, 수동 확인 항목을 적습니다.
5. 리뷰 중 추가 커밋은 가능하면 기존 이력을 강제로 덮어쓰지 않고 작게 유지합니다.

관련 없는 포맷 변경이나 생성 파일을 같은 PR에 포함하지 마세요. 저장 형식, migration, ID, 교차 참조, converter를 바꾸는 경우는 `AGENTS.md`의 행동 테스트 우선 규칙을 따릅니다.

## 추가 개발 명령

| 명령 | 용도 |
|---|---|
| `npm run watch` | Extension host와 VS Code 웹뷰 동시 감시 |
| `npm run typecheck` | 루트와 모든 workspace 타입 검사 |
| `npm run lint` | 모든 TypeScript/React 소스 린트 |
| `npm test` | Vitest 단위 테스트 |
| `npm run perf:baseline:quick` | 고정 seed의 소형 성능 baseline smoke 측정 |
| `npm run perf:baseline` | 5k/10k/25k 및 구조·리치 corpus의 전체 성능 baseline 측정 |
| `npm run perf:baseline:json` | 동등한 하드웨어에서 비교할 원시 sample·요약 JSON 출력 |
| `npm run perf:review` | 고정 rich corpus의 릴리스 성능 검토·판정·환경·실패 증거 보존 |
| `npm run perf:browser` | 실제 Chromium 공유 편집기의 open·입력·paint·scroll/navigation·DOM·heap 보고서 |
| `npm run perf:vscode` | build와 실제 Extension Host mutation/ACK·저장 lifecycle 보고서 |
| `npm run build:cli` | Node.js CLI 단일 ESM bundle 빌드 |
| `npm run licenses:check` | npm 라이선스와 제3자 고지 검증 |

`npm run package`와 `npm run package:cli`는
`SDOC_OUTPUT_DIR` 환경 변수나 Git에서 제외되는 루트 `.sdoc-output-dir`
파일이 지정되어 있으면 생성한 배포 패키지를 해당 폴더에도 복사합니다.
환경 변수가 로컬 파일보다 우선합니다.

### 성능 baseline

스키마 검증의 빠른 판정과 상세 진단을 비교하려면 `npm run build:cli` 후
`node scripts/run-validation-performance.mjs`를 실행합니다. 고정된 네 corpus에서
각각 warmup 2회·측정 7회의 검증 CPU 시간, GC 전후 heap 변화, 실제 CLI
`validate --json` 프로세스 시간과 peak RSS를 기록합니다. 변경 전 CLI bundle을
보존했다면 `--cli-before=<bundle 경로>`로 같은 입력의 전후 결과를 얻을 수 있습니다.
원시 결과는 `output/validation-performance/report.json`에 저장됩니다.
heap 변화는 프로세스 peak와 다르며, 절대 시간은 일반 검증의 합격 기준이 아닙니다.

성능 baseline은 `verify:fast`의 합격 시간 기준이 아닙니다. 머신·전원 상태에
따른 편차 때문에 시간 임계값으로 일반 검증을 실패시키지 않고, 고정 seed와
고정 반복 횟수로 생성한 같은 입력을 동등한 하드웨어에서 비교합니다. 일반
baseline은 persisted contract의 32 MiB와 100,000 node 제한 안에 있는
`text-5k`, `text-10k`, `text-25k`, `structure-10k`, `rich-2k` corpus를 사용합니다.
제한 초과와 malformed rejection fixture는 정확성 테스트에서 별도로 검증합니다.

전체 baseline은 JSON parse, contract validation, normalization, pretty
serialization과 지원 가능한 corpus의 일반 텍스트 editor transaction을
측정합니다. 빠른 확인은 다음 명령을 사용합니다.

```powershell
npm run perf:baseline:quick
npm run perf:baseline:json -- --corpus=text-10k --samples=7 --warmup=2
```

JSON에는 환경 정보, fixture seed, corpus byte/node 수, 원시 sample과
min/median/p95/max/mean이 포함됩니다. 전후 결과를 비교할 때는 Node 버전,
운영체제, CPU와 전원 설정을 같게 유지하고 원시 sample도 함께 기록합니다.
editor transaction 수치는 DOM이 없는 ProseMirror state와 공용 structure
index plugin만 측정하며 warmup과 각 sample의 `EditorState`를 같은 fixture에서
측정 밖에서 새로 만듭니다. 브라우저 layout/paint, React NodeView, webview-host
메시지와 실제 VS Code 저장 수치는 포함하지 않습니다.

실제 사용자 경로는 다음 명령으로 별도 측정합니다.

```powershell
npm run perf:browser
npm run perf:browser -- --corpus=text-10k
npm run perf:browser -- --scenario=lowlight
npm run perf:vscode
```

`--scenario=lowlight`는 고정 `rich-mixed-5k` corpus의 코드 블록 250개에서
코드 입력, 서식 있는 문단 입력, 문단 굵게 적용을 실제 키보드로 측정합니다.
각 시나리오는 2회 준비 입력 후 7개 표본을 수집하고
`tests/ui/artifacts/performance/lowlight.json`에 dispatch CPU, key-to-next-paint,
plugin 시간과 강조 호출 횟수를 저장합니다. 코드 입력은 1회, 문단 편집은
0회 호출을 검증하며 시간은 비교용으로 기록합니다.

`perf:browser`는 Playwright의 실제 Chromium에서 제품과 같은
`useTiptapEditor` 및 공용 extension set을 실행합니다. 고정 corpus를 초기
hydration하여 editable 다음 paint, 실제 키보드 event 다음 paint, scroll과
문서 위치 이동 다음 paint, Long Task, ProseMirror DOM node 수와 Chromium CDP의
JS heap을 기록합니다. 기본 corpus는 `text-5k`이며 `text-10k`와
`structure-10k`도 선택할 수 있습니다. 결과는 stdout과 Git에서 제외된
`tests/ui/artifacts/performance/browser.json`에 기록됩니다. 기본 포트가 충돌하면
`SDOC_BROWSER_PERF_PORT`로 전용 포트를 지정합니다.

`rich-mixed-5k`는 release corpus입니다. top-level block은 paragraph 3,500,
heading 500, code 250, block math 200, image 150, table 100, diagram 100,
callout 150, blockquote 50의 정확한 5,000개이며, paragraph 안에 inline math
300개와 endnote 200개를 결정적으로 포함합니다. 3회 open, top/middle/bottom
ordinary paragraph 각 10회씩 총 30회 input, run당 5회의 scroll/navigation을
측정하고 phase별 Long Task, DOM breakdown, GC 뒤
retained heap을 기록합니다. release budget은 editable p95 2,000 ms, input p95
50 ms/max 100 ms 미만, scroll p95 50 ms, navigation p95 100 ms, DOM 50,000개,
retained heap 128 MiB입니다. `rich-balanced-5k`는 각 rich 유형을 500개 규모로
균등하게 배치하는 별도 stress corpus이며 open 5,000 ms, DOM 75,000개, heap
192 MiB의 capacity budget을 사용합니다. corpus 개수와 seed 재현성은 일반
테스트에서도 고정합니다.

한 Windows x64 / Chromium 151의 `rich-mixed-5k` historical-before run에서
inactive code language option
materialization, attrs-equal rich NodeView no-op, bounded KaTeX cache,
block-math-only viewport materialization, image browser lazy loading을 적용한 뒤
open p95 2,189.8 ms, input p95/max 134.5 ms, scroll p95 52.5 ms, navigation p95
131.4 ms, DOM 40,697개, retained heap 55.55 MB였습니다. DOM과 heap은 통과했지만
open, input, scroll, navigation은 release budget에 미달합니다. input의 editor
dispatch CPU도 별도 기록하며 이 run은 median 30.2 ms, p95 87.1 ms였습니다.
절대 예산이나 corpus를 완화하지 않으며, virtualization 또는 Worker는 이 결과를
근거로 별도 Phase 3 architecture gate에서 검토합니다.

Phase 3의 typed browser probe는 key dispatch를 `editor-state-apply-plugins-cpu`,
`editor-view-update-state-cpu`, `editor-post-update-cpu`로 나누고 structure,
fold, numbering, Lowlight, ID scan, NodeView update counter를 additive schema-v1
measurement로 기록합니다. strict ordinary paragraph projection 적용 전 dispatch
median/p95는 30.1/55.9 ms였고 매 sample의 full structure build가 11.3/17.6 ms로
가장 컸습니다. 현재 release 측정은 top/middle/bottom ordinary paragraph를 각각
10회씩 총 30회 측정합니다. 적용 후 입력의 full build는 0회, classifier는 transaction당
1회가 되었으며 dispatch median/p95는 11.7/18.4 ms로 20 ms 목표를 통과했습니다.
key-to-next-paint는 median/p95/max 44.7/59.8/59.8 ms여서 max 100 ms 미만은
통과했지만 p95 50 ms는 여전히 미달합니다. 같은 run의 open p95는 2,329.1 ms,
scroll p95 59.9 ms, navigation p95 99.9 ms, DOM 40,573개, retained heap 55.6
MB였습니다. generic numbering decoration map보다 느렸던 specialized mapper는
되돌렸고, Worker·editable virtualization·production leaf-text protocol은
[ADR 0021](docs/adr/0021-bound-ordinary-editor-projections-and-defer-broader-runtime-changes.md)의
조건 없이 진행하지 않습니다.
느린 numbering 실험을 제거한 최종 repeat에서도 full structure build는 0회이고
dispatch median/p95는 12.2/16.5 ms였지만, key-to-next-paint p95 71.1 ms,
open p95 2,237.6 ms, scroll p95 56.0 ms, navigation p95 104.4 ms로 browser
paint 변동성과 release budget 미달이 다시 확인됐습니다.

키 입력 측정은 capture phase에서 시작하므로 ProseMirror transaction, plugin과
DOM 갱신을 포함합니다. 300ms debounce가 끝날 때까지의 `debounced-update-wait`와
실제 `getJSON`·immutable mutation snapshot·submit callback 한 회의 CPU 작업인
`sync-checkpoint-cpu`는 별도 항목입니다. 이 추가 항목은 schema version 1의
기존 additive measurement이므로 기존 JSON reader와 호환되지만, 측정 이름 배열을
엄격히 비교하는 소비자는 새 항목을 허용해야 합니다.

`perf:vscode`는 먼저 extension과 webview를 build한 뒤 실제 VS Code Extension
Host suite를 실행합니다. 테스트 모드에서만 활성화되는 monotonic probe가
webview checkpoint 송신부터 ACK 수신까지의 왕복과 host edit 수신부터 ACK
게시까지, `updateDocument`의
asset dehydration·기존 envelope parse·settings resolution·normalization·contract
validation·pretty serialization·`WorkspaceEdit`, 그리고 `onWillSave`의 flush부터
`onDidSave`까지를 기록합니다. 결과는 stdout과 Git에서 제외된
`tests/vscode/artifacts/performance/vscode.json`에 기록됩니다.

Extension Host 보고서는 canonical 5k 문서를 먼저 clean baseline으로 채택한 뒤
중간 paragraph 하나를 실제 webview transaction으로 8회 변경합니다. 첫 mutation의
lexical cold plan과, 성공한 own revision에서 채택한 bounded token offset을 사용하는
후속 7회의 warm plan을 같은 세션에서 측정한 뒤 ACK와 save까지 기다립니다.
`workspace-edit-modified-token-cache-hit`과
`workspace-edit-modified-token-fallback`은 각 plan이 trusted offset 또는 fail-closed
lexical scanner를 사용했는지를 0/1 operation count로 기록합니다.
`workspace-edit-source-code-units`, `target-code-units`,
`source-range-code-units`, `inserted-code-units`, `range-count`,
`content-change-count`, `replacement-ratio-ppm`은 내용이나 경로를 포함하지 않는
가산 schema-v1 measurement입니다. ppm은
`(source range + inserted) / (source + target) * 1,000,000`을 반올림한 정수이므로
나머지 네 code-unit counter에서 독립적으로 재계산할 수 있습니다. 기존
`workspace-apply-edit`의 operation count는 계속 전체 target code units입니다. 실제
Host 검증은 cold 1회와 warm 7회의 counter 분포, 매 mutation의 exact revision과
2-range reconstruction, one-step Undo/Redo를 확인하고, 같은 프로세스의 warm planner
median이 cold sample보다 50% 이상 낮은지도 확인합니다.

같은 보고서의 `canonical-persistence-cache-hit`,
`canonical-metadata-reused`, `canonical-settings-reused`,
`canonical-content-reused`는 exact session, live `TextDocument`, host revision에
묶인 canonical component 재사용 여부를 0/1로 기록합니다. 재사용된 기존 JSON
parse, settings resolve, asset dehydration, normalization 또는 full-document
validation phase는 기존 phase 이름을 유지하면서 operation count 0으로 남깁니다.
`validate-persisted-metadata`는 이전에 full validation을 통과한 canonical document를
재사용한 metadata-only mutation에서 작은 metadata component 검사만 수행했음을
기록합니다. 새 content, import, reload, external change, Undo/Redo와 cache miss는
계속 전체 persisted document validation을 수행합니다.

한 Windows x64 / VS Code 1.135.0 / Node.js 24.18.1의 동일 5k localized run에서
Phase 1 적용 후 warm content median은 source parse 0 ms, normalize 7.49 ms, full
validation 64.55 ms, serialization 3.62 ms, planner 11.31 ms, applyEdit 5.89 ms,
update total 92.66 ms, host ACK 94.22 ms였습니다. 이전 관측값의 update total
156.7 ms와 비교하면 약 40.9% 감소했지만, full validation 자체는 줄지 않아
pre-apply 및 validation 50% 목표에는 미달합니다. 같은 canonical 5k의
metadata-only 경로는 parse·dehydrate·resolve·normalize·full validation이 각각
0회이고 metadata validation 0.88 ms, update total 68.07 ms였습니다. 이 절대
시간은 일반 CI gate가 아니며, ordinary content validation을 더 줄이려면 bounded
operation/changed-subtree protocol 또는 Worker 비용을 이후 architecture gate에서
별도로 검증해야 합니다.

세 보고서는 모두 `shared/performance/instrumentation.ts`의 schema version 1,
monotonic millisecond 형식을 사용합니다. 문서 내용, URI, 사용자 경로와 wall-clock
timestamp는 넣지 않습니다. 일반 CI는 동일한 실제 operation이 완료되고 결과와
보고서 schema가 올바른지만 검증하며, 머신 편차가 큰 절대 시간·heap 임계값으로
실패시키지 않습니다. 수치 비교는 Node host-neutral, Chromium, Extension Host를
서로 다른 surface로 취급하고 같은 surface·corpus·Node/VS Code/Chromium 버전과
동등한 CPU·전원 상태에서 수행합니다.

### CLI 빌드와 패키징

호스트 중립 operation 의미는 `shared/document/operations/`에 두고 파일
시스템 동작은 별도 `cli/` npm workspace에 둡니다. CLI 패키지 버전은 루트
패키지 버전에 맞춰 유지합니다.

저장소 루트에서 CLI 빌드와 패키징을 검증합니다.

```powershell
npm run verify:package:cli
```

이 명령은 설치 가능한 `.tgz`를 `output/`에 만들고 package contents, workspace
entry point, 별도 prefix 설치, UTF-8 문서 생성을 검증합니다. Windows에서
실행하면 PowerShell 7, Windows PowerShell 5.1, `cmd.exe` shim도 같은 script가
검증합니다. CI는 이 command를 Linux와 Windows에서 실행해 OS matrix만 제공합니다.

기능 PR에서 공개 npm registry에 게시하지 마세요. CI는 workflow artifact로
패키지를 업로드하고, 태그 기반 `.github/workflows/release-cli.yml`은 GitHub
OIDC로 npm에 패키지를 게시한 뒤 GitHub Release에 같은 패키지를 첨부합니다.
실패한 태그 릴리스는 수동 실행의 `release_tag`에 기존 태그를 입력해 재시도합니다.

### 릴리스 (유지보수자 전용)

버전 상승, 태그, npm Registry, Marketplace 및 GitHub Release는 유지보수자가 별도로 승인한 릴리스 작업에서만 변경합니다. 일반 기여 PR에서는 버전을 올리거나 패키지를 게시하거나 태그를 만들지 마세요.

릴리스가 승인되면 루트와 npm workspace 버전을 맞추고 `npm run version:check`를 통과시킨 뒤 동일한 `v*` 태그를 사용합니다. `.github/workflows/release-cli.yml`은 CLI `.tgz`를 패키징하고 npm Trusted Publishing의 단기 GitHub OIDC 자격 증명으로 `sdoc-editor-cli`에 게시한 뒤 GitHub Release에 첨부합니다. 워크플로에는 장기 npm 게시 토큰을 저장하지 않으며, 게시 결과는 `npm view sdoc-editor-cli@X.Y.Z version`으로 확인합니다.

같은 태그로 `.github/workflows/release-vscode.yml`도 실행되어
`verify:package:vscode`와 `verify:package:vscode:host`로 실제 배포 artifact를
검증한 뒤 Visual Studio Marketplace에 게시합니다. 이 워크플로는 GitHub
OIDC와 Microsoft Entra 관리 ID를 사용하며 PAT 또는 장기 보관 클라이언트
비밀을 사용하지 않습니다.

### 릴리스 성능 검토

일반 UI CI의 성공과 rich 문서 성능 예산 충족은 별개입니다. VS Code 릴리스는
[performance-review workflow](.github/workflows/performance-review.yml)를 먼저
실행하고, 측정 증거가 만들어진 뒤 패키징·게시로 진행합니다. 게시 checkout은 측정한
clean commit SHA에 고정하며 태그를 다시 해석하지 않습니다. SHA가 없으면
기본 ref로 대신 게시하지 않고 실패합니다. CLI 게시에는
브라우저 예산을 적용하지 않습니다. 워크플로를 수동 실행하면 게시 없이도
선택한 커밋이나 태그를 검토할 수 있습니다.

```powershell
npm ci
npm run verify:ui:browser
npm run perf:review
```

`perf:review`는 `npm run perf:browser -- --corpus=rich-mixed-5k`를 review 모드로
실행합니다. 3회 open, 총 30회 입력, scroll/navigation 각 15회, worker 1개,
retry 0회를 강제합니다. 기존 `perf:browser`의 기본 모드는 계속 예산 위반 시
실패합니다. 두 경로는 같은 예산 정의를 사용하며 corpus와 capture point를
줄이거나 바꾸지 않습니다. review 모드는 기능 assertion을 그대로 실행한 뒤
시간·DOM·heap 예산 판정만 별도로 기록합니다.

| 검토 상태 | 의미 | 명령 종료 코드 / 릴리스 정책 |
|---|---|---|
| `within-budget` | 모든 예산 충족 | 0 / 계속 진행 |
| `below-budget` | 측정 완료, 하나 이상의 예산 미달, 명시적 수용 없음 | 0 / 경고와 미달 지표를 기록하고 계속 진행 |
| `risk-accepted` | 예산 미달과 이번 실행의 검토자·수용 사유를 함께 기록 | 0 / 계속 진행; 측정 판정은 여전히 `below-budget` |
| `measurement-error` | setup·기능 검사 실패, 손상·누락·불완전한 결과 | 1 / 게시 선행 검토 실패; 위험 수용으로 우회 불가 |

절대 시간 미달은 **advisory**입니다. 매 PR을 새 시간 hard gate로 막지 않으며,
[#216의 종료 결정](https://github.com/NaruForge/sdoc-editor/issues/216#issuecomment-5447837216)을
재개하거나 기존 50 ms 입력 예산을 완화하지 않습니다. 그때의 위험 수용을
새 커밋에 자동 적용하지도 않습니다. `below-budget`는 예산 통과나 묵시적
수용을 뜻하지 않습니다. 유지보수자는 릴리스 검토에서 해당 상태와 원시
표본을 확인하고, 수용할 경우 이번 실행에 사유를 직접 남깁니다.

수동 workflow의 `risk_acceptance_reason`, VS Code 릴리스 재실행의
`performance_risk_acceptance_reason`에 사유를 입력하면 GitHub 실행자와 실제
checkout SHA에 연결해 기록합니다. GitHub의 Re-run은 입력 사유를 상속하지만
새 측정의 위험 수용으로 재사용하지 않습니다. 최초 실행자, 재실행자,
run ID/attempt와 무시한 사유를 기록하며, 새 결과를 수용하려면 새 수동
workflow dispatch를 시작해 사유를 직접 입력합니다. 로컬에서는 `SDOC_PERF_ACCEPT_REASON`과
`SDOC_PERF_REVIEWER`를 함께 지정합니다. 사유에는 비밀 정보나 개인 데이터를
넣지 않습니다. 이 입력은 오류나 기능 실패를 성공으로 바꾸지 않습니다.

워크플로는 `windows-2025`, `.node-version`, lockfile의 Playwright/Chromium을
사용합니다. hosted runner의 CPU와 이미지 개정까지 동일하다고 가정하지
않으며 OS·CPU·메모리·Node·npm·이미지 정보, lockfile hash와 실행 커밋을
`tests/ui/artifacts/performance-release/review.json`에 남깁니다. 요약은 같은
디렉터리의 `summary.md`와 GitHub job summary에, 실행 로그는
`measurement.log`에 즉시 기록합니다. 실행 도중의 stdout/stderr도 보존합니다. 원시 pooled JSON과 완료한 run별 JSON은
`tests/ui/artifacts/performance/`에 남습니다. 시작 전 이전 원시 결과를
지우므로 실행 실패가 지난 성공 결과를 재사용하지 않습니다.

실패·취소 시에도 가능한 증거를 `rich-browser-review-<run>-<attempt>`
artifact로 업로드하며 보존 기간은 30일입니다. setup 단계에서 실패하면
측정 성공을 꾸미지 않고 `measurement-error` 요약을 남깁니다. 장기간 유지할
릴리스 판단에는 artifact 만료 전에 결과를 보관하고 검토 기록을 연결합니다.
전후 비교는 동일한 corpus·capture point·Node/Chromium·CPU·전원 조건으로 하며,
재실행으로 유리한 표본만 고르지 말고 각 실행의 결과를 따로 남깁니다.

현재 결과는 **Vite 개발용 harness**의 수치입니다. 생산 번들에서 같은 corpus와
capture point를 측정하는 비교는 별도 단계이며 아직 제공하지 않습니다.
추가할 때는 번들 종류와 환경·capture point 차이를 명시한 별도 결과로
보존하고, 개발용 결과나 예산을 지워 통과로 바꾸지 않습니다. 보고서의
monotonic 원시 측정 형식은 그대로이며, 검토 envelope만 실행 시각과 환경·결정을
추가합니다.


## 코드 구조와 경계

- `src/`: VS Code Extension host와 파일 I/O
- `shared/`: VS Code API에 의존하지 않는 문서 타입, 변환기, 문서 코어
- `shared/book/`: `.sdocbook` 파싱, 합본, 경로 처리, 진단
- `shared/editor/`: VS Code 웹뷰가 사용하는 재사용 가능한 에디터 컴포넌트와 Tiptap 확장
- `webview-ui/src/`: VS Code 전용 메시징과 UI 조합
- `cli/`: 비시각 문서 검사, 검증과 의미 연산을 제공하는 Node.js CLI
- `tests/`: 호스트 독립 코어의 단위 테스트

재사용 가능한 에디터 동작은 `shared/editor/`에 두고 VS Code 통합은 `src/` 또는 `webview-ui/`에 둡니다. 호스트 API는 어댑터 뒤에 두고, `shared/`에서는 `vscode`를 import하지 않습니다. `.sdoc` 저장 형식을 바꿀 때는 `shared/types.ts`, `shared/document/sdocUtils.ts`, `sdoc.schema.json`, 변환기, 테스트를 함께 갱신합니다.

공통 에디터의 host bridge, adapter, CSS ownership 계약은
`docs/architecture.md#dependency-rules`가 기준입니다. 공통 레이아웃 CSS는
`shared/editor/styles/`에서 수정하고 웹뷰 통합 파일에는 테마 토큰과 shell
전용 스타일만 둡니다.

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
- `npm run verify:all`과 필요한 수동 검증이 통과하는가
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
