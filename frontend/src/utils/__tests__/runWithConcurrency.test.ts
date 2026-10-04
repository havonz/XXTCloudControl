import { describe, expect, it, vi } from 'vitest';
import { runWithConcurrency } from '../runWithConcurrency';

describe('runWithConcurrency', () => {
  it('限制同时运行的任务并保留输入顺序', async () => {
    const release: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const result = runWithConcurrency([0, 1, 2, 3], 2, async (value, index) => {
      started.push(value);
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => { release[index] = resolve; });
      active--;
      return `result-${value}`;
    });
    expect(started).toEqual([0, 1]);
    release[1]();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    release[2]();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    release[3]();
    release[0]();
    await expect(result).resolves.toEqual(['result-0', 'result-1', 'result-2', 'result-3']);
    expect(peak).toBe(2);
  });

  it('空列表不启动任务，任务失败向调用方传播', async () => {
    const worker = vi.fn(async () => 'unused');
    await expect(runWithConcurrency([], 3, worker)).resolves.toEqual([]);
    expect(worker).not.toHaveBeenCalled();
    await expect(runWithConcurrency([1], 3, async () => {
      throw new Error('failed');
    })).rejects.toThrow('failed');
  });
});
