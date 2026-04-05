# Issue 1: MCP Server 지원
- Status: Resolved
- Description:
   1. structed doc(*.sdoc, *.tiptap.json)은 AI Agent 활용 시, AI가 기능을 제대로 알고 지원하기 어려움
   2. MCP 서버 개발을 통해 AI가 이를 잘 활용할 수 있도록 해야함.
- Resolution: Phase 1 + Phase 2 구현 완료. VS Code Extension 내장 MCP 서버 (`dist/mcp-server.js`)로 제공.
- Comment
    1. contributor-01: MCP 서버를 VS-Code Extension에 내장하는것이 어떨까? 어떤 기능들이 포함되어야 하지?
    2. copilot: 아래에 분석 및 구현 계획을 정리합니다.
    3. contributor-01: 분석대로 수행합니다. Tauri는 지원하지 않습니다.
    4. copilot: 구현 완료. 변경사항 요약:
       - `shared/mcp/sdocUtils.ts` — SdocEditorProvider에서 추출한 공유 유틸리티 (unwrapSdoc, assignAutoIds, syncCrossReferences, migrateAttributes, queryDocumentStructure 등)
       - `shared/mcp/toolHandlers.ts` — MCP tool handler 로직 (validate, create, export, import, assignIds, syncRefs, migrate, query)
       - `src/mcp/server.ts` — @modelcontextprotocol/sdk 기반 stdio MCP 서버 (9개 도구 + 1개 리소스)
       - `src/SdocEditorProvider.ts` — 중복 로직을 shared/ 함수로 위임 (리팩터링)
       - `esbuild.mjs` — MCP 서버 별도 entry point 빌드 추가
       - `tsconfig.json` — shared/ 디렉토리 include
       - `package.json` — @modelcontextprotocol/sdk, zod 의존성 추가
       - `docs/agent/README.md` — Instructions + Skill + MCP Server 통합 사용 가이드

---

## Analysis: MCP Server vs Skills/Instructions

현재 `docs/agent/` 에 이미 Instructions + Skill 기반 AI 가이드를 구축해 두었습니다.
두 접근법의 장단점을 비교합니다.

| 관점 | Skills/Instructions (현재) | MCP Server (제안) |
|---|---|---|
| AI에게 제공하는 것 | **지식** (포맷 규칙, 예제) | **도구** (실행 가능한 기능) |
| .sdoc 생성/편집 | AI가 JSON을 직접 작성 | 서버가 구조 생성 후 반환 |
| 유효성 검증 | 없음 (AI가 규칙을 따르길 기대) | `sdoc.validate`로 즉시 검증 |
| 내보내기(Export) | AI가 할 수 없음 | `sdoc.export`로 HTML/MD/AsciiDoc 변환 |
| 가져오기(Import) | AI가 할 수 없음 | `sdoc.import`로 Markdown→.sdoc 변환 |
| 교차참조/Auto-ID | AI가 수동으로 ID 부여 | `sdoc.assignIds`, `sdoc.syncRefs` 자동 처리 |
| 배포 | 파일 복사만으로 적용 | 서버 설치 필요 |
| 런타임 의존성 | 없음 | MCP 서버 프로세스 필요 |

**결론: 두 접근법은 보완 관계입니다.**
- Instructions는 AI가 `.sdoc` 포맷을 *이해*하게 합니다 → 항상 필요
- MCP Server는 AI가 복잡한 작업을 *실행*할 수 있게 합니다 → 고급 기능에 필요

---

## MCP Server — 포함되어야 할 기능 (Tools)

### 핵심 도구 (Phase 1)

| Tool | 설명 | 재사용 가능한 기존 코드 |
|---|---|---|
| `sdoc.validate` | .sdoc 파일을 `sdoc.schema.json` 기준으로 검증, 오류 목록 반환 | `sdoc.schema.json` + ajv |
| `sdoc.create` | 메타데이터(title, author)를 받아 올바른 envelope을 가진 새 .sdoc 생성 | `SdocEditorProvider`의 envelope 로직 |
| `sdoc.export` | .sdoc → HTML / Markdown / AsciiDoc 변환 | `shared/converter/` 그대로 재사용 |
| `sdoc.import` | Markdown 텍스트 → .sdoc JSON doc tree 변환 | `shared/converter/markdownToJson` |
| `sdoc.getSchema` | 현재 sdoc 스키마 정의를 반환 (AI가 동적으로 참조) | `sdoc.schema.json` |

