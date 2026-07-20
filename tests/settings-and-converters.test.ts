import { describe, expect, it } from 'vitest';
import { convertJsonToMarkdown } from '../shared/converter/jsonToMarkdown';
import { convertMarkdownToJson } from '../shared/converter/markdownToJson';
import { resolveSettings, SETTINGS_DEFAULTS, toRoman } from '../shared/settingsResolver';

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
    const output = convertJsonToMarkdown(doc);

    expect(output).toContain('# Architecture');
    expect(output).toContain('A structured document.');
    expect(output).toContain('```mermaid');
    expect(output).toContain('A-->B');
  });
});
