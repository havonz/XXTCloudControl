import { Show, createEffect, onCleanup } from 'solid-js';
import { useI18n } from '../i18n';
import RuntimeSettingsForm, { RuntimeTarget } from './RuntimeSettingsForm';
import { RuntimeSettingsService } from '../services/runtimeSettingsService';
import styles from './BatchRenameModal.module.css';
import { createBackdropClose } from '../hooks/useBackdropClose';
export default function RuntimeSettingsModal(props: { open: boolean; targets: RuntimeTarget[]; service: RuntimeSettingsService; onClose: () => void }) {
  const { t } = useI18n();
  const backdropClose = createBackdropClose(() => props.onClose());
  let dialog: HTMLDivElement | undefined;
  createEffect(() => {
    if (!props.open) return;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => dialog?.focus({ preventScroll: true }));
    onCleanup(() => {
      cancelAnimationFrame(frame);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    });
  });
  const keepFocusInDialog = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialog) return;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, [tabindex]'))
      .filter(element => !element.matches(':disabled') && element.tabIndex >= 0 && !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault(); first.focus();
    }
  };
  createEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      props.onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });
  return <Show when={props.open}><div class={styles.overlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
    <div ref={dialog} class={styles.modal} role="dialog" aria-modal="true" aria-labelledby="runtime-settings-title" aria-describedby="runtime-settings-hint" tabIndex={-1} style={{ outline: 'none' }} onKeyDown={keepFocusInDialog}>
      <div class={styles.header}>
        <h3 id="runtime-settings-title" class={styles.title}>{t('runtime.title')}</h3>
      </div>
      <RuntimeSettingsForm targets={props.targets} service={props.service} concurrency={5} onClose={props.onClose} />
    </div>
  </div></Show>;
}
