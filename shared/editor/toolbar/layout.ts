export const TOOLBAR_GROUP_ORDER = [
  'inline-basic',
  'inline-color',
  'heading',
  'alignment',
  'lists-blocks',
  'insert',
  'table-context',
] as const;

export type ToolbarGroupId = typeof TOOLBAR_GROUP_ORDER[number];

export const TOOLBAR_GROUP_PRIORITY: readonly ToolbarGroupId[] = [
  'inline-basic',
  'heading',
  'insert',
  'table-context',
  'lists-blocks',
  'alignment',
  'inline-color',
];

export interface ToolbarLayoutInput {
  availableWidth: number;
  groupWidths: Partial<Record<ToolbarGroupId, number>>;
  presentGroups: readonly ToolbarGroupId[];
  gap?: number;
  overflowWidth?: number;
}

export interface ToolbarLayout {
  visible: readonly ToolbarGroupId[];
  overflow: readonly ToolbarGroupId[];
}

/**
 * Selects complete groups by product priority, then returns both sets in their
 * canonical visual order. A group is never split across the toolbar and menu.
 */
export function resolveToolbarLayout({
  availableWidth,
  groupWidths,
  presentGroups,
  gap = 4,
  overflowWidth = 32,
}: ToolbarLayoutInput): ToolbarLayout {
  const present = new Set(presentGroups);
  const canonical = TOOLBAR_GROUP_ORDER.filter((id) => present.has(id));
  const totalWidth = canonical.reduce(
    (sum, id, index) => sum + (groupWidths[id] ?? 0) + (index === 0 ? 0 : gap),
    0,
  );

  if (totalWidth <= availableWidth) {
    return { visible: canonical, overflow: [] };
  }

  const selected = new Set<ToolbarGroupId>();
  let used = overflowWidth;
  for (const id of TOOLBAR_GROUP_PRIORITY) {
    if (!present.has(id)) continue;
    const width = groupWidths[id] ?? 0;
    const nextWidth = used + gap + width;
    if (nextWidth <= availableWidth) {
      selected.add(id);
      used = nextWidth;
    }
  }

  return {
    visible: canonical.filter((id) => selected.has(id)),
    overflow: canonical.filter((id) => !selected.has(id)),
  };
}
