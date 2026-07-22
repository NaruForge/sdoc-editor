import { describe, expect, it } from 'vitest';
import { shouldFlushOnSaveShortcut } from '../shared/editor/hooks/useTiptapEditor';

describe('editor save lifecycle', () => {
  it('leaves Ctrl+S to the VS Code save participant when shortcut flushing is disabled', () => {
    expect(shouldFlushOnSaveShortcut({ ctrlKey: true, metaKey: false, key: 's' }, false)).toBe(false);
  });

  it('keeps direct Ctrl+S flushing available for standalone hosts', () => {
    expect(shouldFlushOnSaveShortcut({ ctrlKey: true, metaKey: false, key: 's' }, true)).toBe(true);
    expect(shouldFlushOnSaveShortcut({ ctrlKey: false, metaKey: true, key: 's' }, true)).toBe(true);
    expect(shouldFlushOnSaveShortcut({ ctrlKey: true, metaKey: false, key: 'z' }, true)).toBe(false);
  });
});
