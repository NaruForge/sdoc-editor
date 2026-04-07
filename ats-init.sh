#!/usr/bin/env bash
# ATS (AI Task Standard) v0.1 — Project Initializer
# Usage:
#   Interactive:  ./ats-init.sh
#   CLI:          ./ats-init.sh -p PREFIX -n "Project Name"
#   Overwrite:    ./ats-init.sh -p PREFIX -n "Project Name" --force

set -euo pipefail

ATS_VERSION="0.1"
PREFIX=""
PROJECT_NAME=""
FORCE=false
UPGRADE=false

# ── Colors ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

usage() {
  cat << 'USAGE'
ATS (AI Task Standard) v0.1 — Project Initializer

Usage:
  ./ats-init.sh                           Interactive mode
  ./ats-init.sh -p PREFIX -n "Name"       CLI mode
  ./ats-init.sh -p PREFIX -n "Name" -f    Overwrite existing files
  ./ats-init.sh --upgrade                 Upgrade ATS tooling (data safe)

Options:
  -p, --prefix    Task ID prefix (uppercase letters/digits, e.g., PROJ)
  -n, --name      Project name
  -f, --force     Overwrite existing files
  -u, --upgrade   Update instructions/template only (STATUS.md, decisions.md preserved)
  -h, --help      Show this help
USAGE
  exit 0
}

validate_prefix() {
  if [[ ! "$1" =~ ^[A-Z][A-Z0-9]*$ ]]; then
    echo -e "${RED}Error:${NC} PREFIX must start with an uppercase letter and contain only uppercase letters/digits."
    echo "  Valid:   PROJ, SDOC, ATS01"
    echo "  Invalid: proj, -ATS, my-proj"
    return 1
  fi
}

# ── Parse arguments ───────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--prefix)
      [[ $# -lt 2 ]] && echo -e "${RED}Error: --prefix requires a value${NC}" && exit 1
      PREFIX="$2"; shift 2 ;;
    -n|--name)
      [[ $# -lt 2 ]] && echo -e "${RED}Error: --name requires a value${NC}" && exit 1
      PROJECT_NAME="$2"; shift 2 ;;
    -f|--force)  FORCE=true; shift ;;
    -u|--upgrade) UPGRADE=true; shift ;;
    -h|--help)   usage ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; echo ""; usage ;;
  esac
done

# ── Interactive / Upgrade mode ──────────────────────────────────
if [[ "$UPGRADE" == true ]]; then
  if [[ ! -f ".ai/config.yaml" ]]; then
    echo -e "${RED}Error:${NC} .ai/config.yaml not found. Run without --upgrade to initialize first."
    exit 1
  fi
  PREFIX=$(awk '/^  prefix:/ {print $2}' .ai/config.yaml)
  PROJECT_NAME=$(awk -F'"' '/^  name:/ {print $2}' .ai/config.yaml)
  echo -e "${CYAN}Upgrading ATS tooling for '${PROJECT_NAME}' (prefix: ${PREFIX})...${NC}"
  echo ""
  FORCE=true  # upgrade always overwrites tooling files
elif [[ -z "$PREFIX" || -z "$PROJECT_NAME" ]]; then
  echo -e "${BOLD}${CYAN}ATS v${ATS_VERSION} — Interactive Setup${NC}"
  echo ""

  if [[ -z "$PROJECT_NAME" ]]; then
    DEFAULT_NAME="$(basename "$PWD")"
    read -rp "Project name [${DEFAULT_NAME}]: " PROJECT_NAME
    PROJECT_NAME="${PROJECT_NAME:-$DEFAULT_NAME}"
  fi

  if [[ -z "$PREFIX" ]]; then
    while true; do
      read -rp "Task ID prefix (uppercase, e.g., PROJ): " PREFIX
      [[ -z "$PREFIX" ]] && echo -e "${RED}PREFIX is required.${NC}" && continue
      validate_prefix "$PREFIX" && break
    done
  fi
else
  validate_prefix "$PREFIX" || exit 1
fi

if [[ "$UPGRADE" != true ]]; then
  echo ""
  echo -e "${CYAN}Initializing ATS v${ATS_VERSION} for '${PROJECT_NAME}' (prefix: ${PREFIX})...${NC}"
  echo ""
fi

# ── Helper: idempotent file writer ────────────────────────
CREATED=0
SKIPPED=0

write_file() {
  local filepath="$1"

  if [[ -f "$filepath" && "$FORCE" != true ]]; then
    echo -e "  ${YELLOW}SKIP${NC}   ${filepath} (exists, use --force to overwrite)"
    cat > /dev/null
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  mkdir -p "$(dirname "$filepath")"
  cat > "$filepath"
  echo -e "  ${GREEN}CREATE${NC} ${filepath}"
  CREATED=$((CREATED + 1))
}

# ── Generate files ────────────────────────────────────────

# ---- Data files (skip during --upgrade) ----
if [[ "$UPGRADE" != true ]]; then

# .ai/tasks/
if [[ ! -d ".ai/tasks" ]]; then
  mkdir -p .ai/tasks
  echo -e "  ${GREEN}CREATE${NC} .ai/tasks/"
fi

# .ai/config.yaml
write_file ".ai/config.yaml" << EOF
ats: "${ATS_VERSION}"
project:
  prefix: ${PREFIX}
  name: "${PROJECT_NAME}"
agents:
  auto_discover: true
  update_on_complete: true
EOF

# .ai/STATUS.md
write_file ".ai/STATUS.md" << 'EOF'
# Project Status

## In Progress
_없음_

