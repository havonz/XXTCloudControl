// @vitest-environment happy-dom
import { createSignal, lazy, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import AsyncBoundary from '../AsyncBoundary';

describe('AsyncBoundary', () => {
  it('加载期间可以关闭，迟到的资源不会重开弹窗且下次仍能打开', async () => {
    let resolve!: (module: { default: () => Element }) => void;
    const View = lazy(() => new Promise<{ default: () => Element }>((accept) => { resolve = accept; }));
    const [open, setOpen] = createSignal(true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <I18nProvider defaultLocale="en-US">
      <span>Keep dashboard</span>
      <Show when={open()}>
        <AsyncBoundary modal onClose={() => setOpen(false)}><View /></AsyncBoundary>
      </Show>
    </I18nProvider>, host);
    try {
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading...');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(open()).toBe(false);
      resolve({ default: () => {
        const content = document.createElement('div');
        content.textContent = 'Ready panel';
        return content;
      } });
      await Promise.resolve();
      expect(host.textContent).toBe('Keep dashboard');
      setOpen(true);
      await vi.waitFor(() => expect(host.textContent).toContain('Ready panel'));
    } finally {
      dispose();
      host.remove();
    }
  });

  it('模块失败时保留外层界面，并提供关闭与刷新入口', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const View = lazy(async () => { throw new Error('private module path'); });
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <I18nProvider defaultLocale="en-US">
      <span>Keep dashboard</span>
      <AsyncBoundary modal onClose={onClose}><View /></AsyncBoundary>
    </I18nProvider>, host);
    try {
      await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeTruthy());
      expect(host.textContent).toContain('Keep dashboard');
      expect(host.textContent).not.toContain('private module path');
      const buttons = [...host.querySelectorAll('button')];
      expect(buttons.map(button => button.textContent)).toEqual(['Close', 'Refresh']);
      buttons[0].click();
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      dispose();
      host.remove();
      errorLog.mockRestore();
    }
  });
});
