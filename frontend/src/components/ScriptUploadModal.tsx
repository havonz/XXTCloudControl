import { createSignal, createEffect, onCleanup, For, Show, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Select, createListCollection } from '@ark-ui/solid';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark, IconUpload } from '../icons';
import { authFetch } from '../services/httpAuth';
import { useI18n } from '../i18n';
import styles from './ScriptUploadModal.module.css';

interface ScriptEntry {
  name: string;
  path: string;
}

interface ScriptUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadScript: (scriptName: string) => Promise<void>;
  selectedDeviceCount: number;
  serverBaseUrl: string;
}

export function ScriptUploadModal(props: ScriptUploadModalProps) {
  const { t } = useI18n();
  const [selectedScriptName, setSelectedScriptName] = createSignal('');
  const [scripts, setScripts] = createSignal<ScriptEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  const backdropClose = createBackdropClose(() => handleCancel());

  const loadScripts = async () => {
    if (!props.serverBaseUrl) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const response = await authFetch(`${props.serverBaseUrl}/api/scripts/selectable`);
      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
        setScripts([]);
      } else {
        setScripts(data.scripts || []);
      }
    } catch (err) {
      setError(t('modal.script_load_failed', { msg: (err as Error).message }));
      setScripts([]);
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      setSelectedScriptName('');
      setError('');
      loadScripts();
    }
  });

  const handleUploadScript = async () => {
    const name = selectedScriptName();
    if (!name) return;

    setIsSubmitting(true);
    try {
      await props.onUploadScript(name);
      setSelectedScriptName('');
      props.onClose();
    } catch (error) {
      console.error(t('modal.script_upload_failed'), error);
      setError(t('modal.script_upload_failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setSelectedScriptName('');
    props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && !isSubmitting() && selectedScriptName()) {
      handleUploadScript();
    }
  };

  createEffect(() => {
    if (!props.isOpen) return;

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  const selectedDisplayName = createMemo(() => {
    const name = selectedScriptName();
    if (!name) return '';
    const script = scripts().find(s => s.name === name);
    return script ? script.name : name;
  });

  const collection = createMemo(() => createListCollection({ items: scripts().map(s => s.name) }));

  return (
    <Show when={props.isOpen}>
      <div class={styles.overlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h3 class={styles.title}>{t('modal.script_upload_title')}</h3>
            <button class={styles.closeButton} onClick={handleCancel} title={t('common.close')}>
              <IconXmark size={16} />
            </button>
          </div>

          <div class={styles.body}>
            <p class={styles.description}>{t('modal.script_upload_description', { count: props.selectedDeviceCount })}</p>
            
            <div class={styles.inputGroup}>
              <Show when={isLoading()}>
                <div class={styles.loadingMessage}>{t('modal.script_loading')}</div>
              </Show>

              <Show when={error()}>
                <div class={styles.errorMessage}>{error()}</div>
              </Show>

              <Show when={!isLoading() && !error()}>
                <div class={styles.inputRow}>
                  <Select.Root
                    collection={collection()}
                    value={selectedScriptName() ? [selectedScriptName()] : []}
                    onValueChange={(e) => {
                      const val = e.items?.[0] as string | undefined;
                      setSelectedScriptName(val ?? '');
                    }}
                    disabled={isSubmitting()}
                    class={styles.selectRoot}
                  >
                    <Select.Control class={styles.selectControl}>
                      <Select.Trigger class={styles.selectTrigger}>
                        <span class={styles.selectValue}>
                          {selectedDisplayName() || t('modal.script_choose_placeholder')}
                        </span>
                        <span class={styles.dropdownArrow}>▼</span>
                      </Select.Trigger>
                    </Select.Control>
                    <Portal>
                      <Select.Positioner class={styles.selectPositioner}>
                        <Select.Content class={styles.selectContent}>
                          <Select.ItemGroup>
                            <Show when={scripts().length === 0}>
                              <div class={styles.emptyMessage}>{t('modal.script_empty')}</div>
                            </Show>
                            <For each={scripts()}>
                              {(script) => (
                                <Select.Item item={script.name} class={styles.selectItem}>
                                  <div class={styles.selectItemContent}>
                                    <Select.ItemIndicator class={styles.selectItemIndicator}>✓</Select.ItemIndicator>
                                    <Select.ItemText>{script.name}</Select.ItemText>
                                  </div>
                                </Select.Item>
                              )}
                            </For>
                          </Select.ItemGroup>
                        </Select.Content>
                      </Select.Positioner>
                    </Portal>
                    <Select.HiddenSelect />
                  </Select.Root>

                  <button
                    onClick={handleUploadScript}
                    disabled={!selectedScriptName() || isSubmitting()}
                    class={styles.uploadButton}
                  >
                    <IconUpload size={14} />
                    {isSubmitting() ? t('common.uploading') : t('common.upload')}
                  </button>
                </div>
              </Show>
            </div>
            <p class={styles.description}>{t('modal.script_upload_hint')}</p>
          </div>
        </div>
      </div>
    </Show>
  );
}
