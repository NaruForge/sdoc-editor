# ADR 0011: Use opt-in host rendering for non-Mermaid diagrams

## Status

Accepted

## Context

Structured documents preserve diagram language and source. Mermaid is rendered
locally, but PlantUML, D2, and Graphviz require a renderer that is not bundled
with either host. Rendering those languages in a webview would give document
content direct network access, make export behavior host-dependent, and expose
the application to endpoint and response attacks.

Kroki supports plain-text `POST /<language>/png`, but its public service has no
product SLA. Sending a diagram to any Kroki endpoint discloses that diagram
source to the operator. The persisted `.sdoc` contract must remain portable and
must not contain a machine's renderer endpoint or trust decision.

## Decision

- Mermaid remains local. New diagrams default to Mermaid.
- PlantUML, D2, and Graphviz may be rendered through a host-owned Kroki client.
- External rendering is global and defaults to Off. The default endpoint is
  `https://kroki.io`. Enabling it requires UI copy that states diagram source is
  sent to the configured server.
- VS Code reads the setting only from User or Remote User scope and ignores
  workspace-folder overrides. Tauri stores it in global `AppSettings`.
- Renderer settings never enter `.sdoc`, `DocumentSettings`, converter input
  defaults, telemetry, or disk caches.
- Webviews never perform Kroki requests. VS Code's extension host and a Tauri
  Rust command are the only network boundaries.
- A request is limited to 100 KiB UTF-8 source. A response is limited to 2 MiB,
  must be `image/png`, must have the PNG signature and a valid IHDR, must not
  exceed 8192 pixels in either dimension or 32 Mi pixels total, and must arrive
  within 10 seconds. Connection tests use 3 seconds.
- Redirects, credentials, URL query strings, URL fragments, and custom headers
  are rejected. Non-loopback endpoints require HTTPS. Explicit localhost
  endpoints may use HTTP.
- DNS results and the connected address are validated. Link-local, metadata,
  multicast, unspecified, and reserved addresses are always blocked. Private
  network addresses require the separate `allowPrivateNetwork` opt-in and still
  require HTTPS.
- At most two Kroki requests run concurrently. Successful PNGs use a bounded
  process-memory LRU keyed by endpoint, language, and a source digest. Source
  and images are not written to disk.
- A shared `DiagramRenderCoordinator` owns debounce, generation, cancellation,
  and stale-result suppression for previews.
- Preview state and editability are independent. An unknown language or failed
  renderer remains editable and is shown as source-only.
- Converters remain synchronous and network-free. Hosts may pre-render
  non-Mermaid diagrams before HTML/PDF/Slides conversion and pass prepared PNG
  assets. Without a PNG, converters emit an escaped source-only
  `<figure><pre><code>` fallback that preserves the language. Only Mermaid may
  receive `class="mermaid"`.
- A partial diagram fallback does not fail the entire export. The Files workflow
  reports `succeeded: fallback` and summarizes warnings.
- Markdown and AsciiDoc preserve their existing source round-trip behavior.

## Consequences

Documents remain portable and safe to open while external rendering is Off.
Public Kroki outages degrade previews and exports to source-only output rather
than becoming product outages. Host implementations carry a larger security
and cancellation surface, and `.sdocbook` export must share the same pre-render
service instead of bypassing it.

Tauri currently has no Slides export. The shared Slides converter and VS Code
export path follow this policy; adding Tauri Slides later must reuse the same
host renderer rather than introduce frontend networking.
