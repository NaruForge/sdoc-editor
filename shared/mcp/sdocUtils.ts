/**
 * Shared .sdoc document processing utilities.
 * Extracted from SdocEditorProvider for reuse in MCP server and other contexts.
 */

export interface SdocEnvelope {
  sdoc: string;
  meta: SdocMeta;
  doc: any;
}

export interface SdocMeta {
  title?: string;
  author?: string;
  version?: string;
  created?: string;
  modified?: string;
}

const SDOC_VERSION = '1.0';

export function unwrapSdoc(parsed: any): { meta: SdocMeta; doc: any } {
  let doc: any;
  let meta: SdocMeta = {};

  if (parsed.sdoc && parsed.doc) {
    doc = parsed.doc;
    meta = parsed.meta || {};
  } else if (parsed.type === 'doc') {
    doc = parsed;
  } else {
    doc = { type: 'doc', content: [] };
  }

  doc = migrateAttributes(doc);
  return { meta, doc };
}

export function wrapSdoc(doc: any, meta: SdocMeta): SdocEnvelope {
  return {
    sdoc: SDOC_VERSION,
    meta: {
      title: meta.title || '',
      author: meta.author || '',
      version: meta.version || '0.1',
      created: meta.created || new Date().toISOString(),
      modified: new Date().toISOString(),
    },
    doc,
  };
}

export function createEmptySdoc(meta: Partial<SdocMeta>): SdocEnvelope {
  const now = new Date().toISOString();
  const title = meta.title || '';
  const doc: any = {
    type: 'doc',
    content: title
      ? [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
         { type: 'paragraph' }]
      : [{ type: 'paragraph' }],
  };
  return wrapSdoc(doc, {
    title,
    author: meta.author || '',
    version: meta.version || '0.1',
    created: meta.created || now,
    modified: now,
  });
}

export function migrateAttributes(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const cloned = Array.isArray(node) ? [...node] : { ...node };

  if (cloned.attrs) {
    const a = { ...cloned.attrs };
    if ('data-caption' in a) { a.caption = a['data-caption']; delete a['data-caption']; }
    if ('data-align' in a) { a.align = a['data-align']; delete a['data-align']; }
    if ('data-width' in a) { a.width = a['data-width']; delete a['data-width']; }
    cloned.attrs = a;
  }

  if (cloned.content && Array.isArray(cloned.content)) {
    cloned.content = cloned.content.map((child: any) => migrateAttributes(child));
  }
  return cloned;
}

export function extractTitle(doc: any): string {
  if (!doc?.content) return '';
  for (const node of doc.content) {
    if (node.type === 'heading' && node.content) {
      return node.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '')
        .join('');
    }
  }
  return '';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled';
}

function getNodeText(node: any): string {
  if (!node?.content) return '';
  return node.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text || '')
    .join('');
}

export function assignAutoIds(doc: any): any {
  if (!doc?.content) return doc;

  const usedIds = new Set<string>();
  let imageCounter = 0;
  let tableCounter = 0;
  let eqCounter = 0;

  const uniqueId = (base: string): string => {
    let id = base;
    let i = 2;
    while (usedIds.has(id)) { id = `${base}-${i}`; i++; }
    usedIds.add(id);
    return id;
  };

  const cloned = { ...doc, content: doc.content.map((node: any) => {
    if (node.type === 'heading') {
      const text = getNodeText(node);
      const existing = node.attrs?.id;
      const id = existing || uniqueId(slugify(text));
      if (!existing) usedIds.add(id);
      else usedIds.add(existing);
      return { ...node, attrs: { ...node.attrs, id } };
    }
    if (node.type === 'image') {
      imageCounter++;
      const existing = node.attrs?.id;
      const id = existing || uniqueId(`figure-${imageCounter}`);
      if (!existing) usedIds.add(id);
      else usedIds.add(existing);
      return { ...node, attrs: { ...node.attrs, id } };
    }
    if (node.type === 'table') {
      tableCounter++;
      const existing = node.attrs?.id;
      const id = existing || uniqueId(`table-${tableCounter}`);
      if (!existing) usedIds.add(id);
      else usedIds.add(existing);
      return { ...node, attrs: { ...node.attrs, id } };
    }
    if (node.type === 'mathBlock') {
      eqCounter++;
      const existing = node.attrs?.id;
      const id = existing || uniqueId(`eq-${eqCounter}`);
      if (!existing) usedIds.add(id);
      else usedIds.add(existing);
      return { ...node, attrs: { ...node.attrs, id } };
    }
    return node;
  })};

  return cloned;
}

