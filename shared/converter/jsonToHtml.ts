import hljs from 'highlight.js';
import { escapeHtml, formatDate, formatCaptionLabel } from './utils';
import { toRoman } from '../settingsResolver';
import type {
  HtmlExportSettings as ExportSettings,
  HtmlTheme,
  SdocMeta,
  TiptapMark,
  TiptapNode,
} from '../types';

interface ConvertContext {
  settings: ExportSettings;
  imageCounter: number;
  tableCounter: number;
  h1Counter: number;
  eqGlobal: number;
  eqInSection: number;
}

/**
 * Converts Tiptap JSON to HTML format
 */
export function convertJsonToHtml(json: TiptapNode, theme?: HtmlTheme, settings?: ExportSettings, meta?: SdocMeta): string {
  const ctx: ConvertContext = {
    settings: settings || {},
    imageCounter: 0,
    tableCounter: 0,
    h1Counter: 0,
    eqGlobal: 0,
    eqInSection: 0,
  };
  const bodyContent = convertNode(json, ctx);
  return generateHtmlDocument(bodyContent, theme, meta, ctx);
}

function convertNode(node: TiptapNode, ctx: ConvertContext): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(n => convertNode(n, ctx)).join('\n') : '';

    case 'heading': {
      const level = node.attrs?.level || 1;
      const numbered = node.attrs?.numbered !== false;
      const headingText = node.content ? convertInlineContent(node.content, ctx) : '';
      if (level === 1) { ctx.imageCounter = 0; ctx.tableCounter = 0; ctx.eqInSection = 0; if (numbered) ctx.h1Counter++; }
      const hId = node.attrs?.id ? ` id="${escapeHtml(node.attrs.id as string)}"` : '';
      const hAlign = node.attrs?.textAlign ? ` style="text-align:${node.attrs.textAlign}"` : '';
      const hNumbered = numbered ? '' : ' data-numbered="false"';
      return `<h${level}${hId}${hAlign}${hNumbered}>${headingText}</h${level}>`;
    }

    case 'paragraph': {
      const paragraphText = node.content ? convertInlineContent(node.content, ctx) : '';
      const pAlign = node.attrs?.textAlign ? ` style="text-align:${node.attrs.textAlign}"` : '';
      return paragraphText ? `<p${pAlign}>${paragraphText}</p>` : '<p></p>';
    }

    case 'bulletList': {
      const bulletItems = node.content ? node.content.map(n => convertNode(n, ctx)).join('\n') : '';
      return `<ul>\n${bulletItems}\n</ul>`;
    }

    case 'orderedList': {
      const orderedItems = node.content ? node.content.map(n => convertNode(n, ctx)).join('\n') : '';
      return `<ol>\n${orderedItems}\n</ol>`;
    }

    case 'listItem': {
      const itemContent = node.content
        ? node.content.map((child) => {
            if (child.type === 'paragraph') {
              return child.content ? convertInlineContent(child.content, ctx) : '';
            }
            return convertNode(child, ctx);
          }).join('\n')
        : '';
      return `  <li>${itemContent}</li>`;
    }

    case 'taskList': {
      const taskItems = node.content ? node.content.map(n => convertNode(n, ctx)).join('\n') : '';
      return `<ul class="task-list">\n${taskItems}\n</ul>`;
    }

    case 'taskItem': {
      const checked = node.attrs?.checked ? ' checked' : '';
      const taskContent = node.content
        ? node.content.map((child) => {
            if (child.type === 'paragraph') {
              return child.content ? convertInlineContent(child.content, ctx) : '';
            }
            return convertNode(child, ctx);
          }).join('\n')
        : '';
      return `  <li class="task-item"><input type="checkbox"${checked} disabled> ${taskContent}</li>`;
    }

    case 'codeBlock': {
      const language = (node.attrs?.language as string) || '';
      const code = node.content ? node.content.map((n) => n.text || '').join('\n') : '';
      let highlightedCode: string;
      if (language && hljs.getLanguage(language)) {
        highlightedCode = hljs.highlight(code, { language }).value;
      } else {
        highlightedCode = hljs.highlightAuto(code).value;
      }
      return `<pre><code class="hljs language-${escapeHtml(language)}">${highlightedCode}</code></pre>`;
    }

    case 'mathInline':
      return `<span class="math-inline" data-latex="${escapeHtml((node.attrs?.latex as string) || '')}">\\(${escapeHtml((node.attrs?.latex as string) || '')}\\)</span>`;

    case 'mathBlock': {
      ctx.eqGlobal++;
      ctx.eqInSection++;
      const eqMode = ctx.settings.equationNumbering ?? 'sequential';
      const eqLabel = eqMode === 'hierarchical' ? `${ctx.h1Counter}.${ctx.eqInSection}` : `${ctx.eqGlobal}`;
      const eqPrefix = ctx.settings.equationCaptionPrefix ?? '';
      const latex = (node.attrs?.latex as string) || '';
      const eqId = node.attrs?.id ? ` id="${escapeHtml(node.attrs.id as string)}"` : '';
      const parens = ctx.settings.equationParens ?? true;
      const tagContent = eqPrefix
        ? (parens ? `${eqPrefix}(${eqLabel})` : `${eqPrefix}${eqLabel}`)
        : (parens ? `(${eqLabel})` : `${eqLabel}`);
      const taggedLatex = `${latex}\\tag*{${tagContent}}`;
      return `<div class="math-block"${eqId} data-latex="${escapeHtml(taggedLatex)}">\\[${escapeHtml(taggedLatex)}\\]</div>`;
    }

    case 'diagram':
      return `<pre class="mermaid">${escapeHtml((node.attrs?.code as string) || '')}</pre>`;

    case 'blockquote': {
      const bqContent = node.content ? node.content.map(n => convertNode(n, ctx)).join('') : '';
      return `<blockquote>${bqContent}</blockquote>`;
    }

    case 'callout': {
      const variant = (node.attrs?.variant as string) || 'note';
      const calloutIcons: Record<string, string> = { note: '📝', info: 'ℹ️', tip: '💡', warning: '⚠️', danger: '🚨' };
      const calloutLabels: Record<string, string> = { note: 'Note', info: 'Info', tip: 'Tip', warning: 'Warning', danger: 'Danger' };
      const innerContent = node.content ? node.content.map(n => convertNode(n, ctx)).join('') : '';
      return `<div class="callout callout-${variant}"><div class="callout-header"><span class="callout-icon">${calloutIcons[variant] ?? calloutIcons.note}</span><span class="callout-label">${calloutLabels[variant] ?? calloutLabels.note}</span></div><div class="callout-content">${innerContent}</div></div>`;
    }

    case 'table':
      return convertTable(node, ctx);

    case 'image':
      return convertImage(node, ctx);

    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return '';

    case 'hardBreak':
      return '<br>';

    case 'text':
      return applyMarks(escapeHtml(node.text || ''), node.marks || []);

    default:
      return node.content ? node.content.map(n => convertNode(n, ctx)).join('') : '';
  }
}

