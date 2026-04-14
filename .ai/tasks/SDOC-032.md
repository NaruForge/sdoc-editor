---
ats: "0.1"
id: SDOC-032
title: "Toolbar UX 최적화 — 과밀 버튼 정리, 그룹 통합, 사이드바 확장"
status: done
priority: medium
created: 2026-04-14T23:30:00+09:00
modified: 2026-04-15T04:00:00+09:00
author: "@copilot"
---

# SDOC-032: Toolbar UX 최적화 — 과밀 버튼 정리 및 그룹 통합

## Context

기능이 지속적으로 추가되면서 Toolbar에 버튼이 과밀 상태가 됨. 현재 Toolbar에는 **30+개 이상의 컨트롤**이 단일 줄에 나열되어 있어 좁은 VS Code 패널 폭에서 잘리거나 UX가 저하됨.

사용자 요구: 불필요한 버튼 제거 또는 하나의 메뉴로 통합하는 최적화 방안 분석.

## Scope

### In Scope
- 현재 Toolbar 전체 구조 실측 분석
- 버튼별 사용 빈도 / 중요도 분류
- 통합·이동·제거 방안 설계
- 최적 구조 제안 (구체적 레이아웃 포함)

### Out of Scope
- 실제 구현 (별도 태스크)
- BubbleMenu 변경
- 키보드 단축키 변경

---

## 현재 Toolbar 전체 인벤토리

| # | 컨트롤 | 아이콘 | 현재 위치 | 타입 |
|---|--------|--------|-----------|------|
| 1 | **Bold** | B | 서식 그룹 | 버튼 |
| 2 | **Italic** | I | 서식 그룹 | 버튼 |
| 3 | **Underline** | U | 서식 그룹 | 버튼 |
| 4 | **Strikethrough** | ~~S~~ | 서식 그룹 | 버튼 |
| 5 | **Subscript** | x₂ | 서식 그룹 | 버튼 |
| 6 | **Superscript** | x² | 서식 그룹 | 버튼 |
| 7 | **Link** | 🔗 | 서식 그룹 | 버튼 |
| 8 | **텍스트 색상** | 🎨 | 서식 그룹 | 드롭다운 |
| 9 | **하이라이트** | 형광펜 | 서식 그룹 | 드롭다운 |
| — | 구분선 | — | — | — |
| 10 | **H1** | H1 | 헤딩 그룹 | 버튼 |
| 11 | **H2** | H2 | 헤딩 그룹 | 버튼 |
| 12 | **H3** | H3 | 헤딩 그룹 | 버튼 |
| — | 구분선 | — | — | — |
| 13 | **Align Left** | ≡← | 정렬 그룹 | 버튼 |
| 14 | **Align Center** | ≡ | 정렬 그룹 | 버튼 |
| 15 | **Align Right** | ≡→ | 정렬 그룹 | 버튼 |
| 16 | **Align Justify** | ≡≡ | 정렬 그룹 | 버튼 |
| — | 구분선 | — | — | — |
| 17 | **Bullet List** | • | 리스트 그룹 | 버튼 |
| 18 | **Ordered List** | 1. | 리스트 그룹 | 버튼 |
| 19 | **Task List** | ☑ | 리스트 그룹 | 버튼 |
| 20 | **Blockquote** | " | 리스트 그룹 | 버튼 |
| — | 구분선 | — | — | — |
| 21 | **Insert 메뉴** | + Insert | 삽입 그룹 | 드롭다운 |
|    | ↳ Table | | 서브메뉴 | |
|    | ↳ Image | | 서브메뉴 | |
|    | ↳ Draw.io | | 서브메뉴 | |
|    | ↳ Math Formula | | 서브메뉴 | |
|    | ↳ Code Block | | 서브메뉴 | |
|    | ↳ Diagram (Mermaid) | | 서브메뉴 | |
|    | ↳ Horizontal Rule | | 서브메뉴 | |
|    | ↳ Callout (서브) | | 서브메뉴 | |
|    | ↳ Cross Reference | | 서브메뉴 | |
| 22 | **Delete Table** | 🗑 | 상황별(table 내부만) | 버튼 |
| — | 구분선 | — | — | — |
| 23 | **View JSON** | {} | 파일 그룹 | 버튼 |
| 24 | **Export** | ↓ Export | 파일 그룹 | 드롭다운 |
|    | ↳ HTML | | | |
|    | ↳ PDF | | | |
|    | ↳ Markdown | | | |
|    | ↳ AsciiDoc | | | |
|    | ↳ Slides | | | |
| 25 | **Import** | ↑ Import | 파일 그룹 | 드롭다운 |
|    | ↳ Markdown | | | |
|    | ↳ HTML | | | |
| — | 구분선 | — | — | — |
| 26 | **번호 표시 (1.2.3)** | 1.2.3 | 뷰 그룹 | 버튼 |
| 27 | **헤딩 장식** | 서식제거 | 뷰 그룹 | 버튼 |
| 28 | **TOC** | 📖 TOC | 뷰 그룹 | 버튼 |
| 29 | **Settings** | ⚙ | 뷰 그룹 | 버튼 |

