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

interface HtmlTheme {
  companyLogo?: string; // URL or base64 encoded logo
  companyName?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  customStyles?: string; // Additional custom CSS
}

/**
 * Converts Tiptap JSON to HTML format
 */
export function convertJsonToHtml(json: TiptapNode, theme?: HtmlTheme): string {
  const bodyContent = convertNode(json);
  return generateHtmlDocument(bodyContent, theme);
}

function convertNode(node: TiptapNode): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(convertNode).join('\n') : '';

    case 'heading':
      const level = node.attrs?.level || 1;
      const headingText = node.content ? convertInlineContent(node.content) : '';
      return `<h${level}>${headingText}</h${level}>`;

    case 'paragraph':
      const paragraphText = node.content ? convertInlineContent(node.content) : '';
      return paragraphText ? `<p>${paragraphText}</p>` : '<p></p>';

    case 'bulletList':
      const bulletItems = node.content ? node.content.map(convertNode).join('\n') : '';
      return `<ul>\n${bulletItems}\n</ul>`;

    case 'orderedList':
      const orderedItems = node.content ? node.content.map(convertNode).join('\n') : '';
      return `<ol>\n${orderedItems}\n</ol>`;

    case 'listItem':
      const itemContent = node.content
        ? node.content.map((child) => {
            if (child.type === 'paragraph') {
              return child.content ? convertInlineContent(child.content) : '';
            }
            return convertNode(child);
          }).join('\n')
        : '';
      return `  <li>${itemContent}</li>`;

    case 'codeBlock':
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map((n) => n.text || '').join('\n') : '';
      const escapedCode = escapeHtml(code);
      return `<pre><code class="language-${language}">${escapedCode}</code></pre>`;

    case 'mathInline':
      // Render inline LaTeX with KaTeX-compatible placeholder; actual rendering needs client-side katex
      return `<span class="math-inline" data-latex="${escapeHtml(node.attrs?.latex || '')}">\\(${escapeHtml(node.attrs?.latex || '')}\\)</span>`;

    case 'mathBlock':
      return `<div class="math-block" data-latex="${escapeHtml(node.attrs?.latex || '')}">\\[${escapeHtml(node.attrs?.latex || '')}\\]</div>`;

    case 'table':
      return convertTable(node);

    case 'image':
      return convertImage(node);

    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      // These are handled by the table converter
      return '';

    case 'hardBreak':
      return '<br>';

    case 'text':
      return applyMarks(escapeHtml(node.text || ''), node.marks || []);

    default:
      // For unknown types, try to process content if available
      return node.content ? node.content.map(convertNode).join('') : '';
  }
}

function convertInlineContent(content: TiptapNode[]): string {
  return content.map(convertNode).join('');
}

/**
 * Converts table cell content without adding paragraph tags
 */
function convertTableCellContent(content: TiptapNode[]): string {
  return content.map((node) => {
    if (node.type === 'paragraph') {
      // For paragraphs in table cells, just get the text without paragraph tags
      return node.content ? convertInlineContent(node.content) : '';
    }
    return convertNode(node);
  }).join('').trim();
}

