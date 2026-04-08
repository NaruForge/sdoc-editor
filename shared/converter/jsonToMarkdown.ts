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

interface ExportSettings {
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  captionNumbering?: 'simple' | 'hierarchical';
}

export interface SdocMeta {
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
}

let currentSettings: ExportSettings = {};
let imageCounter = 0;
let tableCounter = 0;
let h1Counter = 0;

/**
 * Converts Tiptap JSON to Markdown format
 */
export function convertJsonToMarkdown(json: TiptapNode, settings?: ExportSettings, meta?: SdocMeta): string {
  currentSettings = settings || {};
  imageCounter = 0;
  tableCounter = 0;
  h1Counter = 0;
  let frontMatter = '';
  if (meta && (meta.title || meta.author || meta.version || meta.created || meta.modified)) {
    frontMatter = '---\n';
    if (meta.title) { frontMatter += `title: "${meta.title}"\n`; }
    if (meta.author) { frontMatter += `author: "${meta.author}"\n`; }
    if (meta.version) { frontMatter += `version: "${meta.version}"\n`; }
    if (meta.created) { frontMatter += `created: "${meta.created}"\n`; }
    if (meta.modified) { frontMatter += `modified: "${meta.modified}"\n`; }
    frontMatter += '---\n\n';
  }
  return frontMatter + convertNode(json).trim() + '\n';
}

function convertNode(node: TiptapNode): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(convertNode).join('\n') : '';

    case 'heading': {
      const level = node.attrs?.level || 1;
      const headingPrefix = '#'.repeat(level);
      const headingText = node.content ? convertInlineContent(node.content) : '';
      if (level === 1) { h1Counter++; imageCounter = 0; tableCounter = 0; }
      const anchor = node.attrs?.id ? ` {#${node.attrs.id}}` : '';
      return `${headingPrefix} ${headingText}${anchor}\n`;
    }

    case 'paragraph': {
      const paragraphText = node.content ? convertInlineContent(node.content) : '';
      const align = node.attrs?.textAlign;
      if (paragraphText && align && align !== 'left') {
        return `<p style="text-align:${align}">${paragraphText}</p>\n`;
      }
      return paragraphText ? `${paragraphText}\n` : '';
    }

    case 'bulletList':
      return node.content ? node.content.map((item) => convertListItem(item, '-')).join('') : '';

    case 'orderedList':
      return node.content ? node.content.map((item, index) => convertListItem(item, `${index + 1}.`)).join('') : '';

    case 'listItem':
      // This is handled by the list itself
      return '';

    case 'taskList':
      return node.content ? node.content.map((item) => {
        const checked = item.attrs?.checked ? 'x' : ' ';
        const text = item.content ? item.content.map((child) => {
          if (child.type === 'paragraph') {
            return child.content ? convertInlineContent(child.content) : '';
          }
          return convertNode(child);
        }).join('\n') : '';
        return `- [${checked}] ${text}\n`;
      }).join('') : '';

    case 'taskItem':
      return '';

    case 'codeBlock':
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map((n) => n.text || '').join('\n') : '';
      return `\`\`\`${language}\n${code}\n\`\`\`\n`;

    case 'mathInline':
      return `$${node.attrs?.latex || ''}$`;

    case 'mathBlock':
      return `$$\n${node.attrs?.latex || ''}\n$$\n`;

    case 'diagram': {
      const diagLang = node.attrs?.language || 'mermaid';
      const diagCode = node.attrs?.code || '';
      return `\`\`\`${diagLang}\n${diagCode}\n\`\`\`\n`;
    }

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
      return '  \n'; // Two spaces followed by newline for hard break in Markdown

    case 'text':
      return applyMarks(node.text || '', node.marks || []);

    default:
      // For unknown types, try to process content if available
      return node.content ? node.content.map(convertNode).join('') : '';
  }
}

function convertInlineContent(content: TiptapNode[]): string {
  return content.map(convertNode).join('');
}

/**
 * Escape pipe characters and newlines for safe use inside Markdown table cells.
 */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

/**
 * Check if a table contains complex cells (colspan/rowspan or multi-block content)
 * that cannot be represented in standard GFM pipe tables.
 */
function isComplexTable(table: TiptapNode): boolean {
  for (const row of table.content || []) {
    for (const cell of row.content || []) {
      const colspan = cell.attrs?.colspan || 1;
      const rowspan = cell.attrs?.rowspan || 1;
      if (colspan > 1 || rowspan > 1) { return true; }
      // Multi-block content (more than one block, or non-paragraph block)
      if (cell.content && cell.content.length > 1) { return true; }
      if (cell.content?.some((c: TiptapNode) => c.type !== 'paragraph')) { return true; }
    }
  }
  return false;
}

