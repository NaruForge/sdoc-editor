# ADR 0022: Use an editor-scoped code language listbox

## Status

Accepted

## Context

Large rich documents may contain hundreds of code blocks. Giving every block a
React NodeView and a complete language option list creates one React root and
roughly 194 option nodes per block. Earlier attempts to materialize those
options inside a focused native select also disturbed focus and ProseMirror
selection reconciliation.

The code text must remain owned by ProseMirror, arbitrary persisted language
strings must round-trip unchanged, and language changes must retain native Undo
and Redo behavior.

## Decision

Each code block owns only a permanent lightweight button trigger and a permanent
`pre > code` `contentDOM`. One ref-counted controller per editor/view owns one
native `select[size]` popup outside ProseMirror's `contentDOM`. The popup is
created once, populated only while open, and re-anchored with clamped viewport
geometry on scroll or resize.

The trigger opens from pointer activation, Enter, Space, or Alt+Down; focus alone
does not open it. Native select behavior owns Arrow, Home, End, typeahead, and
selected-option semantics. Enter commits, Escape cancels, and both return focus
to the trigger. Pointer option selection commits on pointer release; keyboard
navigation alone never commits. Tab or Shift+Tab cancels and returns focus to
the trigger so the next Tab proceeds naturally. Outside pointer activation
cancels without stealing its target focus. Printing closes the popup and hides
both popup and triggers.

Commit re-resolves the live position and node immediately before dispatch using
bounded DOM offsets and an exact `nodeDOM` wrapper round trip. It requires an
editable, non-composing editor, the same live wrapper/session and compatible
opening attrs, preserves all current attrs,
and changes only `language` in one `setNodeMarkup` transaction. A stale owner,
read-only editor, or unchanged value closes without a transaction. Values are
stored as typed choice data rather than sentinel strings, so null auto-detection,
the literal `"null"`, empty strings, Unicode, and unknown languages remain
distinct.

## Consequences

- Rich documents have zero React roots for code blocks and at most one language
  popup per editor, while retaining one small trigger per block.
- Imports and reloads invalidate an open session when the NodeView update sees a
  node identity change, even when position, type, and attrs still match. Deletion,
  read-only transition, owner unregistration, and ref-counted controller teardown
  likewise close stale UI before it can commit to replacement content.
- The popup is transient application chrome and is not persisted or exported.
- A custom virtualized listbox is deferred; the native listbox supplies stronger
  keyboard and accessibility behavior with a much smaller implementation.
