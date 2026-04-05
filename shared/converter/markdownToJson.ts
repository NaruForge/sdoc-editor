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
 * Converts a Markdown string to a Tiptap-compatible JSON document tree.
 * Self-contained parser — no external dependencies required.
 */
export function convertMarkdownToJson(markdown: string): TiptapNode {
  let text = markdown;

  // Skip YAML frontmatter (---...---)
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    text = text.slice(fmMatch[0].length);
  }

  const lines = text.split('\n');
  const doc: TiptapNode = { type: 'doc', content: [] };
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const language = codeMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      doc.content!.push({
        type: 'codeBlock',
        attrs: { language },
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    // Math block ($$)
    if (line.trim() === '$$') {
      const latexLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        latexLines.push(lines[i]);
        i++;
      }
      i++; // skip closing $$
      doc.content!.push({
        type: 'mathBlock',
        attrs: { latex: latexLines.join('\n') },
      });
      continue;
    }

    // Mermaid / diagram fenced code block (```mermaid ... ```)
    const diagramFenceMatch = line.match(/^```(mermaid|plantuml|d2|graphviz)\s*$/);
    if (diagramFenceMatch) {
      const diagLang = diagramFenceMatch[1];
      const diagLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        diagLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      doc.content!.push({
        type: 'diagram',
        attrs: { language: diagLang, code: diagLines.join('\n') },
      });
      continue;
    }

    // Heading (strip anchor tags like <a id="..."></a>)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let rawText = headingMatch[2];
      let headingId: string | undefined;
      const anchorMatch = rawText.match(/^<a\s+id="([^"]+)">\s*<\/a>\s*/);
      if (anchorMatch) {
        headingId = anchorMatch[1];
        rawText = rawText.slice(anchorMatch[0].length);
      }
      const attrs: any = { level };
      if (headingId) { attrs.id = headingId; }
      doc.content!.push({
        type: 'heading',
        attrs,
        content: parseInline(rawText),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      doc.content!.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Table (lines starting with |), with optional caption before it
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const tableNode = parseTable(tableLines);
      if (tableNode) {
        // Check if previous node is a bold caption like "**Table 1: caption**"
        const prev = doc.content!.length > 0 ? doc.content![doc.content!.length - 1] : null;
        if (prev && prev.type === 'paragraph' && prev.content?.length === 1) {
          const child = prev.content[0];
          if (child.type === 'text' && child.marks?.length === 1 && child.marks[0].type === 'bold') {
            const capMatch = child.text?.match(/^(?:\S+)\s+[\d.]+:\s*(.+)$/);
            if (capMatch) {
              tableNode.attrs = { ...tableNode.attrs, caption: capMatch[1] };
              doc.content!.pop(); // remove the caption paragraph
            }
          }
        }
        doc.content!.push(tableNode);
      }
      continue;
    }

    // Task list (must check before bullet list)
    if (/^\s*[-*+]\s\[[ xX]\]\s/.test(line)) {
      const { node, nextIndex } = parseTaskList(lines, i);
      doc.content!.push(node);
      i = nextIndex;
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const { node, nextIndex } = parseList(lines, i, 'bulletList');
      doc.content!.push(node);
      i = nextIndex;
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const { node, nextIndex } = parseList(lines, i, 'orderedList');
      doc.content!.push(node);
      i = nextIndex;
      continue;
    }

    // Image on its own line (block-level)
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const alt = imgMatch[1];
      const src = imgMatch[2];
      const imgAttrs: any = { src, alt };

      // Look ahead for italic caption like "*Image 1: caption*"
      let nextNonEmpty = i + 1;
      while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
        nextNonEmpty++;
      }
      if (nextNonEmpty < lines.length) {
        const capLineMatch = lines[nextNonEmpty].trim().match(/^\*(?:\S+)\s+[\d.]+:\s*(.+)\*$/);
        if (capLineMatch) {
          imgAttrs.caption = capLineMatch[1];
          i = nextNonEmpty + 1;
        } else {
          i++;
        }
      } else {
        i++;
      }

      doc.content!.push({
        type: 'image',
        attrs: imgAttrs,
      });
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-block lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^```/) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].match(/^\s*[-*+]\s/) &&
      !lines[i].match(/^\s*\d+\.\s/) &&
      lines[i].trim() !== '$$' &&
      !/^(---|\*\*\*|___)\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const text = paraLines.join('\n');
      doc.content!.push({
        type: 'paragraph',
        content: parseInline(text),
      });
    }
  }

  // Ensure doc has at least empty content
  if (!doc.content || doc.content.length === 0) {
    doc.content = [{ type: 'paragraph' }];
  }

  return doc;
}

