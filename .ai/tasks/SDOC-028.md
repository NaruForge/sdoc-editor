---
ats: "0.1"
id: SDOC-028
title: "Callout / Blockquote / Footnote 기능 평가 및 구현 계획"
status: in-progress
priority: high
created: 2026-04-14T22:00:00+09:00
modified: 2026-04-14T22:00:00+09:00
author: "@copilot"
---

# SDOC-028: Callout / Blockquote / Footnote 기능 평가 및 구현 계획

## Context
SDOC 에디터에 세 가지 블록 기능(Callout/Admonition, Blockquote, Footnote)을 추가하려 한다.
기능분석 보고서(docs/SDOC_기능분석_보고서.md)에 이미 기초 분석이 존재하나, 실제 에디터 경험 측면의 효용성과 구현 난이도에 대한 정밀 평가가 필요하다.

## Scope
### In Scope
- 세 기능의 편집 경험 효용성 평가
- 구현 난이도 평가 (스키마, 에디터, Converter, 동기화 포함)
- 구현 순서 권고

### Out of Scope
- 실제 코드 구현 (별도 태스크로 분리)

## Approach
현재 SDOC 에디터의 아키텍처(Tiptap 확장, Converter 4종, JSON Schema, Tauri 동기화)를 기준으로 각 기능의 구현 영향 범위를 정량적으로 분석한다.

## Analysis

### 영향 범위 매트릭스

| 수정 대상 | Callout | Blockquote | Footnote |
|-----------|---------|------------|----------|
| JSON Schema (`sdoc.schema.json`) | ✅ 신규 노드 | ✅ 신규 노드 | ✅ 신규 노드 2개 |
| Tiptap Extension (webview-ui) | 커스텀 Node 신규 | 기존 확장 등록 | 커스텀 Node 2개 + Plugin |
| Tiptap Extension (tauri-app) | 동기화 | 동기화 | 동기화 |
| CSS 스타일링 | variant별 5종 | 기본 1종 | ref + definition 2종 |
| Converter: HTML | ✅ | ✅ | ✅ (복잡) |
| Converter: Markdown | ✅ GitHub Alerts | ✅ `> ` | ✅ `[^N]` |
| Converter: AsciiDoc | ✅ Admonition | ✅ `____` | ✅ `footnote:[]` |
| Converter: Slides | ✅ | ✅ | ✅ |
| Markdown Import | ✅ `> [!TYPE]` | ✅ `> ` | ✅ `[^N]` |
| CrossRef 연동 | ❌ 불필요 | ❌ 불필요 | ⚠️ 선택적 |
| 자동 번호 관리 | ❌ 불필요 | ❌ 불필요 | ✅ appendTransaction |
| BubbleMenu / Toolbar | ✅ variant 선택 | ✅ 토글 버튼 | ✅ 삽입 버튼 |
| Context Menu | ⚠️ variant 변경 | ❌ | ❌ |

---

### 1. Callout / Admonition 블록

#### 편집 경험 효용성: ★★★★★

| 관점 | 평가 |
|------|------|
| **사용 빈도** | 거의 모든 기술 문서에서 사용 (Note, Warning, Tip, Danger) |
| **시각적 효과** | 아이콘+색상+배경으로 즉각적인 정보 유형 구분 |
| **산업 표준** | GitHub Alerts, Notion Callout, Confluence Panel, MkDocs Admonition — 사실상 표준 |
| **Export 호환** | Markdown GitHub Alerts(`> [!NOTE]`), AsciiDoc(`NOTE:`, `WARNING:` 등), HTML(`<div class="callout">`) 모두 1:1 매핑 |
| **차별화** | Google Docs는 이 기능 미제공 → SDOC의 경쟁력 포인트 |

#### 구현 난이도: ★★★☆☆ (중)

**세부 작업량:**
- Tiptap Node Extension: ~150줄 (커스텀 NodeView, variant 속성, 아이콘 매핑)
- CSS: ~100줄 (5개 variant × 아이콘/배경/테두리)
- JSON Schema: ~30줄
- Converter 4종 수정: 각 ~20줄 (총 ~80줄)
- Markdown Import: ~30줄 (`> [!TYPE]` 파싱)
- Toolbar/BubbleMenu: ~40줄
- Tauri 동기화: Extension 복사

**핵심 난점:**
- Callout 내부에 block content(paragraph, list, code block 등)를 포함해야 하므로 `content: "block+"` 스키마 필요
- variant 전환 UI (드롭다운 또는 BubbleMenu)
- Notion처럼 `/callout` 슬래시 명령 추가 검토 필요

**기존 패턴 활용:**
- DiagramBlock의 NodeView 패턴 재활용 가능
- variant 속성은 MathBlock의 inline/block 토글과 유사

---

### 2. 인용 블록 (Blockquote)

#### 편집 경험 효용성: ★★★★☆

| 관점 | 평가 |
|------|------|
| **사용 빈도** | 인용, 회의록 발언 기록, 고객 피드백 — 중간-높음 |
| **데이터 무결성** | 현재 Markdown Import 시 blockquote 손실 발생 → **기존 결함 해소** |
| **시각적 효과** | 왼쪽 테두리 + 들여쓰기로 명확한 구분 (표준 UX) |
| **Export 호환** | 모든 문서 형식에서 1:1 매핑 (완벽한 호환) |
| **Callout과의 관계** | Callout이 blockquote를 기반으로 확장하는 구조도 가능하나, 의미적으로 분리 권장 |

