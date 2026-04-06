---
ats: "0.1"
id: SDOC-001
title: "MCP 서버 구현"
status: done
priority: high
created: 2025-01-15T10:00:00+09:00
modified: 2025-01-15T18:00:00+09:00
author: contributor-01
assignee: copilot
depends_on: []
blocks: [SDOC-002]
tags: [mcp, backend, shared]
acceptance_criteria:
  - "MCP 서버가 stdio로 동작"
  - "Phase 1 핵심 도구 5개 등록 (validate, create, export, import, getSchema)"
  - "Phase 2 고급 도구 4개 등록 (assignIds, syncRefs, migrate, query)"
  - "빌드 에러 없음"
---

# SDOC-001: MCP 서버 구현

## Context
`.sdoc`/`.tiptap.json` 파일은 AI Agent 활용 시 AI가 기능을 제대로 알고 지원하기 어려움.
기존 Instructions/Skills는 AI에게 **지식**을 제공하지만, **실행 가능한 도구**가 없음.
MCP 서버를 통해 검증, 변환, 자동 ID 부여 등 도구를 제공해야 함.

## Scope
### In Scope
- VS Code Extension 내장 MCP 서버 (stdio 기반)
- Phase 1: validate, create, export, import, getSchema
- Phase 2: assignIds, syncRefs, migrate, query
- shared/mcp/ 공유 로직 추출

### Out of Scope
- Tauri 앱용 MCP 서버 (별도 구현 시 shared/ 재사용)
- 웹 기반 MCP 서버

## Approach
두 접근법(Skills/Instructions vs MCP Server) 비교 후 **보완 관계**로 결론:
- Instructions → AI가 포맷을 *이해*
- MCP Server → AI가 복잡한 작업을 *실행*

VS Code Extension 내장을 채택:
- 코드 재사용 (shared/converter/, SdocEditorProvider 로직)
- 설정 접근 (vscode.workspace.getConfiguration)
- 배포 단순화 (.vsix에 포함)

## Progress
- [x] shared/mcp/sdocUtils.ts — 공유 유틸리티 추출
- [x] shared/mcp/toolHandlers.ts — MCP tool handler 로직
- [x] src/mcp/server.ts — @modelcontextprotocol/sdk 기반 MCP 서버
- [x] SdocEditorProvider 리팩터링 (중복 로직 → shared/ 위임)
- [x] esbuild.mjs — MCP 서버 별도 entry point
- [x] package.json — 의존성 추가 (@modelcontextprotocol/sdk, zod)
- [x] docs/agent/README.md — 통합 사용 가이드

## References
- 관련 파일: `src/mcp/server.ts`, `shared/mcp/toolHandlers.ts`, `shared/mcp/sdocUtils.ts`
- 관련 태스크: SDOC-002 (병합), SDOC-003 (재검토)