**총 29개 컨트롤** (구분선 제외), 드롭다운 서브항목 포함 시 **40+개 액션**.

---

## 문제 분석

### 1. BubbleMenu 중복 제공 항목

BubbleMenu는 텍스트 선택 시 자동 팝업되며 이미 아래 서식 기능을 제공함:
- Bold / Italic / Underline / Strikethrough
- 텍스트 색상 / 하이라이트
- Link
- Subscript / Superscript
- Heading 1/2/3
- Align Left/Center/Right/Justify
- Blockquote (추가됨)

→ Toolbar에서 이 항목들의 **중요도가 낮아짐**. 그러나 선택 없이도 빠르게 On/Off 하기 위해 Toolbar에 두는 용도는 여전히 유효.

### 2. 사용 빈도/중요도 분류

| 등급 | 항목 | 이유 |
|------|------|------|
| **High** (항상 Toolbar에) | Bold, Italic, Underline, H1, H2, H3, Bullet List, Ordered List | 가장 자주 사용. 키보드 단축키가 있더라도 시각적 피드백 필요 |
| **Medium** (Toolbar 유지 권장) | Link, 텍스트 색상, 하이라이트, Task List, Blockquote, Insert 메뉴, Export 메뉴 | 중간 빈도. BubbleMenu 보완 역할 |
| **Low** (통합 또는 이동 권장) | Strikethrough, Subscript, Superscript, Align 4개, Import 메뉴, View JSON, 번호 표시, 헤딩 장식 | 드물게 사용. BubbleMenu/메뉴 통합으로 충분 |
| **Contextual** (조건부) | Delete Table | table 내부일 때만 표시 — 현재 동작 유지 권장 |

### 3. 통합 기회

#### 3-A. 「서식 더보기」 드롭다운으로 통합
Strikethrough, Subscript, Superscript → **텍스트 색상 드롭다운 내부**에 통합하거나 별도 `Aa▾` 드롭다운으로 묶기.
- 절감: 독립 버튼 3개 → 드롭다운 1개 (-2개)

#### 3-B. 정렬 4개 → **정렬 드롭다운 1개**
AlignLeft / AlignCenter / AlignRight / AlignJustify를 현재 활성 정렬 아이콘으로 표시되는 단일 드롭다운으로 통합.
- 절감: 버튼 4개 → 드롭다운 1개 (-3개)

#### 3-C. 「파일 메뉴」 통합
View JSON + Export + Import → 단일 `⋯ File` 드롭다운 1개로 통합.
- JSON View는 개발자 기능 → 오히려 숨기는 게 적합
- 절감: 버튼/드롭다운 3개 → 1개 (-2개)

#### 3-D. 뷰 컨트롤 단순화
번호 표시(1.2.3), 헤딩 장식, TOC, Settings → 정렬 의미상 `뷰 패널` 우측에 몰아서 시각적 분리 강화. 4개 버튼이지만 텍스트 레이블(1.2.3, TOC)을 아이콘만으로 교체해 폭 줄이기.
- 절감 없음, 가시성 개선

#### 3-E. Blockquote 위치 재배치
현재 Blockquote가 List 그룹 끝에 있음. Callout과 함께 **Insert 메뉴 → Quote block 서브항목**으로 이동하거나, 별도 `블록 그룹`(Blockquote + Callout 토글버튼)으로 Toolbar 내 묶기.
- 단, Blockquote는 자주 쓰이므로 Toolbar 노출 유지 검토 필요

