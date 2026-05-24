import { createSignal, createEffect, onCleanup, For, Show, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Select, createListCollection } from '@ark-ui/solid';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import { authFetch } from '../services/httpAuth';
import { useI18n } from '../i18n';
import styles from './ScriptSelectionModal.module.css';

interface ScriptEntry {
  name: string; // Display name (file or folder name)
  path: string; // Actual script path to select
}

interface ScriptSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectScript: (scriptName: string) => void;
  selectedDeviceCount: number;
  serverBaseUrl: string;
}

export function ScriptSelectionModal(props: ScriptSelectionModalProps) {
  const { t } = useI18n();
  const [selectedScriptPath, setSelectedScriptPath] = createSignal('');
  const [scripts, setScripts] = createSignal<ScriptEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  const backdropClose = createBackdropClose(() => handleCancel());

  // Load scripts from server
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

  // Load scripts when modal opens
  createEffect(() => {
    if (props.isOpen) {
      setSelectedScriptPath('');
      setError('');
      loadScripts();
    }
  });

  const handleSelectScript = async () => {
    const path = selectedScriptPath();
    if (!path) return;

    setIsSubmitting(true);
    try {
      await props.onSelectScript(path);
      setSelectedScriptPath('');
      props.onClose();
    } catch (error) {
      console.error(t('modal.script_select_failed'), error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setSelectedScriptPath('');
    props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && !isSubmitting() && selectedScriptPath()) {
      handleSelectScript();
    }
  };

  createEffect(() => {
    if (!props.isOpen) return;

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  // Get display name for selected script
  const selectedDisplayName = createMemo(() => {
    const path = selectedScriptPath();
    if (!path) return '';
    const script = scripts().find(s => s.path === path);
    return script ? script.name : path;
  });

  // Create collection for Ark UI Select - use path as the value
  const collection = createMemo(() => createListCollection({ items: scripts().map(s => s.path) }));

  return (
    <Show when={props.isOpen}>
      <div class={styles.overlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h3 class={styles.title}>{t('modal.script_select_title')}</h3>
            <button class={styles.closeButton} onClick={handleCancel} title={t('common.close')}>
              <IconXmark size={16} />
            </button>
          </div>

          <div class={styles.body}>
            <p class={styles.description}>{t('modal.script_select_description', { count: props.selectedDeviceCount })}</p>
            
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
                    value={selectedScriptPath() ? [selectedScriptPath()] : []}
                    onValueChange={(e) => {
                      const val = e.items?.[0] as string | undefined;
                      setSelectedScriptPath(val ?? '');
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
                                <Select.Item item={script.path} class={styles.selectItem}>
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
                    onClick={handleSelectScript}
                    disabled={!selectedScriptPath() || isSubmitting()}
                    class={styles.selectButton}
                  >
                    {isSubmitting() ? t('modal.script_selecting') : t('modal.script_selected')}
                  </button>
                </div>
              </Show>
            </div>
            <p class={styles.description}>{t('modal.script_select_hint')}</p>
          </div>
        </div>
      </div>
    </Show>
  );
}
