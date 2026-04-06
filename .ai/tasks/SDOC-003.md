---
ats: "0.1"
id: SDOC-003
title: "Skills/Instructions/MCP 재검토"
status: closed
priority: medium
created: 2025-01-16T13:00:00+09:00
modified: 2025-01-16T16:00:00+09:00
author: contributor-01
assignee: copilot
depends_on: [SDOC-002]
blocks: []
tags: [mcp, skills, instructions, schema]
acceptance_criteria:
  - "MCP toolHandlers의 유효성 세트가 스키마와 일치"
  - "Instructions가 최신 노드/마크 타입 반영"
  - "Skills에 새 기능 절차 추가"
  - "전체 빌드 성공"
---

# SDOC-003: Skills/Instructions/MCP 재검토

## Context
Main 브랜치 병합(SDOC-002) 후, main에 추가된 Tiptap v3 기능들(diagram, textAlign, subscript/superscript, textStyle/highlight)이 기존 MCP 서버/Skills/Instructions에 반영되어 있는지 전면 재검토 필요.

## Scope
### In Scope
- MCP toolHandlers.ts 유효성 검증 세트 vs 실제 스키마 비교
- Instructions의 노드/마크 타입 테이블 업데이트
- Skills의 절차 가이드 업데이트
- Examples 파일에 새 기능 예제 추가

### Out of Scope
- 컨버터 수정 (이미 main에서 처리 완료)
- 새 기능 개발

## Approach
스키마(sdoc.schema.json) 기준으로 MCP → Instructions → Skills → Examples 순서로 비교 검증.

## Progress
- [x] toolHandlers.ts: VALID_BLOCK_TYPES에 diagram 추가
- [x] toolHandlers.ts: VALID_INLINE_TYPES에서 image 제거 (block 노드)
- [x] toolHandlers.ts: VALID_MARK_TYPES에 textStyle, highlight, subscript, superscript 추가
- [x] sdoc-format.instructions.md: heading/paragraph에 textAlign, diagram 노드 추가
- [x] SKILL.md: Diagram, textAlign, subscript/superscript, textStyle/highlight 절차 추가
- [x] examples.md: 새 기능 JSON 예제 추가
- [x] 전체 빌드 검증 통과

## References
- 관련 파일: `shared/mcp/toolHandlers.ts`, `docs/agent/.github/instructions/sdoc-format.instructions.md`, `docs/agent/.github/skills/sdoc-editing/SKILL.md`
- 관련 태스크: SDOC-001 (MCP 서버), SDOC-002 (병합)
