# MCP Config Path Migration (.vscode → .github) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copilot CLI가 `.vscode/mcp.json` 지원을 제거함에 따라, MCP 설정 파일 생성 경로를 `.github/mcp.json`으로 변경하고 기존 사용자의 `.vscode/mcp.json`을 자동 마이그레이션한다.

**Architecture:** `src/extension.ts`의 `setupMcpInWorkspace()` 함수가 `.github/mcp.json`에 `sdoc` 서버 항목을 추가하도록 변경한다. 함수 실행 시 기존 `.vscode/mcp.json`에 `sdoc` 항목이 있으면 제거하고, 남은 항목이 없으면 파일을 삭제한다. 문서(`docs/agent/README.md`)의 경로 참조도 함께 업데이트한다.

**Tech Stack:** TypeScript, Node.js `fs` module, VS Code Extension API

---

### Task 1: `setupMcpInWorkspace()` 함수 수정

**Files:**
- Modify: `src/extension.ts:108-130`

- [ ] **Step 1: 마이그레이션 헬퍼 함수 추가**

`setupMcpInWorkspace()` 함수 바로 위에 다음 함수를 추가한다:

```typescript
function migrateVscodeMcpJson(workspaceFsPath: string): void {
  const vscodeMcpPath = path.join(workspaceFsPath, '.vscode', 'mcp.json');
  if (!fs.existsSync(vscodeMcpPath)) return;

  try {
    const content = fs.readFileSync(vscodeMcpPath, 'utf-8');
    const config = JSON.parse(content) as { servers?: Record<string, unknown> };
    if (!config.servers?.['sdoc']) return;

    delete config.servers['sdoc'];

    if (Object.keys(config.servers).length === 0) {
      fs.rmSync(vscodeMcpPath);
    } else {
      fs.writeFileSync(vscodeMcpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }
  } catch {
    // intentionally ignored: malformed or unreadable .vscode/mcp.json
  }
}
```

- [ ] **Step 2: `setupMcpInWorkspace()` 함수 본체 변경**

기존 함수를 아래 코드로 교체한다:

```typescript
function setupMcpInWorkspace(context: vscode.ExtensionContext, workspaceFsPath: string): void {
  const mcpServerPath = path.join(context.extensionPath, 'dist', 'mcp-server.js');
  const githubDir = path.join(workspaceFsPath, '.github');
  const mcpJsonPath = path.join(githubDir, 'mcp.json');

  migrateVscodeMcpJson(workspaceFsPath);

  let config: { servers: Record<string, unknown> } = { servers: {} };
  try {
    const existing = fs.readFileSync(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(existing);
    config = { servers: {}, ...parsed };
  } catch {
    // File doesn't exist — use default
  }

  config.servers['sdoc'] = {
    type: 'stdio',
    command: 'node',
    args: [mcpServerPath],
  };

  fs.mkdirSync(githubDir, { recursive: true });
  fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
```

- [ ] **Step 3: 빌드 확인**

```bash
npm run build:ext 2>&1 | tail -20
```

Expected: 오류 없이 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add src/extension.ts
git commit -m "fix: migrate MCP config from .vscode/mcp.json to .github/mcp.json

Copilot CLI removed support for .vscode/mcp.json.
- setupMcpInWorkspace() now writes to .github/mcp.json
- Auto-migrates existing .vscode/mcp.json: removes sdoc entry,
  deletes file if it becomes empty

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: `docs/agent/README.md` 문서 경로 업데이트

**Files:**
- Modify: `docs/agent/README.md` (3곳)

- [ ] **Step 1: 첫 번째 참조 변경 (표 셀, 11번째 줄)**

변경 전:
```
| MCP Server | 검증/변환/처리 **도구** 제공 | `.vscode/mcp.json` 등록 후 자동 |
```

변경 후:
```
| MCP Server | 검증/변환/처리 **도구** 제공 | `.github/mcp.json` 등록 후 자동 |
```

- [ ] **Step 2: 두 번째 참조 변경 (자동 설치 설명, 25번째 줄)**

변경 전:
```
Instructions/Skills 파일이 프로젝트 `.github/`에 복사되고, `.vscode/mcp.json`이 자동 생성됩니다.
```

변경 후:
```
Instructions/Skills 파일이 프로젝트 `.github/`에 복사되고, `.github/mcp.json`이 자동 생성됩니다.
```

- [ ] **Step 3: 세 번째 참조 변경 (디렉토리 구조도, 43번째 줄)**

변경 전:
```
├── .vscode/
│   └── mcp.json                           ← MCP 서버 설정 (아래 참조)
```

변경 후 (`.vscode/` 섹션 제거, `.github/` 섹션에 `mcp.json` 추가):
```
├── .github/
│   ├── instructions/
│   │   └── sdoc-format.instructions.md   ← .sdoc/.tiptap.json 파일 작업 시 자동 로드
│   ├── skills/
│   │   └── sdoc-editing/
│   │       ├── SKILL.md                   ← /sdoc-editing 슬래시 커맨드
│   │       └── references/
│   │           ├── new-document-template.md
│   │           └── examples.md
│   └── mcp.json                           ← MCP 서버 설정 (아래 참조)
```

- [ ] **Step 4: 수동 설치 안내 문구 변경 (84번째 줄)**

변경 전:
```
수동으로 설정하려면 `.vscode/mcp.json`에 다음을 추가:
```

변경 후:
```
수동으로 설정하려면 `.github/mcp.json`에 다음을 추가:
```

- [ ] **Step 5: 커밋**

```bash
git add docs/agent/README.md
git commit -m "docs: update MCP config path to .github/mcp.json

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: 수동 검증

- [ ] **Step 1: 전체 빌드 확인**

```bash
npm run build 2>&1 | tail -20
```

Expected: 오류 없이 빌드 성공

- [ ] **Step 2: lint 확인**

```bash
npm run lint 2>&1 | tail -20
```

Expected: 오류 없음

- [ ] **Step 3: 변경 내용 최종 확인**

```bash
git --no-pager diff HEAD~2 -- src/extension.ts docs/agent/README.md
```

Expected:
- `src/extension.ts`: `.vscode` → `.github`, `migrateVscodeMcpJson` 함수 추가
- `docs/agent/README.md`: 경로 참조 4곳 변경
