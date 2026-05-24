import { createSignal, createMemo, For, Show } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import { IconUpload, IconXmark } from '../icons';
import { createBackdropClose } from '../hooks/useBackdropClose';
import styles from './DeviceFileBrowser.module.css';
import { useI18n } from '../i18n';

export interface SendToCloudModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (category: 'scripts' | 'files' | 'reports', relativePath: string) => void;
  itemCount: number;
  isScanning?: boolean;
  directoryCount?: number;
}

export default function SendToCloudModal(props: SendToCloudModalProps) {
  const { t } = useI18n();
  const [selectedCategory, setSelectedCategory] = createSignal<'scripts' | 'files' | 'reports'>('files');
  const [relativePath, setRelativePath] = createSignal('/');
  const backdropClose = createBackdropClose(() => props.onClose());
  const categoryOptions = createMemo(() => [
    { value: 'files' as const, label: t('files.cloud_files_root') },
    { value: 'reports' as const, label: t('files.cloud_reports_root') },
    { value: 'scripts' as const, label: t('files.cloud_scripts_root') },
  ]);

  // Create collection for Select component
  const categoryCollection = createMemo(() => 
    createListCollection({
      items: categoryOptions().map(o => ({
        value: o.value,
        label: o.label
      }))
    })
  );

  // Get selected category label for display
  const selectedCategoryLabel = createMemo(() => {
    const option = categoryOptions().find(o => o.value === selectedCategory());
    return option?.label ?? t('files.select_directory');
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
            <h3>{t('files.send_to_cloud')}</h3>
            <button class={styles.closeButton} onClick={props.onClose} title={t('common.close')}>
              <IconXmark size={16} />
            </button>
          </div>

          <div class={styles.sendToCloudBody}>
            <div class={styles.formRow}>
              <label class={styles.formLabel}>{t('files.root')}</label>
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
                        <For each={categoryOptions()}>{(option) => (
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
              <label class={styles.formLabel}>{t('files.relative_path')}</label>
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
                    <span>{t('files.directory_count_prefix', { count: props.directoryCount })}</span>
                  )}
                  {t('files.will_send_files', { count: props.itemCount })}
                </>
              }>
                <span>{t('files.scanning_found_files', { count: props.itemCount })}</span>
              </Show>
            </span>
            <div class={styles.sendToCloudActions}>
              <button class={styles.cancelBtn} onClick={props.onClose}>
                {t('common.cancel')}
              </button>
              <button 
                class={styles.confirmBtn} 
                onClick={handleConfirm}
                disabled={props.isScanning || props.itemCount === 0}
              >
                <IconUpload size={14} />
                <span>{props.isScanning ? t('files.scanning') : t('common.confirm')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
