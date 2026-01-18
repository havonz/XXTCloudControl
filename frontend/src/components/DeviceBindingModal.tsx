import { createSignal, createMemo, Show, createEffect, onMount, onCleanup } from 'solid-js';
import QRCode from 'qrcode';
import { AuthService } from '../services/AuthService';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import styles from './DeviceBindingModal.module.css';

interface DeviceBindingModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverHost: string;
  serverPort: string;
}

const DeviceBindingModal = (props: DeviceBindingModalProps) => {
  const authService = AuthService.getInstance();
  const backdropClose = createBackdropClose(() => handleClose());

  // 二维码数据URL状态
  const [qrCodeDataUrl, setQrCodeDataUrl] = createSignal('');
  
  const hostOnly = createMemo(() => authService.getServerHost(props.serverHost));
  const baseUrl = createMemo(() => authService.getHttpBaseUrl(props.serverHost, props.serverPort));

  const resolveThemeColor = (primaryVar: string, fallbackVar: string) => {
    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue(primaryVar).trim();
    if (primary) return primary;
    return styles.getPropertyValue(fallbackVar).trim();
  };

  // 生成二维码内容
  const qrCodeContent = createMemo(() => {
    const host = hostOnly();
    const port = props.serverPort;
    const fileName = `加入或退出云控[${host}].lua`;
    const encodedFileName = encodeURIComponent(fileName);
    const downloadUrl = encodeURIComponent(`${baseUrl()}/api/download-bind-script?host=${host}&port=${port}`);
    
    return `xxt://download/?path=${encodedFileName}&url=${downloadUrl}`;
  });

  // 生成下载链接
  const downloadUrl = createMemo(() => {
    const host = hostOnly();
    const port = props.serverPort;
    return `${baseUrl()}/api/download-bind-script?host=${host}&port=${port}`;
  });

  // 使用前端库生成二维码
  createEffect(() => {
    if (props.isOpen && qrCodeContent()) {
      const qrDark = resolveThemeColor('--text', '--text-on-gradient');
      const qrLight = resolveThemeColor('--panel', '--bg');
      QRCode.toDataURL(qrCodeContent(), {
        width: 200,
        margin: 2,
        color: {
          dark: qrDark,
          light: qrLight
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
      <div class={styles.modalOverlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modalContent} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h2>设备绑定到云控</h2>
            <button class={styles.closeButton} onClick={handleClose} title="关闭">
              <IconXmark size={16} />
            </button>
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
          

        </div>
      </div>
    </Show>
  );
};

export default DeviceBindingModal;
