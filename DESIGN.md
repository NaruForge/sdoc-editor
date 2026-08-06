---
version: "alpha"
name: Structured Doc Editor Product Chrome
description: Design intent and implementation boundaries for shared application UI.
---

## Overview

Structured Doc Editor is one focused document editor presented through VS Code.
Product chrome should feel native to VS Code while keeping a stable information
architecture, interaction model, and content priority. The document is the
primary surface; navigation and controls should support the writing task
without competing with it.

This contract covers application chrome and shared UI: the Activity rail,
contextual panel, toolbar, dialogs, menus, settings controls, and editor shell.
It does not define the appearance persisted in a `.sdoc` document. Heading
colors, numbering, captions, export styles, and other portable document settings
belong to the [document schema](sdoc.schema.json),
[document types](shared/types.ts), and
[settings resolver](shared/settingsResolver.ts). A panel may present both
screen-only and persisted settings, but it must label and group those scopes so
the user can predict what travels with the document.

This alpha contract is prose-first. It records semantic roles and points to the
runtime sources of truth instead of copying current colors, dimensions, or
breakpoints into a second token system.

## Colors

Color is adaptive and semantic. Shared UI consumes roles rather than assuming a
fixed palette:

- `surface` distinguishes editor, panel, input, menu, and elevated surfaces.
- `foreground` distinguishes primary text from descriptions and placeholders.
- `border` separates regions and controls without becoming decoration.
- `focus` makes keyboard location unambiguous.
- `selection` identifies the current item, range, or activity.
- `disabled` communicates unavailable actions without relying on opacity alone.
- `error` communicates invalid or failed states and is paired with text or an
  icon, never color alone.

VS Code provides these roles through its runtime `--vscode-*` variables.
Shared selectors consume those mapped roles in
[the shared editor stylesheet](shared/editor/styles/editor.css). This document
does not assign a permanent light or dark default; the active VS Code theme
controls the palette.

## Typography

Product chrome follows the VS Code UI typeface and scale. Labels favor short,
plain language and sentence case. Headings establish panel and dialog structure,
not a decorative editorial hierarchy. Monospace is reserved for source,
code-like values, and other content where character alignment has meaning.

Document typography is separate from chrome typography and may be controlled by
portable document settings. The VS Code theme must not silently change the persisted
or exported meaning of those settings.

## Layout

The navigation model has one Activity rail and, when a destination is open, one
contextual Side Panel. The destinations are `Navigate`, `Design`, `Templates`,
and `Publish`. VS Code owns workspace navigation. Availability differences must
be capability-driven, not a second navigation model.

Each destination has an icon and a clear text label. Do not duplicate these
destinations elsewhere as a competing primary navigation. The visible hierarchy
is limited to two levels: destination and its task-oriented panel content. Tabs,
sections, disclosure groups, or tree content within a panel must not create a
third persistent navigation tier.

The Side Panel can be dismissed and resized when docked. At narrow viewport
widths it becomes an overlay so the document remains usable; the runtime
breakpoint, width bounds, persistence, and keyboard resizing behavior belong to
[the responsive panel](shared/editor/components/ResponsiveSidePanel.tsx) and
[its shared width constants](shared/editor/sidePanelWidth.ts). `Design` is one
scrolling, task-oriented panel. Screen-only view preferences and persisted
document settings remain visibly grouped and explained within it.

Reusable structure and geometry live in `shared/editor/`. The VS Code webview
may arrange host-owned regions around that editor, but it must not redefine
common component geometry. The current implementation ownership is:

| Design area | Runtime source of truth | VS Code integration |
| --- | --- | --- |
| Destinations and selection state | [Activity state](shared/editor/activityState.ts) and [Activity rail](shared/editor/components/ActivityBar.tsx) | Capabilities may hide unavailable destinations. |
| Panel responsiveness and resizing | [Responsive Side Panel](shared/editor/components/ResponsiveSidePanel.tsx) and [width constants](shared/editor/sidePanelWidth.ts) | The webview supplies viewport and persistence integration. |
| Common component structure and geometry | [Shared editor components](shared/editor/components/) and [shared editor CSS](shared/editor/styles/editor.css) | Webview composition supplies data and typed adapters. |
| VS Code composition and theme | [VS Code editor shell](webview-ui/src/components/Editor.tsx), [VS Code panel composition](webview-ui/src/components/SidePanel.tsx), and [style entry point](webview-ui/src/main.tsx) | VS Code supplies its live theme variables and owns workspace navigation. |
| Persisted document appearance | [Document schema](sdoc.schema.json), [document types](shared/types.ts), and [settings resolution](shared/settingsResolver.ts) | Host chrome must not change persisted meaning. |

## Elevation & Depth

Depth communicates transient layering, not brand styling. Docked panels belong
to the shell plane. Overlay panels, menus, and dialogs may rise above it with a
clear boundary and scrim where needed. Keep the number of simultaneous layers
low, and ensure the active layer is obvious in both themes and high-contrast
conditions.

## Shapes

Shapes follow a restrained, tool-like language. Borders, corners, and control
silhouettes should clarify grouping and affordance. Reuse the existing shared
component treatment; promote a value to a shared runtime token only after its
ownership and reuse have been verified. Decorative variation must not
make equivalent controls look unrelated.

## Components

Interactive components expose a visible label or an accessible name, use native
semantics where practical, and show hover, active, focus, disabled, and error
states as applicable. Icon-only controls need a localized accessible name and a
discoverable tooltip. Focus indicators must remain visible against adjacent
surfaces in every supported theme.

Opening an overlay Side Panel moves focus into it; `Escape`, its close action,
or its scrim dismisses it and restores focus to the invoking Activity item.
Keyboard users can resize a docked panel through its separator. Dialogs trap
focus while modal, restore focus on close, and do not make background content
operable. Motion respects reduced-motion preferences and never carries the only
signal that state changed.

Responsive changes preserve task order, labels, selection, and unsaved input.
Controls must remain reachable without horizontal page scrolling, and touch or
pointer targets must not overlap. UI changes are verified in VS Code in light,
dark, and high-contrast themes at docked and overlay widths. Verification also
includes keyboard operation, focus order and restoration, accessible names,
contrast, zoom or text scaling, and reduced motion when the change uses motion.

## Do's and Don'ts

Do:

- Read this contract before changing shared or host UI.
- Put reusable behavior, structure, geometry, and stable constants in
  `shared/editor/` and verify the VS Code composition.
- Use semantic theme roles and test the resulting state in light, dark, and high-contrast themes.
- Keep labels and grouping explicit about screen-only versus persisted settings.
- Treat `designmd lint` as format validation only; use host, accessibility, and
  visual checks as evidence of UI consistency.

Don't:

- Add a second Activity rail, duplicate primary destinations, or expose more
  than two visible navigation levels.
- Copy fixed colors, panel widths, breakpoints, spacing, control heights, or
  radii into this file while their runtime ownership is still being consolidated.
- Generate `design-tokens.css` from this alpha contract.
- Put reusable structure or geometry in webview integration CSS. Integration
  CSS is limited to VS Code theme mapping and shell-only behavior.
- Treat application chrome settings as part of `.sdoc`, or treat persisted
  document appearance as a host theme override.
