import { createSignal, createMemo, Show, createEffect, onMount, onCleanup } from 'solid-js';
import QRCode from 'qrcode';
import styles from './DeviceBindingModal.module.css';

interface DeviceBindingModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverHost: string;
  serverPort: string;
}

const DeviceBindingModal = (props: DeviceBindingModalProps) => {
  // 二维码数据URL状态
  const [qrCodeDataUrl, setQrCodeDataUrl] = createSignal('');
  
  // 生成二维码内容
  const qrCodeContent = createMemo(() => {
    const host = props.serverHost;
    const port = props.serverPort;
    const fileName = `加入或退出云控[${host}].lua`;
    const encodedFileName = encodeURIComponent(fileName);
    const downloadUrl = encodeURIComponent(`http://${host}:${port}/api/download-bind-script?host=${host}&port=${port}`);
    
    return `xxt://download/?path=${encodedFileName}&url=${downloadUrl}`;
  });

  // 生成下载链接
  const downloadUrl = createMemo(() => {
    const host = props.serverHost;
    const port = props.serverPort;
    return `http://${host}:${port}/api/download-bind-script?host=${host}&port=${port}`;
  });

  // 使用前端库生成二维码
  createEffect(() => {
    if (props.isOpen && qrCodeContent()) {
      QRCode.toDataURL(qrCodeContent(), {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      }).then((dataUrl) => {
        setQrCodeDataUrl(dataUrl);
      }).catch((error) => {
        console.error('生成二维码失败:', error);
      });
    }
  });

  const handleDownload = () => {
    window.open(downloadUrl(), '_blank');
  };

  const handleClose = () => {
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
      <div class={styles.modalOverlay} onClick={handleClose}>
        <div class={styles.modalContent} onClick={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h2>设备绑定到云控</h2>
          </div>
          
          <div class={styles.modalBody}>
            <div class={styles.qrSection}>
              <h3>扫描二维码下载绑定脚本</h3>
              <div class={styles.qrCodeContainer}>
                <Show when={qrCodeDataUrl()} fallback={
                  <div class={styles.qrCodeLoading}>生成二维码中...</div>
                }>
                  <img 
                    src={qrCodeDataUrl()} 
                    alt="设备绑定二维码" 
                    class={styles.qrCodeImage}
                  />
                </Show>
              </div>
              <p class={styles.qrDescription}>
                使用 XXTouch 扫描此二维码即可下载绑定到云控脚本
              </p>
            </div>
            
            <div class={styles.downloadSection}>
              <h3>手动下载绑定脚本</h3>
              <button 
                class={styles.downloadButton}
                onClick={handleDownload}
              >
                下载绑定脚本
              </button>
              <p class={styles.downloadDescription}>
                点击按钮下载绑定到云控脚本
              </p>
            </div>
          </div>
          
          <div class={styles.modalFooter}>
            <button class={styles.cancelButton} onClick={handleClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default DeviceBindingModal;
