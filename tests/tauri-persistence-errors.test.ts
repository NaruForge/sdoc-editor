import { describe, expect, it } from 'vitest';
import { classifyTauriSaveError } from '../tauri-app/src/adapters/tauriPersistenceErrors';

describe('Tauri persistence error classification', () => {
  it('recognizes the native external modification rejection', () => {
    expect(classifyTauriSaveError(
      'Save rejected: the document was modified outside Structured Doc Editor',
    )).toBe('EXTERNAL_CHANGE');
  });

  it('keeps unrelated native failures as write errors', () => {
    expect(classifyTauriSaveError('Save rejected: stale revision 2; expected 3'))
      .toBe('WRITE_FAILED');
    expect(classifyTauriSaveError('disk full')).toBe('WRITE_FAILED');
  });
});
