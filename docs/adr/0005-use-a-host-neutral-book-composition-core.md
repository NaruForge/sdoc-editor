# ADR 0005: Use a host-neutral book composition core

- Status: Accepted
- Date: 2026-07-20

## Context

The VS Code `.sdocbook` provider previously parsed manifests, read files, rebased assets, resolved links, merged document trees, and exported output in one host-specific class. Preview, Tauri support, and stronger validation would otherwise reproduce those semantics.

## Decision

Place manifest parsing, path normalization, document composition, link handling, and diagnostics in `shared/book/`. File access is supplied through an asynchronous `BookDocumentLoader`. Consumers use the same `BookCompositionResult` for validation, preview, and export.

## Consequences

Book semantics can be tested without either host and extended to Tauri without copying logic. Host providers remain responsible for open buffers, filesystem watching, dialogs, and output destinations. The existing `.sdocbook` 1.0 persisted format remains unchanged.
