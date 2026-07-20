# ADR 0001: Retire the repository-local AI task database

- Status: Accepted
- Date: 2026-07-20

## Context

The repository accumulated an `.ai` directory containing status lists, task files, and an append-only decision log. Completed work was represented both there and in Git, the status file contained duplicated sections, and agent instructions required every session to load the full history.

## Decision

Use the issue tracker for planned work, Git history and the changelog for completed work, and focused ADRs for decisions that remain architecturally relevant. Keep `AGENTS.md` limited to current, verifiable repository guidance.

## Consequences

Historical ATS data remains recoverable from Git. Agents receive less stale context, and decisions can explicitly supersede earlier decisions instead of being treated as immutable.