### 문서 처리 도구 (Phase 2)

| Tool | 설명 | 재사용 가능한 기존 코드 |
|---|---|---|
| `sdoc.assignIds` | heading/image/table에 auto-ID 부여 | `SdocEditorProvider.assignAutoIds()` |
| `sdoc.syncRefs` | 교차참조 링크 텍스트를 현재 번호에 맞게 동기화 | `SdocEditorProvider.syncCrossReferences()` |
| `sdoc.migrate` | 레거시 속성명 마이그레이션 (`data-*` → clean name) | `SdocEditorProvider.migrateAttributes()` |
| `sdoc.query` | 문서 구조 요약 반환 (heading 목록, figure/table 목록, 교차참조 맵) | 신규 개발 |

### 리소스 (Resources, 읽기 전용 컨텍스트)

| Resource | 설명 |
|---|---|
| `sdoc://schema` | 현재 sdoc.schema.json 전체 |
| `sdoc://settings` | 현재 VS Code 에디터 설정 (captionPrefix, numbering 등) |

---

## VS Code Extension 내장 여부

**내장을 권장합니다.** 이유:

1. **코드 재사용**: `shared/converter/`, `SdocEditorProvider`의 `assignAutoIds()`, `syncCrossReferences()`, `migrateAttributes()` 를 직접 호출 가능
2. **설정 접근**: `vscode.workspace.getConfiguration('structuredDocEditor')` 로 사용자 설정을 바로 읽을 수 있음
3. **배포 단순화**: `.vsix`에 포함되어 별도 설치 불필요
4. **VS Code MCP 지원**: VS Code가 extension 내장 MCP server를 네이티브로 지원 (`package.json`의 `"contributes.mcp"`)

단, Tauri 데스크톱 앱에서도 사용하려면 **`shared/` 폴더에 MCP 핵심 로직(tool handler)을 배치**하고, VS Code Extension과 standalone CLI 양쪽에서 래핑하는 구조가 좋습니다.

---

## 구현 계획

### Phase 1: 기반 구축 + 핵심 도구

```
Step 1. shared/mcp/ 폴더에 tool handler 로직 구현
        - validateSdoc(json) → ValidationResult
        - createSdoc(meta) → SdocDocument
        - exportSdoc(json, format) → string
        - importMarkdown(md) → SdocDocument
        - getSchema() → JSON schema

Step 2. src/mcp/ 에 VS Code MCP server 래퍼 구현
        - @modelcontextprotocol/sdk 사용
        - package.json "contributes.mcp" 등록

Step 3. 기존 shared/converter/ 함수들을 tool handler에서 호출
        - 추가 의존성: ajv (JSON schema validation)

Step 4. 테스트 및 검증
```

### Phase 2: 고급 도구 + 리소스

```
Step 5. assignAutoIds, syncCrossReferences를 shared/로 추출
        (현재 SdocEditorProvider에 static method로 존재)

Step 6. sdoc.query tool 개발 (문서 구조 분석기)

Step 7. Resource endpoint 구현 (schema, settings)
```

### Phase 3: Tauri 지원 (선택)

```
Step 8. shared/mcp/를 standalone MCP server로도 실행 가능하게 CLI wrapper 추가
        → Tauri 앱이나 Claude Desktop 등에서 활용
```

---

## 파일 구조 (예상)

```
shared/
├── converter/          ← 기존 (export/import 로직)
└── mcp/
    ├── tools/
    │   ├── validate.ts
    │   ├── create.ts
    │   ├── export.ts
    │   ├── import.ts
    │   ├── assignIds.ts
    │   ├── syncRefs.ts
    │   └── query.ts
    ├── resources/
    │   └── schema.ts
    └── index.ts         ← tool/resource 등록부

src/
└── mcp/
    └── mcpServer.ts     ← VS Code MCP server 래퍼
```