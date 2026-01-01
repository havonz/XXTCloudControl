import { createSignal, onMount, onCleanup } from 'solid-js';
import styles from './ScriptSelectionModal.module.css';

interface ScriptSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectScript: (scriptName: string) => void;
  selectedDeviceCount: number;
}

export function ScriptSelectionModal(props: ScriptSelectionModalProps) {
  const [scriptName, setScriptName] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);

  const handleSelectScript = async () => {
    const name = scriptName().trim();
    if (!name) return;

    setIsLoading(true);
    try {
      await props.onSelectScript(name);
      setScriptName('');
      props.onClose();
    } catch (error) {
      console.error('选择脚本失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setScriptName('');
    props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && !isLoading() && scriptName().trim()) {
      handleSelectScript();
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  if (!props.isOpen) return null;
  return (
    <div class={styles.overlay} onClick={handleCancel}>
      <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div class={styles.header}>
          <h3 class={styles.title}>批量让设备选中脚本</h3>
        </div>

        <div class={styles.body}>
          <p class={styles.description}>将批量为 {props.selectedDeviceCount} 台设备选中脚本</p>
          
          <div class={styles.inputGroup}>
            <div class={styles.inputRow}>
              <input
                id="scriptName"
                type="text"
                value={scriptName()}
                onInput={(e) => setScriptName(e.currentTarget.value)}
                placeholder="请输入脚本名称（如：main.lua）"
                class={styles.input}
                disabled={isLoading()}
              />
              <button
                onClick={handleSelectScript}
                disabled={!scriptName().trim() || isLoading()}
                class={styles.selectButton}
              >
                {isLoading() ? '选择中...' : '选中'}
              </button>
            </div>
          </div>
          <p class={styles.description}>该操作不会将脚本传输到设备上，它仅仅是让设备选中指定名称的脚本作为主运行脚本。</p>
        </div>
        
        <div class={styles.footer}>
          <button onClick={handleCancel} class={styles.cancelButton}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
