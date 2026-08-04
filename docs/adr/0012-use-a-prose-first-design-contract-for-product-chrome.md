# ADR 0012: Use a prose-first design contract for product chrome

## Status

Accepted

## Context

Structured Doc Editor shares editor components across VS Code and Tauri, but
design intent and runtime ownership have not had one explicit contract. Visual
values currently live in shared CSS, host theme mappings, component styles, and
TypeScript constants. Copying those values into a new token file before their
ownership is consolidated would create another source of truth and increase
drift.

Application chrome and persisted document appearance also have different
lifecycles. Chrome adapts to the current host and theme. Heading colors,
numbering, captions, and export appearance stored in `.sdoc` must retain the
same meaning across hosts.

Google's DESIGN.md format can connect machine-checkable structure with design
rationale, but the format is alpha and cannot by itself validate dynamic host
themes, responsive behavior, accessibility, or cross-host parity.

## Decision

- Root [DESIGN.md](../../DESIGN.md) is the source of design intent for product
  chrome and common UI. It documents principles, semantic theme roles,
  navigation and panel behavior, accessibility, responsive behavior, source
  ownership, and intentional host differences.
- Persisted document appearance remains governed by
  [the document schema](../../sdoc.schema.json),
  [TypeScript document types](../../shared/types.ts), and
  [settings resolution](../../shared/settingsResolver.ts), not by the chrome
  design contract.
- Runtime behavior and concrete values remain in shared components,
  [shared CSS](../../shared/editor/styles/editor.css), and shared constants such
  as [Side Panel sizing](../../shared/editor/sidePanelWidth.ts).
- VS Code consumes its semantic runtime theme variables. Tauri maps native
  light and dark palettes to the same semantic roles in
  [its theme stylesheet](../../tauri-app/src/styles/tauri-theme.css).
- Host CSS may define theme mappings and shell-only behavior. Common component
  structure and geometry belong in `shared/editor/` and must not be independently
  overridden by a host.
- The initial DESIGN.md frontmatter contains only format metadata. It does not
  duplicate fixed colors or dimensions, and it does not generate a
  `design-tokens.css` file.
- Stable values may be promoted to shared runtime tokens later only after a
  single implementation owner and cross-host behavior are verified.
- `@google/design.md` is pinned to an exact version. Its lint validates the
  alpha document format; a repository check separately validates DESIGN.md's
  relative links. Neither check is evidence of runtime visual consistency.
- UI verification covers VS Code and Tauri, light and dark themes, relevant
  responsive widths, and accessibility behavior.

## Consequences

Design intent is reviewable beside code without creating a competing runtime
token system. Contributors can trace each rule to the implementation that owns
it, and persisted document appearance stays portable.

The contract remains partly qualitative. Changes to CSS or constants can still
drift from its intent, so UI work requires host, theme, responsive, and
accessibility verification in addition to lint. Consolidating duplicated CSS,
style import order, and responsive constants remains follow-up implementation
work; once that work establishes stable ownership, selected values can become
shared runtime tokens without changing this boundary.
