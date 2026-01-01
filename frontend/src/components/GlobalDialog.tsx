import { Component, createSignal, onMount, Show, For, createMemo } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import styles from './GlobalDialog.module.css';

interface GlobalDialogProps {
  type: 'alert' | 'confirm' | 'prompt' | 'select';
  title?: string;
  message: string;
  defaultValue?: string;
  options?: string[];
  onClose: (value: any) => void;
}

export const GlobalDialog: Component<GlobalDialogProps> = (props) => {
  const [inputValue, setInputValue] = createSignal(props.defaultValue || '');
  let inputRef: HTMLInputElement | undefined;

  const collection = createMemo(() => 
    createListCollection({ items: props.options || [] })
  );

  onMount(() => {
    if (props.type === 'prompt' && inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  });

  const handleConfirm = () => {
    if (props.type === 'prompt' || props.type === 'select') {
      props.onClose(inputValue());
    } else if (props.type === 'confirm') {
      props.onClose(true);
    } else {
      props.onClose(undefined);
    }
  };

  const handleCancel = () => {
    if (props.type === 'prompt' || props.type === 'select') {
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
          <Show when={props.type === 'select'}>
            <div class={styles.inputWrapper}>
              <Select.Root
                collection={collection()}
                value={inputValue() ? [inputValue()] : []}
                onValueChange={(e) => setInputValue(e.value[0] || '')}
              >
                <Select.Control>
                  <Select.Trigger class="cbx-select">
                    <Select.ValueText placeholder="-- 请选择 --" />
                    <span class="dropdown-arrow">▼</span>
                  </Select.Trigger>
                </Select.Control>
                <Portal>
                  <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                    <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                      <Select.ItemGroup>
                        <For each={props.options}>
                          {(item) => (
                            <Select.Item item={item} class="cbx-item">
                              <div class="cbx-item-content">
                                <Select.ItemIndicator>✓</Select.ItemIndicator>
                                <Select.ItemText>{item}</Select.ItemText>
                              </div>
                            </Select.Item>
                          )}
                        </For>
                      </Select.ItemGroup>
                    </Select.Content>
                  </Select.Positioner>
                </Portal>
              </Select.Root>
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
