import { createSignal, Show, createEffect, onMount, onCleanup, For, createMemo } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import { useDialog } from './DialogContext';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import { useI18n } from '../i18n';
import styles from './ClipboardModal.module.css';

interface ClipboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReadClipboard: () => void;
  onWriteClipboard: (uti: string, data: string) => void;
  selectedDevicesCount: number;
  isSyncControlEnabled: boolean;
  onClipboardContentReceived?: (receiverFn: (content: string, uti: string) => void) => void;
}

export default function ClipboardModal(props: ClipboardModalProps) {
  const dialog = useDialog();
  const { t } = useI18n();
  const [clipboardContent, setClipboardContent] = createSignal('');
  const [clipboardUti, setClipboardUti] = createSignal('public.plain-text');
  const [isReadingClipboard, setIsReadingClipboard] = createSignal(false);
  const backdropClose = createBackdropClose(() => handleClose());
  
  // UTI options for Ark-UI Select
  const utiOptions = createMemo(() => [
    { value: 'public.plain-text', label: t('modal.clipboard_plain_text') },
    { value: 'public.png', label: t('modal.clipboard_png') },
  ]);
  const utiOptionsCollection = createMemo(() => 
    createListCollection({ items: utiOptions().map(o => o.value) })
  );

  // 自动填充剪贴板内容的方法
  const autoFillClipboardContent = (content: string, uti: string = 'public.plain-text') => {
    setClipboardContent(content);
    setClipboardUti(uti);
    setIsReadingClipboard(false);
  };

  // 将自动填充方法注册给父组件
  createEffect(() => {
    if (props.onClipboardContentReceived) {
      props.onClipboardContentReceived(autoFillClipboardContent);
    }
  });

  const handleReadClipboard = async () => {
    if (props.selectedDevicesCount === 0) {
      await dialog.alert(t('device.choose_first'));
      return;
    }

    setIsReadingClipboard(true);
    setClipboardContent('');

    try {
      props.onReadClipboard();
      
      setTimeout(() => {
        setIsReadingClipboard(false);
      }, 3000);
    } catch (error) {
      console.error(t('modal.clipboard_read_failed'), error);
      setIsReadingClipboard(false);
    }
  };

  const handleWriteClipboard = async () => {
    if (props.selectedDevicesCount === 0) {
      await dialog.alert(t('device.choose_first'));
      return;
    }

    if (!clipboardContent().trim()) {
      await dialog.alert(t('modal.clipboard_required'));
      return;
    }

    try {
      props.onWriteClipboard(clipboardUti(), clipboardContent());
      
      props.onClose();
    } catch (error) {
      console.error(t('modal.clipboard_write_failed'), error);
    }
  };

  const handleClose = () => {
    setClipboardContent('');
    setClipboardUti('public.plain-text');
    setIsReadingClipboard(false);
    props.onClose();
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
        <div class={styles.clipboardModal} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <div class={styles.headerTitles}>
              <h3>{t('modal.clipboard_title')}</h3>
              <p>{t('device.selected_count', { count: props.selectedDevicesCount })}</p>
            </div>
            <button class={styles.closeButton} onClick={handleClose} title={t('common.close')}>
              <IconXmark size={16} />
            </button>
          </div>
          
          <div class={styles.modalContent}>
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>{t('modal.clipboard_type')}</label>
              <Select.Root
                collection={utiOptionsCollection()}
                value={[clipboardUti()]}
                onValueChange={(e) => {
                  const val = e.value[0] ?? 'public.plain-text';
                  setClipboardUti(val);
                }}
              >
                <Select.Control>
                  <Select.Trigger class="cbx-select" style={{ 'min-width': '120px' }}>
                    <span>{utiOptions().find(o => o.value === clipboardUti())?.label || t('modal.clipboard_plain_text')}</span>
                    <span class="dropdown-arrow">▼</span>
                  </Select.Trigger>
                </Select.Control>
                <Portal>
                  <Select.Positioner style={{ 'z-index': 10400, width: 'var(--reference-width)' }}>
                    <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                      <Select.ItemGroup>
                        <For each={utiOptions()}>{(option) => (
                          <Select.Item item={option.value} class="cbx-item">
                            <div class="cbx-item-content">
                              <Select.ItemIndicator>✓</Select.ItemIndicator>
                              <Select.ItemText>{option.label}</Select.ItemText>
                            </div>
                          </Select.Item>
                        )}</For>
                      </Select.ItemGroup>
                    </Select.Content>
                  </Select.Positioner>
                </Portal>
              </Select.Root>
            </div>
            
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>{t('modal.clipboard_content')}</label>
              <textarea 
                class={styles.textareaInput}
                value={clipboardContent()}
                onInput={(e) => setClipboardContent(e.target.value)}
                placeholder={clipboardUti() === 'public.plain-text' ? t('modal.clipboard_text_placeholder') : t('modal.clipboard_image_placeholder')}
                rows={6}
                disabled={isReadingClipboard()}
              />
            </div>
          </div>
          
          <div class={styles.modalActions}>
            <button 
              class={styles.actionButton}
              onClick={handleReadClipboard}
              disabled={isReadingClipboard() || props.isSyncControlEnabled}
              title={props.isSyncControlEnabled ? t('modal.clipboard_read_disabled') : t('modal.clipboard_read_title')}
            >
              {isReadingClipboard() ? t('modal.clipboard_reading') : t('modal.clipboard_read')}
            </button>
            <button 
              class={styles.actionButton}
              onClick={handleWriteClipboard}
              disabled={!clipboardContent().trim() || isReadingClipboard()}
            >
              {t('modal.clipboard_write')}
            </button>

          </div>
        </div>
      </div>
    </Show>
  );
}
