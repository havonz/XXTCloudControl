import { Show, createEffect, onCleanup } from 'solid-js';
import { createBackdropClose } from '../hooks/useBackdropClose';
import dialogStyles from './GlobalDialog.module.css';
import styles from './LoadingState.module.css';

interface LoadingStateProps {
  message: string;
  error?: boolean;
  modal?: boolean;
  refreshLabel?: string;
  closeLabel?: string;
  onClose?: () => void;
}

export default function LoadingState(props: LoadingStateProps) {
  const backdrop = createBackdropClose(() => props.onClose?.());
  createEffect(() => {
    if (!props.modal || !props.onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  // 直接绑定事件，避免仅导入翻译工具时就注册依赖 DOM 的全局事件。
  return (
    <div
      class={props.modal ? `${dialogStyles.overlay} ${styles.overlay}` : styles.inline}
      on:mousedown={backdrop.onMouseDown}
      on:mouseup={backdrop.onMouseUp}
    >
      <div class={dialogStyles.modal}>
        <div class={`${dialogStyles.body} ${styles.message}`} role={props.error ? 'alert' : 'status'}>
          {props.message}
        </div>
        <Show when={props.error || props.onClose}>
          <div class={dialogStyles.footer}>
            <Show when={props.onClose}>
              <button class={`${dialogStyles.btn} ${dialogStyles.cancelBtn}`} on:click={() => props.onClose?.()}>
                {props.closeLabel}
              </button>
            </Show>
            <Show when={props.error}>
              <button class={`${dialogStyles.btn} ${dialogStyles.confirmBtn}`} on:click={() => window.location.reload()}>
                {props.refreshLabel}
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
