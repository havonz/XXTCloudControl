import { createSignal, Show, onMount, onCleanup } from 'solid-js';
import { useDialog } from './DialogContext';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import styles from './DictionaryModal.module.css';

interface DictionaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSetValue: (key: string, value: string) => void;
  onPushToQueue: (key: string, value: string) => void;
  selectedDeviceCount: number;
}

export default function DictionaryModal(props: DictionaryModalProps) {
  const dialog = useDialog();
  const [key, setKey] = createSignal('');
  const [value, setValue] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const backdropClose = createBackdropClose(() => handleClose());

  const handleSetValue = async () => {
    if (!key().trim() || !value().trim()) {
      await dialog.alert('请输入键名和值');
      return;
    }
    
    setIsLoading(true);
    try {
      await props.onSetValue(key().trim(), value().trim());
      // 成功后清空输入框
      setKey('');
      setValue('');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePushToQueue = async () => {
    if (!key().trim() || !value().trim()) {
      await dialog.alert('请输入键名和值');
      return;
    }
    
    setIsLoading(true);
    try {
      await props.onPushToQueue(key().trim(), value().trim());
      // 成功后清空输入框
      setKey('');
      setValue('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading()) {
      props.onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modalContent} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h2 class={styles.modalTitle}>词典发送</h2>
            <button class={styles.closeButton} onClick={handleClose} title="关闭">
              <IconXmark size={16} />
            </button>
          </div>
          
          <div class={styles.modalBody}>
            <div class={styles.deviceInfo}>
              目标设备：{props.selectedDeviceCount} 台
            </div>
            
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>键名</label>
              <input
                type="text"
                value={key()}
                onInput={(e) => setKey(e.currentTarget.value)}
                placeholder="请输入键名"
                class={styles.textInput}
                disabled={isLoading()}
              />
            </div>
            
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>值</label>
              <textarea
                value={value()}
                onInput={(e) => setValue(e.currentTarget.value)}
                placeholder="请输入值"
                class={styles.textArea}
                rows={4}
                disabled={isLoading()}
              />
            </div>
            
            <div class={styles.buttonGroup}>
              <button
                onClick={handleSetValue}
                class={styles.actionButton}
                disabled={isLoading() || !key().trim() || !value().trim()}
              >
                {isLoading() ? '设置中...' : '设置值'}
              </button>
              <button
                onClick={handlePushToQueue}
                class={styles.actionButton}
                disabled={isLoading() || !key().trim() || !value().trim()}
              >
                {isLoading() ? '发送中...' : '发送到队列'}
              </button>
            </div>
          </div>
          

        </div>
      </div>
    </Show>
  );
}