#### 구현 난이도: ★☆☆☆☆ (매우 낮음)

**세부 작업량:**
- Tiptap Extension: ~10줄 (`@tiptap/extension-blockquote` 등록만 하면 됨, StarterKit에서 disable 해제도 가능)
- CSS: ~20줄 (왼쪽 border, 배경색, 들여쓰기)
- JSON Schema: ~15줄
- Converter 4종: 각 ~10줄 (총 ~40줄)
- Markdown Import: `> ` 파싱은 markdown-it가 기본 지원 → 매핑만 추가
- Toolbar: 토글 버튼 1개
- Tauri 동기화: Extension 복사

**핵심 요점:**
- Tiptap의 `Blockquote` 확장이 이미 존재하며 StarterKit에 포함
- 현재 StarterKit에서 `blockquote: false`로 비활성화했거나 등록을 안 한 상태
- 단순히 활성화 + 스타일링 + Converter 추가로 완성 가능
- **가장 적은 노력으로 가장 확실한 가치 제공**

---

### 3. Footnote (각주)

#### 편집 경험 효용성: ★★★☆☆

| 관점 | 평가 |
|------|------|
| **사용 빈도** | 학술 논문, 공식 보고서에서 필수. 일반 기술 문서에서는 낮음 |
| **UX 복잡도** | 인라인 참조 ↔ 하단 정의 간 네비게이션 필요, 학습 곡선 있음 |
| **시각적 효과** | 본문 흐름 유지하면서 보충 정보 제공 — 학술적 |
| **Export 호환** | Markdown `[^1]`, AsciiDoc `footnote:[]`, HTML `<sup>/<section class="footnotes">` — 매핑 가능하나 복잡 |
| **PDF 특수성** | 페이지 하단 렌더링은 CSS print만으로는 어려움 (현재 headless Chrome PDF) |
| **대안 존재** | CrossRef 시스템으로 문서 내 참조는 이미 지원 중 |

#### 구현 난이도: ★★★★★ (높음)

**세부 작업량:**
- Tiptap Extension: ~300줄
  - `FootnoteRef` (인라인 노드, atom): 번호 렌더링 + 클릭 시 정의로 스크롤
  - `FootnoteDefinition` (블록 노드): 하단 영역에 표시, 역참조 링크
  - `FootnoteNumbering` (Plugin): appendTransaction으로 자동 번호 관리
- CSS: ~80줄 (상첨자 참조, 하단 정의 영역, 호버 프리뷰)
- JSON Schema: ~40줄 (노드 2개)
- Converter 4종: 각 ~40줄 (총 ~160줄) — 참조/정의 매핑 복잡
- Markdown Import: ~60줄 (`[^N]: ` 정의 + `[^N]` 참조 파싱)
- 호버 프리뷰: ~50줄 (tooltip으로 각주 내용 표시)
- Tauri 동기화: Extension 복사 + 추가 UI

**핵심 난점:**
1. **이중 노드 구조**: 인라인 참조(footnoteRef)와 블록 정의(footnoteDefinition) 간 ID 동기화
2. **자동 번호 관리**: 각주 삽입/삭제 시 전체 번호 재정렬 → appendTransaction 플러그인 (기존 EquationNumbering 패턴 유사하나 인라인↔블록 연동이 추가)
3. **편집 UX 설계**: 각주 삽입 시 정의 블록을 어디에 배치할지 (문서 하단 자동? 현재 위치?)
4. **양방향 네비게이션**: 참조 클릭 → 정의로 스크롤, 역참조 클릭 → 본문으로 복귀
5. **PDF 각주**: 페이지 하단에 놓으려면 CSS `@page` + `float: footnote` 필요 (브라우저 지원 불안정)
6. **삭제 일관성**: 참조 삭제 시 정의도 삭제? 정의 삭제 시 orphan 참조 처리?

---

## 종합 비교 및 권고

| 항목 | Callout | Blockquote | Footnote |
|------|---------|------------|----------|
| 편집 효용성 | ★★★★★ | ★★★★☆ | ★★★☆☆ |
| 구현 난이도 | 중 (~400줄) | 매우 낮음 (~100줄) | 높음 (~700줄+) |
| ROI (효용/난이도) | **높음** | **매우 높음** | **낮음** |
| Markdown 호환 임팩트 | GitHub Alerts 지원 | `> ` 손실 해소 | `[^N]` 지원 |
| 선행 의존성 | 없음 | 없음 | 없음 |

### 권고 구현 순서

1. **Blockquote** (1순위) — 최소 노력, Markdown Import 데이터 손실 해소, 기본기 완성
2. **Callout** (2순위) — 높은 효용, Blockquote 구현 경험 활용, 차별화 포인트
3. **Footnote** (3순위) — 높은 복잡도, 타겟 사용자 범위 제한적, 별도 스프린트 권장

> Blockquote와 Callout은 동일 스프린트에 함께 구현 가능 (총 ~500줄).
> Footnote는 UX 설계 검토 후 별도 태스크로 분리 권장.

## Progress
- [x] 현재 에디터 아키텍처 분석
- [x] 세 기능 편집 효용성 평가
- [x] 구현 난이도 정량 분석
- [x] 영향 범위 매트릭스 작성
- [x] 구현 순서 권고