/**
 * Converts table cell content without adding paragraph tags (for GFM pipe tables)
 */
function convertTableCellContent(content: TiptapNode[]): string {
  return escapeTableCell(
    content.map((node) => {
      if (node.type === 'paragraph') {
        return node.content ? convertInlineContent(node.content) : '';
      }
      return convertNode(node);
    }).join('').trim()
  );
}

/**
 * Converts table cell content for HTML fallback (preserves block structure)
 */
function convertTableCellContentHtml(content: TiptapNode[]): string {
  return content.map((node) => {
    if (node.type === 'paragraph') {
      const text = node.content ? convertInlineContent(node.content) : '';
      return text;
    }
    return convertNode(node);
  }).join('<br>').trim();
}

function convertListItem(item: TiptapNode, marker: string): string {
  if (item.type !== 'listItem') {
    return '';
  }

  const itemContent = item.content
    ? item.content.map((child) => {
        if (child.type === 'paragraph') {
          return child.content ? convertInlineContent(child.content) : '';
        }
        return convertNode(child);
      }).join('\n')
    : '';

  return `${marker} ${itemContent}\n`;
}

function convertTable(table: TiptapNode): string {
  if (!table.content || table.content.length === 0) {
    return '';
  }

  // Caption (shared by both paths)
  let captionMd = '';
  const caption = table.attrs?.caption;
  if (caption) {
    tableCounter++;
    const prefix = currentSettings.tableCaptionPrefix || 'Table';
    const numbering = currentSettings.captionNumbering === 'hierarchical'
      ? `${h1Counter}.${tableCounter}`
      : `${tableCounter}`;
    captionMd = `**${prefix} ${numbering}: ${caption}**\n\n`;
  }

  if (isComplexTable(table)) {
    return captionMd + convertTableAsHtml(table);
  }
  return captionMd + convertTableAsGfm(table);
}

/**
 * Calculate the logical column count from the first row (accounting for colspan).
 */
function getLogicalColumnCount(table: TiptapNode): number {
  const firstRow = table.content?.[0];
  if (!firstRow?.content) { return 0; }
  return firstRow.content.reduce((sum: number, cell: TiptapNode) => {
    return sum + (cell.attrs?.colspan || 1);
  }, 0);
}

/**
 * Convert a simple table (no colspan/rowspan) to GFM pipe syntax.
 */
