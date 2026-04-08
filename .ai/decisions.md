# Decision Log

| Date | Task | Agent/Author | Decision | Rationale |
|------|------|-------------|----------|-----------|
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
