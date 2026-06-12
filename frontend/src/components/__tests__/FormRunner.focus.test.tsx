// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import FormRunner from '../FormRunner';
import { I18nProvider } from '../../i18n';
import type { ConfigItem } from '../../utils/scriptConfig';

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

function mountFormRunner(items: ConfigItem[], initialValues?: Record<string, any>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onSubmit = vi.fn();
  const dispose = render(() => (
    <I18nProvider defaultLocale="zh-CN">
      <FormRunner
        open
        items={items}
        initialValues={initialValues}
        onSubmit={onSubmit}
      />
    </I18nProvider>
  ), host);

  return {
    onSubmit,
    dispose: () => {
      dispose();
      host.remove();
    }
  };
}

describe('FormRunner 输入焦点', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Edit 文本框输入时保持当前输入节点焦点', async () => {
    const { dispose } = mountFormRunner([
      {
        type: 'Edit',
        caption: '账号',
        text: ''
      }
    ]);

    await flushAsync();

    const input = document.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();

    input!.focus();
    input!.value = 'a';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();

    expect(input!.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input!.value).toBe('a');

    dispose();
  });
});
