import { createSignal, onCleanup, createEffect, Show, onMount, For } from 'solid-js';
import { createBackdropClose } from '../hooks/useBackdropClose';
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
  const [currentRotation, setCurrentRotation] = createSignal(0); // 旋转角度: 0, 90, 180, 270
  const [keyboardIndicator, setKeyboardIndicator] = createSignal(''); // 键盘指示器
  let keyboardIndicatorTimeout: number | undefined;

  // 剪贴板模态框状态
  const [clipboardModalOpen, setClipboardModalOpen] = createSignal(false);
  const [clipboardMode, setClipboardMode] = createSignal<'read' | 'write'>('read');
  const [clipboardContent, setClipboardContent] = createSignal<string>(''); // 文本内容
  const [clipboardImageData, setClipboardImageData] = createSignal<string | null>(null);
  
  const mainBackdropClose = createBackdropClose(() => handleClose());
  const clipboardBackdropClose = createBackdropClose(() => setClipboardModalOpen(false));

  // 获取设备的 HTTP 端口图片数据
  const [clipboardLoading, setClipboardLoading] = createSignal(false);

  // 触摸状态跟踪
  const [isTouching, setIsTouching] = createSignal(false);
  let lastTouchPosition = { x: 0, y: 0 }; // 记录最后触摸位置

  let videoRef: HTMLVideoElement | undefined;
  let webrtcService: WebRTCService | null = null;
  let statsInterval: number | undefined;
  let lastBytesReceived = 0;
  let lastFramesDecoded = 0;
  let lastTimestamp = 0;

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
            console.log('[WebRTC] Setting remote stream signal');
            setRemoteStream(stream);
          }
        },
        httpPort
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
    const clickPosX = event.clientX - rect.left;
    const clickPosY = event.clientY - rect.top;
    
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
    event.preventDefault();

    // 移除其他元素的焦点，以便键盘事件可以被捕获
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const coords = convertToDeviceCoordinates(event);
    if (!coords) return;

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
    event.preventDefault();

    const coords = convertToDeviceCoordinates(event);
    
    // 如果离开了视频区域且正在触摸，发送 touch up（使用最后位置）
    if (!coords && isTouching()) {
      if (webrtcService) {
        webrtcService.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
      }
      const targetDevices = getTargetDevices();
      if (targetDevices.length > 0 && props.webSocketService) {
        props.webSocketService.touchUpMultipleNormalized(targetDevices);
      }
      setIsTouching(false);
      return;
    }
    
    if (!coords) return;

    // 记录触摸位置
    lastTouchPosition = coords;

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
    
    if (!isTouching()) return;

    const coords = convertToDeviceCoordinates(event);
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
  };
  
  // 鼠标离开视频区域时处理
  const handleMouseLeave = () => {
    if (isTouching()) {
      if (webrtcService) {
        webrtcService.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
      }
      const targetDevices = getTargetDevices();
      if (targetDevices.length > 0 && props.webSocketService) {
        props.webSocketService.touchUpMultipleNormalized(targetDevices);
      }
      setIsTouching(false);
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

  // 特殊按键映射
  const keyMapping: Record<string, string> = {
    'Enter': 'return',
    'Escape': 'escape',
    'Backspace': 'backspace',
    'Tab': 'tab',
    ' ': 'space',
    'Delete': 'delete',
    'ArrowUp': 'up',
    'ArrowDown': 'down',
    'ArrowLeft': 'left',
    'ArrowRight': 'right',
    'Home': 'homebutton',
    'End': 'end',
    'PageUp': 'pageup',
    'PageDown': 'pagedown',
    'Control': 'command',
    'Meta': 'command',
    'Alt': 'option',
    'Shift': 'shift'
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
    // ESC 关闭窗口
    if (e.key === 'Escape' && props.isOpen) {
      handleClose();
      return;
    }

    // 如果剪贴板模态框打开，不拦截键盘事件
    if (clipboardModalOpen()) return;

    // 只在连接状态且焦点在视频区域时处理
    if (connectionState() !== 'connected') return;
    const activeEl = document.activeElement;
    if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable) return;

    // 检测复制/粘贴快捷键
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault();
      handleCopyFromDevice();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      e.preventDefault();
      handlePasteToDevice();
      return;
    }

    // 获取映射的按键
    let mappedKey = keyMapping[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : null);
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
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'v')) return;

    let mappedKey = keyMapping[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : null);
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
    
    // 1. 先触发设备端的复制动作 (Cmd+C)
    if (webrtcService) {
      webrtcService.sendKeyCommand('command', 'down');
      webrtcService.sendKeyCommand('c', 'down');
      setTimeout(() => {
        webrtcService?.sendKeyCommand('c', 'up');
        webrtcService?.sendKeyCommand('command', 'up');
        
        // 2. 稍等片刻后读取剪贴板
        setTimeout(() => {
          const currentDevice = selectedControlDevice();
          if (currentDevice && props.webSocketService) {
            props.webSocketService.readClipboard([currentDevice]);
          }
        }, 200);
      }, 50);
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

  // 剪贴板模态框 - 复制到系统剪贴板
  const handleCopyToSystemClipboard = async () => {
    const text = clipboardContent();
    const imageData = clipboardImageData();
    
    try {
      if (text) {
        await navigator.clipboard.writeText(text);
      } else if (imageData) {
        // 尝试复制图片到剪贴板
        const response = await fetch(`data:image/png;base64,${imageData}`);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
      setClipboardModalOpen(false);
    } catch (error) {
      console.error('复制到剪贴板失败:', error);
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
      console.log('[WebRTC] Applying stream to video element:', stream.id);
      videoRef.srcObject = stream;
      videoRef.play().catch(e => console.error('[WebRTC] Video play error:', e));
    }
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
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
    });
  });

  onCleanup(() => {
    stopStream();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    if (keyboardIndicatorTimeout) clearTimeout(keyboardIndicatorTimeout);
  });

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onMouseDown={mainBackdropClose.onMouseDown} onMouseUp={mainBackdropClose.onMouseUp}>
        <div class={styles.webrtcModal} onMouseDown={(e) => e.stopPropagation()}>
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

              {/* 画面旋转 */}
              <div class={styles.settingGroup}>
                <label class={styles.settingLabel}>画面旋转</label>
                <div class={styles.rotationGroup}>
                  <button 
                    class={`${styles.rotateBtn} ${currentRotation() === 0 ? styles.active : ''}`}
                    onClick={() => setRotation(0)}
                    title="正常"
                  >↑</button>
                  <button 
                    class={`${styles.rotateBtn} ${currentRotation() === 90 ? styles.active : ''}`}
                    onClick={() => setRotation(90)}
                    title="右转90°"
                  >→</button>
                  <button 
                    class={`${styles.rotateBtn} ${currentRotation() === 180 ? styles.active : ''}`}
                    onClick={() => setRotation(180)}
                    title="旋转180°"
                  >↓</button>
                  <button 
                    class={`${styles.rotateBtn} ${currentRotation() === 270 ? styles.active : ''}`}
                    onClick={() => setRotation(270)}
                    title="左转90°"
                  >←</button>
                </div>
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
                    "pointer-events": connectionState() === 'connected' ? 'auto' : 'none',
                    transform: `rotate(${currentRotation()}deg)`
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
                  onMouseLeave={handleMouseLeave}
                  onContextMenu={handleContextMenu}
                />
                
                {/* 键盘指示器 */}
                <Show when={keyboardIndicator()}>
                  <div class={styles.keyboardIndicator}>
                    {keyboardIndicator()}
                  </div>
                </Show>
                
              </div>

              <Show when={connectionState() === 'connected'}>
                {/* 底部工具栏 */}
                <div class={styles.bottomToolbar}>
                  <button class={`${styles.deviceButton} ${styles.btnInfo}`} onClick={handleHomeButton} title="返回主屏幕">
                    🏠 主屏幕
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnSecondary}`} onClick={handleVolumeDown} title="音量-">
                    🔉 -
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnSecondary}`} onClick={handleVolumeUp} title="音量+">
                    🔊 +
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnWarning}`} onClick={handleLockScreen} title="锁定屏幕">
                    🔒 锁屏
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnSuccess}`} onClick={handleCopyFromDevice} title="从设备复制">
                    📑 拷贝
                  </button>
                  <button class={`${styles.deviceButton} ${styles.btnPrimary}`} onClick={handlePasteToDevice} title="粘贴剪贴板内容到设备">
                    📋 粘贴
                  </button>
                </div>

                {/* 统计信息栏 */}
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

      {/* 剪贴板模态框 */}
      <Show when={clipboardModalOpen()}>
        <div class={styles.clipboardModalOverlay} onMouseDown={clipboardBackdropClose.onMouseDown} onMouseUp={clipboardBackdropClose.onMouseUp}>
          <div class={styles.clipboardModal} onMouseDown={(e) => e.stopPropagation()}>
            <div class={styles.clipboardModalHeader}>
              <h4>{clipboardMode() === 'read' ? '📑 设备剪贴板内容' : '📋 写入剪贴板'}</h4>
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
                  📋 复制到剪贴板
                </button>
              </Show>
              <Show when={clipboardMode() === 'write'}>
                <button 
                  class={`${styles.actionButton} ${styles.startButton}`}
                  onClick={handleSendClipboardToDevices}
                  disabled={!clipboardContent() && !clipboardImageData()}
                >
                  📤 发送到设备
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
