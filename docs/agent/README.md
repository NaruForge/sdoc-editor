# .sdoc / .tiptap.json AI Agent 가이드

AI Agent가 `.sdoc` 및 `.tiptap.json` 파일을 올바르게 편집할 수 있도록 돕는 **3가지 계층**의 지원을 제공합니다.

> `.sdoc`와 `.tiptap.json`은 **동일한 JSON 포맷**을 사용하며 완전히 호환됩니다.

| 계층 | 역할 | 활성화 방식 |
|---|---|---|
| Instructions | AI에게 파일 포맷 **지식** 제공 | `.sdoc`/`.tiptap.json` 파일 작업 시 자동 로드 |
| Skill | 구체적 작업 **절차** 안내 | `/sdoc-editing` 슬래시 커맨드 |
| MCP Server | 검증/변환/처리 **도구** 제공 | `.vscode/mcp.json` 등록 후 자동 |

---

## 설치 방법

### 자동 설치 (권장)

VS Code 명령 팔레트에서 한 번에 설치:

```
Ctrl+Shift+P → "Structured Doc: Setup AI Agent (Instructions + Skills + MCP)"
```

Instructions/Skills 파일이 프로젝트 `.github/`에 복사되고, `.vscode/mcp.json`이 자동 생성됩니다.

### 수동 설치

`docs/agent/.github/` 폴더의 내용을 **사용하려는 프로젝트의 루트**에 복사하세요:

```
your-project/
├── .github/
│   ├── instructions/
│   │   └── sdoc-format.instructions.md   ← .sdoc/.tiptap.json 파일 작업 시 자동 로드
│   └── skills/
│       └── sdoc-editing/
│           ├── SKILL.md                   ← /sdoc-editing 슬래시 커맨드
│           └── references/
│               ├── new-document-template.md
│               └── examples.md
├── .vscode/
│   └── mcp.json                           ← MCP 서버 설정 (아래 참조)
├── docs/
│   └── *.sdoc  (또는 *.tiptap.json)
└── ...
```

---

## 1. Instructions (자동 적용)

**파일**: `.github/instructions/sdoc-format.instructions.md`

- `applyTo: "**/*.{sdoc,tiptap.json}"` 로 해당 파일 편집 시 **자동 로드**
- envelope 구조, 노드 타입, 속성 규칙, 마크 등 핵심 포맷 지식 포함
- AI가 별도 호출 없이도 파일을 올바르게 편집할 수 있게 함

---

## 2. Skill (온디맨드 호출)

**폴더**: `.github/skills/sdoc-editing/`

- VS Code 채팅에서 `/sdoc-editing` 슬래시 커맨드로 호출
- 새 문서 생성, 수학 수식 삽입, 테이블 추가 등 구체적 작업 절차 안내
- `references/` 폴더에 템플릿과 예제 포함

---

## 3. MCP Server

MCP Server는 AI에게 파일을 **검증, 변환, 분석**할 수 있는 도구를 제공합니다.

### 사전 조건

- Structured Doc Editor 확장이 설치되어 있어야 합니다 (`.vsix`)
- 확장이 설치되면 `dist/mcp-server.js`가 확장 경로에 포함됩니다

### 설정 방법

`Ctrl+Shift+P` → "Structured Doc: Setup AI Agent" 명령을 사용하면 자동 생성됩니다.

수동으로 설정하려면 `.vscode/mcp.json`에 다음을 추가:

```json
{
  "servers": {
    "sdoc": {
      "type": "stdio",
      "command": "node",
      "args": ["${userHome}/.vscode/extensions/lgm-control-swbaek.structured-doc-editor-0.2.3/dist/mcp-server.js"]
    }
  }
}
```

> **참고**: 확장 버전(`0.2.3`)이 다르면 실제 경로에 맞게 수정하세요.
> `Ctrl+Shift+P` → "MCP: List Servers"로 서버 상태를 확인할 수 있습니다.

### 제공 도구 (Tools)

| Tool | 설명 |
|---|---|
| `sdoc_validate` | 파일을 스키마 기준으로 검증, 오류 목록 반환 |
| `sdoc_create` | 메타데이터를 받아 올바른 envelope 구조의 새 파일 생성 |
| `sdoc_export` | `.sdoc`/`.tiptap.json` → HTML / Markdown / AsciiDoc 변환 |
| `sdoc_import` | Markdown 텍스트 → JSON 변환 |
| `sdoc_getSchema` | JSON 스키마 정의 반환 |
| `sdoc_assignIds` | heading/image/table에 자동 ID 부여 |
| `sdoc_syncRefs` | 교차참조 링크 텍스트를 현재 번호에 맞게 동기화 |
| `sdoc_migrate` | 레거시 `data-*` 속성명을 clean camelCase로 마이그레이션 |
| `sdoc_query` | 문서 구조 요약 (heading 목록, figure/table 목록, 교차참조 맵) |

### 제공 리소스 (Resources)

| Resource URI | 설명 |
|---|---|
| `sdoc://schema` | JSON 스키마 전체 |

---

## 사용 예시

### Instructions (자동)

`.sdoc` 또는 `.tiptap.json` 파일을 열고 AI에게 편집을 요청하면 자동으로 포맷 규칙이 적용됩니다:

> "이 파일에 2장 '시스템 설계' 섹션을 추가해줘"

### Skill (슬래시 커맨드)

채팅에서 `/sdoc-editing`으로 호출:

> `/sdoc-editing 새 기술 사양서 문서를 만들어줘`

> `/sdoc-editing 이 테이블에 캡션과 새 열을 추가해줘`

### MCP Server (도구 활용)

AI가 자동으로 도구를 사용하거나, 직접 요청할 수 있습니다:

> "이 파일이 올바른 형식인지 검증해줘" → `sdoc_validate`

> "이 파일을 Markdown으로 변환해줘" → `sdoc_export` (format: markdown)

> "이 Markdown 파일을 .sdoc로 변환해줘" → `sdoc_import`

> "이 문서의 구조를 보여줘" → `sdoc_query`

> "모든 heading과 table에 ID를 부여하고 교차참조를 동기화해줘" → `sdoc_assignIds` + `sdoc_syncRefs`

---

## 참고

- AI 지시 파일(Instructions, Skill)은 **영어**로 작성됨 (AI 이해도 최적화)
- 사용자는 한글로 요청해도 AI가 올바르게 포맷을 적용함
- 모든 내용은 `sdoc.schema.json` 기반으로 작성됨
- MCP Server는 VS Code 확장에 내장되어 별도 설치 불필요
