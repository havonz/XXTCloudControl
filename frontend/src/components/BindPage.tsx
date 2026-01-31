import { createSignal, createMemo, Show, createEffect, onMount } from 'solid-js';
import QRCode from 'qrcode';
import { AuthService } from '../services/AuthService';
import styles from './BindPage.module.css';

interface BindPageProps {
  onNavigateToLogin?: () => void;
}

/**
 * Public binding page for customers to scan QR code or download binding script.
 * This page is accessible without login at /bind
 */
const BindPage = (props: BindPageProps) => {
  const authService = AuthService.getInstance();
  
  // QR code data URL state
  const [qrCodeDataUrl, setQrCodeDataUrl] = createSignal('');
  const [serverHost, setServerHost] = createSignal('');
  const [serverPort, setServerPort] = createSignal('');
  
  // Detect iOS device
  const isIOS = () => {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  
  // Auto-detect server host and port from current URL
  onMount(() => {
    const host = window.location.hostname;
    const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
    setServerHost(host);
    setServerPort(port);
  });
  
  const hostOnly = createMemo(() => authService.getServerHost(serverHost()));
  const baseUrl = createMemo(() => authService.getHttpBaseUrl(serverHost(), serverPort()));

  const resolveThemeColor = (primaryVar: string, fallbackVar: string) => {
    const computedStyles = getComputedStyle(document.documentElement);
    const primary = computedStyles.getPropertyValue(primaryVar).trim();
    if (primary) return primary;
    return computedStyles.getPropertyValue(fallbackVar).trim();
  };

  // Generate QR code content (XXT download URL)
  const qrCodeContent = createMemo(() => {
    const host = hostOnly();
    const port = serverPort();
    if (!host || !port) return '';
    
    const fileName = `加入或退出云控[${host}].lua`;
    const encodedFileName = encodeURIComponent(fileName);
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const downloadUrl = encodeURIComponent(`${baseUrl()}/api/download-bind-script?host=${host}&port=${port}&proto=${proto}`);
    
    return `xxt://download/?path=${encodedFileName}&url=${downloadUrl}`;
  });

  // Generate direct download URL
  const downloadUrl = createMemo(() => {
    const host = hostOnly();
    const port = serverPort();
    if (!host || !port) return '';
    
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${baseUrl()}/api/download-bind-script?host=${host}&port=${port}&proto=${proto}`;
  });

  // Generate QR code when content is ready
  createEffect(() => {
    const content = qrCodeContent();
    if (content) {
      const qrDark = resolveThemeColor('--text', '--text-on-gradient');
      const qrLight = resolveThemeColor('--panel', '--bg');
      QRCode.toDataURL(content, {
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
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handleGoToLogin = () => {
    if (props.onNavigateToLogin) {
      props.onNavigateToLogin();
    } else {
      window.location.href = '/';
    }
  };

  const handleOpenInXXT = () => {
    const url = qrCodeContent();
    if (url) {
      window.location.href = url;
    }
  };

  return (
    <div class={styles.container}>
      <div class={styles.card}>
        <div class={styles.header}>
          <img src="/favicon-48.png" alt="Logo" class={styles.logo} />
          <h1 class={styles.title}>设备绑定</h1>
        </div>
        
        <div class={styles.body}>
          <div class={styles.qrSection}>
            <h3 class={styles.sectionTitle}>扫描二维码下载绑定脚本</h3>
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
            <p class={styles.description}>
              使用 XXTouch 扫描此二维码即可下载绑定脚本
            </p>
          </div>
          
          <div class={styles.downloadSection}>
            <h3 class={styles.sectionTitle}>手动下载绑定脚本</h3>
            <Show when={isIOS()}>
              <button 
                class={styles.xxtButton}
                onClick={handleOpenInXXT}
              >
                跳转 X.X.T 下载
              </button>
            </Show>
            <button 
              class={styles.downloadButton}
              onClick={handleDownload}
            >
              下载绑定脚本
            </button>
            <p class={styles.description}>
              点击按钮下载绑定脚本，运行后可加入或退出云控
            </p>
          </div>

          <Show when={serverHost()}>
            <div class={styles.serverInfo}>
              云控服务器: {serverHost()}:{serverPort()}
            </div>
          </Show>
        </div>
        
        <div class={styles.footer}>
          <a href="/" class={styles.loginLink} onClick={(e) => { e.preventDefault(); handleGoToLogin(); }}>
            管理员登录 →
          </a>
        </div>
      </div>
    </div>
  );
};

export default BindPage;