/**
 * Parse inline markdown into an array of Tiptap text/inline nodes with marks.
 */
function parseInline(text: string): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  let pos = 0;

  while (pos < text.length) {
    // Inline math $...$
    if (text[pos] === '$' && text[pos + 1] !== '$') {
      const end = text.indexOf('$', pos + 1);
      if (end !== -1) {
        const latex = text.slice(pos + 1, end);
        if (latex.length > 0) {
          nodes.push({ type: 'mathInline', attrs: { latex } });
          pos = end + 1;
          continue;
        }
      }
    }

    // Inline code `...`
    if (text[pos] === '`') {
      const end = text.indexOf('`', pos + 1);
      if (end !== -1) {
        const code = text.slice(pos + 1, end);
        nodes.push({
          type: 'text',
          text: code,
          marks: [{ type: 'code' }],
        });
        pos = end + 1;
        continue;
      }
    }

    // Image ![alt](src)
    if (text[pos] === '!' && text[pos + 1] === '[') {
      const altEnd = text.indexOf(']', pos + 2);
      if (altEnd !== -1 && text[altEnd + 1] === '(') {
        const srcEnd = text.indexOf(')', altEnd + 2);
        if (srcEnd !== -1) {
          const alt = text.slice(pos + 2, altEnd);
          const src = text.slice(altEnd + 2, srcEnd);
          nodes.push({ type: 'image', attrs: { src, alt } });
          pos = srcEnd + 1;
          continue;
        }
      }
    }

    // Link [text](url)
    if (text[pos] === '[') {
      const labelEnd = text.indexOf(']', pos + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const hrefEnd = text.indexOf(')', labelEnd + 2);
        if (hrefEnd !== -1) {
          const label = text.slice(pos + 1, labelEnd);
          const href = text.slice(labelEnd + 2, hrefEnd);
          nodes.push({
            type: 'text',
            text: label,
            marks: [{ type: 'link', attrs: { href } }],
          });
          pos = hrefEnd + 1;
          continue;
        }
      }
    }

    // Bold+Italic ***...***
    if (text.slice(pos, pos + 3) === '***') {
      const end = text.indexOf('***', pos + 3);
      if (end !== -1) {
        const inner = text.slice(pos + 3, end);
        nodes.push({
          type: 'text',
          text: inner,
          marks: [{ type: 'bold' }, { type: 'italic' }],
        });
        pos = end + 3;
        continue;
      }
    }

    // Bold **...**
    if (text.slice(pos, pos + 2) === '**') {
      const end = text.indexOf('**', pos + 2);
      if (end !== -1) {
        const inner = text.slice(pos + 2, end);
        nodes.push({
          type: 'text',
          text: inner,
          marks: [{ type: 'bold' }],
        });
        pos = end + 2;
        continue;
      }
    }

    // Italic *...*
    if (text[pos] === '*' && text[pos + 1] !== '*') {
      const end = text.indexOf('*', pos + 1);
      if (end !== -1 && end > pos + 1) {
        const inner = text.slice(pos + 1, end);
        nodes.push({
          type: 'text',
          text: inner,
          marks: [{ type: 'italic' }],
        });
        pos = end + 1;
        continue;
      }
    }

    // Strikethrough ~~...~~
    if (text.slice(pos, pos + 2) === '~~') {
      const end = text.indexOf('~~', pos + 2);
      if (end !== -1) {
        const inner = text.slice(pos + 2, end);
        nodes.push({
          type: 'text',
          text: inner,
          marks: [{ type: 'strike' }],
        });
        pos = end + 2;
        continue;
      }
    }

    // Underline <u>...</u>
    if (text.slice(pos, pos + 3) === '<u>') {
      const end = text.indexOf('</u>', pos + 3);
      if (end !== -1) {
        const inner = text.slice(pos + 3, end);
        nodes.push({
          type: 'text',
          text: inner,
          marks: [{ type: 'underline' }],
        });
        pos = end + 4;
        continue;
      }
    }

    // Hard break (two trailing spaces + newline, or explicit <br>)
    if (text.slice(pos, pos + 4) === '<br>' || text.slice(pos, pos + 5) === '<br/>') {
      nodes.push({ type: 'hardBreak' });
      pos += text[pos + 3] === '>' ? 4 : 5;
      continue;
    }
    if (text[pos] === ' ' && text[pos + 1] === ' ' && text[pos + 2] === '\n') {
      nodes.push({ type: 'hardBreak' });
      pos += 3;
      continue;
    }

    // Plain text — consume until next special character
    let end = pos + 1;
    while (end < text.length) {
      const ch = text[end];
      if (
        ch === '*' || ch === '`' || ch === '[' || ch === '!' ||
        ch === '~' || ch === '<' || ch === '$' ||
        (ch === ' ' && text[end + 1] === ' ' && text[end + 2] === '\n')
      ) {
        break;
      }
      end++;
    }
    const plainText = text.slice(pos, end);
    if (plainText) {
      // Merge with previous text node if both are plain text
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'text' && !last.marks?.length) {
        last.text = (last.text || '') + plainText;
      } else {
        nodes.push({ type: 'text', text: plainText });
      }
    }
    pos = end;
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text: '' }];
}

