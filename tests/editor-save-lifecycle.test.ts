import { describe, expect, it } from 'vitest';
import {
  PendingEditorUpdateGate,
  shouldEmitEditorFlush,
  shouldFlushOnSaveShortcut,
} from '../shared/editor/hooks/useTiptapEditor';

describe('editor save lifecycle', () => {
  it('leaves Ctrl+S to the VS Code save participant when shortcut flushing is disabled', () => {
    expect(shouldFlushOnSaveShortcut({ ctrlKey: true, metaKey: false, key: 's' }, false)).toBe(false);
  });

  it('keeps direct Ctrl+S flushing available for standalone hosts', () => {
    expect(shouldFlushOnSaveShortcut({ ctrlKey: true, metaKey: false, key: 's' }, true)).toBe(true);
    expect(shouldFlushOnSaveShortcut({ ctrlKey: false, metaKey: true, key: 's' }, true)).toBe(true);
    expect(shouldFlushOnSaveShortcut({ ctrlKey: true, metaKey: false, key: 'z' }, true)).toBe(false);
  });

  it('does not emit a no-op flush and consumes each pending update once', () => {
    const gate = new PendingEditorUpdateGate();
    expect(gate.consume()).toBe(false);
    gate.markPending();
    expect(gate.consume()).toBe(true);
    expect(gate.consume()).toBe(false);
    gate.markPending();
    gate.clear();
    expect(gate.consume()).toBe(false);
  });

  it('keeps save flushes as acknowledgement barriers after debounce emission', () => {
    expect(shouldEmitEditorFlush('barrier', false)).toBe(true);
    expect(shouldEmitEditorFlush('barrier', true)).toBe(true);
    expect(shouldEmitEditorFlush('pending-only', false)).toBe(false);
    expect(shouldEmitEditorFlush('pending-only', true)).toBe(true);
  });
});
