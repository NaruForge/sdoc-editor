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

/**
 * Converts Tiptap JSON to Markdown format
 */
export function convertJsonToMarkdown(json: TiptapNode): string {
  return convertNode(json).trim() + '\n';
}

function convertNode(node: TiptapNode): string {
  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map(convertNode).join('\n') : '';

    case 'heading':
      const level = node.attrs?.level || 1;
      const headingPrefix = '#'.repeat(level);
      const headingText = node.content ? convertInlineContent(node.content) : '';
      return `${headingPrefix} ${headingText}\n`;

    case 'paragraph':
      const paragraphText = node.content ? convertInlineContent(node.content) : '';
      return paragraphText ? `${paragraphText}\n` : '';

    case 'bulletList':
      return node.content ? node.content.map((item) => convertListItem(item, '-')).join('') : '';

    case 'orderedList':
      return node.content ? node.content.map((item, index) => convertListItem(item, `${index + 1}.`)).join('') : '';

    case 'listItem':
      // This is handled by the list itself
      return '';

    case 'codeBlock':
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map((n) => n.text || '').join('\n') : '';
      return `\`\`\`${language}\n${code}\n\`\`\`\n`;

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
 * Converts table cell content without adding paragraph tags
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

  let md = '';

  // Add caption if present
  const caption = table.attrs?.['data-caption'];
  if (caption) {
    md += `**${caption}**\n\n`;
  }

  // Check if first row has headers
  const hasHeader = table.content[0]?.content?.some(
    (cell: TiptapNode) => cell.type === 'tableHeader'
  );

  // Process header row
  if (hasHeader && table.content[0]) {
    const headerRow = table.content[0];
    if (headerRow.content) {
      const headers: string[] = [];
      for (const cell of headerRow.content) {
        const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
        headers.push(cellContent);
      }
      md += '| ' + headers.join(' | ') + ' |\n';
      
      // Add separator row
      md += '|' + headers.map(() => ' --- ').join('|') + '|\n';
    }

    // Process body rows
    for (let i = 1; i < table.content.length; i++) {
      const row = table.content[i];
      if (row.type === 'tableRow' && row.content) {
        const cells: string[] = [];
        for (const cell of row.content) {
          const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
          cells.push(cellContent);
        }
        md += '| ' + cells.join(' | ') + ' |\n';
      }
    }
  } else {
    // No header, treat all rows as body
    for (const row of table.content) {
      if (row.type === 'tableRow' && row.content) {
        const cells: string[] = [];
        for (const cell of row.content) {
          const cellContent = cell.content ? convertTableCellContent(cell.content) : '';
          cells.push(cellContent);
        }
        md += '| ' + cells.join(' | ') + ' |\n';
      }
    }
  }

  md += '\n';
  return md;
}

function convertImage(node: TiptapNode): string {
  const src = node.attrs?.src || '';
  const alt = node.attrs?.alt || '';
  const caption = node.attrs?.['data-caption'] || '';

  let md = `![${alt}](${src})`;
  
  if (caption) {
    md += `\n\n*${caption}*`;
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
  const hasCode = marks.some(m => m.type === 'code');
  const linkMark = marks.find(m => m.type === 'link');
  
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
    
    // Note: Markdown doesn't have native underline, we'll use HTML
    if (hasUnderline) {
      result = `<u>${result}</u>`;
    }
  }
  
  // Apply link last
  if (linkMark) {
    const href = linkMark.attrs?.href || '';
    result = `[${result}](${href})`;
  }
  
  return result;
}
