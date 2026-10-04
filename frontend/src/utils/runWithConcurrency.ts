export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Concurrency limit must be a positive integer');
  }

  const results = new Array<R>(items.length);
  let cursor = 0;
  const tasks = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      // 设备反馈仍按输入顺序匹配，不能用异步完成顺序排列结果。
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(tasks);
  return results;
}
