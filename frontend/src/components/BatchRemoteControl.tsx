import { createSignal, For, Show, onCleanup, createEffect, onMount } from 'solid-js';
import { IconXmark } from '../icons';
import styles from './BatchRemoteControl.module.css';
import { WebRTCService, type WebRTCStartOptions } from '../services/WebRTCService';
import type { Device } from '../services/AuthService';
import type { WebSocketService } from '../services/WebSocketService';

export interface BatchRemoteControlProps {
  isOpen: boolean;
  onClose: () => void;
  devices: Device[];           // 传入的设备列表
  webSocketService: WebSocketService | null;
  password: string;
}

// 设备连接状态
interface DeviceConnection {
  udid: string;
  service: WebRTCService | null;
  stream: MediaStream | null;
  state: 'disconnected' | 'connecting' | 'connected';
  videoRef?: HTMLVideoElement;
}

// 获取设备名称的辅助函数
function getDeviceName(device: Device): string {
  return device.system?.name || device.udid.substring(0, 12) + '...';
}

// 获取设备 HTTP 端口
function getDeviceHttpPort(device: Device): number | undefined {
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
}

export default function BatchRemoteControl(props: BatchRemoteControlProps) {
  // 设备连接状态管理
  const [connections, setConnections] = createSignal<Map<string, DeviceConnection>>(new Map());
  
  // 缓存的设备列表（不会因为 props.devices 状态更新而改变）
  const [cachedDevices, setCachedDevices] = createSignal<Device[]>([]);
  
  // 被勾选的设备 UDID 集合
  const [checkedDevices, setCheckedDevices] = createSignal<Set<string>>(new Set());
  
  // 全选状态（计算属性：当所有设备都被勾选时为 true）
  const isAllSelected = () => {
    const devices = cachedDevices();
    const checked = checkedDevices();
    return devices.length > 0 && checked.size === devices.length;
  };
  
  // 全屏模式
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  
  // localStorage 键名
  const STORAGE_KEY = 'batchRemoteControl';
  
  // 从 localStorage 加载保存的设置
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('[BatchRemote] Failed to load settings:', e);
    }
    return null;
  };
  
  // 保存设置到 localStorage
  const saveSettings = (settings: Record<string, unknown>) => {
    try {
      const current = loadSettings() || {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings }));
    } catch (e) {
      console.error('[BatchRemote] Failed to save settings:', e);
    }
  };
  
  const savedSettings = loadSettings();
  
  // 窗口位置和尺寸（用于拖动和调整大小）
  const [windowPos, setWindowPos] = createSignal(savedSettings?.windowPos || { x: 0, y: 0 });
  const [windowSize, setWindowSize] = createSignal(savedSettings?.windowSize || { width: 0, height: 0 });
  const [windowInitialized, setWindowInitialized] = createSignal(!!savedSettings?.windowSize?.width);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isResizing, setIsResizing] = createSignal(false);
  let dragOffset = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, width: 0, height: 0 };
  let panelRef: HTMLDivElement | null = null;
  
  // 参数控制 - 从 localStorage 加载初始值
  const [resolution, setResolution] = createSignal(savedSettings?.resolution ?? 0.2);
  const [frameRate, setFrameRate] = createSignal(savedSettings?.frameRate ?? 10);
  const [columns, setColumns] = createSignal(savedSettings?.columns ?? 4);
  
  // 保存设置到 localStorage 的 effects
  createEffect(() => {
    if (windowInitialized()) {
      saveSettings({ windowPos: windowPos(), windowSize: windowSize() });
    }
  });
  
  createEffect(() => {
    saveSettings({ resolution: resolution(), frameRate: frameRate(), columns: columns() });
  });
  
  // 设备卡片引用和可见性追踪
  const cardRefs = new Map<string, HTMLDivElement>();
  let gridRef: HTMLDivElement | null = null;
  const [visibleDevices, setVisibleDevices] = createSignal<Set<string>>(new Set());
  let intersectionObserver: IntersectionObserver | null = null;
  
  // 触控状态
  const [activeDevice, setActiveDevice] = createSignal<string | null>(null);
  const [isTouching, setIsTouching] = createSignal(false);
  let lastTouchPosition = { x: 0, y: 0 };
  // 粘贴文本模态框
  const [showPasteModal, setShowPasteModal] = createSignal(false);
  const [pasteText, setPasteText] = createSignal('');
  
  // Move throttling 相关变量
  const MOVE_EPSILON = 0.0015;
  let pendingMove: { x: number; y: number } | null = null;
  let moveRafId: number | null = null;
  let lastSentMove: { x: number; y: number } | null = null;
  
  // 初始化 IntersectionObserver
  const setupIntersectionObserver = () => {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }
    
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const udid = entry.target.getAttribute('data-udid');
          if (!udid) return;
          
          const wasVisible = visibleDevices().has(udid);
          const isVisible = entry.isIntersecting;
          
          if (isVisible !== wasVisible) {
            // 更新可见性状态
            setVisibleDevices(prev => {
              const newSet = new Set(prev);
              if (isVisible) {
                newSet.add(udid);
              } else {
                newSet.delete(udid);
              }
              return newSet;
            });
            
            // 根据可见性断开/重连 WebRTC
            if (isVisible) {
              // 变为可见 - 重新连接
              const device = cachedDevices().find(d => d.udid === udid);
              if (device) {
                const currentConn = connections().get(udid);
                if (!currentConn?.service || currentConn.state === 'disconnected') {
                  console.log(`[BatchRemote] Device ${udid} visible, reconnecting...`);
                  connectDevice(device);
                }
              }
            } else {
              // 变为不可见 - 断开连接
              const currentConn = connections().get(udid);
              if (currentConn?.service && currentConn.state === 'connected') {
                console.log(`[BatchRemote] Device ${udid} hidden, disconnecting...`);
                disconnectDevice(udid);
              }
            }
          }
        });
      },
      {
        root: gridRef,  // 使用网格容器作为根，而不是 viewport
        rootMargin: '50px',
        threshold: 0
      }
    );
    
    // 观察所有已有的卡片
    cardRefs.forEach((el, udid) => {
      el.setAttribute('data-udid', udid);
      intersectionObserver?.observe(el);
    });
  };
  
  // 注册卡片 ref
  const setCardRef = (udid: string, el: HTMLDivElement | null) => {
    if (el) {
      cardRefs.set(udid, el);
      el.setAttribute('data-udid', udid);
      intersectionObserver?.observe(el);
    } else {
      const existing = cardRefs.get(udid);
      if (existing) {
        intersectionObserver?.unobserve(existing);
      }
      cardRefs.delete(udid);
    }
  };

  // 拖动处理
  const handleDragStart = (e: MouseEvent) => {
    if (isFullscreen()) return;
    e.preventDefault();
    const pos = windowPos();
    dragOffset = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setIsDragging(true);
    
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  };

  // 约束窗口位置在页面边界内
  const constrainPosition = (x: number, y: number, width: number, height: number) => {
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);
    return {
      x: Math.max(0, Math.min(maxX, x)),
      y: Math.max(0, Math.min(maxY, y))
    };
  };

  const handleDragMove = (e: MouseEvent) => {
    if (!isDragging()) return;
    const size = windowSize();
    const rawX = e.clientX - dragOffset.x;
    const rawY = e.clientY - dragOffset.y;
    const { x, y } = constrainPosition(rawX, rawY, size.width, size.height);
    setWindowPos({ x, y });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
  };

  // 页面调整大小时，约束窗口位置
  createEffect(() => {
    const handleWindowResize = () => {
      if (isFullscreen() || !windowInitialized()) return;
      const pos = windowPos();
      const size = windowSize();
      const { x, y } = constrainPosition(pos.x, pos.y, size.width, size.height);
      if (x !== pos.x || y !== pos.y) {
        setWindowPos({ x, y });
      }
    };
    
    window.addEventListener('resize', handleWindowResize);
    onCleanup(() => window.removeEventListener('resize', handleWindowResize));
  });

  // 调整大小处理
  const handleResizeStart = (e: MouseEvent) => {
    if (isFullscreen()) return;
    e.preventDefault();
    e.stopPropagation();
    const size = windowSize();
    resizeStart = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };
    setIsResizing(true);
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!isResizing()) return;
    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;
    const newWidth = Math.max(400, resizeStart.width + deltaX);
    const newHeight = Math.max(300, resizeStart.height + deltaY);
    setWindowSize({ width: newWidth, height: newHeight });
  };

  const handleResizeEnd = () => {
    setIsResizing(false);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  };
  // 获取当前选中的设备列表 (被勾选的)
  const getCheckedDevicesList = (): string[] => {
    return [...checkedDevices()];
  };
  
  // 获取其他被勾选的设备（排除当前操作的设备）
  const getOtherCheckedDevices = (currentUdid: string): string[] => {
    return [...checkedDevices()].filter(udid => udid !== currentUdid);
  };

  // 计算设备的最优分辨率 - 取 min(用户设置, 容器适配, 720p限制)
  const calculateOptimalResolution = (device: Device): number => {
    // 1. 用户设置的最大分辨率
    const userMaxScale = resolution();
    
    // 2. 获取设备原始分辨率
    let nativeW = device.width || 1170;
    let nativeH = device.height || 2532;
    
    // 如果设备是横屏，交换宽高
    if (nativeW > nativeH) {
      const tmp = nativeW;
      nativeW = nativeH;
      nativeH = tmp;
    }
    
    // 3. 计算容器尺寸
    const GRID_GAP = 12;
    const GRID_PADDING = 16;
    const cols = columns();
    const panelWidth = isFullscreen() ? window.innerWidth : window.innerWidth * 0.9;
    const availableWidth = panelWidth - (GRID_PADDING * 2) - (GRID_GAP * (cols - 1));
    const cardWidth = availableWidth / cols;
    const containerWidth = cardWidth;
    const containerHeight = containerWidth * (16 / 9);
    
    // 设备画面在容器中的实际显示尺寸 (object-fit: contain)
    const deviceAspect = nativeW / nativeH;
    const containerAspect = 9 / 16;
    
    let displayWidth, displayHeight;
    if (deviceAspect > containerAspect) {
      displayWidth = containerWidth;
      displayHeight = containerWidth / deviceAspect;
    } else {
      displayHeight = containerHeight;
      displayWidth = containerHeight * deviceAspect;
    }
    
    const dpr = window.devicePixelRatio || 1;
    const displayPhysicalW = displayWidth * dpr;
    const displayPhysicalH = displayHeight * dpr;
    const containerScaleW = displayPhysicalW / nativeW;
    const containerScaleH = displayPhysicalH / nativeH;
    const containerScale = Math.min(containerScaleW, containerScaleH);
    
    // 4. 像素限制 (720x1280)
    const MAX_PIXELS = 720 * 1280;
    const nativePixels = nativeW * nativeH;
    const pixelLimitScale = Math.floor(Math.sqrt(MAX_PIXELS / nativePixels) * 100) / 100;
    
    // 取三者最小值
    const finalScale = Math.min(userMaxScale, containerScale, pixelLimitScale);
    return Math.max(0.1, Math.min(1.0, finalScale));
  };

  // 连接单个设备
  const connectDevice = async (device: Device) => {
    const conn = connections().get(device.udid);
    if (!conn || conn.state !== 'disconnected' || !props.webSocketService) return;

    // 更新状态为连接中
    setConnections(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(device.udid);
      if (existing) {
        newMap.set(device.udid, { ...existing, state: 'connecting' });
      }
      return newMap;
    });

    const httpPort = getDeviceHttpPort(device);

    const service = new WebRTCService(
      props.webSocketService,
      device.udid,
      props.password,
      {
        onConnected: () => {
          setConnections(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(device.udid);
            if (existing) {
              newMap.set(device.udid, { ...existing, state: 'connected' });
            }
            return newMap;
          });
        },
        onDisconnected: () => {
          setConnections(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(device.udid);
            if (existing) {
              newMap.set(device.udid, { ...existing, state: 'disconnected', stream: null });
            }
            return newMap;
          });
        },
        onError: (error) => {
          console.error(`[BatchRemote] Device ${device.udid} error:`, error);
          setConnections(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(device.udid);
            if (existing) {
              newMap.set(device.udid, { ...existing, state: 'disconnected' });
            }
            return newMap;
          });
        },
        onTrack: (stream) => {
          setConnections(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(device.udid);
            if (existing) {
              newMap.set(device.udid, { ...existing, stream });
            }
            return newMap;
          });
        },
        onClipboard: () => {},
        onClipboardError: () => {}
      },
      httpPort
    );

    try {
      // 计算自适应分辨率
      // 1. 用户设置的最大分辨率
      const userMaxScale = resolution();
      
      // 2. 基于容器大小计算的分辨率
      // 获取设备原始分辨率（假设设备信息中有 width/height）
      let nativeW = device.width || 1170;  // iPhone 默认宽度
      let nativeH = device.height || 2532; // iPhone 默认高度
      
      // 如果设备是横屏（宽 > 高），交换宽高
      if (nativeW > nativeH) {
        const tmp = nativeW;
        nativeW = nativeH;
        nativeH = tmp;
      }
      
      // 获取容器尺寸（批量控制中每个卡片的视频区域）
      // CSS 参数: grid gap = 12px, grid padding = 16px
      const GRID_GAP = 12;
      const GRID_PADDING = 16;
      const cols = columns();
      
      // 面板宽度（假设全屏模式，否则大约是 90vw）
      const panelWidth = isFullscreen() ? window.innerWidth : window.innerWidth * 0.9;
      
      // 可用于卡片的总宽度 = 面板宽度 - 左右 padding - 间隔
      // 间隔数量 = 列数 - 1
      const availableWidth = panelWidth - (GRID_PADDING * 2) - (GRID_GAP * (cols - 1));
      const cardWidth = availableWidth / cols;
      
      // 视频容器宽度 = 卡片宽度（有少量边框等，但忽略不计）
      // 视频容器高度按 9:16 比例
      const containerWidth = cardWidth;
      const containerHeight = containerWidth * (16 / 9);
      
      // 设备画面在容器中保持宽高比 (object-fit: contain)
      // 需要计算设备画面在容器中的实际显示尺寸
      const deviceAspect = nativeW / nativeH;
      const containerAspect = 9 / 16;
      
      let displayWidth, displayHeight;
      if (deviceAspect > containerAspect) {
        // 设备更宽，以容器宽度为准
        displayWidth = containerWidth;
        displayHeight = containerWidth / deviceAspect;
      } else {
        // 设备更高，以容器高度为准
        displayHeight = containerHeight;
        displayWidth = containerHeight * deviceAspect;
      }
      
      const dpr = window.devicePixelRatio || 1;
      const displayPhysicalW = displayWidth * dpr;
      const displayPhysicalH = displayHeight * dpr;
      const containerScaleW = displayPhysicalW / nativeW;
      const containerScaleH = displayPhysicalH / nativeH;
      const containerScale = Math.min(containerScaleW, containerScaleH);
      
      // 3. 像素限制 (720x1280 = 921600)
      const MAX_PIXELS = 720 * 1280;
      const nativePixels = nativeW * nativeH;
      const pixelLimitScale = Math.floor(Math.sqrt(MAX_PIXELS / nativePixels) * 100) / 100;
      
      // 取三者最小值
      const finalScale = Math.min(userMaxScale, containerScale, pixelLimitScale);
      const clampedScale = Math.max(0.1, Math.min(1.0, finalScale));
      
      console.log(`[BatchRemote] Device ${device.udid} resolution:`, {
        native: `${nativeW}x${nativeH}`,
        container: `${Math.round(containerWidth)}x${Math.round(containerHeight)}`,
        scales: { user: userMaxScale, container: containerScale.toFixed(3), pixelLimit: pixelLimitScale },
        final: clampedScale.toFixed(3)
      });
      
      const options: WebRTCStartOptions = {
        resolution: clampedScale,
        fps: frameRate(),
        force: true
      };
      
      await service.startStream(options);
      
      setConnections(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(device.udid);
        if (existing) {
          newMap.set(device.udid, { ...existing, service });
        }
        return newMap;
      });
    } catch (error) {
      console.error(`[BatchRemote] Failed to connect ${device.udid}:`, error);
      service.cleanup();
      setConnections(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(device.udid);
        if (existing) {
          newMap.set(device.udid, { ...existing, state: 'disconnected' });
        }
        return newMap;
      });
    }
  };

  // 断开单个设备
  const disconnectDevice = async (udid: string) => {
    const conn = connections().get(udid);
    if (!conn || !conn.service) return;

    await conn.service.stopStream();
    conn.service.cleanup();
    
    setConnections(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(udid);
      if (existing) {
        newMap.set(udid, { ...existing, service: null, stream: null, state: 'disconnected' });
      }
      return newMap;
    });
  };

  // 连接所有设备
  const connectAllDevices = async () => {
    for (const device of props.devices) {
      const conn = connections().get(device.udid);
      if (conn?.state === 'disconnected') {
        // 不用 await，并行连接
        connectDevice(device);
      }
    }
  };

  // 断开所有设备
  const disconnectAllDevices = async () => {
    for (const [udid, conn] of connections()) {
      if (conn.service) {
        await disconnectDevice(udid);
      }
    }
  };

  // 切换设备勾选状态
  const toggleDeviceCheck = (udid: string) => {
    setCheckedDevices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(udid)) {
        newSet.delete(udid);
      } else {
        newSet.add(udid);
      }
      return newSet;
    });
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (isAllSelected()) {
      // 取消全选
      setCheckedDevices(new Set<string>());
    } else {
      // 全选
      setCheckedDevices(new Set(cachedDevices().map(d => d.udid)));
    }
  };

  // 坐标转换
  const convertToDeviceCoordinates = (event: MouseEvent | Touch, videoElement: HTMLVideoElement) => {
    const rect = videoElement.getBoundingClientRect();
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;

    if (!videoWidth || !videoHeight) return null;

    const videoAspectRatio = videoWidth / videoHeight;
    const containerAspectRatio = rect.width / rect.height;
    
    let displayWidth, displayHeight, offsetX, offsetY;
    
    if (videoAspectRatio > containerAspectRatio) {
      displayWidth = rect.width;
      displayHeight = rect.width / videoAspectRatio;
      offsetX = 0;
      offsetY = (rect.height - displayHeight) / 2;
    } else {
      displayWidth = rect.height * videoAspectRatio;
      displayHeight = rect.height;
      offsetX = (rect.width - displayWidth) / 2;
      offsetY = 0;
    }

    const clientX = 'clientX' in event ? event.clientX : (event as Touch).clientX;
    const clientY = 'clientY' in event ? event.clientY : (event as Touch).clientY;
    
    const clickPosX = clientX - rect.left;
    const clickPosY = clientY - rect.top;

    if (clickPosX < offsetX || clickPosX > offsetX + displayWidth ||
        clickPosY < offsetY || clickPosY > offsetY + displayHeight) {
      return null;
    }

    const clickX = (clickPosX - offsetX) / displayWidth;
    const clickY = (clickPosY - offsetY) / displayHeight;

    return { x: clickX, y: clickY };
  };

  // 发送移动命令
  const sendMove = (coords: { x: number; y: number }) => {
    const active = activeDevice();
    if (!active) return;
    
    const conn = connections().get(active);
    if (conn?.service) {
      conn.service.sendTouchCommand('move', coords.x, coords.y);
    }
    
    // 只有当操作的设备是选中状态时，才同步到其他选中设备
    if (checkedDevices().has(active)) {
      const otherDevices = getOtherCheckedDevices(active);
      if (otherDevices.length > 0 && props.webSocketService) {
        props.webSocketService.touchMoveMultipleNormalized(otherDevices, coords.x, coords.y);
      }
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

  // 触控事件处理
  const handleDeviceMouseDown = (udid: string, event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    
    const conn = connections().get(udid);
    if (!conn?.videoRef) return;

    const coords = convertToDeviceCoordinates(event, conn.videoRef);
    if (!coords) return;

    resetMoveState();
    setActiveDevice(udid);
    setIsTouching(true);
    lastTouchPosition = coords;

    // 发送到当前设备 (via DataChannel)
    if (conn.service) {
      conn.service.sendTouchCommand('down', coords.x, coords.y);
    }

    // 只有当操作的设备是选中状态时，才同步到其他选中设备
    if (checkedDevices().has(udid)) {
      const otherDevices = getOtherCheckedDevices(udid);
      if (otherDevices.length > 0 && props.webSocketService) {
        props.webSocketService.touchDownMultipleNormalized(otherDevices, coords.x, coords.y);
      }
    }
  };

  const handleDeviceMouseMove = (udid: string, event: MouseEvent) => {
    if (!isTouching() || activeDevice() !== udid) return;
    event.preventDefault();

    const conn = connections().get(udid);
    if (!conn?.videoRef) return;

    const coords = convertToDeviceCoordinates(event, conn.videoRef);
    if (!coords) return;

    lastTouchPosition = coords;
    scheduleMoveSend(coords);
  };

  const handleDeviceMouseUp = (udid: string, event: MouseEvent) => {
    if (!isTouching() || activeDevice() !== udid) return;
    event.preventDefault();
    
    flushQueuedMove();

    const conn = connections().get(udid);
    const coords = conn?.videoRef ? convertToDeviceCoordinates(event, conn.videoRef) : null;
    const finalCoords = coords || lastTouchPosition;

    // 发送到当前设备
    if (conn?.service) {
      conn.service.sendTouchCommand('up', finalCoords.x, finalCoords.y);
    }

    // 只有当操作的设备是选中状态时，才同步到其他选中设备（延迟100ms）
    if (checkedDevices().has(udid)) {
      const otherDevices = getOtherCheckedDevices(udid);
      if (otherDevices.length > 0 && props.webSocketService) {
        setTimeout(() => props.webSocketService?.touchUpMultipleNormalized(otherDevices), 100);
      }
    }

    setIsTouching(false);
    setActiveDevice(null);
    resetMoveState();
  };

  const handleDeviceMouseLeave = (udid: string) => {
    if (isTouching() && activeDevice() === udid) {
      flushQueuedMove();
      
      const conn = connections().get(udid);
      if (conn?.service) {
        conn.service.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
      }
      
      // 只有当操作的设备是选中状态时，才同步（延迟100ms）
      if (checkedDevices().has(udid)) {
        const otherDevices = getOtherCheckedDevices(udid);
        if (otherDevices.length > 0 && props.webSocketService) {
          setTimeout(() => props.webSocketService?.touchUpMultipleNormalized(otherDevices), 100);
        }
      }

      setIsTouching(false);
      setActiveDevice(null);
      resetMoveState();
    }
  };

  // 右键 = Home 键 (对所有设备生效，选中设备会同步)
  const handleDeviceContextMenu = (udid: string, event: MouseEvent) => {
    event.preventDefault();
    
    // 始终对当前设备生效
    const conn = connections().get(udid);
    if (conn?.service) {
      conn.service.sendKeyCommand('homebutton', 'press');
    }

    // 如果当前设备是选中状态，同步到其他选中设备
    if (checkedDevices().has(udid)) {
      const otherDevices = getOtherCheckedDevices(udid);
      if (otherDevices.length > 0 && props.webSocketService) {
        props.webSocketService.pressHomeButtonMultiple(otherDevices);
      }
    }
  };

  // 触摸事件处理 (移动端)
  const handleDeviceTouchStart = (udid: string, event: TouchEvent) => {
    event.preventDefault();
    
    const conn = connections().get(udid);
    if (!conn?.videoRef) return;

    const touch = event.touches[0];
    if (!touch) return;

    const coords = convertToDeviceCoordinates(touch, conn.videoRef);
    if (!coords) return;

    resetMoveState();
    setActiveDevice(udid);
    setIsTouching(true);
    lastTouchPosition = coords;

    if (conn.service) {
      conn.service.sendTouchCommand('down', coords.x, coords.y);
    }

    // 只有当操作的设备是选中状态时，才同步
    if (checkedDevices().has(udid)) {
      const otherDevices = getOtherCheckedDevices(udid);
      if (otherDevices.length > 0 && props.webSocketService) {
        props.webSocketService.touchDownMultipleNormalized(otherDevices, coords.x, coords.y);
      }
    }
  };

  const handleDeviceTouchMove = (udid: string, event: TouchEvent) => {
    event.preventDefault();
    if (!isTouching() || activeDevice() !== udid) return;

    const conn = connections().get(udid);
    if (!conn?.videoRef) return;

    const touch = event.touches[0];
    if (!touch) return;

    const coords = convertToDeviceCoordinates(touch, conn.videoRef);
    if (!coords) return;

    lastTouchPosition = coords;
    scheduleMoveSend(coords);
  };

  const handleDeviceTouchEnd = (udid: string, event: TouchEvent) => {
    event.preventDefault();
    if (!isTouching() || activeDevice() !== udid) return;

    flushQueuedMove();

    const conn = connections().get(udid);
    if (conn?.service) {
      conn.service.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
    }

    // 只有当操作的设备是选中状态时，才同步（延迟100ms）
    if (checkedDevices().has(udid)) {
      const otherDevices = getOtherCheckedDevices(udid);
      if (otherDevices.length > 0 && props.webSocketService) {
        setTimeout(() => props.webSocketService?.touchUpMultipleNormalized(otherDevices), 100);
      }
    }

    setIsTouching(false);
    setActiveDevice(null);
    resetMoveState();
  };

  // 工具栏操作 - 发送到所有被勾选设备
  const handleHomeButton = () => {
    const checked = getCheckedDevicesList();
    
    for (const udid of checked) {
      const conn = connections().get(udid);
      if (conn?.service) {
        conn.service.sendKeyCommand('homebutton', 'press');
      }
    }
    
    if (props.webSocketService && checked.length > 0) {
      props.webSocketService.pressHomeButtonMultiple(checked);
    }
  };

  const handleVolumeUp = () => {
    const checked = getCheckedDevicesList();
    
    for (const udid of checked) {
      const conn = connections().get(udid);
      if (conn?.service) {
        conn.service.sendKeyCommand('volumeup', 'press');
      }
    }
    
    if (props.webSocketService && checked.length > 0) {
      props.webSocketService.keyDownMultiple(checked, 'VOLUMEUP');
      setTimeout(() => props.webSocketService?.keyUpMultiple(checked, 'VOLUMEUP'), 50);
    }
  };

  const handleVolumeDown = () => {
    const checked = getCheckedDevicesList();
    
    for (const udid of checked) {
      const conn = connections().get(udid);
      if (conn?.service) {
        conn.service.sendKeyCommand('volumedown', 'press');
      }
    }
    
    if (props.webSocketService && checked.length > 0) {
      props.webSocketService.keyDownMultiple(checked, 'VOLUMEDOWN');
      setTimeout(() => props.webSocketService?.keyUpMultiple(checked, 'VOLUMEDOWN'), 50);
    }
  };

  const handleLockScreen = () => {
    const checked = getCheckedDevicesList();
    
    for (const udid of checked) {
      const conn = connections().get(udid);
      if (conn?.service) {
        conn.service.sendKeyCommand('lock', 'press');
      }
    }
    
    if (props.webSocketService && checked.length > 0) {
      props.webSocketService.keyDownMultiple(checked, 'LOCK');
      setTimeout(() => props.webSocketService?.keyUpMultiple(checked, 'LOCK'), 50);
    }
  };

  const handlePaste = () => {
    setShowPasteModal(true);
  };

  const sendPasteToDevices = () => {
    const text = pasteText();
    if (!text) return;

    const checked = getCheckedDevicesList();
    
    for (const udid of checked) {
      const conn = connections().get(udid);
      if (conn?.service) {
        conn.service.sendPasteCommand(text);
      }
    }

    setShowPasteModal(false);
    setPasteText('');
  };

  // 全屏切换
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen());
  };

  // 关闭面板
  const handleClose = () => {
    disconnectAllDevices();
    props.onClose();
  };

  // 跟踪是否已初始化，防止重复连接
  let hasInitialized = false;

  // 当面板打开时初始化并连接
  createEffect(() => {
    const isOpen = props.isOpen;
    const devices = props.devices;
    
    if (isOpen && devices.length > 0 && !hasInitialized) {
      hasInitialized = true;
      // 缓存设备列表（仅在初始化时设置一次）
      setCachedDevices([...devices]);
      // 初始化连接映射
      const newConnections = new Map<string, DeviceConnection>();
      for (const device of devices) {
        newConnections.set(device.udid, {
          udid: device.udid,
          service: null,
          stream: null,
          state: 'disconnected'
        });
      }
      setConnections(newConnections);
      // 默认不勾选任何设备
      setCheckedDevices(new Set<string>());
      
      // 延迟连接所有设备
      setTimeout(() => {
        setupIntersectionObserver();
        connectAllDevices();
      }, 100);
    } else if (!isOpen && hasInitialized) {
      // 面板关闭时重置标记和缓存
      hasInitialized = false;
      setCachedDevices([]);
    }
  });

  // 当帧率变化时，动态更新所有已连接设备的帧率
  createEffect(() => {
    const fps = frameRate();
    // 遍历所有已连接的设备并更新帧率
    connections().forEach((conn, udid) => {
      if (conn.service && conn.state === 'connected') {
        conn.service.setFrameRate(fps).catch(err => {
          console.error(`[BatchRemote] Failed to set FPS for ${udid}:`, err);
        });
        console.log(`[BatchRemote] Device ${udid} FPS updated to ${fps}`);
      }
    });
  });

  // 当分辨率/列数/全屏状态变化时，动态更新所有已连接设备的分辨率
  createEffect(() => {
    // 依赖这些信号触发重新计算
    const _ = resolution();
    const __ = columns();
    const ___ = isFullscreen();
    
    // 遍历所有已连接的设备并更新分辨率
    cachedDevices().forEach((device) => {
      const conn = connections().get(device.udid);
      if (conn?.service && conn.state === 'connected') {
        const optimalScale = calculateOptimalResolution(device);
        conn.service.setResolution(optimalScale).catch(err => {
          console.error(`[BatchRemote] Failed to set resolution for ${device.udid}:`, err);
        });
        console.log(`[BatchRemote] Device ${device.udid} resolution updated to ${optimalScale.toFixed(3)}`);
      }
    });
  });

  // 确保触控状态正确清理的函数
  const cleanupTouchState = () => {
    if (isTouching()) {
      const active = activeDevice();
      if (active) {
        // 发送 touch.up 到当前活动设备
        const conn = connections().get(active);
        if (conn?.service) {
          conn.service.sendTouchCommand('up', lastTouchPosition.x, lastTouchPosition.y);
        }
        
        // 如果当前设备是选中状态，同步到其他选中设备（延迟100ms）
        if (checkedDevices().has(active)) {
          const otherDevices = getOtherCheckedDevices(active);
          if (otherDevices.length > 0 && props.webSocketService) {
            setTimeout(() => props.webSocketService?.touchUpMultipleNormalized(otherDevices), 100);
          }
        }
      }
      
      setIsTouching(false);
      setActiveDevice(null);
      resetMoveState();
    }
  };

  // 清理资源
  onCleanup(() => {
    // 断开 IntersectionObserver
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    // 确保发送 touch.up
    cleanupTouchState();
    disconnectAllDevices();
  });

  // ESC 键关闭
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showPasteModal()) {
        setShowPasteModal(false);
      } else if (props.isOpen) {
        handleClose();
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  // 设置视频 ref
  const setVideoRef = (udid: string, el: HTMLVideoElement) => {
    setConnections(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(udid);
      if (existing) {
        newMap.set(udid, { ...existing, videoRef: el });
      }
      return newMap;
    });
  };

  // 绑定视频流到 video 元素
  createEffect(() => {
    for (const [, conn] of connections()) {
      if (conn.videoRef && conn.stream) {
        if (conn.videoRef.srcObject !== conn.stream) {
          conn.videoRef.srcObject = conn.stream;
          conn.videoRef.play().catch(e => console.error('[BatchRemote] Video play error:', e));
        }
      }
    }
  });

  return (
    <Show when={props.isOpen}>
      <div 
        class={`${styles.modalOverlay} ${styles.noBackdrop} ${isFullscreen() ? styles.fullscreen : ''}`} 
      >
        <div 
          ref={(el) => { 
            panelRef = el; 
            // 初始化位置
            if (el && !windowInitialized() && !isFullscreen()) {
              requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect();
                setWindowPos({ x: rect.left, y: rect.top });
                setWindowSize({ width: rect.width, height: rect.height });
                setWindowInitialized(true);
              });
            }
          }}
          class={`${styles.batchRemoteModal} ${isFullscreen() ? styles.fullscreen : ''} ${isDragging() ? styles.dragging : ''}`} 
          style={!isFullscreen() && windowInitialized() ? {
            position: 'fixed',
            left: `${windowPos().x}px`,
            top: `${windowPos().y}px`,
            width: windowSize().width > 0 ? `${windowSize().width}px` : undefined,
            height: windowSize().height > 0 ? `${windowSize().height}px` : undefined,
            transform: 'none'
          } : undefined}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* 头部 - 可拖动区域 */}
          <div 
            class={styles.modalHeader} 
            onMouseDown={handleDragStart}
            style={{ cursor: isFullscreen() ? 'default' : 'move' }}
          >
            <h3>批量实时控制</h3>
            <div class={styles.headerButtons}>
              <button 
                class={styles.headerButton} 
                onClick={toggleFullscreen}
                onMouseDown={(e) => e.stopPropagation()}
                title={isFullscreen() ? '退出全页面' : '全页面'}
              >
                {isFullscreen() ? '退出全屏' : '全页面'}
              </button>
              <button class={styles.closeButton} onClick={handleClose} onMouseDown={(e) => e.stopPropagation()} title="关闭">
                <IconXmark size={16} />
              </button>
            </div>
          </div>

          {/* 工具栏 */}
          <div class={styles.toolbar}>
            <div class={styles.toolbarLeft}>
              <button class={styles.toolButton} onClick={handleHomeButton} title="主屏幕">
                🏠
              </button>
              <button class={styles.toolButton} onClick={handleVolumeDown} title="音量-">
                🔉
              </button>
              <button class={styles.toolButton} onClick={handleVolumeUp} title="音量+">
                🔊
              </button>
              <button class={styles.toolButton} onClick={handleLockScreen} title="锁屏">
                🔒
              </button>
              <button class={styles.toolButton} onClick={handlePaste} title="粘贴">
                📋 粘贴
              </button>
              
              <label class={styles.selectAllLabel}>
                <input 
                  type="checkbox" 
                  class="themed-checkbox"
                  checked={isAllSelected()} 
                  onChange={toggleSelectAll}
                />
                全选同步操作
              </label>
            </div>
          </div>

          {/* 参数控制栏 */}
          <div class={styles.controlBar}>
            <div class={styles.sliderGroup}>
              <label>分辨率</label>
              <input 
                type="range" 
                min="0.1" 
                max="1.0" 
                step="0.05"
                value={resolution()}
                onInput={(e) => setResolution(parseFloat(e.currentTarget.value))}
              />
              <span>{resolution().toFixed(2)}x</span>
            </div>
            
            <div class={styles.sliderGroup}>
              <label>FPS</label>
              <input 
                type="range" 
                min="1" 
                max="30" 
                step="1"
                value={frameRate()}
                onInput={(e) => setFrameRate(parseInt(e.currentTarget.value))}
              />
              <span>{frameRate()}</span>
            </div>
            
            <div class={styles.sliderGroup}>
              <label>列数</label>
              <input 
                type="range" 
                min="2" 
                max="8" 
                step="1"
                value={columns()}
                onInput={(e) => setColumns(parseInt(e.currentTarget.value))}
              />
              <span>{columns()}</span>
            </div>
          </div>

          {/* 设备网格 */}
          <div 
            ref={(el) => { gridRef = el; }}
            class={styles.deviceGrid}
            style={{ '--columns': columns() }}
          >
            <For each={cachedDevices()}>
              {(device) => {
                const conn = () => connections().get(device.udid);
                const isChecked = () => checkedDevices().has(device.udid);
                const isConnected = () => conn()?.state === 'connected';
                const hasStream = () => !!conn()?.stream;
                
                return (
                  <div 
                    ref={(el) => setCardRef(device.udid, el)}
                    class={`${styles.deviceCard} ${isChecked() ? styles.checked : ''}`}
                  >
                    {/* 设备头部 */}
                    <div class={styles.deviceHeader}>
                      <span class={styles.deviceName}>{getDeviceName(device)}</span>
                      <div class={styles.deviceControls}>
                        <input 
                          type="checkbox" 
                          class="themed-checkbox"
                          checked={isChecked()} 
                          onChange={() => toggleDeviceCheck(device.udid)}
                        />
                        <span class={`${styles.statusDot} ${isConnected() ? styles.connected : ''}`} />
                      </div>
                    </div>
                    
                    {/* 视频区域 */}
                    <div class={styles.videoContainer}>
                      <Show 
                        when={hasStream()} 
                        fallback={
                          <div class={styles.videoPlaceholder}>
                            <Show when={conn()?.state === 'connecting'}>
                              <span>连接中...</span>
                            </Show>
                            <Show when={conn()?.state === 'disconnected'}>
                              <button 
                                class={styles.connectButton}
                                onClick={() => connectDevice(device)}
                              >
                                连接
                              </button>
                            </Show>
                          </div>
                        }
                      >
                        <video
                          ref={(el) => setVideoRef(device.udid, el)}
                          class={styles.deviceVideo}
                          autoplay
                          playsinline
                          muted
                          onMouseDown={(e) => handleDeviceMouseDown(device.udid, e)}
                          onMouseMove={(e) => handleDeviceMouseMove(device.udid, e)}
                          onMouseUp={(e) => handleDeviceMouseUp(device.udid, e)}
                          onMouseLeave={() => handleDeviceMouseLeave(device.udid)}
                          onContextMenu={(e) => handleDeviceContextMenu(device.udid, e)}
                          onTouchStart={(e) => handleDeviceTouchStart(device.udid, e)}
                          onTouchMove={(e) => handleDeviceTouchMove(device.udid, e)}
                          onTouchEnd={(e) => handleDeviceTouchEnd(device.udid, e)}
                          onTouchCancel={(e) => handleDeviceTouchEnd(device.udid, e)}
                        />
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          {/* 调整大小手柄 */}
          <Show when={!isFullscreen()}>
            <div 
              class={styles.resizeHandle}
              onMouseDown={handleResizeStart}
            />
          </Show>
        </div>

        {/* 粘贴模态框 */}
        <Show when={showPasteModal()}>
          <div class={styles.pasteModalOverlay} onClick={() => setShowPasteModal(false)}>
            <div class={styles.pasteModal} onClick={(e) => e.stopPropagation()}>
              <h4>粘贴文本到选中设备</h4>
              <textarea
                class={styles.pasteTextarea}
                placeholder="输入要粘贴的文本..."
                value={pasteText()}
                onInput={(e) => setPasteText(e.currentTarget.value)}
                rows={5}
              />
              <div class={styles.pasteActions}>
                <button class={styles.pasteCancel} onClick={() => setShowPasteModal(false)}>
                  取消
                </button>
                <button 
                  class={styles.pasteSend} 
                  onClick={sendPasteToDevices}
                  disabled={!pasteText()}
                >
                  发送到 {getCheckedDevicesList().length} 台设备
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
