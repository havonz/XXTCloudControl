import { createSignal, Show, createEffect } from 'solid-js';
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
  const [clipboardContent, setClipboardContent] = createSignal('');
  const [clipboardUti, setClipboardUti] = createSignal('public.plain-text');
  const [isReadingClipboard, setIsReadingClipboard] = createSignal(false);

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

  const handleReadClipboard = () => {
    if (props.selectedDevicesCount === 0) {
      alert('请先选择设备');
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

  const handleWriteClipboard = () => {
    if (props.selectedDevicesCount === 0) {
      alert('请先选择设备');
      return;
    }

    if (!clipboardContent().trim()) {
      alert('请输入内容');
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

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onClick={handleClose}>
        <div class={styles.clipboardModal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h3>剪贴板操作</h3>
            <p>选中设备: {props.selectedDevicesCount} 台</p>
          </div>
          
          <div class={styles.modalContent}>
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>数据类型:</label>
              <select 
                class={styles.selectInput}
                value={clipboardUti()}
                onChange={(e) => setClipboardUti(e.target.value)}
              >
                <option value="public.plain-text">纯文本</option>
                <option value="public.png">PNG图片</option>
              </select>
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