function convertTableAsGfm(table: TiptapNode): string {
  let md = '';
  const colCount = getLogicalColumnCount(table);

  const hasHeader = table.content![0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  if (hasHeader && table.content![0]) {
    const headerRow = table.content![0];
    if (headerRow.content) {
      const headers: string[] = [];
      for (const cell of headerRow.content) {
        headers.push(cell.content ? convertTableCellContent(cell.content) : '');
      }
      // Pad to column count if needed
      while (headers.length < colCount) { headers.push(''); }
      md += '| ' + headers.join(' | ') + ' |\n';
      md += '|' + headers.map(() => ' --- ').join('|') + '|\n';
    }

    for (let i = 1; i < table.content!.length; i++) {
      const row = table.content![i];
      if (row.type === 'tableRow' && row.content) {
        const cells: string[] = [];
        for (const cell of row.content) {
          cells.push(cell.content ? convertTableCellContent(cell.content) : '');
        }
        while (cells.length < colCount) { cells.push(''); }
        md += '| ' + cells.join(' | ') + ' |\n';
      }
    }
  } else {
    // No header: generate an empty header row so GFM renderers recognize the table
    const emptyHeaders = Array(colCount).fill('');
    md += '| ' + emptyHeaders.join(' | ') + ' |\n';
    md += '|' + emptyHeaders.map(() => ' --- ').join('|') + '|\n';

    for (const row of table.content!) {
      if (row.type === 'tableRow' && row.content) {
        const cells: string[] = [];
        for (const cell of row.content) {
          cells.push(cell.content ? convertTableCellContent(cell.content) : '');
        }
        while (cells.length < colCount) { cells.push(''); }
        md += '| ' + cells.join(' | ') + ' |\n';
      }
    }
  }

  md += '\n';
  return md;
}

/**
 * Convert a complex table (colspan/rowspan/multi-block cells) to HTML.
 * Raw HTML is valid inside GFM / CommonMark.
 */
function convertTableAsHtml(table: TiptapNode): string {
  const align = table.attrs?.align || 'left';
  const width = table.attrs?.width || '100%';
  const tId = table.attrs?.id ? ` id="${table.attrs.id}"` : '';
  let html = `<table${tId} style="width:${width}; text-align:${align};">`;

  const hasHeader = table.content![0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  const renderCellAttrs = (cell: TiptapNode): string => {
    let attrs = '';
    const colspan = cell.attrs?.colspan || 1;
    const rowspan = cell.attrs?.rowspan || 1;
    if (colspan > 1) { attrs += ` colspan="${colspan}"`; }
    if (rowspan > 1) { attrs += ` rowspan="${rowspan}"`; }
    return attrs;
  };

  if (hasHeader && table.content![0]) {
    html += '\n<thead>\n<tr>';
    const headerRow = table.content![0];
    if (headerRow.content) {
      for (const cell of headerRow.content) {
        const cellContent = cell.content ? convertTableCellContentHtml(cell.content) : '';
        html += `<th${renderCellAttrs(cell)}>${cellContent}</th>`;
      }
    }
    html += '</tr>\n</thead>';

    if (table.content!.length > 1) {
      html += '\n<tbody>';
      for (let i = 1; i < table.content!.length; i++) {
        const row = table.content![i];
        html += '\n<tr>';
        if (row.content) {
          for (const cell of row.content) {
            const cellContent = cell.content ? convertTableCellContentHtml(cell.content) : '';
            html += `<td${renderCellAttrs(cell)}>${cellContent}</td>`;
          }
        }
        html += '</tr>';
      }
      html += '\n</tbody>';
    }
  } else {
    html += '\n<tbody>';
    for (const row of table.content!) {
      if (row.type === 'tableRow' && row.content) {
        html += '\n<tr>';
        for (const cell of row.content) {
          const cellContent = cell.content ? convertTableCellContentHtml(cell.content) : '';
          const tag = cell.type === 'tableHeader' ? 'th' : 'td';
          html += `<${tag}${renderCellAttrs(cell)}>${cellContent}</${tag}>`;
        }
        html += '</tr>';
      }
    }
    html += '\n</tbody>';
  }

  html += '\n</table>\n\n';
  return html;
}

function convertImage(node: TiptapNode): string {
  const src = node.attrs?.src || '';
  const alt = node.attrs?.alt || '';
  const caption = node.attrs?.caption || '';

  let md = `![${alt}](${src})`;

  if (caption) {
    imageCounter++;
    const prefix = currentSettings.imageCaptionPrefix || 'Image';
    const numbering = currentSettings.captionNumbering === 'hierarchical'
      ? `${h1Counter}.${imageCounter}`
      : `${imageCounter}`;
    md += `\n\n*${prefix} ${numbering}: ${caption}*`;
  }

  return md + '\n';
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  let result = text;

  // Apply marks in order: bold, italic, code (innermost to outermost)
  const hasBold = marks.some(m => m.type === 'bold');
  const hasItalic = marks.some(m => m.type === 'italic');
  const hasUnderline = marks.some(m => m.type === 'underline');
  const hasStrike = marks.some(m => m.type === 'strike');
  const hasSubscript = marks.some(m => m.type === 'subscript');
  const hasSuperscript = marks.some(m => m.type === 'superscript');
  const hasCode = marks.some(m => m.type === 'code');
  const linkMark = marks.find(m => m.type === 'link');
  const colorMark = marks.find(m => m.type === 'textStyle');
  const highlightMark = marks.find(m => m.type === 'highlight');

  // Code takes precedence
  if (hasCode) {
    result = `\`${result}\``;
  } else {
    // Apply formatting marks
    if (hasBold && hasItalic) {
      result = `***${result}***`;
    } else if (hasBold) {
      result = `**${result}**`;
    } else if (hasItalic) {
      result = `*${result}*`;
    }

    if (hasStrike) {
      result = `~~${result}~~`;
    }

    if (hasSubscript) {
      result = `~${result}~`;
    }

    if (hasSuperscript) {
      result = `^${result}^`;
    }

    // Note: Markdown doesn't have native underline, we'll use HTML
    if (hasUnderline) {
      result = `<u>${result}</u>`;
    }
  }

  // Apply link last
  if (linkMark) {
    const href = linkMark.attrs?.href || '';
    const mdHref = href.replace(/\.sdoc(#|$)/, '.md$1');
    result = `[${result}](${mdHref})`;
  }

  // color/highlight: fall back to HTML span (Markdown has no native support)
  if (colorMark?.attrs?.color) {
    result = `<span style="color:${colorMark.attrs.color}">${result}</span>`;
  }
  if (highlightMark) {
    const bg = highlightMark.attrs?.color || '#fef08a';
    result = `<mark style="background-color:${bg}">${result}</mark>`;
  }

  return result;
}
