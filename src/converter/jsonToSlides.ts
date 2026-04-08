interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  attrs?: any;
  marks?: TiptapMark[];
  text?: string;
}

interface TiptapMark {
  type: string;
  attrs?: any;
}

import hljs from 'highlight.js';

export interface SlideTheme {
  companyLogo?: string;
  companyName?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  customStyles?: string;
  embeddedFonts?: { weight: number; dataUri: string }[];
  fontWeights?: { body: number; bold: number; h1: number; h2: number; h3: number };
}

export interface SlideSettings {
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  captionNumbering?: 'simple' | 'hierarchical';
  slideBreak?: 'h1-only' | 'h1-h2-vertical';
  showTitleSlide?: boolean;
}

export interface SdocMeta {
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
}

let currentSettings: SlideSettings = {};
let imageCounter = 0;
let tableCounter = 0;
let h1Counter = 0;

/**
 * Converts Tiptap JSON to reveal.js slide HTML
 */
export function convertJsonToSlides(json: TiptapNode, theme?: SlideTheme, settings?: SlideSettings, meta?: SdocMeta): string {
  currentSettings = settings || {};
  imageCounter = 0;
  tableCounter = 0;
  h1Counter = 0;

  const slides = splitIntoSlides(json);
  const slideSections = slides.map(slide => buildSlideSection(slide)).join('\n\n');
  return generateSlideDocument(slideSections, theme, meta);
}

interface SlideGroup {
  h1Node?: TiptapNode;
  content: TiptapNode[];
  subSlides?: SlideGroup[]; // H2-based vertical slides
}

function splitIntoSlides(doc: TiptapNode): SlideGroup[] {
  if (!doc.content) return [];

  const useVertical = currentSettings.slideBreak === 'h1-h2-vertical';
  const groups: SlideGroup[] = [];
  let current: SlideGroup = { content: [] };

  for (const node of doc.content) {
    if (node.type === 'heading' && node.attrs?.level === 1) {
      // Push previous group if it has content
      if (current.h1Node || current.content.length > 0) {
        groups.push(current);
      }
      current = { h1Node: node, content: [] };
    } else if (useVertical && node.type === 'heading' && node.attrs?.level === 2) {
      // H2 starts a new sub-slide within the current H1 group
      if (!current.subSlides) {
        // Move existing content (before any H2) to first sub-slide
        if (current.content.length > 0) {
          current.subSlides = [{ content: current.content }];
          current.content = [];
        } else {
          current.subSlides = [];
        }
      }
      current.subSlides.push({ h1Node: node, content: [] });
    } else {
      if (useVertical && current.subSlides && current.subSlides.length > 0) {
        // Add to the latest sub-slide
        current.subSlides[current.subSlides.length - 1].content.push(node);
      } else {
        current.content.push(node);
      }
    }
  }

  // Push last group
  if (current.h1Node || current.content.length > 0) {
    groups.push(current);
  }

  return groups;
}

function buildSlideSection(group: SlideGroup): string {
  if (group.subSlides && group.subSlides.length > 0) {
    // Vertical slide group — wrap in nested <section>
    const parts: string[] = [];

    // First slide: H1 + content before first H2
    let firstContent = '';
    if (group.h1Node) {
      h1Counter++;
      imageCounter = 0;
      tableCounter = 0;
      firstContent += convertSlideNode(group.h1Node);
    }
    if (group.content.length > 0) {
      firstContent += '\n' + group.content.map(convertSlideNode).join('\n');
    }
    if (firstContent) {
      parts.push(`      <section>\n${firstContent}\n      </section>`);
    }

    // Sub-slides (H2-based)
    for (const sub of group.subSlides) {
      let subContent = '';
      if (sub.h1Node) { // This is actually an H2 node stored in h1Node field
        subContent += convertSlideNode(sub.h1Node);
      }
      if (sub.content.length > 0) {
        subContent += '\n' + sub.content.map(convertSlideNode).join('\n');
      }
      parts.push(`      <section>\n${subContent}\n      </section>`);
    }

    return `    <section>\n${parts.join('\n')}\n    </section>`;
  }

  // Simple slide (H1-only mode)
  let content = '';
  if (group.h1Node) {
    h1Counter++;
    imageCounter = 0;
    tableCounter = 0;
    content += convertSlideNode(group.h1Node);
  }
  if (group.content.length > 0) {
    content += '\n' + group.content.map(convertSlideNode).join('\n');
  }

  return `    <section>\n${content}\n    </section>`;
}

