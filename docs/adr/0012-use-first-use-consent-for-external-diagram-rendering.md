# ADR 0012: Use first-use consent for external diagram rendering

## Status

Accepted

## Context

ADR 0011 made PlantUML, D2, and Graphviz rendering an opt-in global setting.
That boundary prevents silent disclosure of diagram source, but users must
discover an implementation-specific Kroki switch before they can preview a
supported text diagram. The `Diagram (Mermaid)` entry label also hides the
other supported languages.

The product needs to make text-diagram support discoverable without treating a
document open, passive preview, or persisted document content as permission to
send source to an external service.

## Decision

- The user-facing feature is named `Text Diagram` / `텍스트 다이어그램`.
- Mermaid remains local and never requires external-rendering consent.
- PlantUML, D2, and Graphviz use the existing host-owned Kroki boundary only
  after the host has persisted an affirmative global consent decision.
- Consent has three states: `undecided`, `granted`, and `declined`. It is global
  application state and never enters `.sdoc`, `DocumentSettings`, converter
  input, telemetry, or document metadata.
- Passive document opening never prompts and never transmits source. Existing
  non-Mermaid nodes remain source-only until the user explicitly edits them or
  requests online preview.
- First explicit editing, preview, connection testing, or export use presents
  an inline disclosure with the exact endpoint. It states that the full source
  is sent to that server, that the decision is global, and that Mermaid remains
  local.
- `granted` and `declined` decisions are persisted. Closing or cancelling the
  disclosure leaves the decision `undecided`.
- A consent mutation carries no diagram source. The editor waits for the
  authoritative host acknowledgement before sending a render request.
- Live preview, export preparation, and connection testing each enforce consent
  again at the host boundary. A missing or revoked grant produces a source-only
  fallback rather than network access.
- Legacy `enabled: true` migrates to `granted`. Legacy `false` or a missing
  value migrates to `undecided`, so the next explicit use receives one clear
  decision point without any automatic transmission.

This supersedes ADR 0011 only where it specifies settings-discovery opt-in and
a default-Off boolean. ADR 0011's host ownership, endpoint validation, request
and response limits, cancellation, memory-only caching, network-free
converters, and source-only fallback remain in force.

## Consequences

Users can discover every supported text-diagram language in the insertion
workflow without learning Kroki terminology first. Privacy remains predictable
because a persisted affirmative decision precedes every external request.

Both hosts must maintain a compatible global-consent migration and correlated
acknowledgement. Export workflows can pause for the same disclosure; accepting
continues with prepared images, while declining continues with source-only
output.
