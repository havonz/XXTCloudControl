import { createSignal, onCleanup, createEffect, Show, onMount } from 'solid-js';
import styles from './WebRTCControl.module.css';
import { WebRTCService, type WebRTCStartOptions } from '../services/WebRTCService';
import type { Device } from '../services/AuthService';
import type { WebSocketService } from '../services/WebSocketService';

export interface WebRTCControlProps {
  isOpen: boolean;
  onClose: () => void;
  device: Device | null;
  webSocketService: WebSocketService | null;
  password: string;
}

export default function WebRTCControl(props: WebRTCControlProps) {
  const [connectionState, setConnectionState] = createSignal<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [resolution, setResolution] = createSignal(0.6); // 60%
  const [frameRate, setFrameRate] = createSignal(20);
  const [currentFps, setCurrentFps] = createSignal(0);
  const [bitrate, setBitrate] = createSignal(0);
  const [remoteStream, setRemoteStream] = createSignal<MediaStream | null>(null);

  let videoRef: HTMLVideoElement | undefined;
  let webrtcService: WebRTCService | null = null;
  let statsInterval: number | undefined;
  let lastBytesReceived = 0;
  let lastTimestamp = 0;
  let frameCount = 0;
  let fpsInterval: number | undefined;

  // 初始化 WebRTC 连接
  const startStream = async () => {
    if (!props.device || !props.webSocketService) return;

    setConnectionState('connecting');

    try {
      if (webrtcService) {
        await webrtcService.cleanup();
      }
      
      webrtcService = new WebRTCService(
        props.webSocketService,
        props.device.udid,
        props.password,
        {
          onConnected: () => {
            setConnectionState('connected');
            startStatsMonitoring();
          },
          onDisconnected: () => {
            setConnectionState('disconnected');
            stopStatsMonitoring();
          },
          onError: (error) => {
            console.error('WebRTC error:', error);
            setConnectionState('disconnected');
          },
          onTrack: (stream) => {
            console.log('[WebRTC] Setting remote stream signal');
            setRemoteStream(stream);
          }
        }
      );

      const options: WebRTCStartOptions = {
        resolution: resolution(),
        fps: frameRate(),
        force: true
      };

      await webrtcService.startStream(options);
    } catch (error) {
      console.error('Failed to start WebRTC stream:', error);
      setConnectionState('disconnected');
    }
  };

  // 停止 WebRTC 连接
  const stopStream = async () => {
    if (webrtcService) {
      await webrtcService.stopStream();
      webrtcService = null;
    }
    setRemoteStream(null);
    if (videoRef) {
      videoRef.srcObject = null;
    }
    setConnectionState('disconnected');
    stopStatsMonitoring();
  };

  // 开始统计监控
  const startStatsMonitoring = () => {
    frameCount = 0;
    fpsInterval = window.setInterval(() => {
      setCurrentFps(frameCount);
      frameCount = 0;
    }, 1000);

    statsInterval = window.setInterval(async () => {
      if (!webrtcService) return;
      
      const pc = webrtcService.getPeerConnection();
      if (!pc) return;

      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const now = Date.now();
            if (lastTimestamp > 0) {
              const bytesReceived = report.bytesReceived || 0;
              const framesDecoded = report.framesDecoded || 0;
              const framesDropped = report.framesDropped || 0;
              const timeDiff = (now - lastTimestamp) / 1000;
              const bytesDiff = bytesReceived - lastBytesReceived;
              
              // if (bytesDiff > 0) {
              //   console.log('[WebRTC] Receiving:', {
              //     kbps: Math.round((bytesDiff * 8) / timeDiff / 1000),
              //     framesDecoded,
              //     framesDropped,
              //     jitter: report.jitter,
              //     packetsLost: report.packetsLost,
              //     videoState: videoRef ? `play:${!videoRef.paused}, muted:${videoRef.muted}, ready:${videoRef.readyState}` : 'no-ref'
              //   });
              // }
              setBitrate(Math.round((bytesDiff * 8) / timeDiff / 1000)); // kbps
              lastBytesReceived = bytesReceived;
            }
            lastTimestamp = now;
            frameCount++;
          }
        });
      } catch (e) {
        console.error('Stats error:', e);
      }
    }, 500);
  };

  // 停止统计监控
  const stopStatsMonitoring = () => {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = undefined;
    }
    if (fpsInterval) {
      clearInterval(fpsInterval);
      fpsInterval = undefined;
    }
    setCurrentFps(0);
    setBitrate(0);
  };

  // 触控事件处理
  const convertToDeviceCoordinates = (event: MouseEvent) => {
    if (!videoRef) return null;

    const rect = videoRef.getBoundingClientRect();
    const videoWidth = videoRef.videoWidth;
    const videoHeight = videoRef.videoHeight;

    if (!videoWidth || !videoHeight) return null;

    // 计算视频在元素中的实际显示区域
    const aspectRatio = videoWidth / videoHeight;
    const elemAspectRatio = rect.width / rect.height;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (aspectRatio > elemAspectRatio) {
      displayWidth = rect.width;
      displayHeight = rect.width / aspectRatio;
      offsetX = 0;
      offsetY = (rect.height - displayHeight) / 2;
    } else {
      displayWidth = rect.height * aspectRatio;
      displayHeight = rect.height;
      offsetX = (rect.width - displayWidth) / 2;
      offsetY = 0;
    }

    const relX = event.clientX - rect.left - offsetX;
    const relY = event.clientY - rect.top - offsetY;

    if (relX < 0 || relX > displayWidth || relY < 0 || relY > displayHeight) {
      return null;
    }

    // 返回 0.0 - 1.0 之间的比例
    return { 
      x: relX / displayWidth, 
      y: relY / displayHeight 
    };
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const coords = convertToDeviceCoordinates(event);
    if (coords && webrtcService) {
      webrtcService.sendTouchCommand('down', coords.x, coords.y);
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (event.buttons !== 1) return;
    event.preventDefault();

    const coords = convertToDeviceCoordinates(event);
    if (coords && webrtcService) {
      webrtcService.sendTouchCommand('move', coords.x, coords.y);
    }
  };

  const handleMouseUp = (event: MouseEvent) => {
    event.preventDefault();

    const coords = convertToDeviceCoordinates(event);
    if (coords && webrtcService) {
      webrtcService.sendTouchCommand('up', coords.x, coords.y);
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    // 右键触发 Home 键（使用 press 动作）
    if (webrtcService) {
      webrtcService.sendKeyCommand('homebutton', 'press');
    }
  };

  // 处理关闭
  const handleClose = () => {
    stopStream();
    props.onClose();
  };

  // 处理 ESC 键
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.isOpen) {
      handleClose();
    }
  };

  // 监听打开状态
  createEffect(() => {
    if (props.isOpen && props.device) {
      startStream();
    } else {
      stopStream();
    }
  });

  // 监听流变化并应用到视频元素
  createEffect(() => {
    const stream = remoteStream();
    if (stream && videoRef) {
      console.log('[WebRTC] Applying stream to video element:', stream.id);
      videoRef.srcObject = stream;
      videoRef.play().catch(e => console.error('[WebRTC] Video play error:', e));
    }
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    stopStream();
    window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Show when={props.isOpen && props.device}>
      <div class={styles.modalOverlay} onClick={handleClose}>
        <div class={styles.webrtcModal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h3>
              WebRTC 实时控制
              <span class={`${styles.connectionBadge} ${styles[connectionState()]}`}>
                {connectionState() === 'connected' ? '已连接' :
                 connectionState() === 'connecting' ? '连接中...' : '未连接'}
              </span>
            </h3>
            <button class={styles.closeButton} onClick={handleClose} title="关闭">
              ✕
            </button>
          </div>

          <div class={styles.webrtcContent}>
            {/* 左侧控制面板 */}
            <div class={styles.controlPanel}>
              <h4>设备信息</h4>
              <div class={styles.deviceInfo}>
                <div class={styles.deviceName}>
                  {props.device?.system?.name || '设备'}
                </div>
                <div class={styles.deviceUdid}>
                  {props.device?.udid}
                </div>
              </div>

              <h4>画质设置</h4>
              <div class={styles.settingGroup}>
                <label class={styles.settingLabel}>分辨率 ({Math.round(resolution() * 100)}%)</label>
                <div class={styles.settingValue}>
                  <input
                    type="range"
                    class={styles.settingSlider}
                    min="0.25"
                    max="1"
                    step="0.05"
                    value={resolution()}
                    onInput={(e) => setResolution(parseFloat(e.currentTarget.value))}
                  />
                </div>
              </div>

              <div class={styles.settingGroup}>
                <label class={styles.settingLabel}>帧率 ({frameRate()} FPS)</label>
                <div class={styles.settingValue}>
                  <input
                    type="range"
                    class={styles.settingSlider}
                    min="5"
                    max="30"
                    step="5"
                    value={frameRate()}
                    onInput={(e) => setFrameRate(parseInt(e.currentTarget.value))}
                  />
                </div>
              </div>

              <div class={styles.actionButtons}>
                <Show when={connectionState() === 'disconnected'}>
                  <button
                    class={`${styles.actionButton} ${styles.startButton}`}
                    onClick={startStream}
                    disabled={!props.device}
                  >
                    ▶ 开始连接
                  </button>
                </Show>
                <Show when={connectionState() !== 'disconnected'}>
                  <button
                    class={`${styles.actionButton} ${styles.stopButton}`}
                    onClick={stopStream}
                  >
                    ⬛ 断开连接
                  </button>
                </Show>
              </div>
            </div>

            {/* 右侧视频区域 */}
            <div class={styles.videoPanel}>
              <div class={styles.videoContainer}>
                <div 
                  class={styles.videoPlaceholder} 
                  style={{ display: connectionState() === 'connected' ? 'none' : 'flex' }}
                >
                  <div class={styles.placeholderIcon}>📺</div>
                  <span>
                    {connectionState() === 'connecting' ? '正在连接...' : '点击"开始连接"启动视频流'}
                  </span>
                </div>
                
                <video
                  ref={videoRef}
                  class={styles.videoElement}
                  style={{ 
                    display: connectionState() === 'connected' ? 'block' : 'none',
                    "pointer-events": connectionState() === 'connected' ? 'auto' : 'none'
                  }}
                  autoplay
                  playsinline
                  muted
                  onLoadedMetadata={() => {
                    console.log('[WebRTC] Video metadata loaded:', videoRef?.videoWidth, 'x', videoRef?.videoHeight);
                    videoRef?.play().catch(e => console.error('[WebRTC] Meta play error:', e));
                  }}
                  onPlay={() => console.log('[WebRTC] Video started playing')}
                  onResize={() => console.log('[WebRTC] Video resized:', videoRef?.videoWidth, 'x', videoRef?.videoHeight)}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onContextMenu={handleContextMenu}
                />
                
                <Show when={connectionState() === 'connected'}>
                  <div class={styles.touchHint}>
                    左键点击/拖动 = 触摸 | 右键 = Home
                  </div>
                </Show>
              </div>

              <Show when={connectionState() === 'connected'}>
                <div class={styles.statsBar}>
                  <span class={styles.statItem}>📊 {currentFps()} FPS</span>
                  <span class={styles.statItem}>📡 {bitrate()} kbps</span>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
