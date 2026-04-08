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
