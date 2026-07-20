---
name: orchestrate-sdoc-work
description: Coordinate bounded multi-agent work for Structured Doc Editor across the VS Code host, Tauri host, shared core, tests, and documentation. Use when a task explicitly requests subagents, delegation, parallel work, Grok or agy review, or when a complex change has at least two independent exploration, implementation, verification, or review workstreams.
---

# Orchestrate SDOC Work

Keep the main agent focused on requirements, decisions, integration, and final
verification. Delegate only bounded work that can proceed independently.

## Workflow

1. Read `AGENTS.md`, `docs/architecture.md`, applicable nested instructions,
   and `git status` before dividing work. Preserve unrelated changes.
2. Keep the task in the main agent when it is a small edit, single-cause
   diagnosis, or tightly coupled change. Delegate only when two or more streams
   can return useful results independently.
3. Write a short task map. For every delegated stream define its goal, allowed
   files, read/write mode, constraints, evidence to return, and completion test.
4. Prefer parallel exploration, architecture review, test analysis, and diff
   review. Partition implementation by non-overlapping files or execute it
   sequentially.
5. Wait for required results, verify claims against the repository, resolve
   conflicts, and integrate centrally. Never accept a worker summary as proof
   when source or test evidence is available.
6. Run the applicable commands from `AGENTS.md`, inspect the final diff, and
   report completed work, verification, and residual risk.

## Native agent roles

- Use the built-in `explorer` for read-heavy codebase discovery.
- Use `sdoc-architect` for cross-host boundaries, migrations, and ADR-level
  choices.
- Use the built-in `worker` for a clearly bounded implementation slice.
- Use `sdoc-verifier` to run and interpret checks without repairing failures.
- Use `sdoc-reviewer` after integration for an independent regression review.

Use no more agents than there are genuinely independent streams. Keep one
thread available for the main agent and avoid recursive delegation.

## External advisors

Use Grok or agy only when the user explicitly asks for an external model or
cross-model validation. Read `references/external-advisors.md` before invoking
either CLI. Run `scripts/invoke-advisor.ps1` so external work remains
non-interactive and advisory by default.

Do not send secrets, credentials, unrelated source, or uncommitted proprietary
content beyond what the task requires. Do not let an external advisor modify
the working tree. Verify every adopted claim locally.

## Delegation contract

Ask every agent to return:

- conclusion and confidence;
- evidence with file and line references;
- files read or changed;
- commands and test outcomes;
- unresolved risks or assumptions;
- the smallest useful next action.

If an agent cannot satisfy the contract, treat its result as incomplete and
continue with direct inspection or a narrower follow-up.
