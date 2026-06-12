import { describe, expect, it } from 'vitest';
import { normalizeCheckBoxIndexes, orderedCheckBoxIndexes, selectedTextIndexes } from '../checkboxGroupOrder';

describe('checkboxGroupOrder', () => {
  it('按选择顺序将已选项排到前面，并保留未选项原始顺序', () => {
    expect(orderedCheckBoxIndexes(6, [6, 3, 2], true)).toEqual([6, 3, 2, 1, 4, 5]);
  });

  it('未开启顺序选中时保持原始显示顺序', () => {
    expect(orderedCheckBoxIndexes(6, [6, 3, 2], false)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('清理无效和重复序号时可保留输入顺序', () => {
    expect(normalizeCheckBoxIndexes([6, 3, 6, 0, 8, '2'], 6, true)).toEqual([6, 3, 2]);
  });

  it('提交时沿用当前选中文本顺序映射为序号', () => {
    expect(selectedTextIndexes(['1', '2', '3', '4', '5', '6'], ['6', '3', '2'])).toEqual([6, 3, 2]);
  });
});
