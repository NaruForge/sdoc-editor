import { formatDate } from './utils';

interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  text?: string;
}

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface ExportSettings {
  imageCaptionPrefix?: string;
  tableCaptionPrefix?: string;
  captionNumbering?: 'simple' | 'hierarchical';
  equationNumbering?: 'sequential' | 'hierarchical';
}

export interface SdocMeta {
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
}

interface ConvertContext {
  settings: ExportSettings;
  imageCounter: number;
  tableCounter: number;
  h1Counter: number;
  eqGlobal: number;
  eqInSection: number;
}

/**
 * Converts Tiptap JSON to Markdown format
 */
export function convertJsonToMarkdown(json: TiptapNode, settings?: ExportSettings, meta?: SdocMeta): string {
  const ctx: ConvertContext = {
    settings: settings || {},
    imageCounter: 0,
    tableCounter: 0,
    h1Counter: 0,
    eqGlobal: 0,
    eqInSection: 0,
  };
  let frontMatter = '';
  if (meta && (meta.title || meta.author || meta.version || meta.created || meta.modified)) {
    frontMatter = '---\n';
    if (meta.title) { frontMatter += `title: "${meta.title}"\n`; }
    if (meta.author) { frontMatter += `author: "${meta.author}"\n`; }
    if (meta.version) { frontMatter += `version: "${meta.version}"\n`; }
    if (meta.created) { frontMatter += `created: "${formatDate(meta.created)}"\n`; }
    if (meta.modified) { frontMatter += `modified: "${formatDate(meta.modified)}"\n`; }
    frontMatter += '---\n\n';
  }
  return frontMatter + convertNode(json, ctx).trim() + '\n';
}

function convertNode(node: TiptapNode, ctx: ConvertContext): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(n => convertNode(n, ctx)).join('\n') : '';

    case 'heading': {
      const level = node.attrs?.level || 1;
      const headingPrefix = '#'.repeat(level as number);
      const headingText = node.content ? convertInlineContent(node.content, ctx) : '';
      if (level === 1) { ctx.h1Counter++; ctx.imageCounter = 0; ctx.tableCounter = 0; ctx.eqInSection = 0; }
      const anchor = node.attrs?.id ? ` {#${node.attrs.id}}` : '';
      return `${headingPrefix} ${headingText}${anchor}\n`;
    }

    case 'paragraph': {
      const paragraphText = node.content ? convertInlineContent(node.content, ctx) : '';
      const align = node.attrs?.textAlign;
      if (paragraphText && align && align !== 'left') {
        return `<p style="text-align:${align}">${paragraphText}</p>\n`;
      }
      return paragraphText ? `${paragraphText}\n` : '';
    }

    case 'bulletList':
      return node.content ? node.content.map((item) => convertListItem(item, '-', ctx)).join('') : '';

    case 'orderedList':
      return node.content ? node.content.map((item, index) => convertListItem(item, `${index + 1}.`, ctx)).join('') : '';

    case 'listItem':
      return '';

    case 'taskList':
      return node.content ? node.content.map((item) => {
        const checked = item.attrs?.checked ? 'x' : ' ';
        const text = item.content ? item.content.map((child) => {
          if (child.type === 'paragraph') {
            return child.content ? convertInlineContent(child.content, ctx) : '';
          }
          return convertNode(child, ctx);
        }).join('\n') : '';
        return `- [${checked}] ${text}\n`;
      }).join('') : '';

    case 'taskItem':
      return '';

    case 'codeBlock': {
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map((n) => n.text || '').join('\n') : '';
      return `\`\`\`${language}\n${code}\n\`\`\`\n`;
    }

    case 'mathInline':
      return `$${node.attrs?.latex || ''}$`;

    case 'mathBlock': {
      ctx.eqGlobal++;
      ctx.eqInSection++;
      const eqMode = ctx.settings.equationNumbering ?? 'sequential';
      const eqLabel = eqMode === 'hierarchical' ? `${ctx.h1Counter}.${ctx.eqInSection}` : `${ctx.eqGlobal}`;
      const latex = node.attrs?.latex || '';
      const eqId = node.attrs?.id ? `\n<a id="${node.attrs.id}"></a>` : '';
      return `${eqId}\n$$\n${latex}\\tag{${eqLabel}}\n$$\n`;
    }

    case 'diagram': {
      const diagLang = node.attrs?.language || 'mermaid';
      const diagCode = node.attrs?.code || '';
      return `\`\`\`${diagLang}\n${diagCode}\n\`\`\`\n`;
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
      return '  \n';

    case 'text':
      return applyMarks(node.text || '', node.marks || []);

    default:
      return node.content ? node.content.map(n => convertNode(n, ctx)).join('') : '';
  }
}

