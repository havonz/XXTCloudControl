import { createSignal } from 'solid-js';
// import styles from './ScriptSelectionModal.module.css';

// 临时使用内联样式来测试弹窗功能
const styles = {
  overlay: 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(5px);',
  modal: 'background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); border-radius: 12px; width: 90%; max-width: 500px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); color: white; overflow: hidden; display: flex; flex-direction: column;',
  header: 'padding: 1rem 1.5rem; border-bottom: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.05);',
  body: 'padding: 1.5rem; flex: 1; overflow-y: auto;',
  inputGroup: 'margin-bottom: 1rem;',
  inputRow: 'display: flex; gap: 0.75rem; align-items: center;',
  input: 'flex: 1; padding: 0.75rem; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 6px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 0.9rem;',
  selectButton: 'background: rgba(40, 167, 69, 0.8); color: white; border: 1px solid rgba(255, 255, 255, 0.3); padding: 0.75rem 1.25rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 500;',
  footer: 'display: flex; justify-content: flex-end; padding: 1rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.05);',
  cancelButton: 'background: rgba(255, 255, 255, 0.1); color: white; border: 1px solid rgba(255, 255, 255, 0.3); padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem;'
};

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

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading() && scriptName().trim()) {
      handleSelectScript();
    }
  };

  if (!props.isOpen) return null;
  return (
    <div style={styles.overlay} onClick={handleCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style="margin: 0; font-size: 1.1rem; font-weight: 600; color: white;">选择脚本</h3>
        </div>
        
        <div style={styles.body}>
          <p style="margin: 0 0 1.5rem 0; font-size: 0.9rem; color: rgba(255, 255, 255, 0.9);">将为 {props.selectedDeviceCount} 台设备选择脚本</p>
          
          <div style={styles.inputGroup}>
            <label for="scriptName" style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500; color: rgba(255, 255, 255, 0.9);">脚本名称：</label>
            <div style={styles.inputRow}>
              <input
                id="scriptName"
                type="text"
                value={scriptName()}
                onInput={(e) => setScriptName(e.currentTarget.value)}
                onKeyPress={handleKeyPress}
                placeholder="请输入脚本名称（如：main.lua）"
                style={styles.input}
                disabled={isLoading()}
              />
              <button
                onClick={handleSelectScript}
                disabled={!scriptName().trim() || isLoading()}
                style={styles.selectButton}
              >
                {isLoading() ? '选择中...' : '选中'}
              </button>
            </div>
          </div>
        </div>
        
        <div style={styles.footer}>
          <button onClick={handleCancel} style={styles.cancelButton}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