export function syncCrossReferences(doc: any, equationNumbering: 'sequential' | 'hierarchical' = 'sequential'): any {
  if (!doc?.content) return doc;

  const idMap = new Map<string, string>();
  let h1 = 0; let imgCnt = 0; let tblCnt = 0;
  let eqGlobal = 0; let eqInSection = 0;
  const h = [0, 0, 0, 0, 0, 0];

  for (const node of doc.content) {
    if (node.type === 'heading') {
      const level: number = node.attrs?.level || 1;
      h[level - 1]++;
      for (let j = level; j < 6; j++) h[j] = 0;
      if (level === 1) { h1++; imgCnt = 0; tblCnt = 0; eqInSection = 0; }
      const nums = h.slice(0, level).join('.') + '.';
      const text = getNodeText(node);
      if (node.attrs?.id) {
        idMap.set(node.attrs.id, `${nums} ${text}`);
      }
    }
    if (node.type === 'image') {
      imgCnt++;
      const caption = node.attrs?.caption || '';
      const label = caption ? `Figure ${imgCnt}: ${caption}` : `Figure ${imgCnt}`;
      if (node.attrs?.id) {
        idMap.set(node.attrs.id, label);
      }
    }
    if (node.type === 'table') {
      tblCnt++;
      const caption = node.attrs?.caption || '';
      const label = caption ? `Table ${tblCnt}: ${caption}` : `Table ${tblCnt}`;
      if (node.attrs?.id) {
        idMap.set(node.attrs.id, label);
      }
    }
    if (node.type === 'mathBlock') {
      eqGlobal++;
      eqInSection++;
      const eqLabel = equationNumbering === 'hierarchical' ? `${h1}.${eqInSection}` : `${eqGlobal}`;
      if (node.attrs?.id) {
        idMap.set(node.attrs.id, `(${eqLabel})`);
      }
    }
  }

  const updateRefs = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    const cloned = Array.isArray(node) ? [...node] : { ...node };

    if (cloned.type === 'text' && cloned.marks) {
      const linkMark = cloned.marks.find((m: any) => m.type === 'link' && m.attrs?.href?.startsWith('#'));
      if (linkMark) {
        const targetId = linkMark.attrs.href.slice(1);
        const newLabel = idMap.get(targetId);
        if (newLabel && cloned.text !== newLabel) {
          return { ...cloned, text: newLabel };
        }
      }
    }

    if (cloned.content && Array.isArray(cloned.content)) {
      cloned.content = cloned.content.map(updateRefs);
    }
    return cloned;
  };

  return updateRefs(doc);
}

export interface QueryResult {
  headings: Array<{ id: string; level: number; text: string; numbering: string }>;
  figures: Array<{ id: string; caption: string; number: number }>;
  tables: Array<{ id: string; caption: string; number: number }>;
  equations: Array<{ id: string; number: number }>;
  crossReferences: Array<{ href: string; text: string; targetExists: boolean }>;
}

export function queryDocumentStructure(doc: any): QueryResult {
  const result: QueryResult = {
    headings: [],
    figures: [],
    tables: [],
    equations: [],
    crossReferences: [],
  };

  if (!doc?.content) return result;

  const h = [0, 0, 0, 0, 0, 0];
  let imgCnt = 0;
  let tblCnt = 0;
  let eqCnt = 0;
  const allIds = new Set<string>();

  // First pass: collect all IDs and build structure
  for (const node of doc.content) {
    if (node.type === 'heading') {
      const level: number = node.attrs?.level || 1;
      h[level - 1]++;
      for (let j = level; j < 6; j++) h[j] = 0;
      if (level === 1) { imgCnt = 0; tblCnt = 0; }
      const nums = h.slice(0, level).join('.');
      const text = getNodeText(node);
      const id = node.attrs?.id || '';
      if (id) allIds.add(id);
      result.headings.push({ id, level, text, numbering: nums });
    }
    if (node.type === 'image') {
      imgCnt++;
      const id = node.attrs?.id || '';
      if (id) allIds.add(id);
      result.figures.push({ id, caption: node.attrs?.caption || '', number: imgCnt });
    }
    if (node.type === 'table') {
      tblCnt++;
      const id = node.attrs?.id || '';
      if (id) allIds.add(id);
      result.tables.push({ id, caption: node.attrs?.caption || '', number: tblCnt });
    }
    if (node.type === 'mathBlock') {
      eqCnt++;
      const id = node.attrs?.id || '';
      if (id) allIds.add(id);
      result.equations.push({ id, number: eqCnt });
    }
  }

  // Second pass: collect cross-references
  const collectRefs = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && node.marks) {
      const linkMark = node.marks.find((m: any) => m.type === 'link' && m.attrs?.href?.startsWith('#'));
      if (linkMark) {
        const targetId = linkMark.attrs.href.slice(1);
        result.crossReferences.push({
          href: linkMark.attrs.href,
          text: node.text || '',
          targetExists: allIds.has(targetId),
        });
      }
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(collectRefs);
    }
  };
  collectRefs(doc);

  return result;
}
