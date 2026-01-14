import { createSignal, onCleanup, createEffect, Show, onMount, For } from 'solid-js';
import styles from './WebRTCControl.module.css';
import { WebRTCService, type WebRTCStartOptions } from '../services/WebRTCService';
import type { Device } from '../services/AuthService';
import type { WebSocketService } from '../services/WebSocketService';

export interface WebRTCControlProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDevices: () => Device[];
  webSocketService: WebSocketService | null;
  password: string;
}

export default function WebRTCControl(props: WebRTCControlProps) {
  const [selectedControlDevice, setSelectedControlDevice] = createSignal<string>('');
  const [connectionState, setConnectionState] = createSignal<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [resolution, setResolution] = createSignal(0.6); // 60%
  const [frameRate, setFrameRate] = createSignal(20);
  const [currentFps, setCurrentFps] = createSignal(0);
  const [bitrate, setBitrate] = createSignal(0);
  const [remoteStream, setRemoteStream] = createSignal<MediaStream | null>(null);
  const [syncControl, setSyncControl] = createSignal(false); // 同步控制开关

  let videoRef: HTMLVideoElement | undefined;
  let webrtcService: WebRTCService | null = null;
  let statsInterval: number | undefined;
  let lastBytesReceived = 0;
  let lastFramesDecoded = 0;
  let lastTimestamp = 0;

  // 获取当前选中设备对象
  const getCurrentDevice = () => {
    const udid = selectedControlDevice();
    return props.selectedDevices().find(d => d.udid === udid) || null;
  };

  // 获取目标设备列表（根据同步控制状态）
  // 注意：当前画面设备的操作已通过 DataChannel 发送，所以需要排除
  const getTargetDevices = (): string[] => {
    const currentDevice = selectedControlDevice();
    if (syncControl()) {
      // 同步控制开启：返回所有选中设备的UDID，但排除当前画面设备（它通过DataChannel控制）
      return props.selectedDevices()
        .map(device => device.udid)
        .filter(udid => udid !== currentDevice);
    } else {
      // 同步控制关闭：不发送任何WS命令（当前设备已通过DataChannel控制）
      return [];
    }
  };

  // 是否正在流式传输
  const isStreaming = () => connectionState() !== 'disconnected';

  // 初始化 WebRTC 连接
  const startStream = async () => {
    const device = getCurrentDevice();
    if (!device || !props.webSocketService) return;

    setConnectionState('connecting');

    try {
      if (webrtcService) {
        await webrtcService.cleanup();
      }
      
      webrtcService = new WebRTCService(
        props.webSocketService,
        device.udid,
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
    lastBytesReceived = 0;
    lastFramesDecoded = 0;
    lastTimestamp = 0;

    statsInterval = window.setInterval(async () => {
      if (!webrtcService) return;
      
      const pc = webrtcService.getPeerConnection();
      if (!pc) return;

      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const now = Date.now();
            const bytesReceived = report.bytesReceived || 0;
            const framesDecoded = report.framesDecoded || 0;

            if (lastTimestamp > 0) {
              const timeDiff = (now - lastTimestamp) / 1000;
              if (timeDiff >= 0.1) { // 避免过度频繁计算
                // 计算码率: kbps
                const bytesDiff = bytesReceived - lastBytesReceived;
                setBitrate(Math.round((bytesDiff * 8) / timeDiff / 1000));
                
                // 计算 FPS: 实际解码帧率
                const framesDiff = framesDecoded - lastFramesDecoded;
                setCurrentFps(Math.round(framesDiff / timeDiff));

                lastBytesReceived = bytesReceived;
                lastFramesDecoded = framesDecoded;
                lastTimestamp = now;
              }
            } else {
              lastBytesReceived = bytesReceived;
              lastFramesDecoded = framesDecoded;
              lastTimestamp = now;
            }
          }
        });
      } catch (e) {
        console.error('Stats error:', e);
      }
    }, 1000); // 每一秒更新一次统计信息更加平稳
  };

  // 停止统计监控
  const stopStatsMonitoring = () => {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = undefined;
    }
    setCurrentFps(0);
    setBitrate(0);
    lastBytesReceived = 0;
    lastFramesDecoded = 0;
    lastTimestamp = 0;
  };

  // 选择控制设备
  const selectControlDevice = (deviceUdid: string) => {
    // 如果正在流式传输，不允许切换设备
    if (isStreaming()) return;
    
    if (deviceUdid === selectedControlDevice()) return;
    
    console.log(`切换WebRTC控制设备: ${selectedControlDevice()} -> ${deviceUdid}`);
    setSelectedControlDevice(deviceUdid);
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
    if (!coords) return;

    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendTouchCommand('down', coords.x, coords.y);
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchDownMultipleNormalized(targetDevices, coords.x, coords.y);
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (event.buttons !== 1) return;
    event.preventDefault();

    const coords = convertToDeviceCoordinates(event);
    if (!coords) return;

    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendTouchCommand('move', coords.x, coords.y);
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchMoveMultipleNormalized(targetDevices, coords.x, coords.y);
    }
  };

  const handleMouseUp = (event: MouseEvent) => {
    event.preventDefault();

    const coords = convertToDeviceCoordinates(event);
    if (!coords) return;

    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendTouchCommand('up', coords.x, coords.y);
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchUpMultipleNormalized(targetDevices);
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    
    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendKeyCommand('homebutton', 'press');
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.pressHomeButtonMultiple(targetDevices);
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

  // 当组件打开时，默认选择第一个设备
  const handleOpen = () => {
    if (props.selectedDevices().length > 0) {
      const firstDevice = props.selectedDevices()[0];
      setSelectedControlDevice(firstDevice.udid);
    }
  };

  // 监听打开状态
  createEffect(() => {
    if (props.isOpen) {
      handleOpen();
    } else {
      stopStream();
      setSelectedControlDevice('');
      setSyncControl(false);
    }
  });

  // 监听选中设备列表变化
  createEffect(() => {
    if (!props.isOpen) return;
    const devices = props.selectedDevices();
    const current = selectedControlDevice();
    const stillSelected = current && devices.some(d => d.udid === current);
    if (!stillSelected && devices.length > 0) {
      if (isStreaming()) {
        // 如果正在流式传输但当前设备不在列表中，停止流
        stopStream();
      }
      setSelectedControlDevice(devices[0].udid);
    } else if (!stillSelected && devices.length === 0) {
      stopStream();
      setSelectedControlDevice('');
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
    <Show when={props.isOpen}>
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
              <h4>设备画面</h4>
              <div class={styles.deviceList}>
                <For each={props.selectedDevices()}>
                  {(device) => (
                    <div 
                      class={`${styles.deviceItem} ${selectedControlDevice() === device.udid ? styles.active : ''} ${isStreaming() ? styles.disabled : ''}`}
                      onClick={() => selectControlDevice(device.udid)}
                    >
                      <div class={styles.deviceName}>
                        {device.system?.name || device.udid}
                      </div>
                      <div class={styles.deviceUdid}>
                        {device.udid.substring(0, 8)}...
                      </div>
                    </div>
                  )}
                </For>
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
                    disabled={isStreaming()}
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
                    disabled={isStreaming()}
                  />
                </div>
              </div>

              {/* 同步控制 */}
              <div class={`${styles.settingGroup} ${styles.syncControlSection}`}>
                <label class={styles.checkboxLabel}>
                  <input 
                    type="checkbox" 
                    class="themed-checkbox"
                    checked={syncControl()}
                    onChange={(e) => setSyncControl(e.target.checked)}
                    disabled={connectionState() !== 'connected'}
                  />
                  <div class={styles.checkboxContent}>
                    同步控制
                    <div class={styles.checkboxHint}>
                      勾选后操作将同步到所有选中设备
                    </div>
                  </div>
                </label>
              </div>

              <div class={styles.actionButtons}>
                <Show when={connectionState() === 'disconnected'}>
                  <button
                    class={`${styles.actionButton} ${styles.startButton}`}
                    onClick={startStream}
                    disabled={!selectedControlDevice()}
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
                
              </div>

              <Show when={connectionState() === 'connected'}>
                <div class={styles.statsBar}>
                  <div class={styles.touchHintInline}>
                    🖱️ 左键: 触摸 | 右键: Home
                    {syncControl() && <span class={styles.syncActiveHint}> (同步中)</span>}
                  </div>
                  <div class={styles.statsGroup}>
                    <span class={styles.statItem}>📊 {currentFps()} FPS</span>
                    <span class={styles.statItem}>📡 {bitrate()} kbps</span>
                    <span class={styles.statItem}>🎯 {syncControl() ? `同步 ${props.selectedDevices().length} 台` : '单端'}</span>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
