import { createSignal, createMemo, Show, createEffect, onCleanup } from 'solid-js';
import QRCode from 'qrcode';
import { AuthService } from '../services/AuthService';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import { useI18n } from '../i18n';
import { getBindingScriptDownloadUrl, getBindingScriptFileName } from '../utils/deviceBinding';
import styles from './DeviceBindingModal.module.css';

interface DeviceBindingModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverHost: string;
  serverPort: string;
}

const DeviceBindingModal = (props: DeviceBindingModalProps) => {
  const authService = AuthService.getInstance();
  const { locale, t } = useI18n();
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

  // 生成下载链接
  const downloadUrl = createMemo(() => {
    const host = hostOnly();
    const port = props.serverPort;
    if (!host || !port) return '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return getBindingScriptDownloadUrl(baseUrl(), host, port, proto, locale());
  });

  // 生成二维码内容
  const qrCodeContent = createMemo(() => {
    const host = hostOnly();
    const url = downloadUrl();
    if (!host || !url) return '';
    return `xxt://download/?path=${encodeURIComponent(getBindingScriptFileName(host))}&url=${encodeURIComponent(url)}`;
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
    const url = downloadUrl();
    if (url) window.open(url, '_blank');
  };

  const handleClose = () => {
    props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  createEffect(() => {
    if (!props.isOpen) return;

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modalContent} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h2>{t('bind.modal_title')}</h2>
            <button class={styles.closeButton} onClick={handleClose} title={t('common.close')}>
              <IconXmark size={16} />
            </button>
          </div>
          
          <div class={styles.modalBody}>
            <div class={styles.qrSection}>
              <h3>{t('bind.scan_title')}</h3>
              <div class={styles.qrCodeContainer}>
                <Show when={qrCodeDataUrl()} fallback={
                  <div class={styles.qrCodeLoading}>{t('bind.qr_loading')}</div>
                }>
                  <img 
                    src={qrCodeDataUrl()} 
                    alt={t('bind.qr_alt')}
                    class={styles.qrCodeImage}
                  />
                </Show>
              </div>
              <p class={styles.qrDescription}>
                {t('bind.modal_qr_description')}
              </p>
            </div>
            
            <div class={styles.downloadSection}>
              <h3>{t('bind.manual_title')}</h3>
              <button 
                class={styles.downloadButton}
                onClick={handleDownload}
              >
                {t('bind.download_script')}
              </button>
              <p class={styles.downloadDescription}>
                {t('bind.modal_download_description')}
              </p>
            </div>
          </div>
          

        </div>
      </div>
    </Show>
  );
};

export default DeviceBindingModal;
