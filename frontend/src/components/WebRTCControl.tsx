import { createSignal, onCleanup, createEffect, Show, onMount, For, createMemo } from 'solid-js';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark, IconHouse, IconVolumeDecrease, IconVolumeIncrease, IconLock, IconPaste, IconCopy, IconPaperPlane, IconLinkSlash, IconLink, IconMobileScreen, IconUser, IconUsers } from '../icons';
import styles from './WebRTCControl.module.css';
import { WebRTCService, type WebRTCStartOptions } from '../services/WebRTCService';
import type { Device } from '../services/AuthService';
import type { WebSocketService } from '../services/WebSocketService';
import { debugLog, debugWarn } from '../utils/debugLogger';

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
  const [resolution, setResolution] = createSignal(0.6); // 这里的 resolution 现在解释为 "最高允许分辨率"
  const [frameRate, setFrameRate] = createSignal(20);
  const [displaySize, setDisplaySize] = createSignal({ width: 0, height: 0 }); // 容器显示尺寸
  const [currentFps, setCurrentFps] = createSignal(0);
  const [bitrate, setBitrate] = createSignal(0);
  const [currentResolution, setCurrentResolution] = createSignal(''); // 当前实际分辨率
  const [remoteStream, setRemoteStream] = createSignal<MediaStream | null>(null);
  const [syncControl, setSyncControl] = createSignal(false); // 同步控制开关
  const [currentRotation, setCurrentRotation] = createSignal(0); // 旋转角度: 0, 90, 180, 270
  const [keyboardIndicator, setKeyboardIndicator] = createSignal(''); // 键盘指示器
  let keyboardIndicatorTimeout: number | undefined;

  // 剪贴板模态框状态
  const [clipboardModalOpen, setClipboardModalOpen] = createSignal(false);
  const [clipboardMode, setClipboardMode] = createSignal<'read' | 'write'>('read');
  const [clipboardContent, setClipboardContent] = createSignal<string>(''); // 文本内容
  const [clipboardImageData, setClipboardImageData] = createSignal<string | null>(null);
  
  // 移动端侧边栏状态
  const [mobileSettingsOpen, setMobileSettingsOpen] = createSignal(false);
  
  const mainBackdropClose = createBackdropClose(() => handleClose());
  const clipboardBackdropClose = createBackdropClose(() => setClipboardModalOpen(false));

  // 获取设备的 HTTP 端口图片数据
  const [clipboardLoading, setClipboardLoading] = createSignal(false);

  // 触摸状态跟踪
  const [isTouching, setIsTouching] = createSignal(false);
  let lastTouchPosition = { x: 0, y: 0 }; // 记录最后触摸位置
  const TOUCH_MOUSE_GUARD_MS = 800;
  let lastTouchTimestamp = 0;
  const shouldIgnoreMouseEvent = (event: MouseEvent) => {
    if (event.sourceCapabilities?.firesTouchEvents) {
      return true;
    }
    return Date.now() - lastTouchTimestamp < TOUCH_MOUSE_GUARD_MS;
  };
  const MOVE_EPSILON = 0.0015;
  let pendingMove: { x: number; y: number } | null = null;
  let moveRafId: number | null = null;
  let lastSentMove: { x: number; y: number } | null = null;
  const LAG_THRESHOLD_MS = 180;
  const LAG_RECOVER_MS = 80;
  const CATCHUP_PLAYBACK_RATE = 1.15;
  let isCatchupActive = false;

  const sendMove = (coords: { x: number; y: number }) => {
    if (webrtcService) {
      webrtcService.sendTouchCommand('move', coords.x, coords.y);
    }
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchMoveMultipleNormalized(targetDevices, coords.x, coords.y);
    }
  };

  const shouldSkipMove = (coords: { x: number; y: number }) => {
    if (!lastSentMove) return false;
    const dx = coords.x - lastSentMove.x;
    const dy = coords.y - lastSentMove.y;
    return (dx * dx + dy * dy) < MOVE_EPSILON * MOVE_EPSILON;
  };

  const scheduleMoveSend = (coords: { x: number; y: number }) => {
    pendingMove = coords;
    if (moveRafId !== null) return;
    moveRafId = requestAnimationFrame(() => {
      moveRafId = null;
      if (!pendingMove) return;
      const next = pendingMove;
      pendingMove = null;
      if (shouldSkipMove(next)) return;
      sendMove(next);
      lastSentMove = next;
    });
  };

  const flushQueuedMove = () => {
    if (moveRafId !== null) {
      cancelAnimationFrame(moveRafId);
      moveRafId = null;
    }
    if (!pendingMove) return;
    const next = pendingMove;
    pendingMove = null;
    if (shouldSkipMove(next)) return;
    sendMove(next);
    lastSentMove = next;
  };

  const resetMoveState = () => {
    pendingMove = null;
    if (moveRafId !== null) {
      cancelAnimationFrame(moveRafId);
      moveRafId = null;
    }
    lastSentMove = null;
  };

  const updatePlaybackRateForLag = (lagMs: number) => {
    if (!videoRef || !Number.isFinite(lagMs)) return;
    const clampedLagMs = Math.max(0, lagMs);
    if (!isCatchupActive && clampedLagMs > LAG_THRESHOLD_MS) {
      videoRef.playbackRate = CATCHUP_PLAYBACK_RATE;
      isCatchupActive = true;
      return;
    }
    if (isCatchupActive && clampedLagMs <= LAG_RECOVER_MS) {
      videoRef.playbackRate = 1.0;
      isCatchupActive = false;
    }
  };

  let videoRef: HTMLVideoElement | undefined;
  let videoContainerRef: HTMLDivElement | undefined;
  let cachedVideoRect: DOMRect | null = null;
  let webrtcService: WebRTCService | null = null;
  let statsInterval: number | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let lastBytesReceived = 0;
  let lastFramesDecoded = 0;
  let lastTimestamp = 0;
  let lastAppliedResolution = 0;
  let lastAppliedFrameRate = 0;

  const updateCachedVideoRect = () => {
    if (videoRef) {
      cachedVideoRect = videoRef.getBoundingClientRect();
    }
  };

  const clearCachedVideoRect = () => {
    cachedVideoRect = null;
  };

  // 最大允许像素限制 (720 x 1280 = 921600)
  const MAX_PIXELS = 720 * 1280;

  // 计算目标分辨率缩放比例
  const targetResolution = createMemo(() => {
    const device = getCurrentDevice();
    const userLimit = resolution(); // 用户拖动的分辨率百分比
    const size = displaySize(); // 浏览器容器尺寸
    
    if (!device?.system?.scrw || !device?.system?.scrh || size.width <= 0 || size.height <= 0) {
      return userLimit;
    }

    let nativeW = device.system.scrw;
    let nativeH = device.system.scrh;
    
    // 考虑旋转
    const rotation = currentRotation();
    if (rotation === 90 || rotation === 270) {
      const tmp = nativeW;
      nativeW = nativeH;
      nativeH = tmp;
    }

    // 候选1：用户设置的缩放比例
    const userScale = userLimit;
    
    // 候选2：让设备画面完全放入容器所需的缩放比例
    // 设备画面会保持原始宽高比，所以我们取宽和高中较小的缩放比例
    // 需要考虑 devicePixelRatio，将 CSS 逻辑像素转换为物理像素
    const dpr = window.devicePixelRatio || 1;
    const containerPhysicalW = size.width * dpr;
    const containerPhysicalH = size.height * dpr;
    const containerScaleW = containerPhysicalW / nativeW;
    const containerScaleH = containerPhysicalH / nativeH;
    const containerScale = Math.min(containerScaleW, containerScaleH);
    
    // 候选3：720x1280 像素限制所需的缩放比例
    // 如果 nativeW * scale * nativeH * scale <= MAX_PIXELS
    // 则 scale <= sqrt(MAX_PIXELS / (nativeW * nativeH))
    const nativePixels = nativeW * nativeH;
    // 向下取整到小数点后两位，确保严格不超过像素限制
    const pixelLimitScale = Math.floor(Math.sqrt(MAX_PIXELS / nativePixels) * 100) / 100;
    
    // 取三者中最小的
    const finalScale = Math.min(userScale, containerScale, pixelLimitScale);
    
    // 限制范围在 0.25 - 1.0
    const clampedScale = Math.max(0.25, Math.min(1.0, finalScale));
    
    // 向下取整到偶数（视频编码如 H.264 要求宽高为偶数）
    const floorToEven = (n: number) => Math.floor(n / 2) * 2;
    
    // 调试日志 - 用向下取整到偶数后的值计算像素数
    const displayW = floorToEven(nativeW * clampedScale);
    const displayH = floorToEven(nativeH * clampedScale);
    debugLog('webrtc', '[Resolution] 计算详情:', {
      '设备原始尺寸': `${nativeW}x${nativeH} (${nativePixels} px)`,
      '容器尺寸(CSS)': `${Math.round(size.width)}x${Math.round(size.height)}`,
      'DPI': dpr,
      '容器尺寸(物理)': `${Math.round(containerPhysicalW)}x${Math.round(containerPhysicalH)}`,
      '用户设置比例': `${Math.round(userScale * 100)}% → ${floorToEven(nativeW * userScale)}x${floorToEven(nativeH * userScale)}`,
      '容器适配比例': `${Math.round(containerScale * 100)}% → ${floorToEven(nativeW * containerScale)}x${floorToEven(nativeH * containerScale)}`,
      '像素限制比例': `${Math.round(pixelLimitScale * 100)}% → ${floorToEven(nativeW * pixelLimitScale)}x${floorToEven(nativeH * pixelLimitScale)}`,
      '最终选择': finalScale === userScale ? '用户设置' : (finalScale === containerScale ? '容器适配' : '像素限制'),
      '最终比例': `${Math.round(clampedScale * 100)}%`,
      '请求分辨率': `${displayW}x${displayH} (${displayW * displayH} px)`
    });

    return clampedScale;
  });

  const getDeviceHttpPort = (device: Device | null): number | undefined => {
    if (!device) return undefined;
    const candidates = [
      device.system?.port,
      device.system?.httpPort,
      device.system?.http_port,
      (device as any).port,
      (device as any).httpPort,
      (device as any).http_port
    ];
    for (const value of candidates) {
      if (typeof value === 'number' && value > 0 && value <= 65535) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
          return parsed;
        }
      }
    }
    return undefined;
  };

  // 获取当前选中设备对象
  function getCurrentDevice() {
    const udid = selectedControlDevice();
    return props.selectedDevices().find(d => d.udid === udid) || null;
  }

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
      
      const httpPort = getDeviceHttpPort(device);

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
            debugLog('webrtc', '[WebRTC] Setting remote stream signal');
            setRemoteStream(stream);
          },
          onClipboard: (contentType, content) => {
            // 收到设备端剪贴板内容
            setClipboardLoading(false);
            if (contentType === 'text') {
              setClipboardContent(content);
              setClipboardImageData(null);
            } else if (contentType === 'image') {
              setClipboardImageData(content);
              setClipboardContent('');
            }
          },
          onClipboardError: (error) => {
            // 剪贴板读取错误
            setClipboardLoading(false);
            console.error('Clipboard error:', error);
            setClipboardContent('');
            setClipboardImageData(null);
          }
        },
        httpPort
      );

      const options: WebRTCStartOptions = {
        resolution: targetResolution(),
        fps: frameRate(),
        force: true
      };

      lastAppliedResolution = targetResolution();
      lastAppliedFrameRate = frameRate();
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
      videoRef.playbackRate = 1.0;
    }
    setConnectionState('disconnected');
    stopStatsMonitoring();
    lastAppliedResolution = 0;
    lastAppliedFrameRate = 0;
    clearCachedVideoRect();
  };

  // 开始统计监控
  const startStatsMonitoring = () => {
    lastBytesReceived = 0;
    lastFramesDecoded = 0;
    lastTimestamp = 0;
    isCatchupActive = false;
    if (videoRef) {
      videoRef.playbackRate = 1.0;
    }

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
            let lagMs = NaN;
            if (typeof report.estimatedPlayoutTimestamp === 'number') {
              lagMs = report.estimatedPlayoutTimestamp - performance.now();
            } else if (
              typeof report.jitterBufferDelay === 'number' &&
              typeof report.jitterBufferEmittedCount === 'number' &&
              report.jitterBufferEmittedCount > 0
            ) {
              lagMs = (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000;
            }
            if (Number.isFinite(lagMs)) {
              updatePlaybackRateForLag(lagMs);
            }

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

        // 每秒更新当前视频实际分辨率
        if (videoRef && videoRef.videoWidth > 0) {
          setCurrentResolution(`${videoRef.videoWidth}x${videoRef.videoHeight}`);
        } else {
          setCurrentResolution('');
        }
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
    setCurrentResolution('');
    lastBytesReceived = 0;
    lastFramesDecoded = 0;
    lastTimestamp = 0;
    isCatchupActive = false;
    if (videoRef) {
      videoRef.playbackRate = 1.0;
    }
  };

  // 选择控制设备
  const selectControlDevice = (deviceUdid: string) => {
    // 如果正在流式传输，不允许切换设备
    if (isStreaming()) return;
    
    if (deviceUdid === selectedControlDevice()) return;
    
    debugLog('webrtc', `切换WebRTC控制设备: ${selectedControlDevice()} -> ${deviceUdid}`);
    setSelectedControlDevice(deviceUdid);
  };

  // 计算旋转后的视频样式
  // 当旋转90°或270°时，视频的宽高互换，需要缩放以适应容器
  const getVideoTransformStyle = () => {
    const rotation = currentRotation();
    
    if (rotation === 0 || rotation === 180) {
      // 不需要特殊处理
      return { transform: `rotate(${rotation}deg)` };
    }
    
    // 90° 或 270° 旋转：视频宽高互换
    // 需要计算缩放比例，使旋转后的视频适应容器
    if (!videoContainerRef) {
      return { transform: `rotate(${rotation}deg)` };
    }
    
    const containerWidth = videoContainerRef.clientWidth;
    const containerHeight = videoContainerRef.clientHeight;
    
    // 旋转后，视频的"显示宽度"是原来的高度，"显示高度"是原来的宽度
    // 我们需要让视频元素的宽高等于容器的高宽（交换）
    // 然后旋转后刚好填满容器
    // 计算缩放比例：取较小的那个比例，确保不超出
    const scale = Math.min(containerWidth / containerHeight, containerHeight / containerWidth);
    
    return { 
      transform: `rotate(${rotation}deg) scale(${scale})`,
    };
  };

  // 触控事件处理 - 支持鼠标和触摸事件
  const convertToDeviceCoordinates = (clientX: number, clientY: number) => {
    if (!videoRef) return null;

    const rect = cachedVideoRect ?? videoRef.getBoundingClientRect();
    if (!cachedVideoRect) {
      cachedVideoRect = rect;
    }
    const videoWidth = videoRef.videoWidth;
    const videoHeight = videoRef.videoHeight;
    const rotation = currentRotation();

    if (!videoWidth || !videoHeight) return null;

    // 计算视频的宽高比（原始视频）
    const videoAspectRatio = videoWidth / videoHeight;
    
    // 对于90°/270°旋转，显示的宽高比是反过来的
    const isRotated90or270 = rotation === 90 || rotation === 270;
    const displayAspectRatio = isRotated90or270 ? 1 / videoAspectRatio : videoAspectRatio;
    
    // 计算视频在容器中的实际显示区域（考虑letterbox/pillarbox）
    const containerAspectRatio = rect.width / rect.height;
    
    let displayWidth, displayHeight, offsetX, offsetY;
    
    if (displayAspectRatio > containerAspectRatio) {
      // 视频比容器更宽，上下有黑边
      displayWidth = rect.width;
      displayHeight = rect.width / displayAspectRatio;
      offsetX = 0;
      offsetY = (rect.height - displayHeight) / 2;
    } else {
      // 视频比容器更高，左右有黑边
      displayWidth = rect.height * displayAspectRatio;
      displayHeight = rect.height;
      offsetX = (rect.width - displayWidth) / 2;
      offsetY = 0;
    }
    
    // 计算点击位置相对于视频元素的位置
    const clickPosX = clientX - rect.left;
    const clickPosY = clientY - rect.top;
    
    // 检查是否在视频显示区域内
    if (clickPosX < offsetX || clickPosX > offsetX + displayWidth ||
        clickPosY < offsetY || clickPosY > offsetY + displayHeight) {
      return null; // 点击在视频区域外
    }
    
    // 计算在显示区域内的归一化坐标 (0-1)
    const clickX = (clickPosX - offsetX) / displayWidth;
    const clickY = (clickPosY - offsetY) / displayHeight;

    // 根据旋转角度，将屏幕坐标转换为设备坐标
    switch (rotation) {
      case 90:
        return { x: clickY, y: 1 - clickX };
      case 180:
        return { x: 1 - clickX, y: 1 - clickY };
      case 270:
        return { x: 1 - clickY, y: clickX };
      default:
        return { x: clickX, y: clickY };
    }
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (shouldIgnoreMouseEvent(event)) return;
    event.preventDefault();
    resetMoveState();
    updateCachedVideoRect();

    // 移除其他元素的焦点，以便键盘事件可以被捕获
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const coords = convertToDeviceCoordinates(event.clientX, event.clientY);
    if (!coords) {
      clearCachedVideoRect();
      return;
    }

    // 记录触摸位置
    lastTouchPosition = coords;

    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendTouchCommand('down', coords.x, coords.y);
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchDownMultipleNormalized(targetDevices, coords.x, coords.y);
    }
    
    setIsTouching(true);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (event.buttons !== 1) return;
    if (shouldIgnoreMouseEvent(event)) return;
    event.preventDefault();

    const coords = convertToDeviceCoordinates(event.clientX, event.clientY);
    
    // 如果离开了视频区域且正在触摸，发送 touch up（使用最后位置）
    if (!coords) {
      if (isTouching()) {
        flushQueuedMove();
        if (webrtcService) {
          webrtcService.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
        }
        const targetDevices = getTargetDevices();
        if (targetDevices.length > 0 && props.webSocketService) {
          props.webSocketService.touchUpMultipleNormalized(targetDevices);
        }
        setIsTouching(false);
        resetMoveState();
      }
      clearCachedVideoRect();
      return;
    }

    // 记录触摸位置
    lastTouchPosition = coords;

    scheduleMoveSend(coords);
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (shouldIgnoreMouseEvent(event)) return;
    event.preventDefault();
    
    if (!isTouching()) {
      clearCachedVideoRect();
      return;
    }

    flushQueuedMove();
    const coords = convertToDeviceCoordinates(event.clientX, event.clientY);
    const finalCoords = coords ?? lastTouchPosition;

    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendTouchCommand('up', finalCoords.x, finalCoords.y);
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchUpMultipleNormalized(targetDevices);
    }
    
    setIsTouching(false);
    resetMoveState();
    clearCachedVideoRect();
  };
  
  // 鼠标离开视频区域时处理
  const handleMouseLeave = (event: MouseEvent) => {
    if (shouldIgnoreMouseEvent(event)) return;
    if (isTouching()) {
      flushQueuedMove();
      if (webrtcService) {
        webrtcService.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
      }
      const targetDevices = getTargetDevices();
      if (targetDevices.length > 0 && props.webSocketService) {
        props.webSocketService.touchUpMultipleNormalized(targetDevices);
      }
      setIsTouching(false);
      resetMoveState();
      clearCachedVideoRect();
    }
  };

  // 移动端触摸事件处理
  const handleTouchStart = (event: TouchEvent) => {
    event.preventDefault();
    lastTouchTimestamp = Date.now();
    resetMoveState();
    updateCachedVideoRect();
    
    // 移除其他元素的焦点
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const touch = event.touches[0];
    if (!touch) {
      clearCachedVideoRect();
      return;
    }

    const coords = convertToDeviceCoordinates(touch.clientX, touch.clientY);
    if (!coords) {
      clearCachedVideoRect();
      return;
    }

    lastTouchPosition = coords;

    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendTouchCommand('down', coords.x, coords.y);
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchDownMultipleNormalized(targetDevices, coords.x, coords.y);
    }
    
    setIsTouching(true);
  };

  const handleTouchMove = (event: TouchEvent) => {
    event.preventDefault();
    lastTouchTimestamp = Date.now();

    const touch = event.touches[0];
    if (!touch) return;

    const coords = convertToDeviceCoordinates(touch.clientX, touch.clientY);
    if (!coords) return;

    lastTouchPosition = coords;
    scheduleMoveSend(coords);
  };

  const handleTouchEnd = (event: TouchEvent) => {
    event.preventDefault();
    lastTouchTimestamp = Date.now();
    
    if (!isTouching()) {
      clearCachedVideoRect();
      return;
    }

    flushQueuedMove();
    // 1. 始终控制当前设备（通过 WebRTC DataChannel）
    if (webrtcService) {
      webrtcService.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
    }

    // 2. 如果开启同步控制，控制其他设备（通过 WebSocket）
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.touchUpMultipleNormalized(targetDevices);
    }
    
    setIsTouching(false);
    resetMoveState();
    clearCachedVideoRect();
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

  // DataChannel key -> WS key code 映射
  const wsKeyCodeMap: Record<string, string> = {
    'homebutton': 'HOMEBUTTON',
    'lock': 'LOCK',
    'volumeup': 'VOLUMEUP',
    'volumedown': 'VOLUMEDOWN',
    'return': 'RETURN',
    'escape': 'ESCAPE',
    'backspace': 'BACKSPACE',
    'tab': 'TAB',
    'space': 'SPACE',
    'delete': 'DELETE',
    'up': 'UP',
    'down': 'DOWN',
    'left': 'LEFT',
    'right': 'RIGHT',
    'command': 'COMMAND',
    'option': 'OPTION',
    'shift': 'SHIFT'
  };

  // 获取 WS key code (字母直接大写)
  const getWsKeyCode = (key: string): string => {
    return wsKeyCodeMap[key] || key.toUpperCase();
  };

  // 特殊按键映射 - 使用 e.code (物理键码) 而不是 e.key (字符)
  // 这样 Shift+2 会发送 Shift 和 "2"，而不是发送 "@"
  const codeMapping: Record<string, string> = {
    // 功能键
    'Enter': 'return',
    'NumpadEnter': 'return',
    'Escape': 'escape',
    'Backspace': 'backspace',
    'Tab': 'tab',
    'Space': 'space',
    'Delete': 'delete',
    // 方向键
    'ArrowUp': 'up',
    'ArrowDown': 'down',
    'ArrowLeft': 'left',
    'ArrowRight': 'right',
    // 导航键
    'Home': 'homebutton',
    'End': 'end',
    'PageUp': 'pageup',
    'PageDown': 'pagedown',
    // 修饰键
    'ControlLeft': 'command',
    'ControlRight': 'command',
    'MetaLeft': 'command',
    'MetaRight': 'command',
    'AltLeft': 'option',
    'AltRight': 'option',
    'ShiftLeft': 'shift',
    'ShiftRight': 'shift',
    // 数字键 (主键盘)
    'Digit0': '0',
    'Digit1': '1',
    'Digit2': '2',
    'Digit3': '3',
    'Digit4': '4',
    'Digit5': '5',
    'Digit6': '6',
    'Digit7': '7',
    'Digit8': '8',
    'Digit9': '9',
    // 符号键
    'Minus': '-',
    'Equal': '=',
    'BracketLeft': '[',
    'BracketRight': ']',
    'Backslash': '\\',
    'Semicolon': ';',
    'Quote': "'",
    'Comma': ',',
    'Period': '.',
    'Slash': '/',
    'Backquote': '`',
    // F键
    'F1': 'f1',
    'F2': 'f2',
    'F3': 'f3',
    'F4': 'f4',
    'F5': 'f5',
    'F6': 'f6',
    'F7': 'f7',
    'F8': 'f8',
    'F9': 'f9',
    'F10': 'f10',
    'F11': 'f11',
    'F12': 'f12'
  };

  // 从 e.code 提取按键名称
  const getKeyFromCode = (code: string): string | null => {
    // 优先使用映射表
    if (codeMapping[code]) {
      return codeMapping[code];
    }
    // 字母键: KeyA -> a, KeyB -> b, ...
    if (code.startsWith('Key') && code.length === 4) {
      return code[3].toLowerCase();
    }
    return null;
  };

  // 获取按键名称（用于显示）
  const getKeyDisplayName = (key: string): string => {
    const displayMap: Record<string, string> = {
      'space': '空格', 'return': '回车', 'escape': 'ESC', 'backspace': '退格',
      'delete': '删除', 'tab': 'Tab', 'up': '↑', 'down': '↓', 'left': '←', 'right': '→'
    };
    return displayMap[key] || (key.length === 1 ? key.toUpperCase() : key);
  };

  // 显示键盘指示器
  const showKeyboardIndicator = (key: string) => {
    if (keyboardIndicatorTimeout) clearTimeout(keyboardIndicatorTimeout);
    setKeyboardIndicator(getKeyDisplayName(key));
    keyboardIndicatorTimeout = window.setTimeout(() => setKeyboardIndicator(''), 1000);
  };

  // 处理键盘事件
  const handleKeyDown = (e: KeyboardEvent) => {

    // 如果剪贴板模态框打开，不拦截键盘事件
    if (clipboardModalOpen()) return;

    // 只在连接状态且焦点在视频区域时处理
    if (connectionState() !== 'connected') return;
    const activeEl = document.activeElement;
    if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable) return;

    // 检测拷贝/剪切/粘贴快捷键
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault();
      // 发送 command up 事件以防止设备端按键卡住（因为弹出模态框会中断焦点）
      // 注意：c 的 down 事件还没发送（被上面拦截了），只有 command down 发了
      if (webrtcService) {
        webrtcService.sendKeyCommand('command', 'up');
      }
      handleCopyFromDevice();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'x') {
      e.preventDefault();
      // 发送 command up 事件以防止设备端按键卡住
      if (webrtcService) {
        webrtcService.sendKeyCommand('command', 'up');
      }
      handleCutFromDevice();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      e.preventDefault();
      // 发送 command up 事件以防止设备端按键卡住（因为弹出模态框会中断焦点）
      // 注意：v 的 down 事件还没发送（被上面拦截了），只有 command down 发了
      if (webrtcService) {
        webrtcService.sendKeyCommand('command', 'up');
      }
      handlePasteToDevice();
      return;
    }

    // 使用 e.code 获取物理键码，这样 Shift+2 会正确发送 "2" 而不是 "@"
    const mappedKey = getKeyFromCode(e.code);
    if (!mappedKey) return;

    e.preventDefault();
    showKeyboardIndicator(mappedKey);

    // 1. 发送到当前设备 (via DataChannel)
    if (webrtcService) {
      webrtcService.sendKeyCommand(mappedKey, 'down');
    }

    // 2. 如果开启同步控制，发送到其他设备 (via WebSocket)
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.keyDownMultiple(targetDevices, getWsKeyCode(mappedKey));
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    // 如果剪贴板模态框打开，不拦截键盘事件
    if (clipboardModalOpen()) return;
    
    if (connectionState() !== 'connected') return;
    const activeEl = document.activeElement;
    if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable) return;
    // 忽略拷贝粘贴快捷键的 key up 事件（已在 keydown 拦截）
    if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyC' || e.code === 'KeyV')) return;

    // 使用 e.code 获取物理键码
    const mappedKey = getKeyFromCode(e.code);
    if (!mappedKey) return;

    e.preventDefault();
    
    // 1. 发送到当前设备 (via DataChannel)
    if (webrtcService) {
      webrtcService.sendKeyCommand(mappedKey, 'up');
    }

    // 2. 如果开启同步控制，发送到其他设备 (via WebSocket)
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.keyUpMultiple(targetDevices, getWsKeyCode(mappedKey));
    }
  };

  // 设备按键处理
  const handleHomeButton = () => {
    // 1. 发送到当前设备 (via DataChannel)
    if (webrtcService) webrtcService.sendKeyCommand('homebutton', 'press');
    // 2. 如果开启同步控制，发送到其他设备 (via WebSocket)
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.pressHomeButtonMultiple(targetDevices);
    }
  };

  const handleVolumeUp = () => {
    if (webrtcService) webrtcService.sendKeyCommand('volumeup', 'press');
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.keyDownMultiple(targetDevices, 'VOLUMEUP');
      setTimeout(() => props.webSocketService?.keyUpMultiple(targetDevices, 'VOLUMEUP'), 50);
    }
  };

  const handleVolumeDown = () => {
    if (webrtcService) webrtcService.sendKeyCommand('volumedown', 'press');
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.keyDownMultiple(targetDevices, 'VOLUMEDOWN');
      setTimeout(() => props.webSocketService?.keyUpMultiple(targetDevices, 'VOLUMEDOWN'), 50);
    }
  };

  const handleLockScreen = () => {
    if (webrtcService) webrtcService.sendKeyCommand('lock', 'press');
    const targetDevices = getTargetDevices();
    if (targetDevices.length > 0 && props.webSocketService) {
      props.webSocketService.keyDownMultiple(targetDevices, 'LOCK');
      setTimeout(() => props.webSocketService?.keyUpMultiple(targetDevices, 'LOCK'), 50);
    }
  };

  // 剪贴板处理 - 打开读取模态框
  const handleCopyFromDevice = () => {
    setClipboardMode('read');
    setClipboardContent('');
    setClipboardImageData(null);
    setClipboardLoading(true);
    setClipboardModalOpen(true);
    
    // 使用 clipboard_request 触发设备端的拷贝操作
    // 设备端会执行 Cmd+C 并自动读取剪贴板内容返回
    if (webrtcService) {
      webrtcService.sendClipboardRequest('copy');
    } else {
      // 如果没有 DataChannel，直接读取剪贴板
      const currentDevice = selectedControlDevice();
      if (currentDevice && props.webSocketService) {
        props.webSocketService.readClipboard([currentDevice]);
      }
    }
  };

  // 剪贴板处理 - 剪切（打开读取模态框）
  const handleCutFromDevice = () => {
    setClipboardMode('read');
    setClipboardContent('');
    setClipboardImageData(null);
    setClipboardLoading(true);
    setClipboardModalOpen(true);
    
    // 使用 clipboard_request 触发设备端的剪切操作
    // 设备端会执行 Cmd+X 并自动读取剪贴板内容返回
    if (webrtcService) {
      webrtcService.sendClipboardRequest('cut');
    } else {
      // 如果没有 DataChannel，直接读取剪贴板
      const currentDevice = selectedControlDevice();
      if (currentDevice && props.webSocketService) {
        props.webSocketService.readClipboard([currentDevice]);
      }
    }
  };

  // 剪贴板处理 - 打开写入模态框
  const handlePasteToDevice = () => {
    setClipboardMode('write');
    setClipboardContent('');
    setClipboardImageData(null);
    setClipboardLoading(false);
    setClipboardModalOpen(true);
    // 延迟聚焦到文本框
    setTimeout(() => {
      const textarea = document.querySelector('.' + styles.clipboardTextarea) as HTMLTextAreaElement;
      if (textarea) textarea.focus();
    }, 100);
  };

  // 剪贴板模态框 - 发送到设备
  const handleSendClipboardToDevices = () => {
    const text = clipboardContent();
    const imageData = clipboardImageData();
    
    if (!text && !imageData) return;
    
    if (text) {
      // 1. 发送到当前设备 (via DataChannel)
      if (webrtcService) {
        webrtcService.sendPasteCommand(text);
      }
      // 2. 如果开启同步控制，发送到其他设备 (via WebSocket)
      const targetDevices = getTargetDevices();
      if (targetDevices.length > 0 && props.webSocketService) {
        const base64Text = btoa(unescape(encodeURIComponent(text)));
        props.webSocketService.writeClipboard(targetDevices, 'public.utf8-plain-text', base64Text);
      }
    } else if (imageData) {
      // 图片通过 WS 发送到所有设备
      const allDevices = syncControl()
        ? props.selectedDevices().map(d => d.udid)
        : [selectedControlDevice()].filter(Boolean) as string[];
      if (allDevices.length > 0 && props.webSocketService) {
        props.webSocketService.writeClipboard(allDevices, 'public.png', imageData);
        
        // 写入剪贴板后触发 Cmd+V 粘贴
        setTimeout(() => {
          if (webrtcService) {
            webrtcService.sendKeyCommand('command', 'down');
            webrtcService.sendKeyCommand('v', 'down');
            setTimeout(() => {
              webrtcService?.sendKeyCommand('v', 'up');
              webrtcService?.sendKeyCommand('command', 'up');
            }, 50);
          }
        }, 300);
      }
    }
    
    setClipboardModalOpen(false);
  };

  // 剪贴板模态框 - 拷贝到系统剪贴板
  const handleCopyToSystemClipboard = async () => {
    const text = clipboardContent();
    const imageData = clipboardImageData();
    
    // 尝试使用现代 Clipboard API（需要安全上下文）
    if (navigator.clipboard && window.isSecureContext) {
      try {
        if (text) {
          await navigator.clipboard.writeText(text);
          setClipboardModalOpen(false);
          return;
        } else if (imageData) {
          // 尝试拷贝图片到剪贴板
          const response = await fetch(`data:image/png;base64,${imageData}`);
          const blob = await response.blob();
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setClipboardModalOpen(false);
          return;
        }
      } catch (error) {
        debugWarn('webrtc', 'Clipboard API 失败，尝试 fallback:', error);
      }
    }
    
    // Fallback：使用 document.execCommand（适用于非安全上下文）
    if (text) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (success) {
          setClipboardModalOpen(false);
          return;
        }
      } catch (error) {
        console.error('execCommand 拷贝失败:', error);
      }
    }
    
    // 如果都失败了，提示用户手动拷贝
    if (imageData) {
      alert('当前环境不支持自动拷贝图片，请手动右键保存图片');
    } else {
      alert('拷贝失败，请手动选中文本后按 Ctrl/Cmd+C 拷贝');
    }
  };

  // 处理粘贴事件 (在写入模式下)
  const handleClipboardPaste = async (e: ClipboardEvent) => {
    e.preventDefault();
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const result = event.target?.result as string;
            // 去掉 data:image/...;base64, 前缀
            const base64 = result.split(',')[1];
            setClipboardImageData(base64);
            setClipboardContent('');
          };
          reader.readAsDataURL(blob);
          return;
        }
      } else if (item.type === 'text/plain') {
        const text = await new Promise<string>((resolve) => {
          item.getAsString(resolve);
        });
        setClipboardContent(text);
        setClipboardImageData(null);
        return;
      }
    }
  };

  // 设置旋转角度
  const setRotation = (degrees: number) => {
    setCurrentRotation(degrees);
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
      debugLog('webrtc', '[WebRTC] Applying stream to video element:', stream.id);
      videoRef.srcObject = stream;
      videoRef.play().catch(e => console.error('[WebRTC] Video play error:', e));
    }
  });

  // 监听目标分辨率变化并动态调整
  createEffect(() => {
    if (connectionState() === 'connected' && webrtcService) {
      const target = targetResolution();
      // 只有当变化超过一定阈值时才调整，避免过度频繁请求
      // 或者当 user limit 改变时调整
      if (Math.abs(target - lastAppliedResolution) > 0.05) {
        debugLog('webrtc', `[WebRTC] Dynamically updating resolution: ${lastAppliedResolution} -> ${target}`);
        webrtcService.setResolution(target).catch(e => console.error('Failed to update resolution:', e));
        lastAppliedResolution = target;
      }
    }
  });

  // 监听帧率变化并动态调整
  createEffect(() => {
    if (connectionState() === 'connected' && webrtcService) {
      const fps = frameRate();
      // 只有当帧率确实改变时才发送请求
      if (fps !== lastAppliedFrameRate) {
        debugLog('webrtc', `[WebRTC] Dynamically updating frame rate: ${lastAppliedFrameRate} -> ${fps}`);
        webrtcService.setFrameRate(fps).catch(e => console.error('Failed to update frame rate:', e));
        lastAppliedFrameRate = fps;
      }
    }
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // 初始化 ResizeObserver 监听容器尺寸
    if (videoContainerRef) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            // Cached touch rect is geometry-dependent; invalidate on container resize.
            clearCachedVideoRect();
            setDisplaySize({ width, height });
          }
        }
      });
      resizeObserver.observe(videoContainerRef);
      
      // 初始尺寸
      const rect = videoContainerRef.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDisplaySize({ width: rect.width, height: rect.height });
      }
    }
    
    // 监听剪贴板响应
    const unsubscribe = props.webSocketService?.onMessage((message: any) => {
      if (message.type === 'pasteboard/read' && message.body) {
        setClipboardLoading(false);
        const { uti, data } = message.body;
        if (uti === 'public.utf8-plain-text' && data) {
          // 解码 base64 文本
          try {
            const text = decodeURIComponent(escape(atob(data)));
            setClipboardContent(text);
            setClipboardImageData(null);
          } catch {
            setClipboardContent(data);
          }
        } else if (uti?.includes('image') || uti === 'public.png' || uti === 'public.jpeg') {
          setClipboardContent('');
          setClipboardImageData(data);
        } else if (data) {
          // 尝试直接显示为文本
          setClipboardContent(data);
          setClipboardImageData(null);
        }
      }
    });
    
    onCleanup(() => {
      if (unsubscribe) unsubscribe();
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = undefined;
      }
    });
  });

  // 确保触控状态正确清理的函数
  const cleanupTouchState = () => {
    if (isTouching()) {
      flushQueuedMove();
      if (webrtcService) {
        webrtcService.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
      }
      const targetDevices = getTargetDevices();
      if (targetDevices.length > 0 && props.webSocketService) {
        props.webSocketService.touchUpMultipleNormalized(targetDevices);
      }
      setIsTouching(false);
      resetMoveState();
    }
    clearCachedVideoRect();
  };

  onCleanup(() => {
    cleanupTouchState();
    stopStream();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    if (keyboardIndicatorTimeout) clearTimeout(keyboardIndicatorTimeout);
  });

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onMouseDown={mainBackdropClose.onMouseDown} onMouseUp={mainBackdropClose.onMouseUp}>
        <div class={styles.webrtcModal} onMouseDown={(e) => e.stopPropagation()}>
          {/* 桌面端标题栏 */}
          <div class={styles.modalHeader}>
            <h3>
              WebRTC 实时控制
              <span class={`${styles.connectionBadge} ${styles[connectionState()]}`}>
                {connectionState() === 'connected' ? '已连接' :
                 connectionState() === 'connecting' ? '连接中...' : '未连接'}
              </span>
            </h3>
            <button class={styles.closeButton} onClick={handleClose} title="关闭">
              <IconXmark size={16} />
            </button>
          </div>
          
          {/* 移动端浮动标题栏 */}
          <div class={styles.mobileHeader}>
            <button 
              class={styles.mobileMenuBtn} 
              onClick={() => setMobileSettingsOpen(!mobileSettingsOpen())}
              title="设置"
            >
              <span class={`${styles.connectionDot} ${styles[connectionState()]}`}></span>
              ☰
            </button>
            <Show when={connectionState() === 'connected'}>
              <div class={styles.mobileStats}>
                <span class={styles.mobileStatItem}>📊 {currentFps()}</span>
                <span class={styles.mobileStatItem}>📡 {bitrate()}k</span>
                <Show when={currentResolution()}>
                  <span class={styles.mobileStatItem}>📺 {currentResolution()}</span>
                </Show>
              </div>
            </Show>
            <button class={styles.mobileCloseBtn} onClick={handleClose} title="关闭">
              ✕
            </button>
          </div>

          <div class={styles.webrtcContent}>
            {/* 移动端侧边栏遮罩 */}
            <Show when={mobileSettingsOpen()}>
              <div class={styles.mobileSidebarOverlay} onClick={() => setMobileSettingsOpen(false)}></div>
            </Show>
            
            {/* 左侧控制面板 */}
            <div class={`${styles.controlPanel} ${mobileSettingsOpen() ? styles.mobileOpen : ''}`}>
              {/* 上半部分：设备列表 */}
              <div class={styles.controlPanelTop}>
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
                          {device.udid}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* 下半部分：画质设置等 */}
              <div class={styles.controlPanelBottom}>
                <div class={styles.settingGroup}>
                  <label class={styles.settingLabel}>最高分辨率 ({Math.round(resolution() * 100)}%)</label>
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
                  <label class={styles.settingLabel}>帧率限制 ({frameRate()} FPS)</label>
                  <div class={styles.settingValue}>
                    <input
                      type="range"
                      class={styles.settingSlider}
                      min="5"
                      max="60"
                      step="5"
                      value={frameRate()}
                      onInput={(e) => setFrameRate(parseInt(e.currentTarget.value))}
                    />
                  </div>
                </div>

              {/* 同步控制 - 分段按钮 */}
              <div class={styles.syncControlSection}>
                <label class={styles.syncControlLabel}>控制模式</label>
                <div class={styles.segmentedControl}>
                  <button 
                    class={`${styles.segmentedButton} ${!syncControl() ? styles.active : ''}`}
                    onClick={() => setSyncControl(false)}
                  >
                    <IconUser size={12} /> 单端
                  </button>
                  <button 
                    class={`${styles.segmentedButton} ${syncControl() ? styles.active : ''}`}
                    onClick={() => setSyncControl(true)}
                  >
                    <IconUsers size={12} /> 同步
                  </button>
                </div>
              </div>

              {/* 画面旋转 - 分段按钮 */}
              <div class={styles.syncControlSection}>
                <label class={styles.syncControlLabel}>画面旋转</label>
                <div class={styles.segmentedControl}>
                  <button 
                    class={`${styles.segmentedButton} ${currentRotation() === 0 ? styles.active : ''}`}
                    onClick={() => setRotation(0)}
                    title="正常"
                  ><IconMobileScreen size={14} /></button>
                  <button 
                    class={`${styles.segmentedButton} ${currentRotation() === 90 ? styles.active : ''}`}
                    onClick={() => setRotation(90)}
                    title="右转90°"
                  ><IconMobileScreen size={14} style={{ transform: 'rotate(90deg)' }} /></button>
                  <button 
                    class={`${styles.segmentedButton} ${currentRotation() === 180 ? styles.active : ''}`}
                    onClick={() => setRotation(180)}
                    title="旋转180°"
                  ><IconMobileScreen size={14} style={{ transform: 'rotate(180deg)' }} /></button>
                  <button 
                    class={`${styles.segmentedButton} ${currentRotation() === 270 ? styles.active : ''}`}
                    onClick={() => setRotation(270)}
                    title="左转90°"
                  ><IconMobileScreen size={14} style={{ transform: 'rotate(270deg)' }} /></button>
                </div>
              </div>

              <div class={styles.actionButtons}>
                <Show when={connectionState() === 'disconnected'}>
                  <button
                    class={`${styles.actionButton} ${styles.startButton}`}
                    onClick={startStream}
                    disabled={!selectedControlDevice()}
                  >
                    <IconLink /> 建立连接
                  </button>
                </Show>
                <Show when={connectionState() !== 'disconnected'}>
                  <button
                    class={`${styles.actionButton} ${styles.stopButton}`}
                    onClick={stopStream}
                  >
                    <IconLinkSlash /> 断开连接
                  </button>
                </Show>
              </div>
              </div>
            </div>

            {/* 右侧视频区域 */}
            <div class={styles.videoPanel}>
              <div class={styles.videoContainer} ref={videoContainerRef}>
                <div 
                  class={styles.videoPlaceholder} 
                  style={{ display: connectionState() === 'connected' ? 'none' : 'flex' }}
                >
                  <div class={styles.placeholderIcon}>📺</div>
                  <span>
                    {connectionState() === 'connecting' ? '正在连接...' : '点击"建立连接"启动视频流'}
                  </span>
                </div>
                
                <video
                  ref={videoRef}
                  class={styles.videoElement}
                  style={{ 
                    display: connectionState() === 'connected' ? 'block' : 'none',
                    "pointer-events": connectionState() === 'connected' ? 'auto' : 'none',
                    ...getVideoTransformStyle()
                  }}
                  autoplay
                  playsinline
                  muted
                  onLoadedMetadata={() => {
                    debugLog('webrtc', '[WebRTC] Video metadata loaded:', videoRef?.videoWidth, 'x', videoRef?.videoHeight);
                    videoRef?.play().catch(e => console.error('[WebRTC] Meta play error:', e));
                  }}
                  onPlay={() => debugLog('webrtc', '[WebRTC] Video started playing')}
                  onResize={() => debugLog('webrtc', '[WebRTC] Video resized:', videoRef?.videoWidth, 'x', videoRef?.videoHeight)}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  onContextMenu={handleContextMenu}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                />
                
                {/* 键盘指示器 */}
                <Show when={keyboardIndicator()}>
                  <div class={styles.keyboardIndicator}>
                    {keyboardIndicator()}
                  </div>
                </Show>
                
              </div>

              <Show when={connectionState() === 'connected'}>
                {/* 统计信息栏 */}
                <div class={styles.statsBar}>
                  <div class={styles.touchHintInline}>
                    🖱️ 左键: 触摸 | 右键: Home
                    {syncControl() && <span class={styles.syncActiveHint}> (同步中)</span>}
                  </div>
                  <div class={styles.statsGroup}>
                    <Show when={currentResolution()}>
                      <span class={styles.statItem}>📺 {currentResolution()}</span>
                    </Show>
                    <span class={styles.statItem}>📊 {currentFps()} FPS</span>
                    <span class={styles.statItem}>📡 {bitrate()} kbps</span>
                    <span class={styles.statItem}>{syncControl() ? <><IconUsers size={12} /> 同步 {props.selectedDevices().length} 台</> : <><IconUser size={12} /> 单端</>}</span>
                  </div>
                </div>

                {/* 底部工具栏 */}
                <div class={styles.bottomToolbar}>
                  <button class={`${styles.deviceButton} ${styles.btnInfo} ${styles.homeButton}`} onClick={handleHomeButton} title="返回主屏幕">
                    <IconHouse size={14} /> 主屏幕
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnSecondary}`} onClick={handleVolumeDown} title="音量-">
                    <IconVolumeDecrease size={14} />
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnSecondary}`} onClick={handleVolumeUp} title="音量+">
                    <IconVolumeIncrease size={14} />
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnWarning}`} onClick={handleLockScreen} title="锁定屏幕">
                    <IconLock size={14} /> 锁屏
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnSuccess}`} onClick={handleCopyFromDevice} title="从设备拷贝">
                    <IconCopy size={14} /> 拷贝
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnPrimary}`} onClick={handlePasteToDevice} title="粘贴剪贴板内容到设备">
                    <IconPaste size={14} /> 粘贴
                  </button>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>

      {/* 剪贴板模态框 */}
      <Show when={clipboardModalOpen()}>
        <div class={styles.clipboardModalOverlay} onMouseDown={clipboardBackdropClose.onMouseDown} onMouseUp={clipboardBackdropClose.onMouseUp}>
          <div class={styles.clipboardModal} onMouseDown={(e) => e.stopPropagation()}>
            <div class={styles.clipboardModalHeader}>
              <h4>{clipboardMode() === 'read' ? <><IconCopy size={14} /> 设备剪贴板内容</> : <><IconPaste size={14} /> 写入剪贴板</>}</h4>
              <button class={styles.closeButton} onClick={() => setClipboardModalOpen(false)}>✕</button>
            </div>
            
            <div class={styles.clipboardModalContent}>
              <Show when={clipboardMode() === 'read'}>
                {/* 读取模式：显示预览 */}
                <Show when={clipboardLoading()}>
                  <div class={styles.clipboardLoading}>正在读取设备剪贴板...</div>
                </Show>
                <Show when={!clipboardLoading() && !clipboardContent() && !clipboardImageData()}>
                  <div class={styles.clipboardEmpty}>设备剪贴板为空或不支持的内容类型</div>
                </Show>
                <Show when={!clipboardLoading() && clipboardContent()}>
                  <div class={styles.clipboardPreview}>
                    <pre class={styles.clipboardText}>{clipboardContent()}</pre>
                  </div>
                </Show>
                <Show when={!clipboardLoading() && clipboardImageData()}>
                  <div class={styles.clipboardPreview}>
                    <img src={`data:image/png;base64,${clipboardImageData()}`} alt="剪贴板图片" class={styles.clipboardImage} />
                  </div>
                </Show>
              </Show>

              <Show when={clipboardMode() === 'write'}>
                {/* 写入模式：输入区域 */}
                <div class={styles.clipboardInputArea} onPaste={handleClipboardPaste}>
                  <Show when={!clipboardImageData()}>
                    <textarea 
                      class={styles.clipboardTextarea}
                      placeholder="在此处粘贴文字或图片..."
                      value={clipboardContent()}
                      onInput={(e) => setClipboardContent(e.currentTarget.value)}
                      onPaste={handleClipboardPaste}
                      rows={5}
                    />
                  </Show>
                  <Show when={clipboardImageData()}>
                    <div class={styles.clipboardImagePreview}>
                      <img src={`data:image/png;base64,${clipboardImageData()}`} alt="要发送的图片" />
                      <button class={styles.clipboardClearImage} onClick={() => { setClipboardImageData(null); setTimeout(() => { const textarea = document.querySelector('.' + styles.clipboardTextarea) as HTMLTextAreaElement; if (textarea) textarea.focus(); }, 50); }}>✕ 清除</button>
                    </div>
                  </Show>
                </div>
                <Show when={syncControl()}>
                  <div class={styles.clipboardSyncHint}>
                    ✓ 同步控制已启用，将发送到所有 {props.selectedDevices().length} 台设备
                  </div>
                </Show>
              </Show>
            </div>

            <div class={styles.clipboardModalActions}>
              <Show when={clipboardMode() === 'read'}>
                <button 
                  class={`${styles.actionButton} ${styles.startButton}`}
                  onClick={handleCopyToSystemClipboard}
                  disabled={clipboardLoading() || (!clipboardContent() && !clipboardImageData())}
                >
                  <IconPaste size={14} /> 拷贝到剪贴板
                </button>
              </Show>
              <Show when={clipboardMode() === 'write'}>
                <button 
                  class={`${styles.actionButton} ${styles.startButton}`}
                  onClick={handleSendClipboardToDevices}
                  disabled={!clipboardContent() && !clipboardImageData()}
                >
                  <IconPaperPlane size={14} /> 发送到设备
                </button>
              </Show>
              <button class={`${styles.actionButton} ${styles.stopButton}`} onClick={() => setClipboardModalOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
}
