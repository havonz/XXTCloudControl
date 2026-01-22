import { Component, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Device } from '../services/AuthService';
import { WebSocketService } from '../services/WebSocketService';
import styles from './LogStreamModal.module.css';

interface LogStreamModalProps {
  isOpen: boolean;
  device: Device | null;
  onClose: () => void;
  webSocketService: WebSocketService | null;
}

const MAX_LOG_LENGTH = 8 * 1024 * 1024;
const TRIM_AMOUNT = 4 * 1024 * 1024;

const LogStreamModal: Component<LogStreamModalProps> = (props) => {
  const [logText, setLogText] = createSignal('');
  const [paused, setPaused] = createSignal(false);
  const [status, setStatus] = createSignal('未连接');

  const appendLog = (message: string) => {
    if (!message) return;
    setLogText((prev) => {
      let next = prev + message;
      if (next.length > MAX_LOG_LENGTH) {
        const cutPoint = next.indexOf('\n', TRIM_AMOUNT);
        const startIndex = cutPoint !== -1 ? cutPoint + 1 : TRIM_AMOUNT;
        next = next.slice(startIndex);
      }
      return next;
    });
  };

  const normalizeLog = (chunk: string) => {
    if (!chunk) return '';
    return chunk.endsWith('\n') ? chunk : `${chunk}\n`;
  };

  createEffect(() => {
    if (!props.isOpen || !props.device || !props.webSocketService) {
      return;
    }

    const udid = props.device.udid;
    setLogText('');
    setPaused(false);
    setStatus('订阅中');

    props.webSocketService.subscribeDeviceLogs([udid]);

    const unsubscribe = props.webSocketService.onMessage((message) => {
      if (message.type !== 'system/log/push' || message.udid !== udid) return;
      const chunk = typeof message.body?.chunk === 'string' ? message.body.chunk : '';
      if (!chunk) return;
      if (!paused()) {
        appendLog(normalizeLog(chunk));
      }
      setStatus(paused() ? '已暂停' : '已连接');
    });

    onCleanup(() => {
      unsubscribe();
      props.webSocketService?.unsubscribeDeviceLogs([udid]);
      setStatus('已断开');
    });
  });

  const handleClose = () => {
    props.onClose();
  };

  const handleTogglePause = () => {
    setPaused((prev) => !prev);
    setStatus(!paused() ? '已暂停' : '已连接');
  };

  const handleClear = () => {
    setLogText('');
  };

  return (
    <Show when={props.isOpen}>
      <div class={styles.overlay} onClick={handleClose}>
        <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <div class={styles.titleGroup}>
              <div class={styles.title}>实时日志</div>
              <div class={styles.meta}>
                {props.device?.system?.name || '未知设备'} · {props.device?.udid}
              </div>
            </div>
            <div class={styles.status}>{status()}</div>
          </div>

          <div class={styles.body}>
            <div class={styles.toolbar}>
              <button class={styles.button} onClick={handleTogglePause}>
                {paused() ? '继续' : '暂停'}
              </button>
              <button class={styles.button} onClick={handleClear}>清空</button>
              <div class={styles.flexSpacer} />
              <button class={`${styles.button} ${styles.buttonPrimary}`} onClick={handleClose}>
                关闭
              </button>
            </div>
            <textarea
              class={styles.logArea}
              value={logText()}
              readOnly
              spellcheck={false}
            />
          </div>
        </div>
      </div>
    </Show>
  );
};

export default LogStreamModal;
