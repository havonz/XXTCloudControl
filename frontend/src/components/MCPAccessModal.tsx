import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { authFetch } from '../services/httpAuth';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { useI18n } from '../i18n';
import { IconXmark } from '../icons';
import { localizeApiError } from '../utils/apiError';
import modal from './DeviceBindingModal.module.css';
import styles from './MCPAccessModal.module.css';

export default function MCPAccessModal(props: { endpoint: string; onClose: () => void }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = createSignal<boolean>();
  const [token, setToken] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const backdrop = createBackdropClose(props.onClose);
  const lifetime = new AbortController();
  let closeButton: HTMLButtonElement | undefined;

  async function request(method: 'GET' | 'POST' | 'DELETE') {
    if (busy()) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/mcp/token', { method, cache: 'no-store', signal: lifetime.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(localizeApiError(payload, t, t('common.failed')).message);
      }
      const result = await response.json();
      setEnabled(result.enabled);
      setToken(result.token || '');
    } catch (error) {
      if (!lifetime.signal.aborted) setMessage(error instanceof Error ? error.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function copy(input: HTMLInputElement | HTMLTextAreaElement) {
    try {
      await navigator.clipboard.writeText(input.value);
      setMessage(t('common.success'));
    } catch {
      input.focus();
      input.select();
      setMessage(t('device_list.copy_failed'));
    }
  }

  onMount(() => {
    const previous = document.activeElement;
    closeButton?.focus();
    void request('GET');
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', keydown);
    onCleanup(() => {
      lifetime.abort();
      window.removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement) previous.focus();
    });
  });

  let addressInput!: HTMLInputElement;
  let tokenInput!: HTMLInputElement;
  let configInput!: HTMLTextAreaElement;
  return <Portal>
    <div class={modal.modalOverlay} onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <section class={modal.modalContent} role="dialog" aria-modal="true" aria-labelledby="mcp-title">
        <div class={modal.modalHeader}>
          <h2 id="mcp-title">{t('mcp.title')}</h2>
          <button ref={closeButton} class={modal.closeButton} onClick={props.onClose} aria-label={t('common.close')}><IconXmark size={16} /></button>
        </div>
        <div class={modal.modalBody}>
          <label for="mcp-address">{t('mcp.address')}</label>
          <div class={styles.row}>
            <input id="mcp-address" ref={addressInput} readOnly value={props.endpoint} />
            <button onClick={() => copy(addressInput)}>{t('common.copy')}</button>
          </div>
          <Show when={token()}>
            <label for="mcp-secret">{t('mcp.secret')}</label>
            <div class={styles.row}>
              <input id="mcp-secret" ref={tokenInput} readOnly value={token()} autocomplete="off" spellcheck={false} />
              <button onClick={() => copy(tokenInput)}>{t('common.copy')}</button>
            </div>
            <p class={styles.headerHint}>{t('mcp.header_hint')}</p>
            <div class={styles.configHeading}>
              <label for="mcp-config">mcpServers JSON</label>
              <button onClick={() => copy(configInput)}>{t('mcp.copy_config')}</button>
            </div>
            <textarea id="mcp-config" ref={configInput} class={styles.config} readOnly wrap="off" rows={11} spellcheck={false}
              value={JSON.stringify({
                mcpServers: {
                  XXTCloudControl: {
                    type: 'http',
                    url: props.endpoint,
                    headers: { Authorization: `Bearer ${token()}` },
                  },
                },
              }, null, 2)}
            />
          </Show>
          <div class={styles.actions}>
            <Show when={enabled() !== undefined} fallback={<button disabled={busy()} onClick={() => request('GET')}>{t(busy() ? 'common.loading' : 'common.refresh')}</button>}>
              <button disabled={busy()} onClick={() => request('POST')}>{t(enabled() ? 'mcp.rotate' : 'mcp.generate')}</button>
              <Show when={enabled()}><button disabled={busy()} onClick={() => request('DELETE')}>{t('mcp.revoke')}</button></Show>
            </Show>
          </div>
          <Show when={message()}><p role="status">{message()}</p></Show>
        </div>
      </section>
    </div>
  </Portal>;
}
