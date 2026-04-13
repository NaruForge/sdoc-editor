---
ats: "0.1"
id: SDOC-018
title: "Block 수식 자동 번호 + CrossRef 지원"
status: done
priority: medium
created: 2026-04-13T11:30:00+09:00
modified: 2026-04-13T11:30:00+09:00
author: "copilot"
---

# SDOC-018: Block 수식 자동 번호 + CrossRef 지원

## Context
Block 수식(MathBlock)에 자동 번호를 표시하고, `@` CrossRef로 수식을 참조할 수 있도록 지원.
UX 논의에서 수식에 Caption은 불필요(논문 표준)하고, 번호 포맷은 Preference로 제공하기로 결정.

## Scope
### In Scope
1. **수식 자동 번호** — MathBlock에 `(1)`, `(2)` 번호를 오른쪽에 표시
2. **번호 포맷 설정** — `equation.numbering: sequential | hierarchical`
   - sequential: 문서 전체 순번 (1), (2), (3)...
   - hierarchical: H1 섹션별 순번 (1.1), (1.2), (2.1)...
3. **CrossRef 지원** — `@` 팝업에 Equations 그룹 추가, ∑ 아이콘
4. **Export 지원** — HTML/Markdown/AsciiDoc에 `\tag{N}` 포함
5. **AsciiDoc mathBlock** — 기존 미구현 case 추가

### Out of Scope
- 수식 Caption (논문 표준에 없음)
- 수식 목록(List of Equations) 사이드바
- \tag 커스터마이징 노출

## Approach

### 번호 표시 (에디터)
- MathBlock NodeView에 `.math-block-rendered-row` flex wrapper 추가
- `.eq-number` span을 오른쪽에 배치
- `_setEqNumber(label)` 함수를 DOM에 노출
- `EquationNumbering` Extension (tiptapExtensions.ts): ProseMirror `view` plugin으로 `buildEqNumberMap(doc)` 실행 후 DOM 업데이트

### 번호 계산
- `buildEqNumberMap(doc)`: H1 경계에서 `eqInSection` 리셋
- `sequential` 모드: 전역 `eqGlobal` 카운터
- `hierarchical` 모드: `${h1}.${eqInSection}` 형식

### CrossRef
- `RefTarget` 타입에 `'equation'` 추가
- `collectTargets()`, `buildIdMap()` 에 mathBlock case 추가
- id 없을 때 fallback: `eq-N`

### Export
- `\tag{N}` 을 latex에 append (KaTeX 표준)
- HTML: `id` attr + tagged latex
- Markdown: `<a id="...">` anchor + `$$\n...\tag{N}\n$$`
- AsciiDoc: `[stem]` passthrough block + `\tag{N}`

## Progress
- [x] MathBlock id attr 추가 (schema)
- [x] NodeView 번호 배지 (.math-block-rendered-row + .eq-number)
- [x] DOM에 _setEqNumber() 노출
- [x] EquationNumbering Plugin (tiptapExtensions.ts)
- [x] buildEqNumberMap() 구현
- [x] equation.numbering VS Code 설정 추가 (package.json)
- [x] sendSettings()에 equationNumbering 추가
- [x] EditorContext equationNumbering 타입 추가
- [x] CrossReference RefTarget 'equation' 타입 추가
- [x] collectTargets() mathBlock 처리 + Equations 그룹
- [x] buildIdMap() mathBlock 처리
- [x] sdocUtils.ts assignAutoIds mathBlock (eq-N)
- [x] sdocUtils.ts syncCrossReferences equationNumbering param
- [x] sdocUtils.ts QueryResult equations[] 추가
- [x] jsonToHtml.ts mathBlock 번호 + \tag
- [x] jsonToMarkdown.ts mathBlock 번호 + \tag
- [x] jsonToAdoc.ts mathBlock + mathInline case 추가
- [x] Export commands equationNumbering 설정 전달
- [x] CSS: vscode-theme.css + tauri-theme.css
- [x] tauri-app 동기화 (MathBlock.ts, CrossReference.ts, tiptapExtensions.ts, EditorContext.tsx)
- [x] 빌드 검증 (esbuild OK, webview build OK)
- [x] 커밋 — `07bdda5`: feat(equation): block equation auto-numbering + CrossRef support
