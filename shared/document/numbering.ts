import { getCaptionPreset, toRoman, type CaptionStyleName } from '../settingsResolver';
import type { TiptapNode } from '../types';
import { walkDocument } from './walker';

export interface NumberingPolicy {
  headingNumbering: boolean;
  captionNumbering: 'sequential' | 'hierarchical';
  equationNumbering: 'sequential' | 'hierarchical';
  captionStyle: CaptionStyleName;
  crossRefIncludeCaption: boolean;
  counterResetPaths?: readonly string[];
}

export type NumberedKind = 'heading' | 'figure' | 'table' | 'equation';

export interface NumberedEntry {
  kind: NumberedKind;
  id?: string;
  path: readonly number[];
  number: string;
  displayLabel: string;
  baseLabel: string;
  referenceLabel: string;
  title?: string;
  headingLevel?: number;
  numbered: boolean;
}

export interface NumberingIndex {
  entries: NumberedEntry[];
  byId: Map<string, NumberedEntry>;
  byPath: Map<string, NumberedEntry>;
  byNode: WeakMap<TiptapNode, NumberedEntry>;
}

const textOf = (node: TiptapNode): string =>
  node.text ?? node.content?.map(textOf).join('') ?? '';

const stringAttr = (node: TiptapNode, name: string): string | undefined => {
  const value = node.attrs?.[name];
  return typeof value === 'string' && value ? value : undefined;
};

const sectionNumber = (section: number, local: string): string =>
  section > 0 ? `${section}.${local}` : local;

/** Build the single document-order numbering model consumed by UI, references and exports. */
export function buildNumberingIndex(doc: TiptapNode, policy: NumberingPolicy): NumberingIndex {
  const preset = getCaptionPreset(policy.captionStyle);
  const entries: NumberedEntry[] = [];
  const byId = new Map<string, NumberedEntry>();
  const byPath = new Map<string, NumberedEntry>();
  const byNode = new WeakMap<TiptapNode, NumberedEntry>();
  const headings = [0, 0, 0, 0, 0, 0];
  let activeSection = 0;
  let globalFigure = 0;
  let globalTable = 0;
  let globalEquation = 0;
  let localFigure = 0;
  let localTable = 0;
  let localEquation = 0;
  const resetPaths = new Set(policy.counterResetPaths ?? []);

  const add = (node: TiptapNode, entry: NumberedEntry): void => {
    entries.push(entry);
    byPath.set(entry.path.join('.'), entry);
    byNode.set(node, entry);
    if (entry.id) byId.set(entry.id, entry);
  };

  for (const { node, path } of walkDocument(doc)) {
    if (resetPaths.has(path.join('.'))) {
      headings.fill(0);
      activeSection = 0;
      globalFigure = 0;
      globalTable = 0;
      globalEquation = 0;
      localFigure = 0;
      localTable = 0;
      localEquation = 0;
    }
    if (node.type === 'heading') {
      const levelValue = node.attrs?.level;
      const level = typeof levelValue === 'number' && levelValue >= 1 && levelValue <= 6
        ? levelValue : 1;
      const explicitlyNumbered = node.attrs?.numbered !== false;
      const numbered = policy.headingNumbering && explicitlyNumbered;
      if (level === 1) {
        if (explicitlyNumbered) {
          headings[0] += 1;
          activeSection = headings[0];
        } else {
          activeSection = 0;
        }
        localFigure = 0;
        localTable = 0;
        localEquation = 0;
      } else if (explicitlyNumbered) {
        headings[level - 1] += 1;
      }
      for (let index = level; index < headings.length; index += 1) headings[index] = 0;
      const number = numbered
        ? headings.slice(0, level).filter((value) => value > 0).join('.')
        : '';
      const title = textOf(node);
      add(node, {
        kind: 'heading', id: stringAttr(node, 'id'), path, number,
        baseLabel: number,
        displayLabel: number ? `${number} ${title}` : title,
        referenceLabel: number ? `${number}. ${title}` : title,
        title, headingLevel: level, numbered,
      });
      continue;
    }

    let kind: Exclude<NumberedKind, 'heading'> | undefined;
    let number = '';
    let prefix = '';
    let title: string | undefined;
    let equationParens = false;
    if (node.type === 'image') {
      kind = 'figure';
      globalFigure += 1;
      localFigure += 1;
      number = policy.captionNumbering === 'hierarchical'
        ? sectionNumber(activeSection, String(localFigure)) : String(globalFigure);
      prefix = preset.figurePrefix;
      title = stringAttr(node, 'caption');
    } else if (node.type === 'table') {
      kind = 'table';
      globalTable += 1;
      localTable += 1;
      const global = preset.tableNumberStyle === 'roman' ? toRoman(globalTable) : String(globalTable);
      const local = preset.tableNumberStyle === 'roman' ? toRoman(localTable) : String(localTable);
      number = policy.captionNumbering === 'hierarchical'
        ? sectionNumber(activeSection, local) : global;
      prefix = preset.tablePrefix;
      title = stringAttr(node, 'caption');
    } else if (node.type === 'mathBlock') {
      kind = 'equation';
      globalEquation += 1;
      localEquation += 1;
      number = policy.equationNumbering === 'hierarchical'
        ? sectionNumber(activeSection, String(localEquation)) : String(globalEquation);
      prefix = preset.equationPrefix;
      equationParens = preset.equationParens;
    }
    if (!kind) continue;

    const baseLabel = equationParens ? `${prefix}(${number})` : `${prefix}${number}`;
    const displayLabel = title ? `${baseLabel}${preset.separator}${title}` : baseLabel;
    add(node, {
      kind, id: stringAttr(node, 'id'), path, number, baseLabel, displayLabel,
      referenceLabel: policy.crossRefIncludeCaption && title ? displayLabel : baseLabel,
      title, numbered: true,
    });
  }

  return { entries, byId, byPath, byNode };
}
