import { describe, expect, it } from 'vitest';
import { convertJsonToMarkdown } from '../shared/converter/jsonToMarkdown';
import { convertJsonToHtml, convertJsonToAdoc, convertJsonToSlides } from '../shared/converter';
import { convertMarkdownToJson } from '../shared/converter/markdownToJson';
import { resolveEditorSettings, resolveSettings, SETTINGS_DEFAULTS, toRoman } from '../shared/settingsResolver';
import { assertPersistedDocument } from '../shared/document/documentContract';
import { normalizeDocument, wrapSdoc } from '../shared/document/sdocUtils';
import type { ExportSettings, SlideSettings, TiptapNode } from '../shared/types';

describe('settings', () => {
  it('uses host-neutral visual defaults', () => {
    expect(SETTINGS_DEFAULTS.headingH1Color).toBe('#2563EB');
    expect(SETTINGS_DEFAULTS.headingH2Color).toBe('#2563EB');
    expect(SETTINGS_DEFAULTS.headingH3Color).toBe('#2563EB');
    expect(SETTINGS_DEFAULTS.headingH4Color).toBe('#2563EB');
    expect(SETTINGS_DEFAULTS.headingH5Color).toBe('#2563EB');
    expect(SETTINGS_DEFAULTS.headingH6Color).toBe('#2563EB');
  });

  it('merges document settings over external settings and defaults', () => {
    const resolved = resolveSettings(
      { captionStyle: 'korean', pdfScale: undefined },
      { captionStyle: 'ieee', pdfScale: 85 },
    );
    expect(resolved.captionStyle).toBe('korean');
    expect(resolved.pdfScale).toBe(85);
    expect(resolved.headingNumbering).toBe(SETTINGS_DEFAULTS.headingNumbering);
    expect(resolved.headingStartNumber).toBe(1);
    expect(resolveSettings({ headingStartNumber: 0 }).headingStartNumber).toBe(0);
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

  it('preserves Auto and explicit table widths across text exports', () => {
    const table = (width?: string): TiptapNode => ({
      type: 'table',
      attrs: {
        id: `table-${width ?? 'missing'}`,
        align: 'left',
        ...(width ? { width } : {}),
      },
      content: [
        {
          type: 'tableRow',
          content: [{
            type: 'tableHeader',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }],
          }],
        },
        {
          type: 'tableRow',
          content: [{
            type: 'tableCell',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }],
          }],
        },
      ],
    });

    expect(convertJsonToHtml({ type: 'doc', content: [table()] }))
      .toContain('style="width: auto;');
    expect(convertJsonToMarkdown({ type: 'doc', content: [table('auto')] }))
      .toContain('| Name |');
    for (const width of ['100%', '75%', '50%']) {
      const doc = { type: 'doc', content: [table(width)] } satisfies TiptapNode;
      expect(convertJsonToHtml(doc)).toContain(`width: ${width};`);
      expect(convertJsonToMarkdown(doc)).toContain(`style="width:${width};`);
      expect(convertJsonToAdoc(doc)).toContain(
        width === '100%' ? 'options="header"' : `width="${width}"`,
      );
    }
    expect(convertJsonToAdoc({ type: 'doc', content: [table('auto')] }))
      .toContain('options="header,autowidth"');
  });
});

describe('cross-format numbering', () => {
  it('preserves skipped heading levels in every export format', () => {
    const doc: TiptapNode = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'one' }, content: [{ type: 'text', text: 'One' }] },
      { type: 'heading', attrs: { level: 2, id: 'one-one' }, content: [{ type: 'text', text: 'One One' }] },
      { type: 'heading', attrs: { level: 4, id: 'one-one-zero-one' }, content: [{ type: 'text', text: 'Skipped Level' }] },
    ] };
    const settings: ExportSettings = { headingNumbering: true };
    const outputs = [
      convertJsonToHtml(doc, undefined, settings),
      convertJsonToMarkdown(doc, settings),
      convertJsonToAdoc(doc, settings),
      convertJsonToSlides(doc, undefined, settings as SlideSettings),
    ];

    for (const output of outputs) {
      expect(output).toContain('1.1.0.1');
      expect(output).toContain('Skipped Level');
    }
  });

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

  it('starts headings at zero in every export format', () => {
    const doc: TiptapNode = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'zero' }, content: [{ type: 'text', text: 'Zero' }] },
      { type: 'heading', attrs: { level: 2, id: 'zero-one' }, content: [{ type: 'text', text: 'Zero One' }] },
    ] };
    const settings: ExportSettings = { headingNumbering: true, headingStartNumber: 0 };
    const outputs = [
      convertJsonToHtml(doc, undefined, settings),
      convertJsonToMarkdown(doc, settings),
      convertJsonToAdoc(doc, settings),
      convertJsonToSlides(doc, undefined, settings as SlideSettings),
    ];

    for (const output of outputs) {
      expect(output).toContain('0.1');
      expect(output).toContain('Zero One');
    }
  });

  it('resolves document settings over host settings in the shared resolver', () => {
    const documentSettings = {
      captionStyle: 'ieee' as const,
      equationNumbering: 'hierarchical' as const,
      headingNumbering: false,
      headingH4Color: '#445566',
      headingH5Color: '#556677',
      headingH6Color: '#667788',
    };
    const resolved = resolveEditorSettings(documentSettings, {
      headingNumbering: false,
      headingH4Color: '#000000',
      headingH5Color: '#111111',
      headingH6Color: '#222222',
      imageCaptionPrefix: 'legacy value must not override the preset',
    }, documentSettings);
    expect(resolved).toMatchObject({
      headingH4Color: '#445566',
      headingH5Color: '#556677',
      headingH6Color: '#667788',
    });
    expect(resolved.tableNumberStyle).toBe('roman');
    expect(resolved.equationParens).toBe(true);

  });
});
