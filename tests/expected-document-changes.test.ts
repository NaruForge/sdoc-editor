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

  it('matches an LF persistence snapshot that includes the required final newline', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';
    const persisted = `${JSON.stringify(persistedEnvelope, null, 2)}\n`;

    expect(persisted.endsWith('\n')).toBe(true);
    changes.expect(uri, persisted, '\n');

    expect(shouldReportExternalDocumentChange([{}], changes, uri, persisted)).toBe(false);
  });

  it('matches a CRLF persistence snapshot including its CRLF final newline', () => {
    const changes = new ExpectedDocumentChanges();
    const uri = 'file:///document.sdoc';
    const persisted = `${JSON.stringify(persistedEnvelope, null, 2)}\n`;
    const appliedCrlf = normalizeDocumentEndOfLines(persisted, '\r\n');

    changes.expect(uri, persisted, '\r\n');

    expect(appliedCrlf.endsWith('\r\n')).toBe(true);
    expect(shouldReportExternalDocumentChange([{}], changes, uri, appliedCrlf)).toBe(false);
  });
});

const persistedEnvelope = {
  sdoc: '1.0',
  meta: {
    title: 'Newline probe',
    author: '',
    version: '0.1',
    created: '2026-08-14T00:00:00.000Z',
    modified: '2026-08-14T00:00:00.000Z',
  },
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  },
};
