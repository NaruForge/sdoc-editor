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
description: "Use when managing tasks, checking project status, creating tasks, updating progress, or working with .ai/ directory files. Covers ATS (AI Task Standard) workflow including STATUS.md, decisions.md, and task lifecycle."
---

# AI Task Standard (ATS) — Agent Instructions

This project uses **AI Task Standard (ATS) v0.1** for task management.

> **IMPORTANT — Language rule**: Always communicate with the user in **Korean (한국어)**. All file contents (code, markdown, config) should follow the project's existing language conventions.

## On Session Start

1. Read `.ai/STATUS.md` to understand the current project state.
2. If a task related to the current work exists in `.ai/tasks/`, refer to its **Context**, **Approach**, and **Progress** sections.
3. Check `.ai/decisions.md` for related decision history. Do NOT reverse decisions made in previous sessions.

## During Work

- Record major design decisions in `.ai/decisions.md` (Date, Task, Agent/Author, Decision, Rationale).
- Update the task's **Progress** section (check completed items).

## On Work Completion

1. Update the task file's frontmatter `status` and `modified` fields.
2. Update `.ai/STATUS.md` to reflect the current state.
3. Check off completed items in the task's **Progress** section.

## STATUS.md Format

Always include a link to the task file when recording in STATUS.md:

```
- [PREFIX-001](tasks/PREFIX-001.md): Task title
```

## Creating New Tasks

When the user requests task creation:

1. Check the project prefix in `.ai/config.yaml`.
2. Find the highest existing number in `.ai/tasks/` and assign the next number.
3. Create the file as `.ai/tasks/{PREFIX}-{NNN}.md`.
4. Use `.ai/tasks/${PREFIX}-Template.md` as the format reference. The template file itself is NOT a task — ignore it.
5. Include at minimum these YAML frontmatter fields: `ats`, `id`, `title`, `status`, `created`, `modified`, `author`.
6. Fill in **Context** and **Scope** sections based on the user's description.
7. Add the new task to `.ai/STATUS.md`.
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
## Language

- Always communicate with the user in **Korean (한국어)**.
- Code comments, commit messages, and technical identifiers may use English.

## AI Task Tracking (ATS)

This project uses AI Task Standard (ATS) for task management.

- On every session start, read `.ai/STATUS.md` to understand the current project state.
- Before starting work, check `.ai/decisions.md` for prior decisions. Do NOT reverse them.
- When completing work, update the task status, progress, and `.ai/STATUS.md`.
- See `.github/instructions/ai-tasks.instructions.md` for the full ATS workflow.
EOF
  echo -e "  ${GREEN}CREATE${NC} ${COPILOT_FILE}"
  CREATED=$((CREATED + 1))
elif ! grep -q "AI Task" "$COPILOT_FILE"; then
  cat >> "$COPILOT_FILE" << 'EOF'

## Language

- Always communicate with the user in **Korean (한국어)**.
- Code comments, commit messages, and technical identifiers may use English.

## AI Task Tracking (ATS)

This project uses AI Task Standard (ATS) for task management.

- On every session start, read `.ai/STATUS.md` to understand the current project state.
- Before starting work, check `.ai/decisions.md` for prior decisions. Do NOT reverse them.
- When completing work, update the task status, progress, and `.ai/STATUS.md`.
- See `.github/instructions/ai-tasks.instructions.md` for the full ATS workflow.
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
