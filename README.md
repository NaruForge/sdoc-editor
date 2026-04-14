# Structured Doc Editor

> **v0.4.4** — Blockquote/Callout 블록 + 저장 버그 수정, BlockExit 키보드 단축키

`.sdoc` / `.tiptap.json` 파일을 위한 WYSIWYG 구조화 문서 에디터입니다.

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| WYSIWYG 편집 | Tiptap/ProseMirror 기반 리치 텍스트 에디터 |
| JSON 저장 | pretty-printed JSON으로 저장 — Git diff 최적화 |
| 내보내기 | Markdown, AsciiDoc, 테마 적용 HTML, PDF, **슬라이드** |
| 가져오기 | Markdown, HTML → `.sdoc` 변환 |
| 텍스트 꾸미기 | 굵게, 기울임, 밑줄, 취소선, 코드, **텍스트 색상**, **하이라이트(음영)** |
| 수학 수식 | KaTeX 인라인 / 블록 수식 |
| 코드 블록 | lowlight 기반 구문 강조 (100+ 언어) |
| **Blockquote** | 인용 블록 (`> text` Markdown 형식) — Markdown/AsciiDoc 호환성 |
| **Callout / Admonition** | 5가지 Variant (📝 Note, ℹ️ Info, 💡 Tip, ⚠️ Warning, 🚨 Danger) — GitHub Alerts / AsciiDoc Admonition 매핑 |
| 표 | 캡션, 정렬, 너비 설정 / 컨텍스트 메뉴로 행·열 조작 |
| 이미지 | 클립보드 붙여넣기, 캡션, 정렬 |
| Mermaid 다이어그램 | 플로우차트·시퀀스·ER·간트 등 라이브 렌더링 / 분할 편집 창 + 6종 템플릿 |
| Draw.io 다이어그램 | 삽입 및 편집 ([Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) 확장 필요) |
| 교차 참조 | `@` 입력으로 heading·figure·table 참조 삽입 및 번호 자동 동기화 |
| 섹션 접기 | heading 옆 토글로 섹션별 접기/펼치기 |
| 할 일 목록 | 체크박스 태스크 리스트 |
| 문서 메타데이터 | Title, Author, Version 인라인 편집 |
| 슬라이드 내보내기 | H1 기준 자동 분리, reveal.js 기반 프레젠테이션 HTML 생성 |
| 내장 폰트 | Legacy Font 2.0 (Light / Regular / SemiBold / Bold) 번들 |
| 자동 업데이트 | 공유 폴더 기반 사내 자동 업데이트 |
| AI Agent 지원 | MCP 서버 내장 — Copilot/Claude 등 AI Agent가 `.sdoc` 직접 생성·편집 가능 |

---

## 설치

1. VS Code에서 `Ctrl+Shift+P` → **"Extensions: Install from VSIX..."**
2. 배포된 `.vsix` 파일 선택
3. VS Code 재시작

> **사내 사용자**: `structuredDocEditor.update.sharedFolder` 설정에 공유 폴더 경로를 지정하면 새 버전 출시 시 자동 업데이트 알림을 받을 수 있습니다.

---

## 사용 방법

1. `.sdoc` 파일을 열면 커스텀 에디터가 자동으로 실행됩니다.
2. `Ctrl+S`로 저장합니다.
3. **이미지 삽입**: 클립보드에서 직접 붙여넣기 (`Ctrl+V`)
4. **Draw.io 다이어그램**: 툴바 "Draw.io" 버튼 → 파일명 입력 → 더블클릭으로 재편집
5. **내보내기**: `Ctrl+Shift+P` → "Structured Doc: Export to ..."
6. **슬라이드**: Toolbar → Export → Slides 또는 `Ctrl+Shift+P` → "Structured Doc: Export to Slides"

---

## 설정

VS Code 설정(`Ctrl+,`)에서 "Structured Doc Editor"를 검색하여 아래 항목을 커스터마이징할 수 있습니다.

### 테마

