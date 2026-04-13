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
 * Converts Tiptap JSON to AsciiDoc format
 */
export function convertJsonToAdoc(json: TiptapNode, settings?: ExportSettings, meta?: SdocMeta): string {
  const ctx: ConvertContext = {
    settings: settings || {},
    imageCounter: 0,
    tableCounter: 0,
    h1Counter: 0,
    eqGlobal: 0,
    eqInSection: 0,
  };
  // Add AsciiDoc document attributes
  let docAttributes = ':sectnums:\n:sectnumlevels: 4\n';
  if (meta?.title) { docAttributes += `= ${meta.title}\n`; }
  if (meta?.author) { docAttributes += `:author: ${meta.author}\n`; }
  if (meta?.version) { docAttributes += `:revnumber: ${meta.version}\n`; }
  if (meta?.modified) { docAttributes += `:revdate: ${formatDate(meta.modified)}\n`; }
  if (meta?.created) { docAttributes += `:created: ${formatDate(meta.created)}\n`; }
  docAttributes += '\n';
  return docAttributes + convertNode(json, ctx).trim() + '\n';
}

function convertNode(node: TiptapNode, ctx: ConvertContext): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(n => convertNode(n, ctx)).join('\n') : '';

    case 'heading': {
      const level = node.attrs?.level || 1;
      const headingPrefix = '='.repeat(level + 1);
      const headingText = node.content ? convertInlineContent(node.content, ctx) : '';
      if (level === 1) { ctx.h1Counter++; ctx.imageCounter = 0; ctx.tableCounter = 0; ctx.eqInSection = 0; }
      const hAnchor = node.attrs?.id ? `[[${node.attrs.id}]]\n` : '';
      return `${hAnchor}${headingPrefix} ${headingText}\n`;
    }

    case 'paragraph': {
      const paragraphText = node.content ? convertInlineContent(node.content, ctx) : '';
      const align = node.attrs?.textAlign;
      if (paragraphText && align && align !== 'left') {
        const adocAlign = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-justify';
        return `[.${adocAlign}]\n${paragraphText}\n`;
      }
      return paragraphText ? `${paragraphText}\n` : '';
    }

    case 'bulletList':
      return node.content ? node.content.map((item) => convertListItem(item, '*', ctx)).join('') : '';

    case 'orderedList':
      return node.content ? node.content.map((item) => convertListItem(item, '.', ctx)).join('') : '';

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
        return `* [${checked}] ${text}\n`;
      }).join('') : '';

    case 'taskItem':
      return '';

    case 'codeBlock': {
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map((n) => n.text || '').join('\n') : '';
      return `[source${language ? `,${language}` : ''}]\n----\n${code}\n----\n`;
    }

    case 'diagram': {
      const diagLang = node.attrs?.language || 'mermaid';
      const diagCode = node.attrs?.code || '';
      return `[${diagLang}]\n....\n${diagCode}\n....\n`;
    }

    case 'mathInline':
      return `stem:[${(node.attrs?.latex as string) || ''}]`;

    case 'mathBlock': {
      ctx.eqGlobal++;
      ctx.eqInSection++;
      const eqMode = ctx.settings.equationNumbering ?? 'sequential';
      const eqLabel = eqMode === 'hierarchical' ? `${ctx.h1Counter}.${ctx.eqInSection}` : `${ctx.eqGlobal}`;
      const latex = (node.attrs?.latex as string) || '';
      const idAttr = node.attrs?.id ? `id="${node.attrs.id}", ` : '';
      return `[${idAttr}stem, options="nowrap"]\n++++\n${latex}\\tag{${eqLabel}}\n++++\n`;
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
      return ' +\n';

    case 'text':
      return applyMarks(node.text || '', node.marks || []);

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

  let adoc = '';

  const caption = table.attrs?.caption;
  if (caption) {
    ctx.tableCounter++;
    const prefix = ctx.settings.tableCaptionPrefix || 'Table';
    const numbering = ctx.settings.captionNumbering === 'hierarchical'
      ? `${ctx.h1Counter}.${ctx.tableCounter}`
      : `${ctx.tableCounter}`;
    adoc += `.${prefix} ${numbering}: ${caption}\n`;
  }

  const hasHeader = table.content[0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  const align = table.attrs?.align;
  const width = table.attrs?.width;

  const tableOptions: string[] = [];

  if (hasHeader) {
    tableOptions.push('header');
  }

  if (align && align !== 'left') {
    tableOptions.push(`align="${align}"`);
  }

  if (width && width !== '100%') {
    tableOptions.push(`width="${width}"`);
  }

  if (tableOptions.length > 0) {
    adoc += `[${tableOptions.join(',')}]\n`;
  }

  adoc += '|===\n';

  for (const row of table.content) {
    if (row.type === 'tableRow' && row.content) {
      const cells: string[] = [];
      for (const cell of row.content) {
        const cellContent = cell.content ? convertTableCellContent(cell.content, ctx) : '';
        cells.push(cellContent);
      }
      adoc += '| ' + cells.join(' | ') + '\n';
    }
  }

  adoc += '|===\n';
  return adoc;
}

function convertImage(node: TiptapNode, ctx: ConvertContext): string {
  const src = node.attrs?.src || '';
  const alt = node.attrs?.alt || '';
  const title = node.attrs?.title || '';
  const caption = node.attrs?.caption;

  if (!src) {
    return '';
  }

  let adoc = '';

  if (caption) {
    ctx.imageCounter++;
    const prefix = ctx.settings.imageCaptionPrefix || 'Image';
    const numbering = ctx.settings.captionNumbering === 'hierarchical'
      ? `${ctx.h1Counter}.${ctx.imageCounter}`
      : `${ctx.imageCounter}`;
    adoc += `.${prefix} ${numbering}: ${caption}\n`;
  }

  adoc += `image::${src}[`;

  if (alt) {
    adoc += alt;
  }

  if (title) {
    adoc += `, ${title}`;
  }

  adoc += ']\n';

  return adoc;
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  let result = text;

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `*${result}*`;
        break;
      case 'italic':
        result = `_${result}_`;
        break;
      case 'underline':
        result = `[.underline]#${result}#`;
        break;
      case 'strike':
        result = `[.line-through]#${result}#`;
        break;
      case 'subscript':
        result = `~${result}~`;
        break;
      case 'superscript':
        result = `^${result}^`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) || '';
        if (href.startsWith('#')) {
          result = `<<${href.slice(1)},${result}>>`;
        } else if (href.includes('.sdoc')) {
          const adocHref = href.replace(/\.sdoc(#|$)/, '.adoc$1');
          result = `xref:${adocHref}[${result}]`;
        } else {
          result = `${href}[${result}]`;
        }
        break;
      }
      case 'textStyle': {
        const color = mark.attrs?.color;
        if (color) result = `[.color-custom]#${result}#`;
        break;
      }
      case 'highlight': {
        result = `[.highlight]#${result}#`;
        break;
      }
    }
  }

  return result;
}
