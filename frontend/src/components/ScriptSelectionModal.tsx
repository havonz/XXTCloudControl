import { createSignal, createEffect, onMount, onCleanup, For, Show, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Select, createListCollection } from '@ark-ui/solid';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import { authFetch } from '../services/httpAuth';
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
      setError('加载脚本列表失败: ' + (err as Error).message);
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
      console.error('选择脚本失败:', error);
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

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  // Get display name for selected script
  const selectedDisplayName = createMemo(() => {
    const path = selectedScriptPath();
    if (!path) return '';
    const script = scripts().find(s => s.path === path);
    return script ? script.name : path;
  });

  // Create collection for Ark UI Select - use path as the value
  const collection = () => createListCollection({ items: scripts().map(s => s.path) });

  if (!props.isOpen) return null;
  
  return (
    <div class={styles.overlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
      <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div class={styles.header}>
          <h3 class={styles.title}>批量让设备选中脚本</h3>
          <button class={styles.closeButton} onClick={handleCancel} title="关闭">
            <IconXmark size={16} />
          </button>
        </div>

        <div class={styles.body}>
          <p class={styles.description}>将批量为 {props.selectedDeviceCount} 台设备选中脚本</p>
          
          <div class={styles.inputGroup}>
            <Show when={isLoading()}>
              <div class={styles.loadingMessage}>正在加载脚本列表...</div>
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
                        {selectedDisplayName() || '请选择脚本'}
                      </span>
                      <span class={styles.dropdownArrow}>▼</span>
                    </Select.Trigger>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner class={styles.selectPositioner}>
                      <Select.Content class={styles.selectContent}>
                        <Select.ItemGroup>
                          <Show when={scripts().length === 0}>
                            <div class={styles.emptyMessage}>暂无可选脚本</div>
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
                  {isSubmitting() ? '选择中...' : '选中'}
                </button>
              </div>
            </Show>
          </div>
          <p class={styles.description}>该操作不会将脚本传输到设备上，它仅仅是让设备选中指定名称的脚本作为主运行脚本。</p>
        </div>
      </div>
    </div>
  );
}
