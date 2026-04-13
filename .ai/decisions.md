# Decision Log

| Date | Task | Agent/Author | Decision | Rationale |
|------|------|-------------|----------|-----------|| 2026-04-13 | SDOC-021 | @copilot | 텍스트 입력에 DeferredTextInput (로컬 state + Enter/blur 확정) | 매 키스트로크마다 Extension Host 라운드트립 + 파일 쓰기 발생 → 로컬 state로 입력 완료 후 1회만 반영 |
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