| 설정 | 설명 | 기본값 |
|---|---|---|
| `theme.companyName` | HTML 내보내기 시 표시할 회사명 | — |
| `theme.companyLogo` | 회사 로고 파일명 (워크스페이스 루트 기준) | — |
| `theme.primaryColor` | 메인 색상 | `#A50034` |
| `theme.accentColor` | 보조 색상 | `#6b6b6b` |
| `theme.fontFamily` | 글꼴 | `Legacy Font 2.0, ...` |

### 폰트 가중치

에디터 및 내보내기에 적용될 폰트 가중치를 요소별로 설정합니다.

| 설정 | 설명 | 기본값 |
|---|---|---|
| `font.body` | 본문 텍스트 | Regular |
| `font.bold` | 굵은 텍스트 | Bold |
| `font.h1` | H1 제목 | Bold |
| `font.h2` | H2 제목 | SemiBold |
| `font.h3` | H3 제목 | SemiBold |

### 제목 / 캡션

| 설정 | 설명 | 기본값 |
|---|---|---|
| `heading.h1Color` | H1 제목 색상 | `#A50034` |
| `heading.showNumber` | 자동 번호 매기기 표시 | `true` |
| `caption.style` | 캡션 스타일 프리셋 | `modern` |
| `caption.crossRefIncludeCaption` | CrossRef에 캡션 텍스트 포함 | `false` |

**캡션 스타일 프리셋**

| 프리셋 | 이미지 | 표 | 수식 | 구분자 | 표 번호 |
|---|---|---|---|---|---|
| `ieee` (간결형) | `Fig. 1` | `Table I` | `(1)` | `. ` | 로마 숫자 |
| `iso` (정석형) | `Figure 1` | `Table 1` | `Equation (1)` | ` — ` | 아라비아 |
| `modern` (현대형) | `Figure 1` | `Table 1` | `Equation 1` | `: ` | 아라비아 |
| `korean` (한국형) | `그림 1` | `표 1` | `식 (1)` | ` ` | 아라비아 |

### 슬라이드

| 설정 | 설명 | 기본값 |
|---|---|---|
| `slide.breakLevel` | 슬라이드 분리 기준 | `h1-only` |
| `slide.showTitleSlide` | 타이틀 슬라이드 자동 생성 | `true` |
| `slide.primaryColor` | 슬라이드 매인 색상 (비워두면 theme 색상 사용) | — |
| `slide.accentColor` | 슬라이드 보조 색상 | — |

### 자동 업데이트

| 설정 | 설명 |
|---|---|
| `update.sharedFolder` | VSIX 배포 공유 폴더 경로 (사내 전용) |

**예시** (`.vscode/settings.json`):

```json
{
  "structuredDocEditor.theme.companyName": "LG Magna e-Powertrain",
  "structuredDocEditor.theme.companyLogo": "legacy-brand-logo.png",
  "structuredDocEditor.theme.primaryColor": "#A50034",
  "structuredDocEditor.font.body": "Regular",
  "structuredDocEditor.font.h1": "Bold",
  "structuredDocEditor.heading.h1Color": "#A50034",
  "structuredDocEditor.caption.style": "korean"
}
```

---

## .sdoc 파일 형식

`.sdoc` 파일은 다음 구조의 JSON입니다.

```json
{
  "sdoc": "1.0",
  "meta": {
    "title": "문서 제목",
    "author": "작성자",
    "version": "1.0",
    "created": "2026-01-01T00:00:00.000Z",
    "modified": "2026-03-27T00:00:00.000Z"
  },
  "doc": {
    "type": "doc",
    "content": [ ... ]
  }
}
```

- `sdoc` — 스키마 버전 (현재 `"1.0"`)
- `meta` — 문서 메타데이터 (에디터 헤더에서 인라인 편집)
- `doc` — Tiptap 문서 트리 (편집 내용)

스키마 전체 정의는 저장소 루트의 `sdoc.schema.json`을 참조하세요.

---

## 라이선스

MIT