---

## 권장 최적화 방안 (3가지 안)

### 안 A: 최소 변경 (conservative)
**변경**: 정렬 4개 버튼 → 단일 드롭다운 + Strikethrough/Sub/Superscript를 Format More 드롭다운으로 통합

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| 정렬 | 4개 버튼 | 1개 드롭다운 |
| Strikethrough, Sub, Superscript | 3개 버튼 | `Aa▾` 드롭다운 1개 |
| **총 Toolbar 항목 수** | **29개** | **23개** (-6개) |

장점: 기존 동작 최대한 보존  
단점: 아직 다소 과밀

---

### 안 B: 균형 변경 (recommended) ⭐
**변경**: A안 + 파일 메뉴 통합 + 뷰 컨트롤 아이콘 전용화

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| 정렬 4개 | 4개 버튼 | 1개 드롭다운 |
| Strikethrough, Sub, Superscript | 3개 버튼 | `Aa▾` 1개 |
| Export + Import + View JSON | 3개 드롭다운/버튼 | `⋯ File` 1개 |
| 번호(1.2.3), 헤딩 장식 레이블 제거 | 텍스트+아이콘 | 아이콘 전용 |
| **총 Toolbar 항목 수** | **29개** | **19개** (-10개) |

Toolbar 구조 (안 B):
```
[B] [I] [U] [Aa▾]  │  [H1] [H2] [H3]  │  [≡▾]  │  [•] [1.] [☑] ["]  │  [+ Insert▾]  │  [⋯ File▾]  │  [#̈] [⚙] [📖] [1.2] [—]
```

장점: 대폭 슬림화, 시각적으로 명확한 그룹핑  
단점: 정렬·파일 1-클릭 접근 포기 (2-클릭으로 전환)

---

### 안 C: 급진 변경 (minimal toolbar)
**변경**: BubbleMenu를 믿고 Toolbar를 구조/삽입/파일 메뉴 위주로 최소화

Toolbar에는 Insert▾, Export▾, TOC, Settings만 두고 나머지는 BubbleMenu 또는 Context Menu로 이동.

| 항목 | 변경 후 |
|------|---------|
| 서식 전부 | BubbleMenu로 이동 |
| 헤딩 | BubbleMenu로 이동 |
| 정렬 | BubbleMenu로 이동 |
| 리스트 3종 | Toolbar 유지 (구조적) |
| Blockquote | Insert 메뉴 이동 |
| **총 Toolbar 항목 수** | **~10개** |

장점: 극도로 깔끔  
단점: BubbleMenu가 유일한 서식 접근 경로 → 발견 가능성 저하, UX 불편 가능성

---

## 결론 및 추천

**안 B (균형 변경)** 채택 권장:
1. 현재 사용자가 익숙한 주요 버튼(Bold/Italic/H1~H3/리스트)은 유지
2. 드물게 쓰는 기능(Strikethrough, Sub/Super, 정렬 4개)을 드롭다운으로 통합
3. 개발자 기능(View JSON)과 파일 작업(Export/Import)을 단일 File 메뉴로 정리
4. 텍스트 레이블 제거로 너비 절약

**구현 우선순위**: 정렬 드롭다운 → 서식 더보기 드롭다운 → 파일 메뉴 통합 순서 권장

## Progress

- [x] 현재 Toolbar 전체 인벤토리 실측
- [x] BubbleMenu 중복 항목 분석
- [x] 사용 빈도/중요도 분류
- [x] 통합 기회 3-A~E 도출
- [x] 최적화 안 A/B/C 설계
- [x] 현재 SidePanel 구조 분석 (TOC + Settings 탭)
- [x] 진보된 Side Activity Bar 아키텍처 설계
- [x] 최종 통합 방안 (안 D) 설계
- [x] 사용자 안 D 선택
- [x] 브랜치 `feature/toolbar-activity-bar` 생성
- [x] `ActivityBar.tsx` 신규 구현 (webview-ui + tauri-app)
- [x] `SidePanel.tsx` 4탭 구조로 재작성 (view/toc/settings/file)
- [x] `Toolbar.tsx` 29개 → 12개 슬림화 (Aa▾ 드롭다운, ≡▾ 정렬 드롭다운)
- [x] `Editor.tsx` 레이아웃 구조 개편 (ActivityBar 통합)
- [x] CSS 추가 (Activity Bar + SidePanel new elements)
- [x] tauri-app 동기화 완료
- [x] webview-ui 빌드 검증 통과