function convertInlineContent(content: TiptapNode[], ctx: ConvertContext): string {
  return content.map(n => convertNode(n, ctx)).join('');
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function isComplexTable(table: TiptapNode): boolean {
  for (const row of table.content || []) {
    for (const cell of row.content || []) {
      const colspan = (cell.attrs?.colspan as number) || 1;
      const rowspan = (cell.attrs?.rowspan as number) || 1;
      if (colspan > 1 || rowspan > 1) { return true; }
      if (cell.content && cell.content.length > 1) { return true; }
      if (cell.content?.some((c: TiptapNode) => c.type !== 'paragraph')) { return true; }
    }
  }
  return false;
}

function convertTableCellContent(content: TiptapNode[], ctx: ConvertContext): string {
  return escapeTableCell(
    content.map((node) => {
      if (node.type === 'paragraph') {
        return node.content ? convertInlineContent(node.content, ctx) : '';
      }
      return convertNode(node, ctx);
    }).join('').trim()
  );
}

function convertTableCellContentHtml(content: TiptapNode[], ctx: ConvertContext): string {
  return content.map((node) => {
    if (node.type === 'paragraph') {
      const text = node.content ? convertInlineContent(node.content, ctx) : '';
      return text;
    }
    return convertNode(node, ctx);
  }).join('<br>').trim();
}

function convertListItem(item: TiptapNode, marker: string, ctx: ConvertContext): string {
  if (item.type !== 'listItem') {
    return '';
  }

  const itemContent = item.content
    ? item.content.map((child) => {
        if (child.type === 'paragraph') {
          return child.content ? convertInlineContent(child.content, ctx) : '';
        }
        return convertNode(child, ctx);
      }).join('\n')
    : '';

  return `${marker} ${itemContent}\n`;
}

function convertTable(table: TiptapNode, ctx: ConvertContext): string {
  if (!table.content || table.content.length === 0) {
    return '';
  }

  let captionMd = '';
  const caption = table.attrs?.caption;
  if (caption) {
    ctx.tableCounter++;
    const prefix = ctx.settings.tableCaptionPrefix || 'Table';
    const numbering = ctx.settings.captionNumbering === 'hierarchical'
      ? `${ctx.h1Counter}.${ctx.tableCounter}`
      : `${ctx.tableCounter}`;
    captionMd = `**${prefix} ${numbering}: ${caption}**\n\n`;
  }

  if (isComplexTable(table)) {
    return captionMd + convertTableAsHtml(table, ctx);
  }
  return captionMd + convertTableAsGfm(table, ctx);
}

function getLogicalColumnCount(table: TiptapNode): number {
  const firstRow = table.content?.[0];
  if (!firstRow?.content) { return 0; }
  return firstRow.content.reduce((sum: number, cell: TiptapNode) => {
    return sum + ((cell.attrs?.colspan as number) || 1);
  }, 0);
}

function convertTableAsGfm(table: TiptapNode, ctx: ConvertContext): string {
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
        headers.push(cell.content ? convertTableCellContent(cell.content, ctx) : '');
      }
      while (headers.length < colCount) { headers.push(''); }
      md += '| ' + headers.join(' | ') + ' |\n';
      md += '|' + headers.map(() => ' --- ').join('|') + '|\n';
    }

    for (let i = 1; i < table.content!.length; i++) {
      const row = table.content![i];
      if (row.type === 'tableRow' && row.content) {
        const cells: string[] = [];
        for (const cell of row.content) {
          cells.push(cell.content ? convertTableCellContent(cell.content, ctx) : '');
        }
        while (cells.length < colCount) { cells.push(''); }
        md += '| ' + cells.join(' | ') + ' |\n';
      }
    }
  } else {
    const emptyHeaders = Array(colCount).fill('');
    md += '| ' + emptyHeaders.join(' | ') + ' |\n';
    md += '|' + emptyHeaders.map(() => ' --- ').join('|') + '|\n';

    for (const row of table.content!) {
      if (row.type === 'tableRow' && row.content) {
        const cells: string[] = [];
        for (const cell of row.content) {
          cells.push(cell.content ? convertTableCellContent(cell.content, ctx) : '');
        }
        while (cells.length < colCount) { cells.push(''); }
        md += '| ' + cells.join(' | ') + ' |\n';
      }
    }
  }

  md += '\n';
  return md;
}

