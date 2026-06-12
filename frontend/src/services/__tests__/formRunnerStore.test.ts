import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createFormRunnerStore } from '../formRunnerStore';
import type { ConfigItem } from '../../utils/scriptConfig';

describe('formRunnerStore', () => {
  it('多行 Edit 提交时保留换行', () => {
    let payload: Record<string, any> = {};

    createRoot((dispose) => {
      const store = createFormRunnerStore();
      const items: ConfigItem[] = [{ type: 'Edit', caption: '备注', allowMultiline: true }];
      store.initialize(items);
      store.setValue('备注', '第一行\n第二行');
      payload = store.submit(items);
      dispose();
    });

    expect(payload).toEqual({ 备注: '第一行\n第二行' });
  });

  it('可编辑 ComboBox 使用 text 作为自定义默认值并按自定义文本提交', () => {
    let initialValue: string | undefined;
    let payload: Record<string, any> = {};

    createRoot((dispose) => {
      const store = createFormRunnerStore();
      const items: ConfigItem[] = [{
        type: 'ComboBox',
        caption: '模式',
        item: ['A'],
        canEdit: true,
        select: 0,
        text: 'custom',
      }];
      store.initialize(items);
      initialValue = store.getValue('模式');
      payload = store.submit(items);
      dispose();
    });

    expect(initialValue).toBe('custom');
    expect(payload).toEqual({ 模式: { select: 0, text: 'custom' } });
  });
});