---

## 현재 SidePanel 구조 분석

현재 구현된 SidePanel (`SidePanel.tsx`):
- **2개 탭**: 📑 목차(TOC) / ⚙️ 설정
- Toolbar 우측의 `[📖 TOC]` `[⚙]` 버튼으로 토글
- 에디터 좌측에 붙어서 열림 (`editor-body-with-toc` 레이아웃)
- 각 탭 전환 시 SidePanel이 닫히지 않고 탭만 바뀜

**현재 SidePanel의 한계**:
1. TOC와 Settings만 지원 — 확장 불가 구조
2. TOC/Settings 토글 버튼이 **Toolbar 공간**을 2개 차지
3. SidePanel이 열리면 에디터 영역이 좁아짐 (TOC 폭 고정)
4. 탭 레이블(`📑 목차`, `⚙️ 설정`)이 SidePanel 헤더 공간을 낭비

---

## 진보된 개선안: Side Activity Bar 아키텍처

### 개념: VS Code 스타일 Activity Bar

```
┌─────────────────────────────────────────────────────────────────┐
│  [Toolbar — 서식/삽입 위주, 슬림화]                              │
├──┬──────────────────────────────────────────────────────────────┤
│  │                                                              │
│🔢│                                                              │
│  │              에디터 콘텐츠 영역                               │
│📑│   ◄ 사이드바가 닫히면 에디터가 전체 사용                      │
│  │                                                              │
│⚙️│                                                              │
│  │                                                              │
│📥│                                                              │
└──┴──────────────────────────────────────────────────────────────┘
```

- **좌측 Activity Bar**: 세로 아이콘 스트립 (항상 표시, 폭 32px)
- **사이드 패널**: 아이콘 클릭 시 토글 (같은 아이콘 재클릭 → 닫힘)
- **Toolbar**: 서식/삽입만 집중, 뷰 컨트롤 아이콘 전부 제거

### Activity Bar 탭 구성

| 아이콘 | 탭 | 콘텐츠 | 현재 위치 |
|--------|----|---------|---------  |
| `🔢` | 번호/장식 | 번호 표시 토글 + 헤딩 장식 토글 (인라인 컨트롤) | Toolbar 버튼 2개 |
| `📑` | 목차 (TOC) | TableOfContents 컴포넌트 | SidePanel 탭 |
| `⚙️` | 문서 설정 | DocumentSettingsPanel 컴포넌트 | SidePanel 탭 |
| `📥` | 파일 작업 | Export 5종 + Import 2종 + View JSON | Toolbar 드롭다운 3개 |

### 레이아웃 구조