function convertSlideNode(node: TiptapNode): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(convertSlideNode).join('\n') : '';

    case 'heading': {
      const level = node.attrs?.level || 1;
      const text = node.content ? convertInlineContent(node.content) : '';
      const hId = node.attrs?.id ? ` id="${escapeHtml(node.attrs.id)}"` : '';
      const hAlign = node.attrs?.textAlign ? ` style="text-align:${node.attrs.textAlign}"` : '';
      return `        <h${level}${hId}${hAlign}>${text}</h${level}>`;
    }

    case 'paragraph': {
      const text = node.content ? convertInlineContent(node.content) : '';
      const pAlign = node.attrs?.textAlign ? ` style="text-align:${node.attrs.textAlign}"` : '';
      return text ? `        <p${pAlign}>${text}</p>` : '';
    }

    case 'bulletList':
      return `        <ul>\n${node.content ? node.content.map(convertSlideNode).join('\n') : ''}\n        </ul>`;

    case 'orderedList':
      return `        <ol>\n${node.content ? node.content.map(convertSlideNode).join('\n') : ''}\n        </ol>`;

    case 'listItem': {
      const itemContent = node.content
        ? node.content.map(child => {
            if (child.type === 'paragraph') {
              return child.content ? convertInlineContent(child.content) : '';
            }
            return convertSlideNode(child);
          }).join('\n')
        : '';
      return `          <li>${itemContent}</li>`;
    }

    case 'taskList':
      return `        <ul class="task-list">\n${node.content ? node.content.map(convertSlideNode).join('\n') : ''}\n        </ul>`;

    case 'taskItem': {
      const checked = node.attrs?.checked ? ' checked' : '';
      const taskContent = node.content
        ? node.content.map(child => {
            if (child.type === 'paragraph') {
              return child.content ? convertInlineContent(child.content) : '';
            }
            return convertSlideNode(child);
          }).join('\n')
        : '';
      return `          <li class="task-item"><input type="checkbox"${checked} disabled> ${taskContent}</li>`;
    }

    case 'codeBlock': {
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map(n => n.text || '').join('\n') : '';
      let highlighted: string;
      if (language && hljs.getLanguage(language)) {
        highlighted = hljs.highlight(code, { language }).value;
      } else {
        highlighted = hljs.highlightAuto(code).value;
      }
      return `        <pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`;
    }

    case 'mathInline':
      return `<span class="math-inline">\\(${escapeHtml(node.attrs?.latex || '')}\\)</span>`;

    case 'mathBlock':
      return `        <div class="math-block">\\[${escapeHtml(node.attrs?.latex || '')}\\]</div>`;

    case 'diagram':
      return `        <pre class="mermaid">${escapeHtml(node.attrs?.code || '')}</pre>`;

    case 'table':
      return convertTable(node);

    case 'image':
      return convertImage(node);

    case 'hardBreak':
      return '<br>';

    case 'text':
      return applyMarks(escapeHtml(node.text || ''), node.marks || []);

    default:
      return node.content ? node.content.map(convertSlideNode).join('') : '';
  }
}

function convertInlineContent(content: TiptapNode[]): string {
  return content.map(convertSlideNode).join('');
}

function convertTableCellContent(content: TiptapNode[]): string {
  return content.map(node => {
    if (node.type === 'paragraph') {
      return node.content ? convertInlineContent(node.content) : '';
    }
    return convertSlideNode(node);
  }).join('').trim();
}

function convertTable(table: TiptapNode): string {
  if (!table.content || table.content.length === 0) return '';

  tableCounter++;
  const caption = table.attrs?.caption;
  const prefix = currentSettings.tableCaptionPrefix || 'Table';
  const numbering = currentSettings.captionNumbering === 'hierarchical'
    ? `${h1Counter}.${tableCounter}` : `${tableCounter}`;

  const hasHeader = table.content[0]?.content?.some((cell: TiptapNode) => cell.type === 'tableHeader');
  const tId = table.attrs?.id ? ` id="${escapeHtml(table.attrs.id)}"` : '';

  let html = `        <table${tId} class="slide-table">`;

  if (caption) {
    html += `\n          <caption>${prefix} ${numbering}: ${escapeHtml(caption)}</caption>`;
  }

  if (hasHeader && table.content[0]) {
    html += '\n          <thead>\n            <tr>';
    for (const cell of table.content[0].content || []) {
      const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
      html += `\n              <th>${cellContent}</th>`;
    }
    html += '\n            </tr>\n          </thead>';

    if (table.content.length > 1) {
      html += '\n          <tbody>';
      for (let i = 1; i < table.content.length; i++) {
        const row = table.content[i];
        html += '\n            <tr>';
        for (const cell of row.content || []) {
          const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
          html += `\n              <td>${cellContent}</td>`;
        }
        html += '\n            </tr>';
      }
      html += '\n          </tbody>';
    }
  } else {
    html += '\n          <tbody>';
    for (const row of table.content) {
      if (row.type === 'tableRow' && row.content) {
        html += '\n            <tr>';
        for (const cell of row.content) {
          const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
          const tag = cell.type === 'tableHeader' ? 'th' : 'td';
          html += `\n              <${tag}>${cellContent}</${tag}>`;
        }
        html += '\n            </tr>';
      }
    }
    html += '\n          </tbody>';
  }

  html += '\n        </table>';
  return html;
}

