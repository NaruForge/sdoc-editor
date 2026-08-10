import { describe, expect, it } from 'vitest';
import {
  ExpectedDocumentChanges,
  hasTextDocumentContentChanges,
  normalizeDocumentEndOfLines,
  shouldReportExternalDocumentChange,
} from '../src/utils/expectedDocumentChanges';

describe('expected VS Code document changes', () => {
  it('ignores state-only save events without content changes', () => {
    expect(hasTextDocumentContentChanges([])).toBe(false);
  });

  it('retains expected and external events that contain text changes', () => {
    expect(hasTextDocumentContentChanges([{}])).toBe(true);
  });

  it('does not consume an expected edit when a state-only save event arrives first', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';
    const persisted = '{\n  "sdoc": "1.0"\n}';
    changes.expect(uri, persisted, '\n');

    expect(shouldReportExternalDocumentChange([], changes, uri, persisted)).toBe(false);
    expect(shouldReportExternalDocumentChange([{}], changes, uri, persisted)).toBe(false);
    expect(shouldReportExternalDocumentChange([{}], changes, uri, persisted)).toBe(true);
  });

  it('reports an unmatched text change as external', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';
    changes.expect(uri, '{"title":"Mine"}', '\n');

    expect(shouldReportExternalDocumentChange(
      [{}],
      changes,
      uri,
      '{"title":"External"}',
    )).toBe(true);
  });

  it('matches an LF persistence snapshot after VS Code applies it to a CRLF document', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';
    const persisted = '{\n  "sdoc": "1.0"\n}';

    changes.expect(uri, persisted, '\r\n');

    expect(changes.consume(uri, '{\r\n  "sdoc": "1.0"\r\n}')).toBe(true);
  });

  it('preserves exact matching for LF documents', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';
    const persisted = '{\n  "sdoc": "1.0"\n}';

    changes.expect(uri, persisted, '\n');

    expect(changes.consume(uri, persisted)).toBe(true);
  });

  it('does not consume a different external change', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';

    changes.expect(uri, '{\n  "title": "Mine"\n}', '\r\n');

    expect(changes.consume(uri, '{\r\n  "title": "External"\r\n}')).toBe(false);
  });

  it('does not consume a matching snapshot twice', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';
    const persisted = '{\r\n  "sdoc": "1.0"\r\n}';

    changes.expect(uri, persisted, '\r\n');

    expect(changes.consume(uri, persisted)).toBe(true);
    expect(changes.consume(uri, persisted)).toBe(false);
  });

  it('normalizes mixed input endings to the target document ending', () => {
    expect(normalizeDocumentEndOfLines('a\r\nb\nc\rd', '\r\n'))
      .toBe('a\r\nb\r\nc\r\nd');
  });
});
