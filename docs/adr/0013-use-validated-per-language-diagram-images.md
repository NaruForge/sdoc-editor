# ADR 0013: Use validated per-language diagram images

## Status

Accepted

## Context

ADR 0011 required every external diagram renderer response to be PNG. Kroki's
D2 renderer supports SVG output rather than PNG, so the shared PNG-only request
path cannot render valid D2 source. ADR 0020 also requires passive document
opening to remain network-free while allowing rendering after an explicit user
edit or preview request.

## Decision

- Host adapters choose a fixed output format by supported language: D2 uses
  SVG, while PlantUML and Graphviz continue to use PNG.
- SVG responses must be exact `image/svg+xml`, valid UTF-8, bounded to the same
  2 MiB response, 8192-pixel dimension, and 32 Mi-pixel limits as PNG, and must
  have usable root dimensions or a `viewBox`.
- Hosts reject document types, entities, scripts, active embedded elements,
  event attributes, external references, CSS imports, and other active SVG
  content. Internal fragment references and embedded base64 fonts used by D2
  remain allowed.
- Validated SVG is transported as a base64 `data:image/svg+xml` URL and is used
  only as an image source. Remote SVG markup is never injected into the DOM.
- Prepared HTML, PDF, and Slides exports accept validated PNG or SVG image data
  while retaining the escaped source fallback.
- An explicit insertion intent is held only in shared editor runtime storage.
  It is consumed once by the newly created NodeView and never enters `.sdoc`,
  document settings, metadata, or host persistence.

This supersedes ADR 0011 only where it mandates PNG for every external
language. Its consent, host ownership, endpoint validation, request limits,
cancellation, memory-only caching, and source-only fallback decisions remain in
force. ADR 0020's passive-open and authoritative-consent rules remain in force.

## Consequences

D2 renders through the format Kroki actually supports without weakening the
host network boundary. Both hosts must keep SVG validation behavior equivalent,
and format-specific tests must protect the request path, MIME type, safety
checks, and export transport.
