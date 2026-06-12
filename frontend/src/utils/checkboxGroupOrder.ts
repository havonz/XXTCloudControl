export function normalizeCheckBoxIndexes(indexes: unknown, itemCount: number, preserveOrder = true): number[] {
  if (!Array.isArray(indexes)) return [];
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of indexes) {
    const index = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(index)) continue;
    const integer = Math.trunc(index);
    if (integer < 1 || (itemCount > 0 && integer > itemCount) || seen.has(integer)) continue;
    seen.add(integer);
    result.push(integer);
  }
  return preserveOrder ? result : result.slice().sort((left, right) => left - right);
}

export function orderedCheckBoxIndexes(itemCount: number, selectedIndexes: unknown, orderedSelection?: boolean): number[] {
  const allIndexes = Array.from({ length: Math.max(0, itemCount) }, (_, index) => index + 1);
  if (!orderedSelection) return allIndexes;
  const selected = normalizeCheckBoxIndexes(selectedIndexes, itemCount, true);
  const selectedSet = new Set(selected);
  return [
    ...selected,
    ...allIndexes.filter(index => !selectedSet.has(index))
  ];
}

export function selectedTextIndexes(items: string[], selectedTexts: readonly string[]): number[] {
  return selectedTexts
    .map(text => items.indexOf(text))
    .filter(index => index >= 0)
    .map(index => index + 1);
}
