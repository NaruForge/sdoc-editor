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

let currentSettings: ExportSettings = {};
let imageCounter = 0;
let tableCounter = 0;
let h1Counter = 0;

/**
 * Converts Tiptap JSON to AsciiDoc format
 */
export function convertJsonToAdoc(json: TiptapNode, settings?: ExportSettings): string {
  currentSettings = settings || {};
  imageCounter = 0;
  tableCounter = 0;
  h1Counter = 0;
  // Add AsciiDoc document attributes
  const docAttributes = ':sectnums:\n:sectnumlevels: 4\n\n';
  return docAttributes + convertNode(json).trim() + '\n';
}

function convertNode(node: TiptapNode): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(convertNode).join('\n') : '';

    case 'heading':
      const level = node.attrs?.level || 1;
      const headingPrefix = '='.repeat(level + 1);
      const headingText = node.content ? convertInlineContent(node.content) : '';
      if (level === 1) { h1Counter++; imageCounter = 0; tableCounter = 0; }
      return `${headingPrefix} ${headingText}\n`;

    case 'paragraph':
      const paragraphText = node.content ? convertInlineContent(node.content) : '';
      return paragraphText ? `${paragraphText}\n` : '';

    case 'bulletList':
      return node.content ? node.content.map((item) => convertListItem(item, '*')).join('') : '';

    case 'orderedList':
      return node.content ? node.content.map((item) => convertListItem(item, '.')).join('') : '';

    case 'listItem':
      // This is handled by the list itself
      return '';

    case 'codeBlock':
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map((n) => n.text || '').join('\n') : '';
      return `[source${language ? `,${language}` : ''}]\n----\n${code}\n----\n`;

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
      return ' +\n';

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
 * Converts table cell content without adding newlines from paragraphs
 */
function convertTableCellContent(content: TiptapNode[]): string {
  return content.map((node) => {
    if (node.type === 'paragraph') {
      // For paragraphs in table cells, just get the text without newlines
      return node.content ? convertInlineContent(node.content) : '';
    }
    return convertNode(node);
  }).join('').trim();
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

  let adoc = '';

  // Add caption if present
  const caption = table.attrs?.caption;
  if (caption) {
    tableCounter++;
    const prefix = currentSettings.tableCaptionPrefix || 'Table';
    const numbering = currentSettings.captionNumbering === 'hierarchical'
      ? `${h1Counter}.${tableCounter}`
      : `${tableCounter}`;
    adoc += `.${prefix} ${numbering}: ${caption}\n`;
  }

  // Check if first row has headers
  const hasHeader = table.content[0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  // Add table options
  const align = table.attrs?.align;
  const width = table.attrs?.width;
  
  let tableOptions: string[] = [];
  
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

  // Process each row - cells should be on the same line
  for (const row of table.content) {
    if (row.type === 'tableRow' && row.content) {
      const cells: string[] = [];
      for (const cell of row.content) {
        const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
        cells.push(cellContent);
      }
      // All cells in one line, separated by |
      adoc += '| ' + cells.join(' | ') + '\n';
    }
  }

  adoc += '|===\n';
  return adoc;
}

function convertImage(node: TiptapNode): string {
  const src = node.attrs?.src || '';
  const alt = node.attrs?.alt || '';
  const title = node.attrs?.title || '';
  const caption = node.attrs?.caption;

  if (!src) {
    return '';
  }

  let adoc = '';

  // Add caption if present (displayed above image in AsciiDoc)
  if (caption) {
    imageCounter++;
    const prefix = currentSettings.imageCaptionPrefix || 'Image';
    const numbering = currentSettings.captionNumbering === 'hierarchical'
      ? `${h1Counter}.${imageCounter}`
      : `${imageCounter}`;
    adoc += `.${prefix} ${numbering}: ${caption}\n`;
  }

  // AsciiDoc image syntax: image::path[alt text, title]
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
      case 'code':
        result = `\`${result}\``;
        break;
      case 'link':
        const href = mark.attrs?.href || '';
        result = `${href}[${result}]`;
        break;
    }
  }

  return result;
}
