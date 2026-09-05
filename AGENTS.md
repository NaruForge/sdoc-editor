# Structured Doc Editor — Agent Guide

## Repository map

Structured Doc Editor supports two delivery surfaces: the VS Code extension
(`src/` plus `webview-ui/`) and the non-visual CLI (`cli/`). Both consume the
host-neutral TypeScript code in `shared/`. The retired Windows Desktop source
exists only in the `v0.7.8` tag and is not a build or verification target.

- `sdoc.schema.json` and `shared/types.ts`: persisted document contract
- `shared/document/`: envelope, validation, migrations, IDs, and operations
- `shared/converter/`: host-neutral import/export conversion
- `shared/book/`: host-neutral `.sdocbook` parsing and composition
- `shared/editor/`: reusable React/Tiptap editor behavior and structure
- `src/`: VS Code Extension Host integration and host I/O
- `webview-ui/`: VS Code webview adapters and composition
- `cli/src/` and `cli/README.md`: CLI filesystem boundary and public command,
  output, and exit-code contract
- `DESIGN.md`: prose-first UI intent and runtime ownership
- `docs/architecture.md`: current architecture and dependency direction
- `docs/adr/`: durable decisions; later ADRs may supersede earlier ones
- `CONTRIBUTING.md#verification-contract`: authoritative verification commands

## Global invariants

1. Preserve unrelated working-tree changes and never edit generated artifacts
   directly. For `sdoc.schema.json` changes, regenerate the tracked validators
   in `shared/document/generated/` with `npm run validators:generate`, then run
   `npm run validators:check`.
2. Parse external JSON as `unknown` and validate or narrow it at the boundary.
3. Add behavior tests before changing persisted schema, migrations, IDs,
   cross-references, or converters; update schema, examples, and converters
   together when persisted semantics change.
4. Keep host capabilities behind typed adapters. Host-neutral code must not
   import VS Code, Node host APIs, or delivery-surface modules; CI enforces
   those direct import boundaries.
5. Keep reusable editor behavior and geometry in `shared/editor/`; keep VS Code
   integration in `src/` or `webview-ui/`. Read `DESIGN.md` before UI changes.
6. Keep `.sdocbook` file loading behind `BookDocumentLoader`; composition must
   consume the injected loader.
7. Use GitHub Issues for planned material work and Git history for completed
   work. Do not create a repository-local task database.
8. Never put vulnerabilities, credentials, personal/customer data, or sensitive
   logs in public issues; use `SECURITY.md`.

## Workflow pointers

- Run `npm ci` once, use `npm run verify:fast` while iterating, and run
  `npm run verify:all` before completing a material change. The command contract
  and targeted variants live in `CONTRIBUTING.md#verification-contract`.
- When CLI commands, JSON responses, or semantic read/operation contracts change,
  keep the affected [public schemas and manual](cli/README.md#public-schemas-and-operation-contract),
  operation examples in `examples/operations/`, and matching tests in `cli/tests/`
  and `tests/operations-schema.test.ts` in sync with the owning implementation.
- For issue creation or mutation, follow `.github/AI_ISSUE_REPORTING.md`; record
  confirmed causes, alternatives, strategy, decisions, and final verification
  on the implementation issue.
- 이 저장소에 연결된 `sdoc-editor` GitHub Project를 사용한다. 실제 구현을 시작할 때
  해당 이슈를 이 프로젝트에 추가하고 Status를 `In Progress`로 변경한다.
- Contributor, packaging, and maintainer release procedures live in
  `CONTRIBUTING.md` rather than this always-loaded map.