/**
 * Parse a markdown list (bullet or ordered) starting at index `start`.
 */
function parseList(
  lines: string[],
  start: number,
  listType: 'bulletList' | 'orderedList'
): { node: TiptapNode; nextIndex: number } {
  const items: TiptapNode[] = [];
  let i = start;
  const pattern = listType === 'bulletList' ? /^(\s*)[-*+]\s(.*)/ : /^(\s*)\d+\.\s(.*)/;

  while (i < lines.length) {
    const match = lines[i].match(pattern);
    if (!match) break;

    const itemText = match[2];
    items.push({
      type: 'listItem',
      content: [{
        type: 'paragraph',
        content: parseInline(itemText),
      }],
    });
    i++;
  }

  return {
    node: { type: listType, content: items },
    nextIndex: i,
  };
}

/**
 * Parse a markdown task list starting at index `start`.
 */
function parseTaskList(
  lines: string[],
  start: number
): { node: TiptapNode; nextIndex: number } {
  const items: TiptapNode[] = [];
  let i = start;
  const pattern = /^\s*[-*+]\s\[([xX ])\]\s(.*)/;

  while (i < lines.length) {
    const match = lines[i].match(pattern);
    if (!match) break;

    const checked = match[1].toLowerCase() === 'x';
    const itemText = match[2];
    items.push({
      type: 'taskItem',
      attrs: { checked },
      content: [{
        type: 'paragraph',
        content: parseInline(itemText),
      }],
    });
    i++;
  }

  return {
    node: { type: 'taskList', content: items },
    nextIndex: i,
  };
}

/**
 * Parse markdown table lines into a Tiptap table node.
 */
function parseTable(tableLines: string[]): TiptapNode | null {
  if (tableLines.length < 2) return null;

  const parseRow = (line: string): string[] => {
    return line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim());
  };

  // Check if second row is separator (---|---|---)
  const isSeparator = (line: string): boolean =>
    /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line.trim());

  const rows: TiptapNode[] = [];
  let hasHeader = false;

  if (tableLines.length >= 2 && isSeparator(tableLines[1])) {
    hasHeader = true;
    // Header row
    const headerCells = parseRow(tableLines[0]);
    rows.push({
      type: 'tableRow',
      content: headerCells.map(cell => ({
        type: 'tableHeader',
        content: [{ type: 'paragraph', content: parseInline(cell) }],
      })),
    });

    // Body rows
    for (let r = 2; r < tableLines.length; r++) {
      const cells = parseRow(tableLines[r]);
      rows.push({
        type: 'tableRow',
        content: cells.map(cell => ({
          type: 'tableCell',
          content: [{ type: 'paragraph', content: parseInline(cell) }],
        })),
      });
    }
  } else {
    // No header — all body rows
    for (const line of tableLines) {
      const cells = parseRow(line);
      rows.push({
        type: 'tableRow',
        content: cells.map(cell => ({
          type: 'tableCell',
          content: [{ type: 'paragraph', content: parseInline(cell) }],
        })),
      });
    }
  }

  return { type: 'table', content: rows };
}
