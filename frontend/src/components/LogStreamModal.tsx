import { Component, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Device } from '../services/AuthService';
import { WebSocketService } from '../services/WebSocketService';
import { IconXmark } from '../icons';
import styles from './LogStreamModal.module.css';

interface LogStreamModalProps {
  isOpen: boolean;
  device: Device | null;
  onClose: () => void;
  webSocketService: WebSocketService | null;
}

const MAX_LOG_LENGTH = 8 * 1024 * 1024;
const TRIM_TARGET_LENGTH = 4 * 1024 * 1024;

const LogStreamModal: Component<LogStreamModalProps> = (props) => {
  const [paused, setPaused] = createSignal(false);
  const [autoScroll, setAutoScroll] = createSignal(true);
  const [status, setStatus] = createSignal('未连接');
  let logAreaRef: HTMLTextAreaElement | undefined;
  let logChunks: string[] = [];
  let totalLogLength = 0;
  let pendingLogBuffer = '';
  let flushFrameId: number | null = null;

  const scrollToBottom = () => {
    if (!logAreaRef) {
      return;
    }

    logAreaRef.scrollTop = logAreaRef.scrollHeight;
  };

  const syncLogArea = () => {
    if (!logAreaRef) {
      return;
    }

    logAreaRef.value = logChunks.join('');
    if (autoScroll()) {
      scrollToBottom();
    }
  };

  const cancelScheduledFlush = () => {
    if (flushFrameId === null) {
      return;
    }

    cancelAnimationFrame(flushFrameId);
    flushFrameId = null;
  };

  const resetLogState = () => {
    cancelScheduledFlush();
    logChunks = [];
    totalLogLength = 0;
    pendingLogBuffer = '';
    if (logAreaRef) {
      logAreaRef.value = '';
    }
  };

  const trimChunkToTarget = (chunk: string, keepLength: number) => {
    if (chunk.length <= keepLength) {
      return chunk;
    }

    const start = Math.max(0, chunk.length - keepLength);
    const nextLine = chunk.indexOf('\n', start);
    return chunk.slice(nextLine !== -1 && nextLine + 1 < chunk.length ? nextLine + 1 : start);
  };

  const trimLogsIfNeeded = () => {
    if (totalLogLength <= MAX_LOG_LENGTH) {
      return false;
    }

    while (logChunks.length > 0 && totalLogLength - logChunks[0].length >= TRIM_TARGET_LENGTH) {
      totalLogLength -= logChunks[0].length;
      logChunks.shift();
    }

    if (totalLogLength > TRIM_TARGET_LENGTH && logChunks.length > 0) {
      const keepLength = TRIM_TARGET_LENGTH - (totalLogLength - logChunks[0].length);
      const trimmedChunk = trimChunkToTarget(logChunks[0], Math.max(0, keepLength));
      totalLogLength -= logChunks[0].length - trimmedChunk.length;
      logChunks[0] = trimmedChunk;
    }

    return true;
  };

  const flushPendingLogs = () => {
    flushFrameId = null;
    if (!pendingLogBuffer) {
      return;
    }

    const nextChunk = pendingLogBuffer;
    pendingLogBuffer = '';
    logChunks.push(nextChunk);
    totalLogLength += nextChunk.length;

    const trimmed = trimLogsIfNeeded();
    if (!logAreaRef) {
      return;
    }

    if (trimmed) {
      syncLogArea();
      return;
    }

    logAreaRef.value += nextChunk;
    if (autoScroll()) {
      scrollToBottom();
    }
  };

  const scheduleFlush = () => {
    if (flushFrameId !== null) {
      return;
    }

    flushFrameId = requestAnimationFrame(flushPendingLogs);
  };

  const appendLog = (message: string) => {
    if (!message) {
      return;
    }

    pendingLogBuffer += message;
    scheduleFlush();
  };

  createEffect(() => {
    if (!props.isOpen || !props.device || !props.webSocketService) {
      return;
    }

    const udid = props.device.udid;
    resetLogState();
    setPaused(false);
    setAutoScroll(true);
    setStatus('订阅中');

    const unsubscribe = props.webSocketService.watchDeviceLog(udid, (chunk) => {
      if (!paused()) {
        appendLog(chunk.endsWith('\n') ? chunk : `${chunk}\n`);
      }
      setStatus(paused() ? '已暂停' : '已连接');
    });

    onCleanup(() => {
      unsubscribe();
      cancelScheduledFlush();
      setStatus('已断开');
    });
  });

  createEffect(() => {
    if (!props.isOpen || !autoScroll() || !logAreaRef) {
      return;
    }

    scrollToBottom();
  });

  const handleTogglePause = () => {
    setPaused((prev) => {
      const next = !prev;
      setStatus(next ? '已暂停' : '已连接');
      return next;
    });
  };

  return (
    <Show when={props.isOpen}>
      <div class={styles.overlay} onClick={props.onClose}>
        <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h2>实时日志 - {props.device?.system?.name || '未知设备'}</h2>
            <div class={styles.headerRight}>
              <div class={styles.status}>{status()}</div>
              <button class={styles.closeButton} onClick={props.onClose}>
                <IconXmark size={18} />
              </button>
            </div>
          </div>

          <div class={styles.body}>
            <div class={styles.toolbar}>
              <button class={styles.button} onClick={handleTogglePause}>
                {paused() ? '继续' : '暂停'}
              </button>
              <button class={styles.button} onClick={resetLogState}>清空</button>
              <div class={styles.flexSpacer} />
              <label class={styles.autoScrollLabel}>
                <input
                  type="checkbox"
                  class="themed-checkbox"
                  checked={autoScroll()}
                  onChange={(e) => setAutoScroll(e.currentTarget.checked)}
                />
                <span>自动滚动</span>
              </label>
            </div>
            <textarea
              ref={(el) => {
                logAreaRef = el;
                syncLogArea();
              }}
              class={styles.logArea}
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
