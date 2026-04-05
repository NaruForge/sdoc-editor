# Issue 3: Branch 병합 후 Skills와 Instruction, MCP 재검토
- Status: Closed
- Description:
   1. Main branch로 병합이 완료되었음. 기존에 개발한 Skills/Instruction 그리고 MCP 서버가 모두 올바르게 적용되는지, 그리고 Main과 병합되어 기능이 변경되어야 하지는 않는지 전면 재검토가 필요함.
- Resolution: 병합 후 스키마 vs MCP/Skills/Instructions 간 불일치 발견 및 수정 완료.
- Comment:

## 발견된 불일치 및 수정 사항

### 1. `shared/mcp/toolHandlers.ts` — 유효성 검증 세트 수정
- `VALID_BLOCK_TYPES`: `diagram` 추가
- `VALID_INLINE_TYPES`: `image` 제거 (image는 block 노드)
- `VALID_MARK_TYPES`: `textStyle`, `highlight`, `subscript`, `superscript` 추가

### 2. `docs/agent/.github/instructions/sdoc-format.instructions.md` — 스키마 반영
- `heading`, `paragraph` 노드에 `textAlign` 속성 추가
- `diagram` 노드 섹션 추가 (language, code 속성)
- 마크 타입 테이블에 `subscript`, `superscript`, `textStyle`, `highlight` 추가

### 3. `docs/agent/.github/skills/sdoc-editing/SKILL.md` — 절차 보완
- Diagram(Mermaid) 삽입 절차 추가
- 텍스트 정렬(textAlign) 절차 추가
- 아래첨자/위첨자(subscript/superscript) 절차 추가
- 텍스트 색상/하이라이트(textStyle/highlight) 절차 추가

### 4. `docs/agent/.github/skills/sdoc-editing/references/examples.md` — 예제 추가
- Diagram (Mermaid) JSON 예제
- textAlign (heading, paragraph) JSON 예제
- subscript/superscript JSON 예제  
- textStyle (color) / highlight (background color) JSON 예제

### 검증 결과
- 컨버터 (`jsonToHtml`, `jsonToMarkdown`, `jsonToAdoc`): 이미 main에서 새 기능 처리 완료 — 수정 불필요
- `sdocUtils.ts`: assignAutoIds는 heading/image/table만 처리 (diagram은 대상 외) — 정상
- 전체 빌드 (`npm run build`): extension + webview + MCP 서버 모두 성공
