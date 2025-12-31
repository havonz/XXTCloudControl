import { Component, createSignal, onMount, Show } from 'solid-js';
import styles from './GlobalDialog.module.css';

interface GlobalDialogProps {
  type: 'alert' | 'confirm' | 'prompt';
  title?: string;
  message: string;
  defaultValue?: string;
  onClose: (value: any) => void;
}

export const GlobalDialog: Component<GlobalDialogProps> = (props) => {
  const [inputValue, setInputValue] = createSignal(props.defaultValue || '');
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    if (props.type === 'prompt' && inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  });

  const handleConfirm = () => {
    if (props.type === 'prompt') {
      props.onClose(inputValue());
    } else if (props.type === 'confirm') {
      props.onClose(true);
    } else {
      props.onClose(undefined);
    }
  };

  const handleCancel = () => {
    if (props.type === 'prompt') {
      props.onClose(null);
    } else if (props.type === 'confirm') {
      props.onClose(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div class={styles.overlay} onClick={(e) => e.target === e.currentTarget && handleCancel()}>
      <div class={styles.modal} onKeyDown={handleKeyDown}>
        <div class={styles.header}>
          <h3>{props.title}</h3>
        </div>
        <div class={styles.body}>
          <div class={styles.message}>{props.message}</div>
          <Show when={props.type === 'prompt'}>
            <div class={styles.inputWrapper}>
              <input
                ref={inputRef}
                type="text"
                class={styles.input}
                value={inputValue()}
                onInput={(e) => setInputValue(e.currentTarget.value)}
                autofocus
              />
            </div>
          </Show>
        </div>
        <div class={styles.footer}>
          <Show when={props.type !== 'alert'}>
            <button class={`${styles.btn} ${styles.cancelBtn}`} onClick={handleCancel}>
              取消
            </button>
          </Show>
          <button class={`${styles.btn} ${styles.confirmBtn}`} onClick={handleConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
};
