import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertJsonToHtml } from '../shared/converter/jsonToHtml';
import { convertJsonToMarkdown } from '../shared/converter/jsonToMarkdown';
import { convertJsonToSlides } from '../shared/converter/jsonToSlides';
import { convertMarkdownToJson } from '../shared/converter/markdownToJson';
import type { TiptapNode } from '../shared/types';

const diagrams: TiptapNode = {
  type: 'doc',
  content: [
    { type: 'diagram', attrs: { language: 'mermaid', code: 'graph TD\nA-->B' } },
    { type: 'diagram', attrs: { language: 'plantuml', code: '@startuml\nA -> B\n@enduml' } },
    { type: 'diagram', attrs: { language: 'd2', code: 'A -> B' } },
    { type: 'diagram', attrs: { language: 'future<&"', code: '<node> & "edge"' } },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ['HTML', (options?: Parameters<typeof convertJsonToHtml>[4]) =>
    convertJsonToHtml(diagrams, undefined, undefined, undefined, options)],
  ['Slides', (options?: Parameters<typeof convertJsonToSlides>[4]) =>
    convertJsonToSlides(diagrams, undefined, undefined, undefined, options)],
])('%s diagram conversion', (_format, convert) => {
  it('classifies only Mermaid as Mermaid and preserves other sources', () => {
    const output = convert();

    expect(output).toContain('<pre class="mermaid">graph TD\nA--&gt;B</pre>');
    expect(output).toContain('data-language="plantuml"');
    expect(output).toContain('<code>@startuml\nA -&gt; B\n@enduml</code>');
    expect(output).toContain('data-language="d2"');
    expect(output).toContain('data-language="future&lt;&amp;&quot;"');
    expect(output).toContain('<code>&lt;node&gt; &amp; &quot;edge&quot;</code>');
    expect(output).not.toContain('<pre class="mermaid">@startuml');
    expect(output).not.toContain('<pre class="mermaid">A -&gt; B');
  });

  it('adds a prepared PNG without removing the escaped source fallback', () => {
    const resolveDiagramImage = vi.fn(({ language }: { language: string }) => (
      language === 'plantuml'
        ? { dataUrl: 'data:image/png;base64,AA==', alt: 'Prepared architecture' }
        : undefined
    ));
    const output = convert({ resolveDiagramImage });

    expect(resolveDiagramImage).toHaveBeenCalled();
    expect(output).toContain(
      '<img src="data:image/png;base64,AA==" alt="Prepared architecture">',
    );
    expect(output).toContain('<code>@startuml\nA -&gt; B\n@enduml</code>');
  });
});

it('round-trips non-Mermaid language and source through the document converters', () => {
  const source = '```plantuml\n@startuml\nAlice -> Bob: <request> & response\n@enduml\n```';
  const document = convertMarkdownToJson(source);
  const diagram = document.content?.[0];

  expect(diagram).toMatchObject({
    type: 'diagram',
    attrs: {
      language: 'plantuml',
      code: '@startuml\nAlice -> Bob: <request> & response\n@enduml',
    },
  });
  expect(convertJsonToMarkdown(document)).toContain(source);
  expect(convertJsonToHtml(document)).toContain(
    '<code>@startuml\nAlice -&gt; Bob: &lt;request&gt; &amp; response\n@enduml</code>',
  );
});

it('does not perform network work while converting diagram fallbacks', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  convertJsonToHtml(diagrams);
  convertJsonToSlides(diagrams);

  expect(fetch).not.toHaveBeenCalled();
});
