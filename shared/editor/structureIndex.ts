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