function convertInlineContent(content: TiptapNode[], ctx: ConvertContext): string {
  return content.map(n => convertNode(n, ctx)).join('');
}

function convertTableCellContent(content: TiptapNode[], ctx: ConvertContext): string {
  return content.map((node) => {
    if (node.type === 'paragraph') {
      return node.content ? convertInlineContent(node.content, ctx) : '';
    }
    return convertNode(node, ctx);
  }).join('').trim();
}

function convertTable(table: TiptapNode, ctx: ConvertContext): string {
  if (!table.content || table.content.length === 0) {
    return '';
  }

  ctx.tableCounter++;
  let html = '';

  const caption = table.attrs?.caption;
  const align = table.attrs?.align || 'left';
  const width = table.attrs?.width || '100%';
  const prefix = ctx.settings.tableCaptionPrefix ?? '';
  const tblNum = ctx.settings.tableNumberStyle === 'roman' ? toRoman(ctx.tableCounter) : `${ctx.tableCounter}`;
  const numbering = ctx.settings.captionNumbering === 'hierarchical'
    ? `${ctx.h1Counter}.${tblNum}`
    : tblNum;

  const hasHeader = table.content[0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  const tId = table.attrs?.id ? ` id="${escapeHtml(table.attrs.id as string)}"` : '';
  html += `<table${tId} style="width: ${width}; text-align: ${align};" class="doc-table">`;

  if (caption) {
    html += `\n  <caption>${formatCaptionLabel(prefix, numbering, escapeHtml(caption as string), ctx.settings.captionSeparator ?? ' ')}</caption>`;
  }

  if (hasHeader && table.content[0]) {
    html += '\n  <thead>\n    <tr>';
    const headerRow = table.content[0];
    if (headerRow.content) {
      for (const cell of headerRow.content) {
        const cellContent = cell.content ? convertTableCellContent(cell.content, ctx) : '';
        let cellAttrs = '';
        const colspan = (cell.attrs?.colspan as number) || 1;
        const rowspan = (cell.attrs?.rowspan as number) || 1;
        if (colspan > 1) { cellAttrs += ` colspan="${colspan}"`; }
        if (rowspan > 1) { cellAttrs += ` rowspan="${rowspan}"`; }
        html += `\n      <th${cellAttrs}>${cellContent}</th>`;
      }
    }
    html += '\n    </tr>\n  </thead>';

    if (table.content.length > 1) {
      html += '\n  <tbody>';
      for (let i = 1; i < table.content.length; i++) {
        const row = table.content[i];
        html += '\n    <tr>';
        if (row.content) {
          for (const cell of row.content) {
            const cellContent = cell.content ? convertTableCellContent(cell.content, ctx) : '';
            let cellAttrs = '';
            const colspan = (cell.attrs?.colspan as number) || 1;
            const rowspan = (cell.attrs?.rowspan as number) || 1;
            if (colspan > 1) { cellAttrs += ` colspan="${colspan}"`; }
            if (rowspan > 1) { cellAttrs += ` rowspan="${rowspan}"`; }
            html += `\n      <td${cellAttrs}>${cellContent}</td>`;
          }
        }
        html += '\n    </tr>';
      }
      html += '\n  </tbody>';
    }
  } else {
    html += '\n  <tbody>';
    for (const row of table.content) {
      if (row.type === 'tableRow' && row.content) {
        html += '\n    <tr>';
        for (const cell of row.content) {
          const cellContent = cell.content ? convertTableCellContent(cell.content, ctx) : '';
          const cellTag = cell.type === 'tableHeader' ? 'th' : 'td';
          let cellAttrs = '';
          const colspan = (cell.attrs?.colspan as number) || 1;
          const rowspan = (cell.attrs?.rowspan as number) || 1;
          if (colspan > 1) { cellAttrs += ` colspan="${colspan}"`; }
          if (rowspan > 1) { cellAttrs += ` rowspan="${rowspan}"`; }
          html += `\n      <${cellTag}${cellAttrs}>${cellContent}</${cellTag}>`;
        }
        html += '\n    </tr>';
      }
    }
    html += '\n  </tbody>';
  }

  html += '\n</table>';
  return html;
}

function convertImage(node: TiptapNode, ctx: ConvertContext): string {
  const src = (node.attrs?.src as string) || '';
  const alt = (node.attrs?.alt as string) || '';
  const title = (node.attrs?.title as string) || '';
  const caption = (node.attrs?.caption as string) || '';
  const align = (node.attrs?.align as string) || 'center';
  ctx.imageCounter++;
  const prefix = ctx.settings.imageCaptionPrefix ?? '';
  const numbering = ctx.settings.captionNumbering === 'hierarchical'
    ? `${ctx.h1Counter}.${ctx.imageCounter}`
    : `${ctx.imageCounter}`;

  const alignStyle = align === 'left'
    ? ' style="display:block; margin-right:auto; margin-left:0;"'
    : align === 'right'
      ? ' style="display:block; margin-right:0; margin-left:auto;"'
      : ' style="display:block; margin:0 auto; text-align:center;"';

  const figNodeId = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
  const figId = figNodeId ? ` id="${escapeHtml(figNodeId)}"` : '';
  let html = `<figure class="doc-image"${figId}${alignStyle}>`;

  if (title) {
    html += `\n  <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}">`;
  } else {
    html += `\n  <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  }

  if (caption) {
    html += `\n  <figcaption>${formatCaptionLabel(prefix, numbering, escapeHtml(caption), ctx.settings.captionSeparator ?? ' ')}</figcaption>`;
  }

  html += '\n</figure>';
  return html;
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  let result = text;

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `<strong>${result}</strong>`;
        break;
      case 'italic':
        result = `<em>${result}</em>`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'strike':
        result = `<s>${result}</s>`;
        break;
      case 'subscript':
        result = `<sub>${result}</sub>`;
        break;
      case 'superscript':
        result = `<sup>${result}</sup>`;
        break;
      case 'code':
        result = `<code>${result}</code>`;
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) || '';
        const htmlHref = href.replace(/\.sdoc(#|$)/, '.html$1');
        result = `<a href="${escapeHtml(htmlHref)}">${result}</a>`;
        break;
      }
      case 'textStyle': {
        const color = mark.attrs?.color as string;
        if (color) result = `<span style="color:${escapeHtml(color)}">${result}</span>`;
        break;
      }
      case 'highlight': {
        const bg = (mark.attrs?.color as string) || '#fef08a';
        result = `<mark style="background-color:${escapeHtml(bg)}">${result}</mark>`;
        break;
      }
    }
  }

  return result;
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

const AUTO_RENDER_CALL = `renderMathInElement(document.body, { delimiters: [
  {left: '\\\\[', right: '\\\\]', display: true},
  {left: '\\\\(', right: '\\\\)', display: false}
]});`;

function generateScriptTags(settings: ExportSettings): string {
  const assets = settings.embeddedAssets;
  if (assets && settings.selfContained === 'full') {
    const parts: string[] = [];
    if (assets.katexCss) {
      parts.push(`<style>${assets.katexCss}</style>`);
    }
    if (assets.katexJs) {
      parts.push(`<script>${assets.katexJs}</script>`);
    }
    if (assets.autoRenderJs) {
      parts.push(`<script>${assets.autoRenderJs}\n${AUTO_RENDER_CALL}</script>`);
    }
    if (assets.mermaidJs) {
      parts.push(`<script>${assets.mermaidJs}\n${MERMAID_INIT}</script>`);
    }
    return parts.join('\n  ');
  }

  return `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
    onload="${AUTO_RENDER_CALL}"></script>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    ${MERMAID_INIT}
  </script>`;
}

function generateHtmlDocument(bodyContent: string, theme?: HtmlTheme, meta?: SdocMeta, ctx?: ConvertContext): string {
  const companyLogo = theme?.companyLogo || '';
  const companyName = theme?.companyName || '';
  const primaryColor = theme?.primaryColor || '#A50034';
  const accentColor = theme?.accentColor || '#6b6b6b';
  const fontFamily = theme?.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  const customStyles = theme?.customStyles || '';
  const fw = theme?.fontWeights || { body: 400, bold: 700, h1: 700, h2: 600, h3: 600 };

  // Generate @font-face rules if embeddedFonts are provided
  const fontFaceRules = (theme?.embeddedFonts || []).map(f => `
    @font-face {
      font-family: 'Structured Doc Embedded Font';
      font-weight: ${f.weight};
      font-style: normal;
      font-display: swap;
      src: url(${f.dataUri}) format('woff2');
    }`).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta?.title ? escapeHtml(meta.title) : 'Document'}</title>
  ${meta?.author ? `<meta name="author" content="${escapeHtml(meta.author)}">` : ''}
  <style>
    ${fontFaceRules}
    /* Base Styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: ${fontFamily};
      font-weight: ${fw.body};
      font-size: 16px;
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      background-color: #FFFFFF;
    }

    strong, b {
      font-weight: ${fw.bold};
    }

    /* Header with Company Logo */
    .document-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid ${primaryColor};
    }

    .company-logo {
      max-height: 60px;
      max-width: 200px;
    }

    .company-name {
      font-size: 24px;
      font-weight: bold;
      color: ${primaryColor};
    }

    .document-title {
      font-size: 2.4em;
      font-weight: 700;
      color: #333;
      margin-bottom: 0.3em;
    }

    .document-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5em;
      margin-bottom: 2em;
      padding: 1em;
      background-color: #f9fafb;
      border-left: 3px solid ${primaryColor};
      font-size: 0.9em;
      color: #6b6b6b;
    }

    .document-meta .meta-item strong {
      color: #6b6b6b;
    }

    /* Headings with Auto-numbering */
    body {
      counter-reset: h1 h2 h3 h4;
    }

    h1 {
      counter-set: h2 0 h3 0 h4 0;
      counter-increment: h1;
      font-size: 2em;
      font-weight: ${fw.h1};
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      color: ${primaryColor};
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 0.3em;
    }

    h1.document-title {
      counter-increment: none;
      font-size: 2.4em;
      color: #333;
      border-bottom: none;
      padding-bottom: 0;
      margin-top: 0;
    }

    h1.document-title::before {
      content: none;
    }

    h1::before {
      content: counter(h1) ". ";
    }

    h2 {
      counter-set: h3 0 h4 0;
      counter-increment: h2;
      font-size: 1.5em;
      font-weight: ${fw.h2};
      margin-top: 1.3em;
      margin-bottom: 0.4em;
      color: ${accentColor};
    }

    h2::before {
      content: counter(h1) "." counter(h2) ". ";
    }

    h3 {
      counter-set: h4 0;
      counter-increment: h3;
      font-size: 1.25em;
      font-weight: ${fw.h3};
      margin-top: 1.2em;
      margin-bottom: 0.3em;
      color: #6b6b6b;
    }

    h3::before {
      content: counter(h1) "." counter(h2) "." counter(h3) ". ";
    }

    h4 {
      counter-increment: h4;
      font-size: 1.1em;
      margin-top: 1em;
      margin-bottom: 0.3em;
      color: #6b6b6b;
    }

    h4::before {
      content: counter(h1) "." counter(h2) "." counter(h3) "." counter(h4) ". ";
    }

    /* Headings explicitly excluded from numbering (e.g. Introduction, Glossary, References) */
    h1[data-numbered="false"],
    h2[data-numbered="false"],
    h3[data-numbered="false"],
    h4[data-numbered="false"] {
      counter-increment: none;
    }

    h1[data-numbered="false"]::before,
    h2[data-numbered="false"]::before,
    h3[data-numbered="false"]::before,
    h4[data-numbered="false"]::before {
      content: none;
    }

    /* Paragraphs */
    p {
      margin-bottom: 1em;
      text-align: justify;
    }

    /* Lists */
    ul, ol {
      margin-left: 2em;
      margin-bottom: 1em;
    }

    li {
      margin-bottom: 0.5em;
    }

    /* Code */
    code {
      background-color: #f3f4f6;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.9em;
    }

    pre {
      background-color: #1f2937;
      color: #f9fafb;
      padding: 1em;
      border-radius: 5px;
      overflow-x: auto;
      margin-bottom: 1em;
    }

    pre.mermaid {
      background-color: #ffffff;
      color: inherit;
      padding: 0;
    }

    pre.mermaid svg {
      background-color: #ffffff !important;
      border-radius: 5px;
    }

    pre code {
      background-color: transparent;
      padding: 0;
      color: inherit;
    }

    /* Syntax Highlighting (highlight.js) */
    .hljs-comment, .hljs-quote { color: #6a9955; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-addition { color: #569cd6; }
    .hljs-number, .hljs-string, .hljs-meta .hljs-meta-string,
    .hljs-literal, .hljs-doctag, .hljs-regexp { color: #ce9178; }
    .hljs-title, .hljs-section, .hljs-name,
    .hljs-selector-id, .hljs-selector-class { color: #dcdcaa; }
    .hljs-attribute, .hljs-attr, .hljs-variable,
    .hljs-template-variable, .hljs-class .hljs-title, .hljs-type { color: #4ec9b0; }
    .hljs-symbol, .hljs-bullet, .hljs-subst,
    .hljs-meta, .hljs-meta .hljs-keyword, .hljs-tag { color: #d4d4d4; }
    .hljs-built_in, .hljs-builtin-name { color: #4ec9b0; }
    .hljs-deletion { color: #ce9178; text-decoration: line-through; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: bold; }

    /* Tables */
    table.doc-table {
      border-collapse: collapse;
      margin: 1.5em 0;
      width: 100%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    table.doc-table caption {
      font-weight: bold;
      margin-bottom: 0.5em;
      color: ${primaryColor};
      text-align: left;
      caption-side: top;
    }

    table.doc-table th,
    table.doc-table td {
      border: 1px solid #e5e7eb;
      padding: 0.75em;
      text-align: left;
    }

    table.doc-table thead th {
      background-color: ${primaryColor};
      color: white;
      font-weight: bold;
    }

    table.doc-table tbody tr:nth-child(even) {
      background-color: #f9fafb;
    }

    table.doc-table tbody tr:hover {
      background-color: #f3f4f6;
    }

    /* Images */
    figure.doc-image {
      margin: 1.5em 0;
      text-align: center;
    }

    figure.doc-image img {
      max-width: 100%;
      height: auto;
      border: 1px solid #e5e7eb;
      border-radius: 5px;
    }

    figure.doc-image figcaption {
      margin-top: 0.5em;
      font-style: italic;
      color: #6b6b6b;
      font-size: 0.9em;
    }

    /* Text Formatting */
    strong {
      font-weight: bold;
    }

    em {
      font-style: italic;
    }

    u {
      text-decoration: underline;
    }

    s {
      text-decoration: line-through;
    }

    a {
      color: ${primaryColor};
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    /* Task List */
    .task-list {
      list-style: none;
      padding-left: 0;
    }

    .task-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 4px 0;
    }

    .task-item input[type="checkbox"] {
      margin-top: 3px;
      width: 16px;
      height: 16px;
      accent-color: ${primaryColor};
    }

    .task-item input:checked + span,
    .task-item input:checked ~ * {
      text-decoration: line-through;
      opacity: 0.6;
    }

    /* Print Styles */
    @media print {
      body {
        max-width: 100%;
        padding: 20px;
      }

      .document-header {
        page-break-after: avoid;
      }

      h1, h2, h3, h4, h5, h6 {
        page-break-after: avoid;
      }

      table, figure {
        page-break-inside: avoid;
      }
    }

    /* Custom Styles */
    ${customStyles}

    /* Math Styles */
    .math-inline { display: inline; }
    .math-block { display: block; text-align: center; margin: 1em 0; overflow-x: auto; }

    /* Blockquote */
    blockquote {
      margin: 1em 0;
      padding: 0.6em 1em;
      border-left: 4px solid ${primaryColor};
      background-color: rgba(0,0,0,0.04);
      border-radius: 0 4px 4px 0;
    }
    blockquote p { margin: 0; }
    blockquote p + p { margin-top: 0.5em; }

    /* Callout */
    .callout {
      margin: 1em 0;
      padding: 0.75em 1em;
      border-radius: 6px;
      border-left: 4px solid;
    }
    .callout-header {
      display: flex;
      align-items: center;
      gap: 0.4em;
      font-weight: 700;
      font-size: 0.82em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.4em;
    }
    .callout-content > p:first-child { margin-top: 0; }
    .callout-content > p:last-child { margin-bottom: 0; }
    .callout-note   { background: rgba(100,116,139,.1); border-color: #64748b; }
    .callout-note   .callout-header { color: #64748b; }
    .callout-info   { background: rgba(14,165,233,.1);  border-color: #0ea5e9; }
    .callout-info   .callout-header { color: #0ea5e9; }
    .callout-tip    { background: rgba(34,197,94,.1);   border-color: #22c55e; }
    .callout-tip    .callout-header { color: #22c55e; }
    .callout-warning{ background: rgba(245,158,11,.1);  border-color: #f59e0b; }
    .callout-warning .callout-header { color: #f59e0b; }
    .callout-danger { background: rgba(239,68,68,.1);   border-color: #ef4444; }
    .callout-danger .callout-header { color: #ef4444; }
  </style>
  ${generateScriptTags(ctx?.settings || {})}
</head>
<body>
  ${companyLogo || companyName ? `
  <header class="document-header">
    ${companyLogo ? `<img src="${companyLogo}" alt="Company Logo" class="company-logo">` : ''}
    ${companyName ? `<div class="company-name">${escapeHtml(companyName)}</div>` : ''}
  </header>
  ` : ''}
  ${meta?.title ? `<h1 class="document-title">${escapeHtml(meta.title)}</h1>` : ''}
  ${meta && (meta.author || meta.version || meta.created || meta.modified) ? `
  <div class="document-meta">
    ${meta.author ? `<span class="meta-item"><strong>Author:</strong> ${escapeHtml(meta.author)}</span>` : ''}
    ${meta.version ? `<span class="meta-item"><strong>Version:</strong> ${escapeHtml(meta.version)}</span>` : ''}
    ${meta.created ? `<span class="meta-item"><strong>Created:</strong> ${escapeHtml(formatDate(meta.created))}</span>` : ''}
    ${meta.modified ? `<span class="meta-item"><strong>Modified:</strong> ${escapeHtml(formatDate(meta.modified))}</span>` : ''}
  </div>
  ` : ''}

  ${bodyContent}
</body>
</html>`;
}
