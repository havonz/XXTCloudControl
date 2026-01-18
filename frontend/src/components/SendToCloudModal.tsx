import { createSignal, createMemo, For, Show } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import { IconUpload, IconXmark } from '../icons';
import { createBackdropClose } from '../hooks/useBackdropClose';
import styles from './DeviceFileBrowser.module.css';

export interface SendToCloudModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (category: 'scripts' | 'files' | 'reports', relativePath: string) => void;
  itemCount: number;
  isScanning?: boolean;
  directoryCount?: number;
}

const CATEGORY_OPTIONS = [
  { value: 'files', label: '云控资源目录' },
  { value: 'reports', label: '云控报告目录' },
  { value: 'scripts', label: '云控脚本目录' },
] as const;

export default function SendToCloudModal(props: SendToCloudModalProps) {
  const [selectedCategory, setSelectedCategory] = createSignal<'scripts' | 'files' | 'reports'>('files');
  const [relativePath, setRelativePath] = createSignal('/');
  const backdropClose = createBackdropClose(() => props.onClose());

  // Create collection for Select component
  const categoryCollection = createMemo(() => 
    createListCollection({
      items: CATEGORY_OPTIONS.map(o => ({
        value: o.value,
        label: o.label
      }))
    })
  );

  // Get selected category label for display
  const selectedCategoryLabel = createMemo(() => {
    const option = CATEGORY_OPTIONS.find(o => o.value === selectedCategory());
    return option?.label ?? '-- 选择目录 --';
  });

  const handleConfirm = () => {
    let path = relativePath().trim() || '/';
    // Normalize path
    if (!path.startsWith('/')) path = '/' + path;
    props.onConfirm(selectedCategory(), path);
  };

  return (
    <Show when={props.isOpen}>
      <div 
        class={styles.editorOverlay} 
        onMouseDown={backdropClose.onMouseDown} 
        onMouseUp={backdropClose.onMouseUp}
      >
        <div 
          class={styles.sendToCloudModal} 
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div class={styles.sendToCloudHeader}>
            <h3>发送到云控</h3>
            <button class={styles.closeButton} onClick={props.onClose}>
              <IconXmark size={16} />
            </button>
          </div>

          <div class={styles.sendToCloudBody}>
            <div class={styles.formRow}>
              <label class={styles.formLabel}>根目录</label>
              <Select.Root
                class={styles.formSelectRoot}
                collection={categoryCollection()}
                value={[selectedCategory()]}
                onValueChange={(e) => {
                  const next = (e.value[0] ?? 'files') as 'scripts' | 'files' | 'reports';
                  setSelectedCategory(next);
                }}
              >
                <Select.Control style={{ width: '100%' }}>
                  <Select.Trigger class="cbx-select" style={{ width: '100%', flex: 1 }}>
                    <span>{selectedCategoryLabel()}</span>
                    <span class="dropdown-arrow">▼</span>
                  </Select.Trigger>
                </Select.Control>
                <Portal>
                  <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                    <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                      <Select.ItemGroup>
                        <For each={CATEGORY_OPTIONS}>{(option) => (
                          <Select.Item 
                            item={{ value: option.value, label: option.label }} 
                            class="cbx-item"
                          >
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

            <div class={styles.formRow}>
              <label class={styles.formLabel}>相对路径</label>
              <input
                type="text"
                class={styles.formInput}
                placeholder="/"
                value={relativePath()}
                onInput={(e) => setRelativePath(e.currentTarget.value)}
              />
            </div>
          </div>

          <div class={styles.sendToCloudFooter}>
            <span class={styles.itemCountInfo}>
              <Show when={props.isScanning} fallback={
                <>
                  {props.directoryCount && props.directoryCount > 0 && (
                    <span>{props.directoryCount} 个目录，</span>
                  )}
                  将发送 {props.itemCount} 个文件
                </>
              }>
                <span>扫描目录中... 已发现 {props.itemCount} 个文件</span>
              </Show>
            </span>
            <div class={styles.sendToCloudActions}>
              <button class={styles.cancelBtn} onClick={props.onClose}>
                取消
              </button>
              <button 
                class={styles.confirmBtn} 
                onClick={handleConfirm}
                disabled={props.isScanning || props.itemCount === 0}
              >
                <IconUpload size={14} />
                <span>{props.isScanning ? '扫描中...' : '确定'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
