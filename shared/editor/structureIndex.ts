export function findActivePosition(sortedPositions: readonly number[], cursorPosition: number): number {
  let low = 0;
  let high = sortedPositions.length - 1;
  let active = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const position = sortedPositions[middle];
    if (position <= cursorPosition) {
      active = position;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return active;
}

export interface OutlinePosition {
  level: number;
  pos: number;
}

export interface OutlinePresentationIndex {
  hasChildren: readonly boolean[];
  visible: readonly boolean[];
}

/** Builds collapse and child metadata in one pass, including skipped heading levels. */
export function buildOutlinePresentationIndex(
  entries: readonly OutlinePosition[],
  collapsed: ReadonlySet<number>,
): OutlinePresentationIndex {
  const hasChildren = new Array<boolean>(entries.length).fill(false);
  const visible = new Array<boolean>(entries.length).fill(true);
  const ancestors: Array<{ index: number; level: number; descendantsHidden: boolean }> = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= entry.level) {
      ancestors.pop();
    }
    const parent = ancestors[ancestors.length - 1];
    if (parent) hasChildren[parent.index] = true;
    visible[index] = !parent?.descendantsHidden;
    ancestors.push({
      index,
      level: entry.level,
      descendantsHidden: Boolean(parent?.descendantsHidden) || collapsed.has(entry.pos),
    });
  }
  return { hasChildren, visible };
}