## Ready
_없음_

## Done (최근)
_없음_

## Blocked
_없음_

<!-- 형식: - [PREFIX-001](tasks/PREFIX-001.md): 태스크 제목 -->
EOF

# .ai/decisions.md
write_file ".ai/decisions.md" << 'EOF'
# Decision Log

| Date | Task | Agent/Author | Decision | Rationale |
|------|------|-------------|----------|-----------|
EOF

fi # end data files

# ---- Tooling files (always update) ----

# .github/instructions/ai-tasks.instructions.md
write_file ".github/instructions/ai-tasks.instructions.md" << 'EOF'
---
applyTo: "**"
---

# AI Task Standard (ATS) — Agent Instructions

이 프로젝트는 **AI Task Standard (ATS) v0.1**을 사용하여 태스크를 관리합니다.

## 작업 시작 시

1. `.ai/STATUS.md`를 읽어 프로젝트 현재 상태를 파악하세요.
2. 현재 작업과 관련된 태스크가 `.ai/tasks/`에 있으면 해당 파일의 **Context**, **Approach**, **Progress** 섹션을 참조하세요.
3. `.ai/decisions.md`에서 관련 결정 이력을 확인하세요. 이전 세션에서 내린 결정을 번복하지 마세요.

## 작업 중

- 주요 설계 결정을 내렸으면 `.ai/decisions.md`에 기록하세요 (Date, Task, Agent/Author, Decision, Rationale).
- 태스크의 **Progress** 섹션을 업데이트하세요 (완료된 항목 체크).

## 작업 완료 시

1. 태스크 파일의 frontmatter `status`와 `modified`를 업데이트하세요.
2. `.ai/STATUS.md`를 현재 상태에 맞게 업데이트하세요.
3. 태스크의 **Progress** 섹션에서 완료 항목을 체크하세요.

## STATUS.md 작성 형식

태스크를 STATUS.md에 기록할 때 반드시 태스크 파일로의 링크를 포함하세요:

```
- [PREFIX-001](tasks/PREFIX-001.md): 태스크 제목
```

## 새 태스크 생성 시

사용자가 "태스크 만들어줘"라고 요청하면:

1. `.ai/config.yaml`에서 프로젝트 접두사를 확인하세요.
2. `.ai/tasks/`의 기존 파일에서 가장 높은 번호를 찾아 다음 번호를 부여하세요.
3. `.ai/tasks/{PREFIX}-{NNN}.md` 형식으로 생성하세요.
4. `.ai/tasks/${PREFIX}-Template.md`를 참조하여 동일한 형식으로 작성하세요. 이 템플릿 파일 자체는 태스크가 아니므로 무시하세요.
5. YAML frontmatter에 최소한 `ats`, `id`, `title`, `status`, `created`, `modified`, `author` 필드를 포함하세요.
6. 사용자가 설명한 내용으로 **Context**와 **Scope** 섹션을 작성하세요.
7. `.ai/STATUS.md`에 새 태스크를 추가하세요.
EOF

# .ai/tasks/{PREFIX}-Template.md (task creation template)
write_file ".ai/tasks/${PREFIX}-Template.md" << EOF
---
ats: "${ATS_VERSION}"
id: ${PREFIX}-NNN
title: ""
status: draft
priority: medium
created: YYYY-MM-DDTHH:MM:SS+09:00
modified: YYYY-MM-DDTHH:MM:SS+09:00
author: ""
---

# ${PREFIX}-NNN: (제목)

## Context
(이 태스크의 배경과 목적)

## Scope
### In Scope
- (구현 범위)

### Out of Scope
- (명시적 제외 항목)

## Approach
(선택한 접근법과 그 이유)

## Progress
- [ ] (할 일 항목)
EOF

# .github/copilot-instructions.md (append-safe)
COPILOT_FILE=".github/copilot-instructions.md"
mkdir -p .github

if [[ "$FORCE" == true || ! -f "$COPILOT_FILE" ]]; then
  cat > "$COPILOT_FILE" << 'EOF'
## AI Task Tracking

이 프로젝트는 AI Task Standard(ATS)를 사용합니다. `.ai/STATUS.md`를 읽고 관련 태스크를 참조하세요.
EOF
  echo -e "  ${GREEN}CREATE${NC} ${COPILOT_FILE}"
  CREATED=$((CREATED + 1))
elif ! grep -q "AI Task" "$COPILOT_FILE"; then
  cat >> "$COPILOT_FILE" << 'EOF'

## AI Task Tracking

이 프로젝트는 AI Task Standard(ATS)를 사용합니다. `.ai/STATUS.md`를 읽고 관련 태스크를 참조하세요.
EOF
  echo -e "  ${GREEN}APPEND${NC} ${COPILOT_FILE}"
  CREATED=$((CREATED + 1))
else
  echo -e "  ${YELLOW}SKIP${NC}   ${COPILOT_FILE} (ATS section already present)"
  SKIPPED=$((SKIPPED + 1))
fi

# ── Summary ───────────────────────────────────────────────
echo ""
if [[ "$UPGRADE" == true ]]; then
  echo -e "${GREEN}ATS upgraded successfully!${NC} (${CREATED} updated, ${SKIPPED} skipped)"
else
  echo -e "${GREEN}ATS initialized successfully!${NC} (${CREATED} created, ${SKIPPED} skipped)"
  echo ""
  echo -e "Next step: Create your first task"
  echo -e "  cp .ai/tasks/${PREFIX}-Template.md .ai/tasks/${PREFIX}-001.md"
fi
