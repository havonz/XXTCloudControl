import { createSignal, Show, createEffect, onMount, onCleanup, For, createMemo } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import { useDialog } from './DialogContext';
import { createBackdropClose } from '../hooks/useBackdropClose';
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
  const [clipboardContent, setClipboardContent] = createSignal('');
  const [clipboardUti, setClipboardUti] = createSignal('public.plain-text');
  const [isReadingClipboard, setIsReadingClipboard] = createSignal(false);
  const backdropClose = createBackdropClose(() => handleClose());
  
  // UTI options for Ark-UI Select
  const utiOptions = [
    { value: 'public.plain-text', label: '纯文本' },
    { value: 'public.png', label: 'PNG图片' },
  ];
  const utiOptionsCollection = createMemo(() => 
    createListCollection({ items: utiOptions.map(o => o.value) })
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
      await dialog.alert('请先选择设备');
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
      console.error('读取剪贴板失败:', error);
      setIsReadingClipboard(false);
    }
  };

  const handleWriteClipboard = async () => {
    if (props.selectedDevicesCount === 0) {
      await dialog.alert('请先选择设备');
      return;
    }

    if (!clipboardContent().trim()) {
      await dialog.alert('请输入内容');
      return;
    }

    try {
      props.onWriteClipboard(clipboardUti(), clipboardContent());
      
      props.onClose();
    } catch (error) {
      console.error('写入剪贴板失败:', error);
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
            <h3>剪贴板操作</h3>
            <p>选中设备: {props.selectedDevicesCount} 台</p>
          </div>
          
          <div class={styles.modalContent}>
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>数据类型:</label>
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
                    <span>{utiOptions.find(o => o.value === clipboardUti())?.label || '纯文本'}</span>
                    <span class="dropdown-arrow">▼</span>
                  </Select.Trigger>
                </Select.Control>
                <Portal>
                  <Select.Positioner style={{ 'z-index': 10400, width: 'var(--reference-width)' }}>
                    <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                      <Select.ItemGroup>
                        <For each={utiOptions}>{(option) => (
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
              <label class={styles.inputLabel}>内容:</label>
              <textarea 
                class={styles.textareaInput}
                value={clipboardContent()}
                onInput={(e) => setClipboardContent(e.target.value)}
                placeholder={clipboardUti() === 'public.plain-text' ? '输入文本内容...' : '输入Base64编码的图片数据...'}
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
              title={props.isSyncControlEnabled ? '读取剪贴板仅在非同步控制模式下可用' : '读取当前设备的剪贴板内容'}
            >
              {isReadingClipboard() ? '读取中...' : '读取剪贴板'}
            </button>
            <button 
              class={styles.actionButton}
              onClick={handleWriteClipboard}
              disabled={!clipboardContent().trim() || isReadingClipboard()}
            >
              写入剪贴板
            </button>
            <button 
              class={styles.cancelButton}
              onClick={handleClose}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