function convertTableAsHtml(table: TiptapNode, ctx: ConvertContext): string {
  const align = table.attrs?.align || 'left';
  const width = table.attrs?.width || '100%';
  const tId = table.attrs?.id ? ` id="${table.attrs.id}"` : '';
  let html = `<table${tId} style="width:${width}; text-align:${align};">`;

  const hasHeader = table.content![0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  const renderCellAttrs = (cell: TiptapNode): string => {
    let attrs = '';
    const colspan = (cell.attrs?.colspan as number) || 1;
    const rowspan = (cell.attrs?.rowspan as number) || 1;
    if (colspan > 1) { attrs += ` colspan="${colspan}"`; }
    if (rowspan > 1) { attrs += ` rowspan="${rowspan}"`; }
    return attrs;
  };

  if (hasHeader && table.content![0]) {
    html += '\n<thead>\n<tr>';
    const headerRow = table.content![0];
    if (headerRow.content) {
      for (const cell of headerRow.content) {
        const cellContent = cell.content ? convertTableCellContentHtml(cell.content, ctx) : '';
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
            const cellContent = cell.content ? convertTableCellContentHtml(cell.content, ctx) : '';
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
          const cellContent = cell.content ? convertTableCellContentHtml(cell.content, ctx) : '';
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

function convertImage(node: TiptapNode, ctx: ConvertContext): string {
  const src = node.attrs?.src || '';
  const alt = node.attrs?.alt || '';
  const caption = node.attrs?.caption || '';

  let md = `![${alt}](${src})`;

  if (caption) {
    ctx.imageCounter++;
    const prefix = ctx.settings.imageCaptionPrefix || 'Image';
    const numbering = ctx.settings.captionNumbering === 'hierarchical'
      ? `${ctx.h1Counter}.${ctx.imageCounter}`
      : `${ctx.imageCounter}`;
    md += `\n\n*${prefix} ${numbering}: ${caption}*`;
  }

  return md + '\n';
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  let result = text;

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

  if (hasCode) {
    result = `\`${result}\``;
  } else {
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

    if (hasUnderline) {
      result = `<u>${result}</u>`;
    }
  }

  if (linkMark) {
    const href = (linkMark.attrs?.href as string) || '';
    const mdHref = href.replace(/\.sdoc(#|$)/, '.md$1');
    result = `[${result}](${mdHref})`;
  }

  if (colorMark?.attrs?.color) {
    result = `<span style="color:${colorMark.attrs.color}">${result}</span>`;
  }
  if (highlightMark) {
    const bg = (highlightMark.attrs?.color as string) || '#fef08a';
    result = `<mark style="background-color:${bg}">${result}</mark>`;
  }

  return result;
}
