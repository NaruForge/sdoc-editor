import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../shared/editor/context/EditorContext';
import { LinkDialog } from '../shared/editor/components/LinkDialog';
import {
  applyLinkEdit,
  captureLinkSelection,
  copyCapturedLink,
  openCapturedLink,
  removeCapturedLink,
  restoreCapturedLinkSelection,
} from '../shared/editor/linkEditing';
import { isSafeLinkUrl, normalizeSafeLinkUrl } from '../shared/document/linkUrl';

const schema = getSchema([StarterKit]);

const editorState = (content: Array<Record<string, unknown>>, from: number, to = from): EditorState => {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'paragraph', content }],
  });
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
};

describe('safe link URLs', () => {
  it.each([
    ['https://example.com/docs?q=1#part', 'https://example.com/docs?q=1#part'],
    [' HTTP://EXAMPLE.COM ', 'HTTP://EXAMPLE.COM'],
    ['mailto:owner@example.com', 'mailto:owner@example.com'],
    ['tel:+82-2-1234-5678', 'tel:+82-2-1234-5678'],
    ['#target-heading', '#target-heading'],
    ['./other.sdoc#overview', './other.sdoc#overview'],
    ['../My document.sdoc', '../My document.sdoc'],
  ])('accepts a supported URL: %s', (input, expected) => {
    expect(normalizeSafeLinkUrl(input)).toEqual({ ok: true, url: expected });
    expect(isSafeLinkUrl(input)).toBe(true);
  });

  it.each([
    '',
    '#',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///C:/secret.txt',
    'C:\\secret.txt',
    '/etc/passwd',
    '\\\\server\\share\\secret.sdoc',
    '//example.com/scheme-relative',
    'https://example.com/line\nbreak',
  ])('rejects an unsafe or non-portable URL: %s', (input) => {
    expect(normalizeSafeLinkUrl(input).ok).toBe(false);
    expect(isSafeLinkUrl(input)).toBe(false);
  });
});

describe('link edit transactions', () => {
  it('captures the full link range and changes only its URL', () => {
    const state = editorState(
      [
        {
          type: 'text',
          text: 'Linked',
          marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://old.example' } }],
        },
      ],
      3,
    );
    const captured = captureLinkSelection(state);

    expect(captured).toMatchObject({
      ok: true,
      snapshot: {
        mode: 'edit',
        text: 'Linked',
        href: 'https://old.example',
        target: { from: 1, to: 7 },
      },
    });
    if (!captured.ok) return;
    const edited = applyLinkEdit(state, captured.snapshot, {
      url: 'https://new.example',
      text: 'Linked',
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const marks = state.apply(edited.transaction).doc.firstChild?.firstChild?.marks ?? [];
    expect(marks.map((mark) => mark.type.name).sort()).toEqual(['bold', 'italic', 'link']);
    expect(marks.find((mark) => mark.type.name === 'link')?.attrs.href).toBe('https://new.example');
  });

  it('keeps only common non-link marks when display text changes', () => {
    const state = editorState(
      [
        {
          type: 'text',
          text: 'Bold italic',
          marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://example.com' } }],
        },
        {
          type: 'text',
          text: ' bold',
          marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
      1,
      17,
    );
    const captured = captureLinkSelection(state);

    expect(captured).toMatchObject({
      ok: true,
      snapshot: { hasMixedFormatting: true },
    });
    if (!captured.ok) return;
    const edited = applyLinkEdit(state, captured.snapshot, {
      url: 'https://example.com/new',
      text: 'Replacement',
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const node = state.apply(edited.transaction).doc.firstChild?.firstChild;
    expect(node?.text).toBe('Replacement');
    expect(node?.marks.map((mark) => mark.type.name).sort()).toEqual(['bold', 'link']);
  });

  it('rejects a selection that spans multiple links', () => {
    const state = editorState(
      [
        {
          type: 'text',
          text: 'First',
          marks: [{ type: 'link', attrs: { href: 'https://one.example' } }],
        },
        { type: 'text', text: ' and ' },
        {
          type: 'text',
          text: 'Second',
          marks: [{ type: 'link', attrs: { href: 'https://two.example' } }],
        },
      ],
      1,
      17,
    );

    expect(captureLinkSelection(state)).toEqual({
      ok: false,
      reason: 'multiple-links',
    });
  });

  it('restores the exact selection on cancel and removes only the captured link mark', () => {
    const state = editorState(
      [
        {
          type: 'text',
          text: 'Linked',
          marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
      2,
      5,
    );
    const captured = captureLinkSelection(state);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)));

    const restored = moved.apply(restoreCapturedLinkSelection(moved, captured.snapshot));
    expect(restored.selection).toMatchObject({ from: 2, to: 5 });

    const removed = removeCapturedLink(restored, captured.snapshot);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const marks = restored.apply(removed.transaction).doc.firstChild?.firstChild?.marks ?? [];
    expect(marks.map((mark) => mark.type.name)).toEqual(['bold']);
  });

  it('provides safe open and copy actions without exposing unsafe legacy hrefs', async () => {
    const safeState = editorState(
      [
        {
          type: 'text',
          text: 'Linked',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
      3,
    );
    const safe = captureLinkSelection(safeState);
    expect(safe.ok).toBe(true);
    if (!safe.ok) return;
    const open = vi.fn();
    const copy = vi.fn(async () => undefined);

    expect(openCapturedLink(safe.snapshot, open)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com');
    await expect(copyCapturedLink(safe.snapshot, copy)).resolves.toBe(true);
    expect(copy).toHaveBeenCalledWith('https://example.com');

    const unsafeState = editorState(
      [
        {
          type: 'text',
          text: 'Legacy',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
      3,
    );
    const unsafe = captureLinkSelection(unsafeState);
    expect(unsafe.ok).toBe(true);
    if (!unsafe.ok) return;
    expect(openCapturedLink(unsafe.snapshot, open)).toBe(false);
    await expect(copyCapturedLink(unsafe.snapshot, copy)).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('surfaces mixed formatting before confirming a display-text edit', () => {
    const markup = renderToStaticMarkup(
      <EditorProvider>
        <LinkDialog
          mode="edit"
          defaultUrl="https://example.com"
          defaultText="Mixed text"
          mixedFormatting
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </EditorProvider>,
    );

    expect(markup).toContain('Edit link');
    expect(markup).toContain('Changing the display text keeps only formatting shared');
    expect(markup).toContain('role="status"');
  });
});