function convertImage(node: TiptapNode): string {
  const src = node.attrs?.src || '';
  const alt = node.attrs?.alt || '';
  const caption = node.attrs?.caption || '';
  imageCounter++;
  const prefix = currentSettings.imageCaptionPrefix || 'Image';
  const numbering = currentSettings.captionNumbering === 'hierarchical'
    ? `${h1Counter}.${imageCounter}` : `${imageCounter}`;

  const figId = node.attrs?.id ? ` id="${escapeHtml(node.attrs.id)}"` : '';
  let html = `        <figure class="slide-image"${figId}>`;
  html += `\n          <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  if (caption) {
    html += `\n          <figcaption>${prefix} ${numbering}: ${escapeHtml(caption)}</figcaption>`;
  }
  html += '\n        </figure>';
  return html;
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold': result = `<strong>${result}</strong>`; break;
      case 'italic': result = `<em>${result}</em>`; break;
      case 'underline': result = `<u>${result}</u>`; break;
      case 'strike': result = `<s>${result}</s>`; break;
      case 'subscript': result = `<sub>${result}</sub>`; break;
      case 'superscript': result = `<sup>${result}</sup>`; break;
      case 'code': result = `<code>${result}</code>`; break;
      case 'link': {
        const href = mark.attrs?.href || '';
        result = `<a href="${escapeHtml(href)}">${result}</a>`;
        break;
      }
      case 'textStyle': {
        const color = mark.attrs?.color;
        if (color) result = `<span style="color:${escapeHtml(color)}">${result}</span>`;
        break;
      }
      case 'highlight': {
        const bg = mark.attrs?.color || '#fef08a';
        result = `<mark style="background-color:${escapeHtml(bg)}">${result}</mark>`;
        break;
      }
    }
  }
  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const MERMAID_INIT = `mermaid.initialize({
  startOnLoad: true,
  theme: 'base',
  themeVariables: {
    background: '#ffffff',
    mainBkg: '#ffffff',
    primaryColor: '#dbeafe',
    edgeLabelBackground: '#ffffff'
  }
});`;

function generateSlideDocument(slideSections: string, theme?: SlideTheme, meta?: SdocMeta): string {
  const primaryColor = theme?.primaryColor || '#A50034';
  const accentColor = theme?.accentColor || '#6b6b6b';
  const fontFamily = theme?.fontFamily || "'Legacy Font 2.0', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  const companyLogo = theme?.companyLogo || '';
  const companyName = theme?.companyName || '';
  const customStyles = theme?.customStyles || '';
  const fw = theme?.fontWeights || { body: 400, bold: 700, h1: 700, h2: 600, h3: 600 };

  const fontFaceRules = (theme?.embeddedFonts || []).map(f => `
      @font-face {
        font-family: 'Legacy Font 2.0';
        font-weight: ${f.weight};
        font-style: normal;
        font-display: swap;
        src: url(${f.dataUri}) format('woff2');
      }`).join('\n');

  // Title slide
  let titleSlide = '';
  if (currentSettings.showTitleSlide !== false && meta?.title) {
    const logoHtml = companyLogo
      ? `\n          <img src="${companyLogo}" alt="Logo" class="title-logo">`
      : '';
    const companyHtml = companyName
      ? `\n          <p class="title-company">${escapeHtml(companyName)}</p>`
      : '';
    titleSlide = `
    <section class="title-slide">
      <div class="title-content">${logoHtml}
        <h1>${escapeHtml(meta.title)}</h1>${meta.author ? `\n        <p class="title-author">${escapeHtml(meta.author)}</p>` : ''}${meta.version ? `\n        <p class="title-version">v${escapeHtml(meta.version)}</p>` : ''}${companyHtml}
      </div>
    </section>

`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta?.title ? escapeHtml(meta.title) : 'Slides'}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    ${fontFaceRules}

    /* Base */
    :root {
      --r-main-font: ${fontFamily};
      --r-heading-font: ${fontFamily};
      --r-main-font-size: 28px;
      --r-main-color: #333;
      --r-heading-color: ${primaryColor};
      --r-link-color: ${primaryColor};
      --r-link-color-hover: ${accentColor};
      --r-background-color: #fff;
    }

    .reveal {
      font-weight: ${fw.body};
    }

    .reveal strong, .reveal b {
      font-weight: ${fw.bold};
    }

    .reveal h1 {
      font-weight: ${fw.h1};
      font-size: 1.8em;
      color: ${primaryColor};
      border-bottom: 3px solid ${primaryColor};
      padding-bottom: 0.2em;
    }

    .reveal h2 {
      font-weight: ${fw.h2};
      font-size: 1.4em;
      color: ${accentColor};
    }

    .reveal h3 {
      font-weight: ${fw.h3};
      font-size: 1.1em;
      color: ${accentColor};
    }

    /* Title slide */
    .title-slide {
      text-align: center;
    }

    .title-slide .title-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.3em;
    }

    .title-slide h1 {
      font-size: 2.2em;
      border-bottom: none;
      margin-bottom: 0.2em;
    }

    .title-logo {
      max-height: 80px;
      max-width: 300px;
      margin-bottom: 0.5em;
    }

    .title-author {
      font-size: 1.1em;
      color: ${accentColor};
    }

    .title-version {
      font-size: 0.8em;
      color: #999;
    }

    .title-company {
      font-size: 0.9em;
      color: ${primaryColor};
      margin-top: 1em;
      font-weight: ${fw.h2};
    }

    /* Slide content text alignment */
    .reveal section {
      text-align: left;
    }

    .reveal section p {
      margin-bottom: 0.6em;
      line-height: 1.5;
    }

    /* Lists */
    .reveal ul, .reveal ol {
      display: block;
      margin-left: 1em;
    }

    .reveal li {
      margin-bottom: 0.3em;
      line-height: 1.4;
    }

    /* Task list */
    .reveal .task-list {
      list-style: none;
      padding-left: 0;
    }

    .reveal .task-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .reveal .task-item input[type="checkbox"] {
      margin-top: 4px;
      accent-color: ${primaryColor};
    }

    /* Code blocks */
    .reveal pre {
      width: 100%;
      box-shadow: none;
      font-size: 0.55em;
    }

    .reveal pre code {
      max-height: 500px;
      padding: 1em;
      border-radius: 8px;
    }

    .reveal code {
      background-color: #f3f4f6;
      padding: 0.15em 0.3em;
      border-radius: 3px;
      font-size: 0.85em;
    }

    .reveal pre code {
      background-color: #1f2937;
      color: #f9fafb;
    }

    /* Syntax highlighting */
    .hljs-comment, .hljs-quote { color: #6a9955; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag { color: #569cd6; }
    .hljs-number, .hljs-string, .hljs-literal, .hljs-doctag, .hljs-regexp { color: #ce9178; }
    .hljs-title, .hljs-section, .hljs-name { color: #dcdcaa; }
    .hljs-attribute, .hljs-attr, .hljs-variable, .hljs-type { color: #4ec9b0; }
    .hljs-built_in { color: #4ec9b0; }

    /* Tables */
    .reveal .slide-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.7em;
      margin: 0.5em 0;
    }

    .reveal .slide-table caption {
      font-weight: bold;
      color: ${primaryColor};
      text-align: left;
      margin-bottom: 0.3em;
      font-size: 0.9em;
    }

    .reveal .slide-table th,
    .reveal .slide-table td {
      border: 1px solid #e5e7eb;
      padding: 0.4em 0.6em;
      text-align: left;
    }

    .reveal .slide-table thead th {
      background-color: ${primaryColor};
      color: white;
      font-weight: bold;
    }

    .reveal .slide-table tbody tr:nth-child(even) {
      background-color: #f9fafb;
    }

    /* Images */
    .reveal .slide-image {
      text-align: center;
      margin: 0.5em 0;
    }

    .reveal .slide-image img {
      max-width: 80%;
      max-height: 55vh;
      border-radius: 5px;
    }

    .reveal .slide-image figcaption {
      font-style: italic;
      color: ${accentColor};
      font-size: 0.7em;
      margin-top: 0.3em;
    }

    /* Math */
    .reveal .math-block {
      text-align: center;
      margin: 0.5em 0;
      overflow-x: auto;
    }

    /* Mermaid */
    .reveal pre.mermaid {
      background: transparent;
      box-shadow: none;
    }

    /* Slide number */
    .reveal .slide-number {
      font-size: 14px;
      color: ${accentColor};
    }

    /* Print */
    @media print {
      .reveal .slide-image img {
        max-height: none;
      }
    }

    ${customStyles}
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${titleSlide}${slideSections}
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
    onload="renderMathInElement(document.body, { delimiters: [
      {left: '\\\\[', right: '\\\\]', display: true},
      {left: '\\\\(', right: '\\\\)', display: false}
    ]});"></script>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    ${MERMAID_INIT}
  </script>
  <script>
    Reveal.initialize({
      hash: true,
      slideNumber: true,
      width: 1280,
      height: 720,
      margin: 0.08,
      transition: 'slide',
      controls: true,
      progress: true,
      center: false,
      plugins: []
    });
  </script>
</body>
</html>`;
}
