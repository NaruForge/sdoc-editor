import { describe, expect, it, vi } from 'vitest';
import {
  EditorDocumentReplacementBoundary,
  type EditorReplacementReason,
} from '../shared/editor/documentReplacement';

describe('EditorDocumentReplacementBoundary', () => {
  it('hydrates exactly once and rejects duplicate initial results', () => {
    const apply = vi.fn();
    const boundary = new EditorDocumentReplacementBoundary<string>();

    expect(boundary.replace('initial-load', 'first', apply)).toBe(true);
    expect(boundary.replace('initial-load', 'late duplicate', apply)).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(boundary.isHydrated).toBe(true);
  });

  it('allows only explicit user replacement reasons after hydration', () => {
    const apply = vi.fn();
    const boundary = new EditorDocumentReplacementBoundary<string>();
    boundary.replace('initial-load', 'first', apply);

    boundary.replace('user-reload', 'reload', apply);
    boundary.replace('user-import', 'import', apply);
    boundary.replace('confirmed-template', 'template', apply);
    expect(apply.mock.calls.map(([value]) => value)).toEqual([
      'first', 'reload', 'import', 'template',
    ]);

    expect(() => boundary.replace(
      'background-ack' as EditorReplacementReason,
      'stale',
      apply,
    )).toThrow(/replacement reason/i);
    expect(apply).toHaveBeenCalledTimes(4);
  });
});
