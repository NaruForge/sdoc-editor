# Decision Log

| Date | Task | Agent/Author | Decision | Rationale |
|------|------|-------------|----------|-----------|
| 2026-07-16 | SDOC-059 | @copilot | 헤딩 크기 스케일을 하드코딩된 `em` 값 대신 `--heading-size-h1..h6` CSS 커스텀 프로퍼티로 단일 정의하고, 굵기는 레벨별 변수 대신 `--heading-font-weight: 700` 고정값으로 통일 | 사용자가 "H1~H6 모두 굵게, H6=본문 크기, 레벨당 2pt 증가"를 명시적으로 요청했고, 매직 넘버 반복을 피하기 위해 한 곳에서 스케일을 관리(Rule 3.3) |
| 2026-07-20 | SDOC-058 | @copilot | 헤딩 번호 제외는 "0번부터 시작" 옵션이 아니라 헤딩별 `numbered: false` 속성으로 구현 | 0-시작은 여전히 번호를 부여하므로 Introduction/Glossary 같은 "번호가 아예 없어야 하는" 실제 니즈를 해결하지 못하고, IEEE/ISO 실무 관례(전/후주 섹션 무번호)와도 맞지 않음 |
| 2026-07-20 | SDOC-058 | @copilot | `numbered` 속성은 Heading 노드를 교체하는 대신 별도 `Extension`의 `addGlobalAttributes()`로 주입 | `@tiptap/extension-heading`을 신규 의존성으로 추가하자 npm이 `@tiptap/core`를 3.22.2→3.28.0으로 재해석해 `@tiptap/react`와 내부 API 불일치로 빌드가 깨졌음(peer 버전 드리프트). 기존 StarterKit 번들 Heading에 속성만 추가하면 의존성 변경 없이 동일 기능을 구현 가능 |
| 2026-07-20 | SDOC-058 | @copilot | 번호 제외 헤딩도 하위 레벨 CSS 카운터(`counter-set`)는 그대로 리셋하되 자신의 `counter-increment`/`::before`만 억제 | 하위에 중첩된 일반 헤딩들의 번호가 밀리지 않게 하기 위함(자기 자신만 무번호 처리, 나머지는 정상 헤딩처럼 취급하는 단순화) |
| 2026-07-03 | SDOC-057 | @copilot | 삭제 확인에 `window.confirm` 대신 React state 기반 커스텀 `ConfirmDialog` 컴포넌트 도입 | Tauri WebView2에서 네이티브 동기 dialog가 사용자 클릭 전에 반환되는 신뢰성 문제가 실제로 재현되었고, 이 코드베이스의 다른 모든 다이얼로그(`LinkDialog` 등)가 이미 이 패턴을 쓰고 있어 일관성 있게 해결 가능 |
| 2026-07-03 | SDOC-057 | @copilot | 삭제 되돌리기(undo)는 `trash` 크레이트의 `os_limited::list()`/`restore_all()`을 이용하되, 삭제 직전 타임스탬프로 방금 삭제된 `TrashItem`을 매칭해 `DocState.recent_deletions` 스택(최대 20개)에 저장하는 "peek → restore → 성공 시 pop" 패턴 채택 | `trash::delete()`가 식별자를 반환하지 않아 시각 기반 매칭이 필요했고, 복원 실패 시에도 스택에 항목을 남겨 재시도를 허용하는 것이 데이터 유실 없이 안전함 |
| 2026-07-03 | SDOC-057 | @copilot | `os_limited` API가 macOS에서 미지원이므로 `find_trash_item`/`restore_trash_item`을 cfg 게이팅해 Windows/Linux는 실동작, 그 외 플랫폼은 `None`/`Err` 폴백 제공 | 이 프로젝트의 번들 타겟은 Windows 전용(`msi`/`nsis`)이라 실사용에는 영향 없지만, 크로스플랫폼 컴파일 안전성을 위해 하나의 함수에서 조건부로 분기 처리 |
| 2026-07-03 | SDOC-056 | @copilot | 탐색기 삭제는 `fs::remove_file`/`remove_dir_all`로 영구 삭제하지 않고 `trash` 크레이트로 OS 휴지통에 이동 | VS Code 탐색기의 기본 삭제 동작(휴지통 이동)과 동일한 안전망을 제공해 실수로 삭제해도 복구 가능하도록 함 |
| 2026-07-03 | SDOC-056 | @copilot | 삭제 대상이 현재 열린 문서(또는 그 상위 폴더)이면 `state.file_path`를 비우고 프론트엔드에서 편집기를 닫아 시작 화면으로 전환 | 삭제 후에도 이미 사라진 경로로 자동 저장을 시도하면 조용히 실패하거나 오류가 반복 발생하므로, 상태를 즉시 정리하는 것이 안전함 |
| 2026-07-03 | SDOC-055 | @copilot | 탐색기 자동 새로고침을 위해 워크스페이스 루트 전체를 감시하는 `start_workspace_watcher`를 기존 `start_file_watcher`(drawio 폴더 전용)와 별도 커맨드로 신설 | 감시 대상과 목적(탐색기 목록 갱신 vs 에디터 내 이미지 썸네일 갱신)이 서로 달라 하나로 합치면 필터링 로직이 얽히고 SRP를 위반하게 됨 |
| 2026-07-03 | SDOC-055 | @copilot | 폴더 전환 시 이전 워처 스레드를 명시적으로 kill하지 않고, `workspace_watch_generation` 카운터를 비교해 스레드가 스스로 종료하도록 구현 | `notify::Watcher`를 스레드 경계 밖에서 강제 중단시키려면 복잡한 동기화가 필요한데, 세대 비교는 다음 폴링 주기(300ms)에서 자연스럽게 해소되어 훨씬 단순함 |
| 2026-07-03 | SDOC-055 | @copilot | 파일 내용 수정(Modify Data)은 무시하고 생성/삭제/이름변경만 "구조적 변경"으로 간주해 400ms 디바운스 후 이벤트 emit | 문서 자동저장 등 빈번한 content-modify 이벤트로 탐색기가 계속 재조회되는 것을 막고, 임시파일→rename 같은 연쇄 이벤트를 하나의 새로고침으로 합치기 위함 |
| 2026-07-03 | SDOC-054 | @copilot | "최근 문서(파일 단위)"와는 별개로 `recent_folders: Vec<String>`을 `settings.json`에 신설해 최근 작업 폴더 히스토리를 영속화하고, 시작 시 CLI 인자가 없으면 그중 존재하는 첫 폴더를 자동 복원 | 기존 `current_folder`는 인메모리 전용이라 재시작마다 초기화되어 워크스페이스가 전혀 복원되지 않았던 것이 사용자가 보고한 "최근 문서만 보인다" 현상의 근본 원인이었음. 진짜 멀티 워크스페이스(동시 다중 폴더) 지원은 과거 세그먼트에서 범위가 크다고 판단해 보류했으므로, 이번엔 "최근 폴더 목록에서 빠르게 재오픈"까지만 구현 |
| 2026-07-03 | SDOC-054 | @copilot | `get_recent_folders`는 저장된 경로 중 `is_dir()`로 실제 존재하는 폴더만 필터링해 반환 | 이동/삭제된 폴더를 목록에서 매번 프론트엔드가 걸러내는 대신 백엔드 한 곳에서 판단해 Rule 1.1(복제 금지)을 준수 |
| 2026-07-02 | SDOC-053 | @copilot | 탐색기 파일 필터를 제거해 모든 확장자를 표시하되, 백엔드가 `is_document` 플래그로 "편집기에서 열 수 있는 문서인지"를 명시적으로 알려주고 프론트엔드는 이 플래그로만 열기 동작(에디터 vs 시스템 기본 앱)을 분기 | 확장자 판별 로직을 프론트엔드에서 다시 구현하면 Rust의 `is_document_path`와 두 곳에서 중복·불일치가 생기므로, 단일 소스(Rust)가 의미 있는 boolean을 내려주는 방식을 선택 |
| 2026-07-02 | SDOC-053 | @copilot | `rename_entry`는 원본이 문서 파일일 때만 `.sdoc`/`.tiptap.json` 확장자를 강제하고, 그 외 파일은 원본 확장자를 유지 | 기존 로직은 모든 비-디렉토리 파일에 무조건 문서 확장자를 붙여 이미지/drawio 파일 이름 변경 시 확장자가 손상되는 잠재적 버그가 있었음 |
| 2026-07-02 | SDOC-052 | @copilot | Draw.io/이미지의 "asset URL → 상대 경로" 역추출을 여러 곳에서 정규식으로 반복하는 대신, 생성 시점에 알고 있는 상대 경로를 `relativePath` 노드 속성으로 영구 저장하도록 구조 변경 | Windows 절대 경로의 백슬래시가 `convertFileSrc`에서 `%5C`로 인코딩되어 기존 `/`-only 정규식이 매치되지 못하는 근본 버그가 더블클릭 실행 실패와 속성창 경로 오표시 두 버그의 공통 원인이었음이 확인되어, 파싱을 여러 번 고치는 대신 파싱 자체를 없애는 방향을 선택 |
| 2026-07-03 | SDOC-051 | @copilot | Draw.io 빈 이미지 버그는 파일 생성 로직이 아니라 `tauri.conf.json`/`Cargo.toml`에 `assetProtocol`/`protocol-asset`이 전혀 설정되지 않은 것이 근본 원인이라 판단, 두 설정을 함께 추가 | Rust 커맨드가 이미 정상적으로 파일을 쓰고 있음을 먼저 검증했고, `convertFileSrc`로 만든 `asset.localhost` URL이 scope 미설정으로 원천 차단되고 있었음을 확인함 |
| 2026-07-03 | SDOC-051 | @copilot | Drawio 더블클릭 미실행 버그는 `CustomImage.tsx`가 tauri-app에 존재하지 않는 `window.vscode`를 우선 사용하던 것이 원인이라 판단, `window.__openDrawio` 전역 브릿지를 신설하고 `window.vscode`는 VS Code 확장 호환을 위해 fallback으로 유지 | `__editorFlushUpdate` 등 기존에 검증된 "vanilla NodeView ↔ React" 브릿지 패턴을 재사용해 일관성을 유지하면서도 두 런타임(VS Code/Tauri) 모두 지원 |
| 2026-07-03 | SDOC-051 | @copilot | draw.io 실행 실패(미설치 추정) 시 `postMessage` 프라미스의 reject를 catch해 신규 `DrawioInstallGuideDialog`를 표시하고 `@tauri-apps/plugin-shell`의 `open()`으로 drawio.com 링크를 열도록 구현 | 기존에는 `open_drawio_external`의 `Result::Err`가 unhandled rejection으로 조용히 무시되어 사용자가 실패 사실을 전혀 알 수 없었음 |
| 2026-07-02 | SDOC-050 | @copilot | 상단 메뉴바는 네이티브 Tauri Menu API 대신 커스텀 HTML `MenuBar` 컴포넌트로 구현 (사용자 선택) | 플랫폼(Windows/macOS/Linux) 간 완전히 동일한 모양을 보장하고, 기존 Toolbar 드롭다운과 동일한 CSS 변수/패턴을 재사용할 수 있어 일관성이 높음 |
| 2026-07-02 | SDOC-050 | @copilot | 죽은 `menu-new`/`menu-open`/`menu-save` 이벤트 리스너(emit하는 Rust 코드 없음)를 제거 | Rule 9.2(데드 코드 즉시 삭제)에 따라, 새 메뉴바가 동일 액션을 prop으로 직접 연결하므로 더 이상 필요 없는 leftover 코드였음 |
| 2026-07-02 | SDOC-049 | @copilot | "시작 시 1회 실행" effect의 deps를 빈 배열로 바꾸고 `loadDocument`/`loadWorkspace`는 ref로 최신 참조 | `workspaceFolder`에 의존하는 두 콜백을 deps에 넣으면 폴더 전환마다 effect가 재실행되어 백엔드에 남은 이전 문서 경로로 워크스페이스를 되돌리는 버그가 발생했음 |
| 2026-07-02 | SDOC-049 | @copilot | `loadDocument`는 문서가 현재 워크스페이스 내부(`isPathInsideFolder`)에 있으면 `workspaceFolder`를 재설정하지 않음 | 하위 폴더 문서를 열 때마다 탐색기 루트가 그 문서의 부모 폴더로 좁혀지는 문제를 막고, 워크스페이스 밖 문서를 열 때는 기존처럼 자동으로 새 루트를 잡아야 하므로 |
| 2026-07-02 | SDOC-048 | @copilot | 탐색기 폴더 접기/펼치기는 트리 구조 변환 없이 flat DFS list + `depth` 필드만으로, 단일 변수 `hideUntilDepth`를 이용해 프론트엔드에서 구현 | 백엔드 `list_folder_documents`가 이미 DFS pre-order flat list를 반환하므로 별도 트리 변환 로직 없이도 O(n) 단일 순회로 collapse를 표현할 수 있어 백엔드 변경이 불필요함 |
| 2026-07-02 | SDOC-048 | @copilot | 전체 경로 표시는 별도 패널 대신 `.editor-shell` 하단에 고정된 전역 상태바(`.app-status-bar`)로 구현하고, hover 중인 탐색기 항목 → 현재 문서 → 워크스페이스 폴더 순으로 우선순위를 둠 | 사용자가 "최하단 가로바"를 명시적으로 추천했고, VS Code 상태바와 유사한 UX 관례를 따르면서 항상 최신 컨텍스트(hover 우선)를 보여주는 것이 가장 유용함 |
| 2026-07-02 | SDOC-047 | @copilot | 탐색기 빈 공간 우클릭 메뉴는 VS Code 조사 결과를 기반으로 새 폴더/시스템 탐색기 보기/경로 복사/새로고침만 채택하고 Cut·Copy·Paste·통합 터미널·멀티 루트 워크스페이스는 제외 | sdoc 탐색기는 단일 폴더 문서 편집기이며 해당 항목들은 sdoc 워크플로우에 불필요한 복잡도만 추가함 |
| 2026-07-02 | SDOC-047 | @copilot | "파일 탐색기에서 보기"는 Rust `reveal_in_file_explorer` 커맨드(Windows `explorer /select,`, macOS `open -R`, 기타 폴백)로 구현하고 "경로 복사"는 프론트엔드 `navigator.clipboard.writeText`로 처리 | OS 탐색기 통합은 웹 API로 불가능해 네이티브 명령이 필요한 반면, 클립보드 복사는 이미 `ImageContextMenu`에서 검증된 프론트엔드 전용 패턴이라 재사용이 적합 |
| 2026-07-02 | SDOC-046 | @copilot | Tauri 탐색기 컨텍스트 메뉴는 신규 `ExplorerContextMenu` 컴포넌트로 분리하고 기존 `ImageContextMenu`/`table-context-menu` CSS 클래스를 재사용 | 이미 검증된 고정 위치 팝업 패턴과 스타일을 재사용해 중복 구현을 피하고 시각적 일관성을 유지하기 위함 |
| 2026-07-02 | SDOC-046 | @copilot | 이름 변경은 `rename_entry` Rust 커맨드에서 파일/폴더 여부를 판별해 처리하고, 현재 열린 문서 및 최근 문서 목록의 경로도 함께 갱신 | 이름 변경 도중 편집 중인 문서의 상태(`file_path`)가 stale해지면 저장 실패로 이어지므로 백엔드에서 단일 지점 동기화가 필요 |
| 2026-07-02 | SDOC-046 | @copilot | 탐색기 정렬은 폴더 우선 + 대소문자 무시 이름순으로 고정 (VS Code 기본 규칙) | 사용자가 VS Code와 동일한 탐색 경험을 기대하며, 경로 문자열 그대로 정렬 시 대문자가 먼저 오는 등 직관적이지 않았음 |
| 2026-07-01 | SDOC-045 | @copilot | Tauri standalone parity는 좌측 Explorer 탭 + Rust 제한 명령(`list_folder_documents`, `create_document_in_folder`)으로 구현하고 PDF/Slides는 미지원 disabled로 표시 | VS Code처럼 폴더 기반 문서 탐색/생성을 제공하되 node_modules/target 등 제외와 파일명 검증으로 안전한 최소 backend 표면을 유지하기 위함 |
| 2026-07-01 | SDOC-045 | @copilot | VS Code webview Export는 `meta.settings.outputDir` > `structuredDocEditor.export.outputDir` > 문서 폴더 순서로 출력 위치를 결정하고 기존 파일은 사용자 확인 후 덮어쓴다 | 문서별 Export 설정과 전역 기본값을 충돌 없이 반영하면서 예상치 못한 파일 덮어쓰기를 방지하기 위함 |
| 2026-07-01 | SDOC-045 | @copilot | Export UX 공통 기반은 `DocumentSettings` optional 필드와 shared 타입 별칭만 먼저 추가하고 VS Code/Tauri 구체 구현은 후속 에이전트가 분리 수행 | 병렬 구현 충돌을 줄이면서 SDOC-019 설정 우선순위와 shared 단일 소스 원칙을 유지하기 위함 |
| 2026-07-01 | SDOC-044 | @copilot | UX 개선은 새 문서 진입/저장 신뢰/export 설정 통일/Tauri parity 순서로 단계화 | 사용자 시뮬레이션 14회에서 첫 사용 진입, 결과 예측 가능성, VS Code-Tauri 기능 차이가 반복 마찰로 확인됨 |
| 2026-06-12 | SDOC-042 | @copilot | Tauri `DocumentSettingsPanel`의 Export CSS UI는 파일 다이얼로그 대신 deferred text input으로 동기화 | Tauri 앱은 VS Code `showOpenDialog`를 사용할 수 없고, 기존 Tauri 입력 UX는 blur/Enter 확정 패턴을 사용하므로 직접 경로 입력이 가장 일관적 |
| 2026-06-12 | SDOC-041 | @copilot | `DocumentSettingsPanel`에 선택적 `onPostMessage` prop을 추가하고 CSS file picker는 `state.docSettings` 기준으로 렌더링 | 기존 callback-props 패턴을 유지하면서 문서별 CSS 경로만 정확히 표시/수정하려면 merged settings가 아닌 document override 상태를 직접 써야 함 |
| 2026-04-28 | SDOC-040 | @copilot | `tauri-app/Cargo.toml` workspace에 `resolver = "2"` 추가 | edition 2021을 사용하는 멤버 crate와 workspace resolver 불일치 경고 제거. resolver="2"가 Rust 2021 edition 권장값 |
| 2026-04-27 | SDOC-040 | @copilot | Tauri 빌드 툴체인을 `Rust 1.90.0`으로 고정하고 `CARGO_BUILD_JOBS=1`를 기본값으로 문서/스크립트에 반영 | Rust 1.92 환경에서 `STATUS_STACK_BUFFER_OVERRUN (0xc0000409)`가 간헐적으로 발생. 1.90.0 + 단일 job에서 빌드 성공 재현 확인 |
| 2026-04-14 | SDOC-031 | @copilot | `onWillSaveTextDocument` + `requestFlush` + `saveRequested` 3중 보호 | `onWillSaveTextDocument`는 dirty 문서 저장 시 webview flush를 보장. `saveRequested` 플래그는 clean 문서에서도 edit 적용 후 재저장을 트리거 |
| 2026-04-14 | SDOC-031 | @copilot | 메시지 처리를 순차 큐로 변경 (`Promise.then` 체이닝) | async 핸들러 간 동시 실행 방지. `edit` → `requestSave` 순서 보장이 필수 |
| 2026-04-14 | SDOC-031 | @copilot | `pendingApplyEdits`를 `Map<string, number>`로 문서별 분리 | 싱글턴 Provider에서 복수 문서 열 때 카운터 혼선 방지 |
| 2026-04-14 | SDOC-031 | @copilot | `pendingEditRef`를 boolean → number 카운터로 변경 | 연속 edit 전송 시 여러 개의 'update' echo-back을 개별 차감 |
| 2026-04-14 | SDOC-031 | @copilot | `BlockExit` 확장으로 blockquote/callout 공통 탈출 패턴 구현 | Enter(빈 마지막 문단→탈출) + Backspace(빈 첫 문단→해제) 패턴을 단일 Extension으로 통합 |
| 2026-04-14 | SDOC-029 | @copilot | StarterKit 기본 Blockquote 확장 활성화 (별도 import 불필요) | StarterKit이 이미 Blockquote를 포함하므로 tiptapExtensions 배열에 등록만으로 완성. 별도 커스텀 노드 불필요 |
| 2026-04-14 | SDOC-029 | @copilot | Markdown export: `> line` 형식, AsciiDoc: `[quote]\n____\n...\n____` | GFM 표준 blockquote 구문, AsciiDoc 표준 quote block 구문 사용 |
| 2026-04-14 | SDOC-030 | @copilot | Callout을 커스텀 NodeView로 구현 (헤더+콘텐츠 DOM 분리) | `renderHTML`만으로는 헤더(아이콘+레이블) + ContentDOM 분리 불가. NodeView가 필요 |
| 2026-04-14 | SDOC-030 | @copilot | Markdown export: GitHub Alerts (`> [!NOTE]`) 매핑 | GitHub, GitLab 등 현대 Markdown 렌더러가 지원하는 사실상 표준. Obsidian Callout과도 유사 |
| 2026-04-14 | SDOC-030 | @copilot | AsciiDoc export: `danger` variant를 `CAUTION`으로 매핑 | AsciiDoc 5개 Admonition 타입(NOTE/TIP/IMPORTANT/WARNING/CAUTION) 중 `danger`에 가장 가까운 것이 CAUTION |
| 2026-04-14 | SDOC-030 | @copilot | BubbleMenu에서 Callout 활성화 시에만 variant picker 표시 | 텍스트 선택 시 기본 BubbleMenu에 항상 표시하면 과부하. 커서가 callout 내부에 있을 때만 conditional rendering |
| 2026-04-14 | SDOC-027 | @copilot | 방정식 우측 렌더링 태그는 항상 `(N)` 고정, CrossRef 레이블만 프리셋 따름 | 국제 표준 문서(IEEE, ISO, AMS 등) 관행상 방정식 우측 태그는 `(N)` 형태가 원칙. CrossRef 참조 텍스트에서만 프리셋 스타일 적용이 의미 있음 |
| 2026-04-13 | SDOC-023 | @copilot | `captionEquationPrefix` 괄호 내부에 삽입 `(prefix+N)` | 수식 번호 괄호 형태는 학술 표준 유지, prefix는 괄호 안 번호 앞에 삽입 ("Eq. "→"(Eq. 1)", "식 "→"(식 1)"). 괄호 제거는 사용자 요구사항에 없음 |
| 2026-04-13 | SDOC-023 | @copilot | `captionSeparator` 단일 설정으로 이미지/표 공통 적용 | "이미지와 표의 구분자를 각각" 요청 없음. 단일 설정이 UX 단순화. 필요 시 분리 가능 |
| 2026-04-13 | SDOC-023 | @copilot | `formatCaptionLabel()` separator 파라미터 기본값 `' '` | 기존 코드와 100% 호환, 기본값 변경 없이 separator 미전달 시 기존 동작 유지 |
| 2026-04-13 | SDOC-023 | @copilot | CSS `--caption-separator` 변수: `content: ... var(--caption-separator)` | CSS counter 기반 에디터 미리보기에도 구분자 적용. JS로 `setProperty`로 동적 제어 |
| 2026-04-13 | SDOC-022 | @copilot | 캡션 포맷을 `prefix + numbering + " " + caption`으로 통일, 기본 prefix 빈 문자열 | 사용자가 접두사에 구분자(": ", ". " 등)까지 포함하여 완전 제어. "Fig. 1 text", "그림 1 text", "1 text" 모두 가능 |
| 2026-04-13 | SDOC-022 | @copilot | `formatCaptionLabel()` 헬퍼를 shared/converter/utils.ts에 추가 | 컨버터 4개의 캡션 포맷 로직 중복 제거, 단일 소스 |
| 2026-04-13 | SDOC-022 | @copilot | CrossRef에 `captionNumbering` 설정 반영: simple/hierarchical 모드 | 기존에는 항상 simple만 사용했으나, CSS와 export는 hierarchical을 지원했음. CrossRef도 동일하게 반영 |
| 2026-04-13 | SDOC-021 | @copilot | 텍스트 입력에 DeferredTextInput (로컬 state + Enter/blur 확정) | 매 키스트로크마다 Extension Host 라운드트립 + 파일 쓰기 발생 → 로컬 state로 입력 완료 후 1회만 반영 |
| 2026-04-13 | SDOC-021 | @copilot | CrossRef `buildIdMap`/`collectTargets`에서 `window.__editorSettings` prefix 동적 참조 | "Figure"/"Table" 하드코딩 제거, 사용자 설정 접두사와 동기화 |
| 2026-04-13 | SDOC-021 | @copilot | `CROSSREF_RESYNC_META` transaction meta로 settings 변경 시 appendTransaction 트리거 | appendTransaction은 docChanged만 감지하므로, settings 변경은 별도 meta 트리거 필요 || 2026-04-13 | SDOC-020 | @copilot | CSS `counter-reset` → `counter-set`으로 교체하여 heading 번호 리셋 | CSS Lists Level 3에서 `counter-reset`은 새로운 scope를 생성하여 flat sibling 구조에 전파되지 않음. `counter-set`은 기존 scope의 값만 변경하므로 ProseMirror의 flat DOM에서 정상 동작. 브라우저 테스트로 검증 완료 |
| 2026-04-13 | SDOC-020 | @copilot | `body`에 모든 카운터 초기화 후 `counter-set`으로 리셋 (export HTML) | Export HTML도 동일한 flat sibling 구조이므로 같은 패턴 적용. `body { counter-reset: h1 h2 h3 h4; }` + `h1 { counter-set: h2 0 h3 0 h4 0; }` |
| 2026-04-13 | SDOC-019 | @copilot | `resolveSettings()` 3단계 우선순위 머지: meta.settings > VS Code Preference > SETTINGS_DEFAULTS | 기존 문서 하위호환 100% (meta.settings 없으면 VS Code 값 폴백), 새 문서는 문서별 독립 설정 가능 |
| 2026-04-13 | SDOC-019 | @copilot | SidePanel 래퍼로 TOC + Settings 탭 전환 구조 구현 (standalone TOC 대체) | 단일 사이드바 영역에서 탭으로 전환하는 UX가 공간 효율적, 기존 TOC 동작 100% 보존 |
| 2026-04-13 | SDOC-019 | @copilot | '기본값 불러오기' = meta.settings를 null로 설정 (삭제) → VS Code 폴백 | 개별 필드 리셋보다 단순, 설정 우선순위 체계와 자연스럽게 연동 |
| 2026-04-13 | SDOC-019 | @contributor-01 | 설정 패널을 오른쪽 사이드바에 배치, TOC와 탭 전환 | TOC 패턴과 일치하는 UX, 에디터 영역 침범 최소화 |
| 2026-04-13 | SDOC-019 | @contributor-01 | 설정 패널 내부를 3개 접이식 그룹(제목, 캡션, 방정식)으로 구성 | 9개 설정의 논리적 그룹화, 접이식으로 공간 효율 |
| 2026-04-13 | SDOC-019 | @contributor-01 | 컬러피커에 `<input type="color">` 사용 (시스템 컬러피커) | VS Code 스타일과 일관, 별도 라이브러리 불필요 |
| 2026-04-13 | SDOC-019 | @contributor-01 | '기본값 불러오기' 버튼 1개로 전체 초기화 (meta.settings 삭제 → VS Code 폴백) | 개별 리셋보다 단순, 설정 우선순위 체계와 자연스럽게 연동 |
| 2026-04-13 | SDOC-019 | @contributor-01 | Toolbar에 ⚙️ 아이콘 버튼 추가 (TOC 버튼 옆) | 발견성 높은 위치, TOC 토글과 동일한 패턴 |
| 2026-04-13 | SDOC-017 | @copilot | Export 날짜를 `YYYY-MM-DD`로 포맷 (`formatDate()` 헬퍼) | ISO 타임스탬프(`T01:16:20.722Z`)는 문서 메타데이터에 불필요한 정보. YYYY-MM-DD가 국제 표준(ISO 8601 날짜)이자 가독성 최적 |
| 2026-04-13 | SDOC-017 | @copilot | BubbleMenu 활성 상태에 `useEditorState()` 사용 (transaction 구독 대신) | tiptap v3 BubbleMenu는 `createPortal`로 렌더링되어 부모 리렌더 전파가 불안정. `useSyncExternalStore` 기반 `useEditorState()`는 portal 내부에서도 안정적으로 동작 |
| 2026-04-13 | SDOC-017 | @copilot | CrossRef 동기화를 `appendTransaction` 플러그인으로 webview 내부에서 처리 | Extension Host 라운드트립(echo suppression 문제)보다 webview 내부 직접 처리가 실시간성 우수. ProseMirror `appendTransaction`은 트랜잭션 후 즉시 교정 tr을 삽입하는 표준 패턴 |
| 2026-04-13 | SDOC-016 | @copilot | Math 노드 타입 전환에 `tr.replaceWith()` 사용 (setNodeMarkup 대신) | mathBlock(group:block)과 mathInline(group:inline)은 다른 그룹이므로 setNodeMarkup으로 타입 변경 불가. delete+insert 패턴 필요 |
| 2026-04-13 | SDOC-016 | @copilot | 하이브리드 편집 UX: click→인라인+프리뷰, dblclick→Dialog | Notion/Obsidian 패턴. 빠른 편집은 인라인, 고급 편집(예제/타입토글)은 Dialog로 분리 |
| 2026-04-09 | SDOC-015 | @copilot | ESLint v10 flat config + eslint-config-prettier | ESLint v10은 flat config 필수, Prettier 충돌 방지를 위해 eslint-config-prettier 사용 |
| 2026-04-09 | SDOC-015 | @copilot | `shared/types.ts`에 `Record<string, unknown>` 대신 `any` 제거 (TiptapNode.attrs) | Harness Rule 2.1 준수, `Record<string, unknown>`이 `any`보다 안전하며 점진적 타입 강화 가능 |
| 2026-04-09 | SDOC-015 | @copilot | `HtmlExportSettings extends ExportSettings` 상속 패턴 | HTML 전용 필드를 확장 인터페이스로 분리, 기본 ExportSettings는 Markdown/AsciiDoc에서 재사용 |
| 2026-04-09 | SDOC-015 | @copilot | TypeScript strictness를 `noUnusedLocals: true, noUnusedParameters: true`로 통일 | 3개 패키지(root, webview-ui, tauri-app) 간 일관성 확보, 데드코드 조기 탐지 |
| 2026-04-09 | SDOC-015 | @contributor-01 | 전면 코드 감사 후 5단계 점진적 리팩토링 채택 | Phase별 독립 커밋 가능, 기능 회귀 방지. Phase 0(버그)→1(인프라)→2(Converter)→3(Host)→4(Webview)→5(의존성) 순서 |
| 2026-04-09 | SDOC-015 | @contributor-01 | `src/converter/` 삭제하고 `shared/converter/` 단일화 결정 | 2,534줄 완전 복제 + 드리프트로 실제 버그 발생 확인. Converter에 vscode API 의존성 없음 확인 |
| 2026-04-13 | SDOC-015 | @copilot | `asciidoctor` devDependency + esbuild external 제거 | 코드에서 실제 사용하지 않음 확인 (esbuild.mjs external에만 잔존). 데드 의존성 정리 |
| 2026-04-13 | SDOC-015 | @copilot | Tauri 플러그인 `^2` → `^2.x.y` 구체화 | major 범위 `^2`는 breaking change 위험. 설치된 실제 버전 기준으로 minor 고정 |
| 2026-04-09 | SDOC-015 | @contributor-01 | Harness Engineering Guidelines 신규 작성 | AI Agent 코드 작성 시 반복 문제(중복, any 남용, God class) 방지를 위한 강제 규칙 필요 |
| 2026-04-08 | SDOC-012 | @contributor-01 | TTF → WOFF2 전환 + 사용 weight만 임베딩 | WOFF2는 무손실 ~63% 압축, weight 필터로 추가 절감. 기존 TTF 삭제 |
| 2026-04-08 | SDOC-012 | @contributor-01 | slide.transition 설정 추가, 기본값 none | 애니메이션 부드럽지 않은 문제 → 사용자 선택으로 전환, 기본 비활성화 |
| 2026-04-09 | SDOC-014 | @copilot | 복잡 테이블(colspan/rowspan) → HTML `<table>` 폴백, 단순 테이블 → GFM pipe 유지 | GFM pipe 테이블은 병합 셀 표현 불가, HTML raw block이 유일한 무손실 대안. 단순 테이블은 GFM이 가독성 우수 |
| 2026-04-09 | SDOC-014 | @copilot | HTML 변환기에도 colspan/rowspan 속성 추가 | 기존 HTML export도 병합 셀 속성 누락됨, 동시에 수정 |
| 2026-04-09 | SDOC-013 | @contributor-01 | Markdown 앵커 `<a id>` → Pandoc `{#id}` 전환 | RAG 파이프라인 노이즈 최소화, GFM에서도 기존 방식 동작 안 함 → 추가 리스크 없음 |
| 2026-04-08 | SDOC-011 | @contributor-01 | 슬라이드 전용 편집 모드 미구현, Export 전용 | Single source of truth 원칙, 수요 확인 후 Phase 2 |
| 2026-04-08 | SDOC-011 | @copilot | reveal.js CDN (v5) 사용 | 자체 프레젠테이션 뷰 불필요, 키보드 탐색/전체화면/오버뷰 내장 |
| 2026-04-08 | SDOC-010 | @contributor-01 | README 사용자용/개발자용 분리 | Extension 상세 페이지에 개발 정보 불필요, CONTRIBUTING.md로 분리 |
| 2026-04-08 | SDOC-009 | @contributor-01 | Legacy Font 2.0 TTF 번들링, VS Code Settings 드롭다운 | 시스템 폰트 목록 조회 대비 구현 간단, 4종 가중치로 충분 |
| 2026-04-07 | SDOC-008 | @contributor-01 | `.sdoc-project` → `.sdocbook` 확장자 변경 | "책(book)" 메타포가 직관적, mdBook/GitBook 관례와 일치, 사용성 향상 |
| 2026-04-07 | SDOC-004 | @contributor-01 | 이미지 base64 임베딩 기본, CDN 임베딩은 export.selfContained 설정으로 선택 | 파일 크기와 오프라인 사용성 균형 |
| 2026-04-07 | SDOC-004 | @contributor-01 | shared/converter도 함께 업데이트 (imageResolver 콜백 패턴) | MCP/Tauri에서도 self-contained 지원 필요 |
| 2026-04-07 | SDOC-005 | @contributor-01 | CSS zoom 속성으로 PDF 배율 제어, VS Code 설정으로 조정 가능 | CDP 프로토콜 대비 구현 간단, Chrome print-to-pdf에서 정상 동작 |
| 2026-04-07 | SDOC-005 | @contributor-01 | 시스템 Chrome/Edge headless 모드로 PDF 생성 | VSIX 크기 제약, 대부분의 PC에 Chrome/Edge 존재, 검증된 패턴 |
| 2025-01-16 | SDOC-003 | @copilot | toolHandlers.ts 유효성 세트 수정 (diagram 추가, image→block) | main 병합 후 스키마 불일치 발견 |
| 2025-01-16 | SDOC-003 | @copilot | Instructions/Skills에 textAlign, diagram, subscript/superscript 추가 | main에 추가된 Tiptap v3 기능 반영 |
| 2025-01-16 | SDOC-002 | @copilot | package.json 충돌 → 양쪽 의존성 모두 포함 | MCP SDK + Tiptap v3 동시 필요 |
| 2025-01-15 | SDOC-001 | @contributor-01 | Skills + MCP 보완 관계로 유지 | Instructions는 이해, MCP는 실행 담당 |
| 2025-01-15 | SDOC-001 | @copilot | shared/mcp/에 공유 로직 배치 | MCP 서버 + Tauri 양쪽에서 재사용 |
| 2025-01-15 | SDOC-001 | @copilot | VS Code Extension 내장 MCP 서버 채택 | 코드 재사용, 설정 접근, 배포 단순화 |
| 2026-07-01 | SDOC-045 | @copilot (Opus 4.8) | webview-ui 발견성 UX: ActivityBar compact label, 공용 PanelEmptyState, 삽입 메뉴 검색, CrossReference equation 그룹/필터 + eq-N anchor 이동 | SDOC-044 UX 시뮬레이션의 발견성 마찰 해소. Tauri parity는 ux-tauri-sidebar-parity가 후속 동기화 |
