import { createSignal, Show, createEffect, onCleanup } from 'solid-js';
import { useDialog } from './DialogContext';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  const [key, setKey] = createSignal('');
  const [value, setValue] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const backdropClose = createBackdropClose(() => handleClose());

  const handleSetValue = async () => {
    if (!key().trim() || !value().trim()) {
      await dialog.alert(t('modal.dictionary_required'));
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
      await dialog.alert(t('modal.dictionary_required'));
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

  createEffect(() => {
    if (!props.isOpen) return;

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modalContent} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h2 class={styles.modalTitle}>{t('modal.dictionary_title')}</h2>
            <button class={styles.closeButton} onClick={handleClose} title={t('common.close')}>
              <IconXmark size={16} />
            </button>
          </div>
          
          <div class={styles.modalBody}>
            <div class={styles.deviceInfo}>
              {t('modal.dictionary_target', { count: props.selectedDeviceCount })}
            </div>
            
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>{t('modal.dictionary_key')}</label>
              <input
                type="text"
                value={key()}
                onInput={(e) => setKey(e.currentTarget.value)}
                placeholder={t('modal.dictionary_key_placeholder')}
                class={styles.textInput}
                disabled={isLoading()}
              />
            </div>
            
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>{t('modal.dictionary_value')}</label>
              <textarea
                value={value()}
                onInput={(e) => setValue(e.currentTarget.value)}
                placeholder={t('modal.dictionary_value_placeholder')}
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
                {isLoading() ? t('modal.setting') : t('modal.dictionary_set_value')}
              </button>
              <button
                onClick={handlePushToQueue}
                class={styles.actionButton}
                disabled={isLoading() || !key().trim() || !value().trim()}
              >
                {isLoading() ? t('modal.dictionary_sending') : t('modal.dictionary_send_queue')}
              </button>
            </div>
          </div>
          

        </div>
      </div>
    </Show>
  );
}
