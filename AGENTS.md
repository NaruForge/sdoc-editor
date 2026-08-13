# Structured Doc Editor — Agent Guide

## Product

Structured Doc Editor edits `.sdoc` and `.tiptap.json` documents through the
VS Code extension in `src/` with the React webview in `webview-ui/`. The `cli/`
workspace provides non-visual inspection and semantic document operations.

The Windows desktop app reached end of life with v0.7.8. Its source remains
available from the `v0.7.8` tag, but it is not present on `main` and is not a
supported host, build target, or required verification surface from v0.8.0 onward.

The document model, converters, settings, and host-neutral utilities belong in
`shared/`. VS Code APIs must not enter shared modules.

## Source of truth

- `sdoc.schema.json`: persisted `.sdoc` document contract
- `shared/types.ts`: TypeScript document and settings types
- `shared/document/`: document envelope, migrations, IDs, and cross-references
- `shared/settingsResolver.ts`: defaults and settings resolution
- `shared/converter/`: all import/export conversion
- `shared/book/`: `.sdocbook` parsing, validation, and host-neutral composition
- `shared/editor/`: reusable editor UI and Tiptap code consumed by the VS Code webview
- `DESIGN.md`: product chrome design intent, runtime ownership, and UI verification contract
- `docs/architecture.md`: current architecture
- `docs/adr/`: durable architectural decisions; newer ADRs may supersede older ones

Do not create a repository-local task database. Use the issue tracker for planned work and Git history for completed work.

## Required commands

Run from the repository root:

```powershell
npm ci
npm run check
npm run build:all
```

## Change rules

1. Preserve unrelated working-tree changes.
2. Add behavior tests before changing migration, ID assignment, cross-references, or converters.
3. Add reusable editor behavior to `shared/editor/`; keep VS Code integration in `src/` or `webview-ui/`.
4. Keep extension-host and webview differences behind typed adapters or host-level components.
5. Parse external JSON as `unknown` and validate or narrow it at the boundary.
6. Do not add new `any`, untyped `window` globals, synchronous extension-host I/O, or copied defaults.
7. Update schemas, examples, tests, and converters when the persisted document format changes.
8. Keep user documentation in `README.md`, contributor workflow in `CONTRIBUTING.md`, and implementation detail in `docs/`.
9. Keep `.sdocbook` loading behind `BookDocumentLoader`; the composition core must not access host filesystems directly.
10. Before changing UI, read `DESIGN.md`. Keep reusable structure and geometry in `shared/editor/`, and verify affected behavior in VS Code across light, dark, and high-contrast themes, relevant responsive widths, and accessibility states.

## Packaging

- `npm run package` creates the VSIX in `output/`.
- `npm run package:cli` creates the installable CLI `.tgz` in `output/`.
- Versions are synchronized by `npm run version:check`.
- A matching `v*` tag publishes the VS Code extension through
  `.github/workflows/release-vscode.yml` and attaches the CLI package through
  `.github/workflows/release-cli.yml`.

## GitHub issue workflow

- GitHub Issues are the public source of truth for bugs, features, UX changes, architectural improvements, and technical debt.
- Create or identify an issue before starting material implementation work.
- Record confirmed root causes, considered alternatives, implementation strategy, and important design decisions as issue comments.
- Link commits and pull requests to the issue. Use `Fixes #<number>` only when the change fully resolves the issue.
- Before closing an issue, comment with the implemented scope, verification results, and any remaining follow-up work.
- Do not use private local notes as the sole record of a development decision.
- Keep the Issue Form's type label and apply `area: cli` and `area: vscode` according to the affected delivery surfaces defined in `.github/AI_ISSUE_REPORTING.md`.
- Trivial typo fixes, mechanical release or version operations, and routine dependency maintenance may proceed without a dedicated issue when no product decision is involved.
- Never disclose vulnerabilities, credentials, personal information, customer data, or sensitive logs in public issues. Use GitHub Security Advisories or another appropriate private channel.