```
Editor.tsx 레이아웃:

┌── toolbar (상단) ──────────────────────────────────────────────┐
│ [B][I][U][Aa▾] │ [H1][H2][H3] │ [≡▾] │ [•][1.][☑]["] │ [+▾] │
└────────────────────────────────────────────────────────────────┘
┌── editor-body-layout ──────────────────────────────────────────┐
│ ┌─ activity-bar (32px) ──┐ ┌─ side-panel (240px, 토글) ─┐     │
│ │  [🔢] active-tab       │ │  <활성 탭 콘텐츠>           │     │
│ │  [📑]                  │ │                            │     │
│ │  [⚙️]                  │ └────────────────────────────┘     │
│ │  [📥]                  │ ┌─ editor-content-area ──────────┐  │
│ └────────────────────────┘ │  (제목 + ProseMirror)           │  │
│                            └────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## 안 D: Activity Bar + Toolbar 슬림화 통합안 (최종 권장) ⭐⭐

### Toolbar 변경 (안 B 기반 + 뷰 컨트롤 완전 제거)

```
[B][I][U][Aa▾] │ [H1][H2][H3] │ [≡▾] │ [•][1.][☑]["] │ [+ Insert▾]
```

| 항목 | 현재 | 안 D |
|------|------|------|
| Strikethrough, Sub, Superscript | 3개 독립 버튼 | `Aa▾` 드롭다운 1개 |
| Align 4개 | 4개 독립 버튼 | `≡▾` 드롭다운 1개 (현재 활성 정렬 아이콘) |
| Export / Import / View JSON | 드롭다운 3개 | **Activity Bar [📥] 탭으로 이동** |
| 번호 표시(1.2.3) / 헤딩 장식 | 2개 버튼 | **Activity Bar [🔢] 탭으로 이동** |
| TOC / Settings 버튼 | 2개 버튼 | **Activity Bar 아이콘으로 대체** |
| **Toolbar 총 항목** | **29개** | **12개** (-17개) |

### Activity Bar 패널 상세

#### [🔢] 뷰 컨트롤 탭
```
┌ 뷰 설정 ────────────────────────────┐
│  번호 매김   [━━━●    ] ON           │
│  헤딩 장식   [━━━●    ] ON           │
└─────────────────────────────────────┘
```
- 클릭 즉시 토글되는 인라인 스위치 (패널 열 필요 없이 아이콘 클릭만으로도 토글)
- 또는 클릭 → 미니 팝오버(툴팁)로 두 토글 표시 (패널 불필요)

#### [📑] 목차 탭
- 기존 TableOfContents 그대로

#### [⚙️] 문서 설정 탭
- 기존 DocumentSettingsPanel 그대로

#### [📥] 파일 작업 탭
```
┌ 내보내기 ──────────────────────────┐
│  → HTML                            │
│  → PDF                             │
│  → Markdown                        │
│  → AsciiDoc                        │
│  → Slides (reveal.js)              │
├ 가져오기 ──────────────────────────┤
│  ← Markdown                        │
│  ← HTML                            │
├ 개발 ──────────────────────────────┤
│  { } JSON 소스 보기                 │
└────────────────────────────────────┘
```

---

## 안별 비교표

| 기준 | 현재 | 안 A | 안 B | 안 D (권장) |
|------|------|------|------|------------|
| Toolbar 항목 수 | 29개 | 23개 | 19개 | **12개** |
| 항목 접근 클릭 수 | 1~2회 | 1~2회 | 1~2회 | 1~2회 |
| 에디터 폭 효율 | 보통 | 보통 | 보통 | **최대** (Activity Bar 32px만 차지) |
| 확장 용이성 | 낮음 | 낮음 | 낮음 | **높음** (탭 추가만 하면 됨) |
| 구현 복잡도 | — | 낮음 | 낮음 | **중간** (Activity Bar 신규 컴포넌트) |
| VS Code UX 친숙도 | 보통 | 보통 | 보통 | **높음** (VS Code 패턴 그대로) |

---

## 구현 범위 (안 D 선택 시)

1. **`ActivityBar.tsx`** 신규 컴포넌트 (세로 아이콘 스트립, 토글 로직)
2. **`SidePanel.tsx`** 탭 추가: `'view' | 'toc' | 'settings' | 'file'`
3. **`Toolbar.tsx`** 슬림화:
   - 정렬 → 드롭다운 통합
   - Strikethrough/Sub/Super → `Aa▾` 통합
   - Export/Import/ViewJSON/번호/장식/TOC/Settings 버튼 **전부 제거**
4. **`Editor.tsx`** 레이아웃 조정: `activity-bar` + `side-panel` 분리
5. CSS: `.activity-bar`, `.activity-bar-icon` 스타일

신규 파일 2개, 수정 파일 4개.

---

## Progress

- [x] 현재 Toolbar 전체 인벤토리 실측
- [x] BubbleMenu 중복 항목 분석
- [x] 사용 빈도/중요도 분류
- [x] 통합 기회 3-A~E 도출
- [x] 최적화 안 A/B/C 설계
- [x] 현재 SidePanel 구조 분석 (TOC + Settings 탭)
- [x] 진보된 Side Activity Bar 아키텍처 설계
- [x] 최종 통합 방안 (안 D) 설계
- [ ] 사용자 안 선택
- [ ] 구현 (별도 태스크)