function convertTable(table: TiptapNode): string {
  if (!table.content || table.content.length === 0) {
    return '';
  }

  let html = '';

  // Get table attributes
  const caption = table.attrs?.['data-caption'];
  const align = table.attrs?.['data-align'] || 'left';
  const width = table.attrs?.['data-width'] || '100%';

  // Check if first row has headers
  const hasHeader = table.content[0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  // Start table with attributes
  html += `<table style="width: ${width}; text-align: ${align};" class="doc-table">`;

  // Add caption if present
  if (caption) {
    html += `\n  <caption>${escapeHtml(caption)}</caption>`;
  }

  // Process rows
  if (hasHeader && table.content[0]) {
    // First row as header
    html += '\n  <thead>\n    <tr>';
    const headerRow = table.content[0];
    if (headerRow.content) {
      for (const cell of headerRow.content) {
        const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
        html += `\n      <th>${cellContent}</th>`;
      }
    }
    html += '\n    </tr>\n  </thead>';

    // Rest of rows as body
    if (table.content.length > 1) {
      html += '\n  <tbody>';
      for (let i = 1; i < table.content.length; i++) {
        const row = table.content[i];
        html += '\n    <tr>';
        if (row.content) {
          for (const cell of row.content) {
            const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
            html += `\n      <td>${cellContent}</td>`;
          }
        }
        html += '\n    </tr>';
      }
      html += '\n  </tbody>';
    }
  } else {
    // No header, all rows are body
    html += '\n  <tbody>';
    for (const row of table.content) {
      if (row.type === 'tableRow' && row.content) {
        html += '\n    <tr>';
        for (const cell of row.content) {
          const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
          const cellTag = cell.type === 'tableHeader' ? 'th' : 'td';
          html += `\n      <${cellTag}>${cellContent}</${cellTag}>`;
        }
        html += '\n    </tr>';
      }
    }
    html += '\n  </tbody>';
  }

  html += '\n</table>';
  return html;
}

function convertImage(node: TiptapNode): string {
  const src = node.attrs?.src || '';
  const alt = node.attrs?.alt || '';
  const title = node.attrs?.title || '';
  const caption = node.attrs?.['data-caption'] || '';
  const align = node.attrs?.align || 'center';

  const alignStyle = align === 'left'
    ? ' style="display:block; margin-right:auto; margin-left:0;"'
    : align === 'right'
      ? ' style="display:block; margin-right:0; margin-left:auto;"'
      : ' style="display:block; margin:0 auto; text-align:center;"';

  let html = `<figure class="doc-image"${alignStyle}>`;
  
  if (title) {
    html += `\n  <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}">`;
  } else {
    html += `\n  <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  }
  
  if (caption) {
    html += `\n  <figcaption>${escapeHtml(caption)}</figcaption>`;
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
      case 'code':
        result = `<code>${result}</code>`;
        break;
      case 'link':
        const href = mark.attrs?.href || '';
        result = `<a href="${escapeHtml(href)}">${result}</a>`;
        break;
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

function generateHtmlDocument(bodyContent: string, theme?: HtmlTheme): string {
  const companyLogo = theme?.companyLogo || '';
  const companyName = theme?.companyName || '';
  const primaryColor = theme?.primaryColor || '#2563eb';
  const accentColor = theme?.accentColor || '#1e40af';
  const fontFamily = theme?.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const customStyles = theme?.customStyles || '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
  <style>
    /* Base Styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: ${fontFamily};
      font-size: 16px;
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      background-color: #fff;
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

    /* Headings with Auto-numbering */
    body {
      counter-reset: h1;
    }

    h1 {
      counter-reset: h2;
      counter-increment: h1;
      font-size: 2em;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      color: ${primaryColor};
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 0.3em;
    }

    h1::before {
      content: counter(h1) ". ";
    }

    h2 {
      counter-reset: h3;
      counter-increment: h2;
      font-size: 1.5em;
      margin-top: 1.3em;
      margin-bottom: 0.4em;
      color: ${accentColor};
    }

    h2::before {
      content: counter(h1) "." counter(h2) ". ";
    }

    h3 {
      counter-reset: h4;
      counter-increment: h3;
      font-size: 1.25em;
      margin-top: 1.2em;
      margin-bottom: 0.3em;
      color: #374151;
    }

    h3::before {
      content: counter(h1) "." counter(h2) "." counter(h3) ". ";
    }

    h4 {
      counter-increment: h4;
      font-size: 1.1em;
      margin-top: 1em;
      margin-bottom: 0.3em;
      color: #4b5563;
    }

    h4::before {
      content: counter(h1) "." counter(h2) "." counter(h3) "." counter(h4) ". ";
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

    pre code {
      background-color: transparent;
      padding: 0;
      color: inherit;
    }

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
      color: #6b7280;
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
  </style>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
    onload="renderMathInElement(document.body, { delimiters: [
      {left: '\\\\[', right: '\\\\]', display: true},
      {left: '\\\\(', right: '\\\\)', display: false}
    ]})"></script>
</head>
<body>
  ${companyLogo || companyName ? `
  <header class="document-header">
    ${companyLogo ? `<img src="${companyLogo}" alt="Company Logo" class="company-logo">` : ''}
    ${companyName ? `<div class="company-name">${escapeHtml(companyName)}</div>` : ''}
  </header>
  ` : ''}
  
  ${bodyContent}
</body>
</html>`;
}
