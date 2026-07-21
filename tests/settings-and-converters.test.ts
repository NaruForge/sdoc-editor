import { describe, expect, it } from 'vitest';
import { convertJsonToMarkdown } from '../shared/converter/jsonToMarkdown';
import { convertJsonToHtml, convertJsonToAdoc, convertJsonToSlides } from '../shared/converter';
import { convertMarkdownToJson } from '../shared/converter/markdownToJson';
import { resolveEditorSettings, resolveSettings, SETTINGS_DEFAULTS, toRoman } from '../shared/settingsResolver';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { normalizeDocument, wrapSdoc } from '../shared/document/sdocUtils';
import type { ExportSettings, SlideSettings, TiptapNode } from '../shared/types';
import { resolveTauriEditorSettings } from '../tauri-app/src/settingsAdapter';

describe('settings', () => {
  it('merges document settings over external settings and defaults', () => {
    const resolved = resolveSettings(
      { captionStyle: 'korean', pdfScale: undefined },
      { captionStyle: 'ieee', pdfScale: 85 },
    );
    expect(resolved.captionStyle).toBe('korean');
    expect(resolved.pdfScale).toBe(85);
    expect(resolved.headingNumbering).toBe(SETTINGS_DEFAULTS.headingNumbering);
  });

  it('formats roman table numbers', () => {
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(19)).toBe('XIX');
  });
});

describe('markdown conversion', () => {
  it('round-trips headings, paragraphs, and Mermaid diagrams', () => {
    const markdown = '# Architecture\n\nA structured document.\n\n```mermaid\ngraph TD\nA-->B\n```';
    const doc = convertMarkdownToJson(markdown);
    expect(() => assertPersistedDocument(wrapSdoc(normalizeDocument(doc), {}))).not.toThrow();
    const output = convertJsonToMarkdown(doc);

    expect(output).toContain('# 1 Architecture');
    expect(output).toContain('A structured document.');
    expect(output).toContain('```mermaid');
    expect(output).toContain('A-->B');
  });
});

describe('cross-format numbering', () => {
  it('uses the same shared numbering for HTML, Markdown, AsciiDoc, and Slides', () => {
    const table = (id: string, caption?: string): TiptapNode => ({
      type: 'table', attrs: { id, ...(caption ? { caption } : {}) },
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }],
    });
    const doc: TiptapNode = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'one' }, content: [{ type: 'text', text: 'One' }] },
      table('uncaptioned'),
      table('first-caption', 'Ports'),
      { type: 'heading', attrs: { level: 1, id: 'two' }, content: [{ type: 'text', text: 'Two' }] },
      table('second-section', 'Signals'),
      { type: 'mathBlock', attrs: { id: 'equation', latex: 'x=1' } },
    ] };
    const settings: ExportSettings = {
      captionStyle: 'ieee', headingNumbering: true,
      captionNumbering: 'hierarchical', equationNumbering: 'hierarchical',
    };
    const outputs = [
      convertJsonToHtml(doc, undefined, settings),
      convertJsonToMarkdown(doc, settings),
      convertJsonToAdoc(doc, settings),
      convertJsonToSlides(doc, undefined, settings as SlideSettings),
    ];

    for (const output of outputs) {
      expect(output).toContain('Table 1.II. Ports');
      expect(output).toContain('Table 2.I. Signals');
    }
    expect(outputs[0]).toContain('(2.1)');
    expect(outputs[1]).toContain('(2.1)');
    expect(outputs[2]).toContain('(2.1)');
    expect(outputs[3]).toContain('(2.1)');
  });

  it('resolves identical host semantics from the shared settings resolver', () => {
    const documentSettings = { captionStyle: 'ieee' as const, equationNumbering: 'hierarchical' as const, headingNumbering: false };
    const shared = resolveEditorSettings(documentSettings);
    const tauri = resolveTauriEditorSettings({
      headingNumbering: false,
      imageCaptionPrefix: 'legacy value must not override the preset',
    }, documentSettings);
    expect(tauri).toMatchObject(shared);
    expect(tauri.tableNumberStyle).toBe('roman');
    expect(tauri.equationParens).toBe(true);
  });
});
