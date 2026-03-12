import { createSignal, For, Show, onCleanup, createEffect, onMount, createMemo } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { CgMaximizeAlt, CgMinimizeAlt } from 'solid-icons/cg';
import { IconXmark, IconHouse, IconVolumeDecrease, IconVolumeIncrease, IconLock, IconPaste, IconGear } from '../icons';
import styles from './BatchRemoteControl.module.css';
import { WebRTCService, type WebRTCStartOptions } from '../services/WebRTCService';
import type { Device } from '../services/AuthService';
import type { WebSocketService } from '../services/WebSocketService';
import { MultiTouchSessionManager, type TouchPoint } from '../utils/multiTouchSession';
import { debugLog, debugWarn } from '../utils/debugLogger';
import {
  canHandleRemoteWheel,
  createRemoteWheelBatcher,
  normalizeRemoteWheelSettings,
  normalizeWheelDeltaY,
  parseRemoteWheelSetting,
  type RemoteWheelSettings,
} from '../utils/remoteWheel';

export interface BatchRemoteControlProps {
  isOpen: boolean;
  onClose: () => void;
  devices: Device[];           // 传入的设备列表
  webSocketService: WebSocketService | null;
  password: string;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface ConnectionViewState {
  state: ConnectionState;
  hasStream: boolean;
}

interface BatchRemoteSettings {
  windowPos?: { x: number; y: number };
  windowSize?: { width: number; height: number };
  resolution?: number;
  frameRate?: number;
  columns?: number;
  wheel?: Partial<RemoteWheelSettings>;
}

function createDisconnectedViewState(): ConnectionViewState {
  return {
    state: 'disconnected',
    hasStream: false
  };
}

function createConnectionStateMap(devices: Device[]): Record<string, ConnectionViewState> {
  const next: Record<string, ConnectionViewState> = {};
  for (const device of devices) {
    next[device.udid] = createDisconnectedViewState();
  }
  return next;
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
  const MOBILE_MAX_COLUMNS = 4;
  const DESKTOP_MAX_COLUMNS = 8;
  const VIEWPORT_MOBILE_BREAKPOINT = 768;
  const COMPACT_PANEL_BREAKPOINT = 700;
  const currentIsOpen = createMemo(() => props.isOpen);
  const currentDevices = createMemo(() => props.devices);
  const currentWebSocketService = createMemo(() => props.webSocketService);
  const currentPassword = createMemo(() => props.password);
  const [connectionStates, setConnectionStates] = createStore<Record<string, ConnectionViewState>>({});
  const serviceByUdid = new Map<string, WebRTCService>();
  const streamByUdid = new Map<string, MediaStream>();
  const videoRefByUdid = new Map<string, HTMLVideoElement>();
  const lastAppliedResolutionByUdid = new Map<string, number>();
  
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
  
  // 全屏模式（仅用于桌面端手动切换）
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [isViewportMobile, setIsViewportMobile] = createSignal(window.innerWidth <= VIEWPORT_MOBILE_BREAKPOINT);
  
  const STORAGE_KEY = 'batchRemoteControl';
  const clampColumns = (value: number, max: number = DESKTOP_MAX_COLUMNS) => Math.max(2, Math.min(max, value));

  const loadSettings = (): BatchRemoteSettings | null => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved) as BatchRemoteSettings;
      }
    } catch (e) {
      console.error('[BatchRemote] Failed to load settings:', e);
    }
    return null;
  };
  
  const savedSettings = loadSettings() || {};
  const savedWheelSettings = normalizeRemoteWheelSettings(savedSettings?.wheel);
  let persistedSettings: BatchRemoteSettings = { ...savedSettings };
  const initialPanelWidth = savedSettings?.windowSize?.width ?? Math.round(window.innerWidth * 0.95);
  const [panelWidth, setPanelWidth] = createSignal(initialPanelWidth);
  const isCompactPanel = createMemo(() => !isViewportMobile() && !isFullscreen() && panelWidth() < COMPACT_PANEL_BREAKPOINT);
  const usesSidebarLayout = createMemo(() => isViewportMobile() || isCompactPanel());
  const getLayoutMaxColumns = () => (usesSidebarLayout() ? MOBILE_MAX_COLUMNS : DESKTOP_MAX_COLUMNS);
  const deviceByUdid = createMemo(() => new Map(cachedDevices().map((device) => [device.udid, device])));

  const saveSettings = (settings: Partial<BatchRemoteSettings>) => {
    try {
      persistedSettings = { ...persistedSettings, ...settings };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedSettings));
    } catch (e) {
      console.error('[BatchRemote] Failed to save settings:', e);
    }
  };

  // 窗口位置和尺寸（用于拖动和调整大小）
  const [windowPos, setWindowPos] = createSignal(savedSettings?.windowPos || { x: 0, y: 0 });
  const [windowSize, setWindowSize] = createSignal(savedSettings?.windowSize || { width: 0, height: 0 });
  const [windowInitialized, setWindowInitialized] = createSignal(!!savedSettings?.windowSize?.width);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isResizing, setIsResizing] = createSignal(false);
  let dragOffset = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, width: 0, height: 0 };
  let panelRef: HTMLDivElement | null = null;
  let panelResizeObserver: ResizeObserver | null = null;
  let panelUpdateRafId: number | null = null;
  let pendingWindowPos: { x: number; y: number } | null = null;
  let pendingWindowSize: { width: number; height: number } | null = null;
  
  const initialResolution = savedSettings?.resolution ?? 0.2;
  const initialFrameRate = savedSettings?.frameRate ?? 10;
  const initialColumnPreference = clampColumns(savedSettings?.columns ?? 4, DESKTOP_MAX_COLUMNS);
  const [columnPreference, setColumnPreference] = createSignal(initialColumnPreference);
  const [resolutionDraft, setResolutionDraft] = createSignal(initialResolution);
  const [appliedResolution, setAppliedResolution] = createSignal(initialResolution);
  const [frameRateDraft, setFrameRateDraft] = createSignal(initialFrameRate);
  const [appliedFrameRate, setAppliedFrameRate] = createSignal(initialFrameRate);
  const [columnsDraft, setColumnsDraft] = createSignal(clampColumns(initialColumnPreference, getLayoutMaxColumns()));
  const appliedColumns = createMemo(() => clampColumns(columnPreference(), getLayoutMaxColumns()));
  const previewColumns = createMemo(() => clampColumns(columnsDraft(), getLayoutMaxColumns()));
  
  // 设备卡片引用和可见性追踪
  const cardRefs = new Map<string, HTMLDivElement>();
  let gridRef: HTMLDivElement | null = null;
  const [visibleDevices, setVisibleDevices] = createSignal<Set<string>>(new Set());
  let intersectionObserver: IntersectionObserver | null = null;
  let isDisconnectingAll = false;
  let scheduledResolutionRefreshId: number | null = null;
  let scheduledIntersectionRefreshId: number | null = null;
  let suppressIntersectionEffects = false;
  const bindFrameByUdid = new Map<string, number>();
  
  // 触控状态
  let mouseActiveDevice: string | null = null;
  let isMouseTouching = false;
  let lastMouseTouchPosition: TouchPoint = { x: 0, y: 0 };
  let mouseMirrorDevices: string[] = [];
  let activeTouchDevice: string | null = null;
  let activeTouchMirrorDevices: string[] = [];
  // 粘贴文本模态框
  const [showPasteModal, setShowPasteModal] = createSignal(false);
  const [pasteText, setPasteText] = createSignal('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const [wheelSettingsOpen, setWheelSettingsOpen] = createSignal(false);
  const [wheelEnabled, setWheelEnabled] = createSignal<boolean>(savedWheelSettings.enabled);
  const [wheelNatural, setWheelNatural] = createSignal<boolean>(savedWheelSettings.natural);
  const [wheelBrakeEnabled, setWheelBrakeEnabled] = createSignal<boolean>(savedWheelSettings.brakeEnabled);
  const [wheelStepPx, setWheelStepPx] = createSignal<number>(savedWheelSettings.stepPx);
  const [wheelCoalesceMs, setWheelCoalesceMs] = createSignal<number>(savedWheelSettings.coalesceMs);
  const [wheelAmp, setWheelAmp] = createSignal<number>(savedWheelSettings.amp);
  const [wheelDurBaseMs, setWheelDurBaseMs] = createSignal<number>(savedWheelSettings.durBaseMs);
  const [wheelReleaseDelayMs, setWheelReleaseDelayMs] = createSignal<number>(savedWheelSettings.releaseDelayMs);
  const [wheelBrakeReversePx, setWheelBrakeReversePx] = createSignal<number>(savedWheelSettings.brakeReversePx);
  let wheelSettingsRef: HTMLDivElement | null = null;
  
  // Move throttling 相关变量
  const MOVE_EPSILON = 0.0015;
  let pendingMouseMove: TouchPoint | null = null;
  let mouseMoveRafId: number | null = null;
  let lastSentMouseMove: TouchPoint | null = null;

  const syncViewportMobile = () => {
    setIsViewportMobile(window.innerWidth <= VIEWPORT_MOBILE_BREAKPOINT);
  };

  const syncPanelWidth = (width?: number) => {
    const nextWidth = width ?? panelRef?.getBoundingClientRect().width ?? windowSize().width ?? initialPanelWidth;
    if (nextWidth > 0 && Math.abs(nextWidth - panelWidth()) >= 0.5) {
      setPanelWidth(nextWidth);
    }
  };

  const isSameNumber = (a: number, b: number, epsilon: number = 0.0001) => Math.abs(a - b) < epsilon;

  const flushQueuedPanelUpdate = () => {
    if (panelUpdateRafId !== null) {
      cancelAnimationFrame(panelUpdateRafId);
      panelUpdateRafId = null;
    }
    if (pendingWindowPos) {
      setWindowPos(pendingWindowPos);
      pendingWindowPos = null;
    }
    if (pendingWindowSize) {
      setWindowSize(pendingWindowSize);
      pendingWindowSize = null;
    }
  };

  const schedulePanelUpdate = (next: { position?: { x: number; y: number }; size?: { width: number; height: number } }) => {
    if (next.position) {
      pendingWindowPos = next.position;
    }
    if (next.size) {
      pendingWindowSize = next.size;
    }
    if (panelUpdateRafId !== null) return;
    panelUpdateRafId = requestAnimationFrame(() => {
      panelUpdateRafId = null;
      if (pendingWindowPos) {
        setWindowPos(pendingWindowPos);
        pendingWindowPos = null;
      }
      if (pendingWindowSize) {
        setWindowSize(pendingWindowSize);
        pendingWindowSize = null;
      }
    });
  };

  function currentWheelSettings(): RemoteWheelSettings {
    return normalizeRemoteWheelSettings({
      enabled: wheelEnabled(),
      natural: wheelNatural(),
      brakeEnabled: wheelBrakeEnabled(),
      stepPx: wheelStepPx(),
      coalesceMs: wheelCoalesceMs(),
      amp: wheelAmp(),
      durBaseMs: wheelDurBaseMs(),
      releaseDelayMs: wheelReleaseDelayMs(),
      brakeReversePx: wheelBrakeReversePx(),
    });
  }

  const getConnectionState = (udid: string): ConnectionViewState => {
    return connectionStates[udid] || createDisconnectedViewState();
  };

  const getService = (udid: string) => serviceByUdid.get(udid) || null;

  const flushSettings = () => {
    saveSettings({
      windowPos: windowPos(),
      windowSize: windowSize(),
      resolution: appliedResolution(),
      frameRate: appliedFrameRate(),
      columns: columnPreference(),
      wheel: currentWheelSettings(),
    });
  };

  createEffect(() => {
    saveSettings({ wheel: currentWheelSettings() });
  });

  createEffect(() => {
    if (usesSidebarLayout()) {
      setWheelSettingsOpen(false);
      return;
    }
    setMobileSidebarOpen(false);
  });

  createEffect((previousColumns?: number) => {
    const nextColumns = appliedColumns();
    if (previousColumns !== undefined && previousColumns !== nextColumns) {
      scheduleResolutionRefresh();
    }
    return nextColumns;
  });

  createEffect(() => {
    if (!wheelSettingsOpen()) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wheelSettingsRef?.contains(target)) return;
      setWheelSettingsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    onCleanup(() => document.removeEventListener('pointerdown', handlePointerDown));
  });

  const bindStreamToVideo = (udid: string) => {
    const video = videoRefByUdid.get(udid);
    if (!video) return;

    const stream = streamByUdid.get(udid) || null;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    if (stream) {
      queueMicrotask(() => {
        video.play().catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') {
            return;
          }
          console.error('[BatchRemote] Video play error:', e);
        });
      });
    }
  };

  const scheduleBindStreamToVideo = (udid: string) => {
    if (bindFrameByUdid.has(udid)) return;
    const rafId = requestAnimationFrame(() => {
      bindFrameByUdid.delete(udid);
      bindStreamToVideo(udid);
    });
    bindFrameByUdid.set(udid, rafId);
  };

  const setDeviceStream = (udid: string, stream: MediaStream | null) => {
    if (stream) {
      streamByUdid.set(udid, stream);
    } else {
      streamByUdid.delete(udid);
    }
    setConnectionStates(udid, {
      ...getConnectionState(udid),
      hasStream: !!stream
    });
    scheduleBindStreamToVideo(udid);
  };

  const setVideoRef = (udid: string, el: HTMLVideoElement | null) => {
    const existing = videoRefByUdid.get(udid);
    if (existing && existing !== el && existing.srcObject) {
      existing.srcObject = null;
    }

    if (el) {
      videoRefByUdid.set(udid, el);
      scheduleBindStreamToVideo(udid);
      return;
    }

    if (existing) {
      existing.srcObject = null;
    }
    videoRefByUdid.delete(udid);
  };

  const clearDeviceRuntime = (udid: string, expectedService?: WebRTCService) => {
    const currentService = serviceByUdid.get(udid);
    if (expectedService && currentService && currentService !== expectedService) {
      return;
    }

    if (currentService && (!expectedService || currentService === expectedService)) {
      currentService.cleanup();
    }

    serviceByUdid.delete(udid);
    lastAppliedResolutionByUdid.delete(udid);
    const pendingBind = bindFrameByUdid.get(udid);
    if (pendingBind !== undefined) {
      cancelAnimationFrame(pendingBind);
      bindFrameByUdid.delete(udid);
    }
    setDeviceStream(udid, null);
    setConnectionStates(udid, createDisconnectedViewState());
  };

  const getPanelWidthForResolution = () => {
    if (gridRef?.clientWidth) {
      return gridRef.clientWidth;
    }
    if (panelRef?.clientWidth) {
      return panelRef.clientWidth;
    }
    if (windowInitialized() && windowSize().width > 0) {
      return windowSize().width;
    }
    return isFullscreen() || isViewportMobile() ? window.innerWidth : window.innerWidth * 0.9;
  };

  const calculateOptimalResolution = (device: Device, maxScale: number = appliedResolution(), columnCount: number = appliedColumns()): number => {
    let nativeW = device.width || 1170;
    let nativeH = device.height || 2532;

    if (nativeW > nativeH) {
      const tmp = nativeW;
      nativeW = nativeH;
      nativeH = tmp;
    }

    const GRID_GAP = 12;
    const GRID_PADDING = 16;
    const cols = Math.max(1, columnCount);
    const panelWidth = getPanelWidthForResolution();
    const availableWidth = panelWidth - (GRID_PADDING * 2) - (GRID_GAP * (cols - 1));
    const cardWidth = Math.max(1, availableWidth / cols);
    const containerWidth = cardWidth;
    const containerHeight = containerWidth * (16 / 9);

    const deviceAspect = nativeW / nativeH;
    const containerAspect = 9 / 16;

    let displayWidth;
    let displayHeight;
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

    const MAX_PIXELS = 720 * 1280;
    const nativePixels = nativeW * nativeH;
    const pixelLimitScale = Math.floor(Math.sqrt(MAX_PIXELS / nativePixels) * 100) / 100;

    const finalScale = Math.min(maxScale, containerScale, pixelLimitScale);
    return Math.max(0.1, Math.min(1.0, finalScale));
  };

  const applyFrameRateToConnectedDevices = (fps: number) => {
    cachedDevices().forEach((device) => {
      if (getConnectionState(device.udid).state !== 'connected') return;
      const service = getService(device.udid);
      if (!service) return;
      service.setFrameRate(fps).catch(err => {
        console.error(`[BatchRemote] Failed to set FPS for ${device.udid}:`, err);
      });
      debugLog('batch_remote', `[BatchRemote] Device ${device.udid} FPS updated to ${fps}`);
    });
  };

  const applyResolutionToConnectedDevices = () => {
    cachedDevices().forEach((device) => {
      if (getConnectionState(device.udid).state !== 'connected') return;
      const service = getService(device.udid);
      if (!service) return;

      const nextScale = calculateOptimalResolution(device);
      const previousScale = lastAppliedResolutionByUdid.get(device.udid);
      if (previousScale !== undefined && isSameNumber(previousScale, nextScale)) {
        return;
      }

      lastAppliedResolutionByUdid.set(device.udid, nextScale);

      service.setResolution(nextScale).catch(err => {
        console.error(`[BatchRemote] Failed to set resolution for ${device.udid}:`, err);
        if (previousScale === undefined) {
          lastAppliedResolutionByUdid.delete(device.udid);
        } else {
          lastAppliedResolutionByUdid.set(device.udid, previousScale);
        }
      });
      debugLog('batch_remote', `[BatchRemote] Device ${device.udid} resolution updated to ${nextScale.toFixed(3)}`);
    });
  };

  const scheduleResolutionRefresh = () => {
    if (scheduledResolutionRefreshId !== null) return;
    scheduledResolutionRefreshId = requestAnimationFrame(() => {
      scheduledResolutionRefreshId = null;
      applyResolutionToConnectedDevices();
    });
  };

  const commitResolution = () => {
    const next = resolutionDraft();
    if (!isSameNumber(next, appliedResolution())) {
      setAppliedResolution(next);
      applyResolutionToConnectedDevices();
    }
    flushSettings();
  };

  const commitFrameRate = () => {
    const next = frameRateDraft();
    if (next !== appliedFrameRate()) {
      setAppliedFrameRate(next);
      applyFrameRateToConnectedDevices(next);
    }
    flushSettings();
  };

  const commitColumns = () => {
    const next = previewColumns();
    if (next !== columnsDraft()) {
      setColumnsDraft(next);
    }
    if (next !== columnPreference()) {
      setColumnPreference(next);
    }
    flushSettings();
  };

  const scheduleIntersectionRefresh = () => {
    if (scheduledIntersectionRefreshId !== null) return;
    scheduledIntersectionRefreshId = requestAnimationFrame(() => {
      scheduledIntersectionRefreshId = null;
      if (!currentIsOpen() || !gridRef) return;
      setupIntersectionObserver();
    });
  };

  const handleConnectButton = async (device: Device) => {
    await connectDevice(device);
  };
  
  // 初始化 IntersectionObserver
  const setupIntersectionObserver = () => {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }
    if (!gridRef) return;
    
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (suppressIntersectionEffects) return;

        const nextVisible = new Set(visibleDevices());
        const becameVisible: string[] = [];
        const becameHidden: string[] = [];
        let hasChanges = false;

        entries.forEach(entry => {
          const udid = entry.target.getAttribute('data-udid');
          if (!udid) return;
          
          const wasVisible = nextVisible.has(udid);
          const isVisible = entry.isIntersecting;
          
          if (isVisible !== wasVisible) {
            if (isVisible) {
              nextVisible.add(udid);
              becameVisible.push(udid);
            } else {
              nextVisible.delete(udid);
              becameHidden.push(udid);
            }
            hasChanges = true;
          }
        });

        if (!hasChanges) return;

        setVisibleDevices(nextVisible);

        becameVisible.forEach((udid) => {
          const device = deviceByUdid().get(udid);
          if (!device) return;
          const currentState = getConnectionState(udid);
          if (!getService(udid) || currentState.state === 'disconnected') {
            debugLog('batch_remote', `[BatchRemote] Device ${udid} visible, reconnecting...`);
            connectDevice(device);
          }
        });

        becameHidden.forEach((udid) => {
          if (getService(udid) && getConnectionState(udid).state === 'connected') {
            debugLog('batch_remote', `[BatchRemote] Device ${udid} hidden, disconnecting...`);
            disconnectDevice(udid);
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
    if (isFullscreen() || isViewportMobile()) return;
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
    schedulePanelUpdate({ position: { x, y } });
  };

  const handleDragEnd = () => {
    flushQueuedPanelUpdate();
    setIsDragging(false);
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    flushSettings();
  };

  // 页面调整大小时，优先推面板位置，再缩小面板尺寸
  createEffect(() => {
    const handleWindowResize = () => {
      if (isFullscreen() || isViewportMobile() || !windowInitialized()) return;
      
      const pos = windowPos();
      const size = windowSize();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      
      // 最小尺寸限制
      const MIN_WIDTH = 400;
      const MIN_HEIGHT = 300;
      
      let newX = pos.x;
      let newY = pos.y;
      let newWidth = size.width;
      let newHeight = size.height;
      
      // 1. 如果面板右边超出视口，先向左推
      if (newX + newWidth > viewportW) {
        newX = Math.max(0, viewportW - newWidth);
      }
      
      // 2. 如果面板底部超出视口，先向上推
      if (newY + newHeight > viewportH) {
        newY = Math.max(0, viewportH - newHeight);
      }
      
      // 3. 如果推到 0 还是放不下，则缩小面板宽度
      if (newWidth > viewportW) {
        newWidth = Math.max(MIN_WIDTH, viewportW);
        newX = 0;
      }
      
      // 4. 如果推到 0 还是放不下，则缩小面板高度
      if (newHeight > viewportH) {
        newHeight = Math.max(MIN_HEIGHT, viewportH);
        newY = 0;
      }
      
      // 应用变更
      if (newX !== pos.x || newY !== pos.y) {
        setWindowPos({ x: newX, y: newY });
      }
      if (newWidth !== size.width || newHeight !== size.height) {
        setWindowSize({ width: newWidth, height: newHeight });
      }

      if (newX !== pos.x || newY !== pos.y || newWidth !== size.width || newHeight !== size.height) {
        scheduleResolutionRefresh();
        flushSettings();
      }
    };
    
    window.addEventListener('resize', handleWindowResize);
    onCleanup(() => window.removeEventListener('resize', handleWindowResize));
  });

  // 调整大小处理
  const handleResizeStart = (e: MouseEvent) => {
    if (isFullscreen() || isViewportMobile()) return;
    e.preventDefault();
    e.stopPropagation();
    const size = windowSize();
    resizeStart = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };
    suppressIntersectionEffects = true;
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
    schedulePanelUpdate({ size: { width: newWidth, height: newHeight } });
  };

  const handleResizeEnd = () => {
    flushQueuedPanelUpdate();
    suppressIntersectionEffects = false;
    setIsResizing(false);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    scheduleResolutionRefresh();
    scheduleIntersectionRefresh();
    flushSettings();
  };
  // 获取当前选中的设备列表 (被勾选的)
  const getCheckedDevicesList = (): string[] => {
    return [...checkedDevices()];
  };
  
  // 获取其他被勾选的设备（排除当前操作的设备）
  const getOtherCheckedDevices = (currentUdid: string): string[] => {
    return [...checkedDevices()].filter(udid => udid !== currentUdid);
  };

  const resolveWheelTargets = (sourceUdid: string): string[] => {
    const checked = checkedDevices();
    if (!checked.size || !checked.has(sourceUdid)) {
      return [sourceUdid];
    }
    return [sourceUdid, ...getOtherCheckedDevices(sourceUdid)];
  };

  // 将设备按可用控制通道拆分，避免同一个动作重复发送
  const splitDevicesByControlChannel = (udids: string[]) => {
    const viaWebRTC: string[] = [];
    const viaWebSocket: string[] = [];

    for (const udid of udids) {
      if (getService(udid) && getConnectionState(udid).state === 'connected') {
        viaWebRTC.push(udid);
      } else {
        viaWebSocket.push(udid);
      }
    }

    return { viaWebRTC, viaWebSocket };
  };

  const clearActiveTouchLock = () => {
    activeTouchDevice = null;
    activeTouchMirrorDevices = [];
  };

  const buildTouchKey = (touch: Touch) => `touch:${touch.identifier}`;

  const sendTouchAction = (
    udid: string,
    action: 'down' | 'move' | 'up',
    coords: TouchPoint,
    fingerId?: number,
    otherDevices: string[] = []
  ) => {
    const service = getService(udid);
    if (service) {
      service.sendTouchCommand(action, coords.x, coords.y, fingerId);
    }

    if (otherDevices.length > 0 && props.webSocketService) {
      if (action === 'down') {
        props.webSocketService.touchDownMultipleNormalized(otherDevices, coords.x, coords.y, fingerId);
      } else if (action === 'move') {
        props.webSocketService.touchMoveMultipleNormalized(otherDevices, coords.x, coords.y, fingerId);
      } else {
        props.webSocketService.touchUpMultipleNormalized(otherDevices, fingerId);
      }
    }
  };

  const sendMouseMove = (coords: TouchPoint) => {
    if (!mouseActiveDevice) return;
    sendTouchAction(mouseActiveDevice, 'move', coords, undefined, mouseMirrorDevices);
  };

  const shouldSkipMouseMove = (coords: TouchPoint) => {
    if (!lastSentMouseMove) return false;
    const dx = coords.x - lastSentMouseMove.x;
    const dy = coords.y - lastSentMouseMove.y;
    return (dx * dx + dy * dy) < MOVE_EPSILON * MOVE_EPSILON;
  };

  const scheduleMouseMoveSend = (coords: TouchPoint) => {
    pendingMouseMove = coords;
    if (mouseMoveRafId !== null) return;
    mouseMoveRafId = requestAnimationFrame(() => {
      mouseMoveRafId = null;
      if (!pendingMouseMove) return;
      const next = pendingMouseMove;
      pendingMouseMove = null;
      if (shouldSkipMouseMove(next)) return;
      sendMouseMove(next);
      lastSentMouseMove = next;
    });
  };

  const flushQueuedMouseMove = () => {
    if (mouseMoveRafId !== null) {
      cancelAnimationFrame(mouseMoveRafId);
      mouseMoveRafId = null;
    }
    if (!pendingMouseMove) return;
    const next = pendingMouseMove;
    pendingMouseMove = null;
    if (shouldSkipMouseMove(next)) return;
    sendMouseMove(next);
    lastSentMouseMove = next;
  };

  const resetMouseMoveState = () => {
    pendingMouseMove = null;
    if (mouseMoveRafId !== null) {
      cancelAnimationFrame(mouseMoveRafId);
      mouseMoveRafId = null;
    }
    lastSentMouseMove = null;
  };

  const wheelBatcher = createRemoteWheelBatcher((payload) => {
    const [sourceUdid, ...mirrorUdids] = payload.targets ?? [];
    if (sourceUdid) {
      const service = getService(sourceUdid);
      if (service && getConnectionState(sourceUdid).state === 'connected') {
        service.sendWheelCommand({
          x: payload.nx,
          y: payload.ny,
          deltaY: payload.deltaY,
          rotateQuarter: payload.rotateQuarter,
          settings: payload.settings,
        });
      }
    }

    if (mirrorUdids.length > 0 && props.webSocketService) {
      props.webSocketService.sendWheelCommandMultipleNormalized(
        mirrorUdids,
        payload.nx,
        payload.ny,
        {
          deltaY: payload.deltaY,
          rotateQuarter: payload.rotateQuarter,
          ...payload.settings,
        }
      );
    }
  });

  const touchSession = new MultiTouchSessionManager(
    {
      onTouchStart: (session) => {
        if (!activeTouchDevice) return;
        sendTouchAction(activeTouchDevice, 'down', session.point, session.fingerId, activeTouchMirrorDevices);
      },
      onTouchMove: (session) => {
        if (!activeTouchDevice) return;
        sendTouchAction(activeTouchDevice, 'move', session.point, session.fingerId, activeTouchMirrorDevices);
      },
      onTouchEnd: (session) => {
        if (!activeTouchDevice) return;
        sendTouchAction(activeTouchDevice, 'up', session.point, session.fingerId, activeTouchMirrorDevices);
      }
    },
    { moveEpsilon: MOVE_EPSILON }
  );

  const resetTouchStateForDevice = (udid?: string) => {
    if (!udid || mouseActiveDevice === udid) {
      isMouseTouching = false;
      mouseActiveDevice = null;
      mouseMirrorDevices = [];
      lastMouseTouchPosition = { x: 0, y: 0 };
      resetMouseMoveState();
    }

    if (!udid || activeTouchDevice === udid) {
      touchSession.reset();
      clearActiveTouchLock();
    }
  };

  // 连接单个设备
  const connectDevice = async (device: Device) => {
    const wsService = currentWebSocketService();
    if (getConnectionState(device.udid).state !== 'disconnected' || !wsService) return;

    setConnectionStates(device.udid, {
      ...getConnectionState(device.udid),
      state: 'connecting'
    });

    const httpPort = getDeviceHttpPort(device);

    const service = new WebRTCService(
      wsService,
      device.udid,
      currentPassword(),
      {
        onConnected: () => {
          if (!currentIsOpen()) return;
          if (serviceByUdid.get(device.udid) !== service) return;
          setConnectionStates(device.udid, {
            ...getConnectionState(device.udid),
            state: 'connected'
          });
          scheduleResolutionRefresh();
        },
        onDisconnected: () => {
          resetTouchStateForDevice(device.udid);
          clearDeviceRuntime(device.udid, service);
        },
        onError: (error) => {
          console.error(`[BatchRemote] Device ${device.udid} error:`, error);
          resetTouchStateForDevice(device.udid);
          clearDeviceRuntime(device.udid, service);
        },
        onTrack: (stream) => {
          if (!currentIsOpen()) return;
          if (serviceByUdid.get(device.udid) !== service) return;
          setDeviceStream(device.udid, stream);
        },
        onClipboard: () => {},
        onClipboardError: () => {}
      },
      httpPort
    );

    try {
      const clampedScale = calculateOptimalResolution(device, appliedResolution(), appliedColumns());
      debugLog('batch_remote', `[BatchRemote] Device ${device.udid} resolution scale: ${clampedScale.toFixed(3)}`);
      
      const options: WebRTCStartOptions = {
        resolution: clampedScale,
        fps: appliedFrameRate(),
        force: true
      };

      serviceByUdid.set(device.udid, service);
      lastAppliedResolutionByUdid.set(device.udid, clampedScale);
      await service.startStream(options);
    } catch (error) {
      console.error(`[BatchRemote] Failed to connect ${device.udid}:`, error);
      clearDeviceRuntime(device.udid, service);
    }
  };

  // 断开单个设备
  const disconnectDevice = async (udid: string) => {
    wheelBatcher.clear();
    const service = getService(udid);
    if (!service) {
      resetTouchStateForDevice(udid);
      clearDeviceRuntime(udid);
      return;
    }

    cleanupTouchState(udid);

    try {
      await service.stopStream();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== 'Service destroyed') {
        debugWarn('batch_remote', `[BatchRemote] Failed to stop stream for ${udid}:`, error);
      }
    }

    clearDeviceRuntime(udid, service);
  };

  // 断开所有设备
  const disconnectAllDevices = async () => {
    if (isDisconnectingAll) return;
    isDisconnectingAll = true;
    wheelBatcher.clear();

    try {
      const activeUdids = cachedDevices()
        .map(device => device.udid)
        .filter(udid => getService(udid) || getConnectionState(udid).state !== 'disconnected' || getConnectionState(udid).hasStream);

      for (const udid of activeUdids) {
        if (getService(udid) || getConnectionState(udid).hasStream) {
          await disconnectDevice(udid);
        }
      }
    } finally {
      isDisconnectingAll = false;
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

  // 触控事件处理
  const handleDeviceMouseDown = (udid: string, event: MouseEvent) => {
    if (event.button !== 0) return;
    if (touchSession.hasActiveTouches() || isMouseTouching) return;
    event.preventDefault();
    wheelBatcher.clear();

    const videoRef = videoRefByUdid.get(udid);
    if (!videoRef) return;

    const coords = convertToDeviceCoordinates(event, videoRef);
    if (!coords) return;

    resetMouseMoveState();
    mouseActiveDevice = udid;
    isMouseTouching = true;
    lastMouseTouchPosition = coords;
    mouseMirrorDevices = checkedDevices().has(udid) ? getOtherCheckedDevices(udid) : [];
    sendTouchAction(udid, 'down', coords, undefined, mouseMirrorDevices);
  };

  const handleDeviceMouseMove = (udid: string, event: MouseEvent) => {
    if (!isMouseTouching || mouseActiveDevice !== udid) return;
    event.preventDefault();

    const videoRef = videoRefByUdid.get(udid);
    if (!videoRef) return;

    const coords = convertToDeviceCoordinates(event, videoRef);
    if (!coords) return;

    lastMouseTouchPosition = coords;
    scheduleMouseMoveSend(coords);
  };

  const handleDeviceMouseUp = (udid: string, event: MouseEvent) => {
    if (!isMouseTouching || mouseActiveDevice !== udid) return;
    event.preventDefault();
    
    flushQueuedMouseMove();

    const videoRef = videoRefByUdid.get(udid);
    const coords = videoRef ? convertToDeviceCoordinates(event, videoRef) : null;
    const finalCoords = coords || lastMouseTouchPosition;

    sendTouchAction(udid, 'up', finalCoords, undefined, mouseMirrorDevices);
    isMouseTouching = false;
    mouseActiveDevice = null;
    mouseMirrorDevices = [];
    resetMouseMoveState();
  };

  const handleDeviceMouseLeave = (udid: string) => {
    if (isMouseTouching && mouseActiveDevice === udid) {
      flushQueuedMouseMove();
      sendTouchAction(udid, 'up', lastMouseTouchPosition, undefined, mouseMirrorDevices);
      isMouseTouching = false;
      mouseActiveDevice = null;
      mouseMirrorDevices = [];
      resetMouseMoveState();
    }
  };

  // 右键 = Home 键 (对所有设备生效，选中设备会同步)
  const handleDeviceContextMenu = (udid: string, event: MouseEvent) => {
    event.preventDefault();

    // 始终对当前设备生效
    const service = getService(udid);
    if (service) {
      service.sendKeyCommand('homebutton', 'press');
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
    if (isMouseTouching) return;
    if (activeTouchDevice && activeTouchDevice !== udid) return;
    event.preventDefault();
    wheelBatcher.clear();

    const videoRef = videoRefByUdid.get(udid);
    if (!videoRef) return;

    const changedTouches = Array.from(event.changedTouches || []);
    for (const touch of changedTouches) {
      const coords = convertToDeviceCoordinates(touch, videoRef);
      if (!coords) continue;

      if (!activeTouchDevice) {
        activeTouchDevice = udid;
        activeTouchMirrorDevices = checkedDevices().has(udid) ? getOtherCheckedDevices(udid) : [];
      }

      const session = touchSession.beginTouch(buildTouchKey(touch), coords);
      if (!session && !touchSession.hasActiveTouches()) {
        clearActiveTouchLock();
      }
    }
  };

  const handleDeviceTouchMove = (udid: string, event: TouchEvent) => {
    event.preventDefault();
    if (!touchSession.hasActiveTouches() || activeTouchDevice !== udid) return;

    const videoRef = videoRefByUdid.get(udid);
    if (!videoRef) return;

    const changedTouches = Array.from(event.changedTouches || []);
    for (const touch of changedTouches) {
      const coords = convertToDeviceCoordinates(touch, videoRef);
      if (!coords) continue;
      touchSession.updateTouch(buildTouchKey(touch), coords);
    }
  };

  const handleDeviceTouchEnd = (udid: string, event: TouchEvent) => {
    event.preventDefault();
    if (activeTouchDevice !== udid) return;

    const videoRef = videoRefByUdid.get(udid);
    const changedTouches = Array.from(event.changedTouches || []);
    for (const touch of changedTouches) {
      const coords = videoRef ? convertToDeviceCoordinates(touch, videoRef) : null;
      touchSession.endTouch(buildTouchKey(touch), coords ?? undefined);
    }

    if (!touchSession.hasActiveTouches()) {
      clearActiveTouchLock();
    }
  };

  const handleDeviceWheel = (udid: string, event: WheelEvent) => {
    if (!getConnectionState(udid).hasStream) return;

    const videoRef = videoRefByUdid.get(udid);
    if (!videoRef) return;

    const settings = currentWheelSettings();
    const deltaY = normalizeWheelDeltaY(
      event.deltaY,
      event.deltaMode,
      event.currentTarget instanceof HTMLVideoElement ? event.currentTarget.clientHeight : videoRef.clientHeight,
    );

    if (!canHandleRemoteWheel({
      enabled: settings.enabled,
      pointerActive: isMouseTouching || touchSession.hasActiveTouches(),
      deltaY,
    })) {
      return;
    }

    const coords = convertToDeviceCoordinates(event, videoRef);
    if (!coords) return;

    const targets = resolveWheelTargets(udid);
    wheelBatcher.schedule({
      targets,
      nx: coords.x,
      ny: coords.y,
      deltaY,
      rotateQuarter: 0,
      settings,
      mergeKey: `${udid}|${targets.join(',')}`,
    });

    event.preventDefault();
    event.stopPropagation();
  };

  // 工具栏操作 - 发送到所有被勾选设备
  const handleHomeButton = () => {
    const checked = getCheckedDevicesList();

    const { viaWebRTC, viaWebSocket } = splitDevicesByControlChannel(checked);

    for (const udid of viaWebRTC) {
      const service = getService(udid);
      if (service) {
        service.sendKeyCommand('homebutton', 'press');
      }
    }

    if (props.webSocketService && viaWebSocket.length > 0) {
      props.webSocketService.pressHomeButtonMultiple(viaWebSocket);
    }
  };

  const handleVolumeUp = () => {
    const checked = getCheckedDevicesList();
    const { viaWebRTC, viaWebSocket } = splitDevicesByControlChannel(checked);

    for (const udid of viaWebRTC) {
      const service = getService(udid);
      if (service) {
        service.sendKeyCommand('volumeup', 'press');
      }
    }
    
    if (props.webSocketService && viaWebSocket.length > 0) {
      props.webSocketService.keyDownMultiple(viaWebSocket, 'VOLUMEUP');
      setTimeout(() => props.webSocketService?.keyUpMultiple(viaWebSocket, 'VOLUMEUP'), 50);
    }
  };

  const handleVolumeDown = () => {
    const checked = getCheckedDevicesList();
    const { viaWebRTC, viaWebSocket } = splitDevicesByControlChannel(checked);

    for (const udid of viaWebRTC) {
      const service = getService(udid);
      if (service) {
        service.sendKeyCommand('volumedown', 'press');
      }
    }
    
    if (props.webSocketService && viaWebSocket.length > 0) {
      props.webSocketService.keyDownMultiple(viaWebSocket, 'VOLUMEDOWN');
      setTimeout(() => props.webSocketService?.keyUpMultiple(viaWebSocket, 'VOLUMEDOWN'), 50);
    }
  };

  const handleLockScreen = () => {
    const checked = getCheckedDevicesList();
    const { viaWebRTC, viaWebSocket } = splitDevicesByControlChannel(checked);

    for (const udid of viaWebRTC) {
      const service = getService(udid);
      if (service) {
        service.sendKeyCommand('lock', 'press');
      }
    }
    
    if (props.webSocketService && viaWebSocket.length > 0) {
      props.webSocketService.keyDownMultiple(viaWebSocket, 'LOCK');
      setTimeout(() => props.webSocketService?.keyUpMultiple(viaWebSocket, 'LOCK'), 50);
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
      const service = getService(udid);
      if (service) {
        service.sendPasteCommand(text);
      }
    }

    setShowPasteModal(false);
    setPasteText('');
  };

  // 全屏切换
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen());
    scheduleResolutionRefresh();
    flushSettings();
  };

  // 关闭面板
  const handleClose = () => {
    setVisibleDevices(new Set());
    setMobileSidebarOpen(false);
    setWheelSettingsOpen(false);
    wheelBatcher.clear();
    flushSettings();
    cleanupTouchState();
    disconnectAllDevices();
    props.onClose();
  };

  // 跟踪是否已初始化，防止重复连接
  let hasInitialized = false;

  // 当面板打开时初始化并连接
  createEffect(() => {
    const isOpen = currentIsOpen();
    const devices = currentDevices();
    
    if (isOpen && devices.length > 0 && !hasInitialized) {
      hasInitialized = true;
      // 缓存设备列表（仅在初始化时设置一次）
      setCachedDevices([...devices]);
      setConnectionStates(reconcile(createConnectionStateMap(devices)));
      // 默认不勾选任何设备
      setCheckedDevices(new Set<string>());
      // 每次打开都重置可见集合，避免继承上一次状态
      setVisibleDevices(new Set<string>());
      serviceByUdid.clear();
      streamByUdid.clear();
      videoRefByUdid.clear();
      lastAppliedResolutionByUdid.clear();
      
      // 延迟初始化可见性观察器，由可见性驱动连接
      setTimeout(() => {
        setupIntersectionObserver();
      }, 100);
    } else if (!isOpen && hasInitialized) {
      setMobileSidebarOpen(false);
      wheelBatcher.clear();
      flushSettings();
      cleanupTouchState();
      disconnectAllDevices();
      // 面板关闭时重置标记和缓存
      hasInitialized = false;
      setCachedDevices([]);
      setCheckedDevices(new Set<string>());
      setVisibleDevices(new Set<string>());
      setMobileSidebarOpen(false);
      setWheelSettingsOpen(false);
      setConnectionStates(reconcile({}));
      videoRefByUdid.clear();
      suppressIntersectionEffects = false;
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
    }
  });

  // 确保触控状态正确清理的函数
  const cleanupTouchState = (udid?: string) => {
    wheelBatcher.clear();
    if ((!udid || mouseActiveDevice === udid) && isMouseTouching && mouseActiveDevice) {
      flushQueuedMouseMove();
      sendTouchAction(mouseActiveDevice, 'up', lastMouseTouchPosition, undefined, mouseMirrorDevices);
      isMouseTouching = false;
      mouseActiveDevice = null;
      mouseMirrorDevices = [];
      resetMouseMoveState();
    }

    if ((!udid || activeTouchDevice === udid) && activeTouchDevice && touchSession.hasActiveTouches()) {
      touchSession.releaseAll();
      clearActiveTouchLock();
    }
  };

  // 清理资源
  onCleanup(() => {
    // 断开 IntersectionObserver
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    bindFrameByUdid.forEach((rafId) => cancelAnimationFrame(rafId));
    bindFrameByUdid.clear();
    flushQueuedPanelUpdate();
    if (scheduledResolutionRefreshId !== null) {
      cancelAnimationFrame(scheduledResolutionRefreshId);
      scheduledResolutionRefreshId = null;
    }
    if (scheduledIntersectionRefreshId !== null) {
      cancelAnimationFrame(scheduledIntersectionRefreshId);
      scheduledIntersectionRefreshId = null;
    }
    wheelBatcher.clear();
    setMobileSidebarOpen(false);
    // 确保发送 touch.up
    cleanupTouchState();
    disconnectAllDevices();
  });

  // 特殊按键映射 - 使用 e.code (物理键码) 而不是 e.key (字符)
  // 这样 Shift+2 会发送 Shift 和 "2"，量而不是发送 "@"
  const codeMapping: Record<string, string> = {
    // 功能键
    'Enter': 'RETURN',
    'NumpadEnter': 'RETURN',
    'Escape': 'ESCAPE',
    'Backspace': 'BACKSPACE',
    'Tab': 'TAB',
    'Space': 'SPACE',
    'Delete': 'DELETE',
    // 方向键
    'ArrowUp': 'UP',
    'ArrowDown': 'DOWN',
    'ArrowLeft': 'LEFT',
    'ArrowRight': 'RIGHT',
    // 导航键
    'Home': 'HOMEBUTTON',
    'End': 'END',
    'PageUp': 'PAGEUP',
    'PageDown': 'PAGEDOWN',
    // 修饰键
    'ControlLeft': 'COMMAND',
    'ControlRight': 'COMMAND',
    'MetaLeft': 'COMMAND',
    'MetaRight': 'COMMAND',
    'AltLeft': 'OPTION',
    'AltRight': 'OPTION',
    'ShiftLeft': 'SHIFT',
    'ShiftRight': 'SHIFT',
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
    'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5',
    'F6': 'F6', 'F7': 'F7', 'F8': 'F8', 'F9': 'F9', 'F10': 'F10',
    'F11': 'F11', 'F12': 'F12'
  };

  // 从 e.code 提取按键名称 (设备端需要的格式)
  const getKeyFromCode = (code: string): string | null => {
    // 优先使用映射表
    if (codeMapping[code]) {
      return codeMapping[code];
    }
    // 字母键: KeyA -> a, KeyB -> b, ... -> 设备端需要 A, B, ...
    if (code.startsWith('Key') && code.length === 4) {
      return code[3].toUpperCase();
    }
    return null;
  };

  // 键盘事件处理
  const handleKeyDown = (e: KeyboardEvent) => {
    // 检查是否在输入文本
    const isTextInput = e.target instanceof HTMLTextAreaElement || 
      (e.target instanceof HTMLInputElement && ['text', 'password', 'number', 'email', 'search', 'tel', 'url'].includes(e.target.type));

    if (isTextInput) {
      // 只有 Escape 键在这种情况下需要关闭模态框
      if (e.key === 'Escape' && showPasteModal()) {
        setShowPasteModal(false);
      }
      return;
    }

    // ESC 键关闭面板
    if (e.key === 'Escape') {
      if (props.isOpen) {
        handleClose();
      }
      return;
    }

    // 如果面板没打开或者没选中设备，不产生作用
    if (!props.isOpen || checkedDevices().size === 0) return;

    const deviceKey = getKeyFromCode(e.code);
    if (!deviceKey) return;

    // 组织默认行为（例如方向键滚动页面）
    e.preventDefault();

    const checked = getCheckedDevicesList();
    const { viaWebRTC, viaWebSocket } = splitDevicesByControlChannel(checked);

    // 发送到已连接 WebRTC 的设备
    for (const udid of viaWebRTC) {
      const service = getService(udid);
      if (service && getConnectionState(udid).state === 'connected') {
        service.sendKeyCommand(deviceKey, 'down');
      }
    }

    // 通过 WebSocket 同步到未走 WebRTC 的设备
    if (props.webSocketService && viaWebSocket.length > 0) {
      props.webSocketService.keyDownMultiple(viaWebSocket, deviceKey);
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    const isTextInput = e.target instanceof HTMLTextAreaElement || 
      (e.target instanceof HTMLInputElement && ['text', 'password', 'number', 'email', 'search', 'tel', 'url'].includes(e.target.type));
    
    if (isTextInput) return;
    if (!props.isOpen || checkedDevices().size === 0) return;

    const deviceKey = getKeyFromCode(e.code);
    if (!deviceKey) return;

    e.preventDefault();

    const checked = getCheckedDevicesList();
    const { viaWebRTC, viaWebSocket } = splitDevicesByControlChannel(checked);
    for (const udid of viaWebRTC) {
      const service = getService(udid);
      if (service && getConnectionState(udid).state === 'connected') {
        service.sendKeyCommand(deviceKey, 'up');
      }
    }

    if (props.webSocketService && viaWebSocket.length > 0) {
      props.webSocketService.keyUpMultiple(viaWebSocket, deviceKey);
    }
  };

  onMount(() => {
    syncViewportMobile();
    window.addEventListener('resize', syncViewportMobile);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
  });

  onCleanup(() => {
    panelResizeObserver?.disconnect();
    panelResizeObserver = null;
    window.removeEventListener('resize', syncViewportMobile);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  });

  const renderWheelSettingsContent = () => (
    <>
      <div class={styles.wheelSettingsToggles}>
        <label class={styles.wheelToggleItem}>
          <input
            type="checkbox"
            class="themed-checkbox"
            checked={wheelEnabled()}
            onInput={(e) => setWheelEnabled(e.currentTarget.checked)}
          />
          <span>启用滚轮滚动</span>
        </label>
        <label class={styles.wheelToggleItem}>
          <input
            type="checkbox"
            class="themed-checkbox"
            checked={wheelNatural()}
            onInput={(e) => setWheelNatural(e.currentTarget.checked)}
          />
          <span>自然滚动方向</span>
        </label>
        <label class={styles.wheelToggleItem}>
          <input
            type="checkbox"
            class="themed-checkbox"
            checked={wheelBrakeEnabled()}
            onInput={(e) => setWheelBrakeEnabled(e.currentTarget.checked)}
          />
          <span>滚动刹车</span>
        </label>
      </div>

      <div class={styles.wheelSettingsFields}>
        <div class={styles.wheelField}>
          <span class={styles.wheelFieldLabel}>滚动步长</span>
          <div class={styles.wheelFieldRow}>
            <input
              type="range"
              min="5"
              max="240"
              step="1"
              value={wheelStepPx()}
              onInput={(e) => setWheelStepPx(parseRemoteWheelSetting('stepPx', e.currentTarget.value))}
            />
            <span>{Math.round(wheelStepPx())}px</span>
          </div>
        </div>

        <div class={styles.wheelField}>
          <span class={styles.wheelFieldLabel}>合并窗口</span>
          <div class={styles.wheelFieldRow}>
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={wheelCoalesceMs()}
              onInput={(e) => setWheelCoalesceMs(parseRemoteWheelSetting('coalesceMs', e.currentTarget.value))}
            />
            <span>{Math.round(wheelCoalesceMs())}ms</span>
          </div>
        </div>

        <div class={styles.wheelField}>
          <span class={styles.wheelFieldLabel}>滚动加速</span>
          <div class={styles.wheelFieldRow}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={wheelAmp()}
              onInput={(e) => setWheelAmp(parseRemoteWheelSetting('amp', e.currentTarget.value))}
            />
            <span>{wheelAmp().toFixed(2)}</span>
          </div>
        </div>

        <div class={styles.wheelField}>
          <span class={styles.wheelFieldLabel}>基础时长</span>
          <div class={styles.wheelFieldRow}>
            <input
              type="range"
              min="20"
              max="800"
              step="5"
              value={wheelDurBaseMs()}
              onInput={(e) => setWheelDurBaseMs(parseRemoteWheelSetting('durBaseMs', e.currentTarget.value))}
            />
            <span>{Math.round(wheelDurBaseMs())}ms</span>
          </div>
        </div>

        <div class={styles.wheelField}>
          <span class={styles.wheelFieldLabel}>抬起前延迟</span>
          <div class={styles.wheelFieldRow}>
            <input
              type="range"
              min="0"
              max="500"
              step="10"
              value={wheelReleaseDelayMs()}
              onInput={(e) => setWheelReleaseDelayMs(parseRemoteWheelSetting('releaseDelayMs', e.currentTarget.value))}
            />
            <span>{Math.round(wheelReleaseDelayMs())}ms</span>
          </div>
        </div>

        <div class={styles.wheelField}>
          <span class={styles.wheelFieldLabel}>刹车回头像素</span>
          <div class={styles.wheelFieldRow}>
            <input
              type="range"
              min="2"
              max="20"
              step="1"
              disabled={!wheelBrakeEnabled()}
              value={wheelBrakeReversePx()}
              onInput={(e) => setWheelBrakeReversePx(parseRemoteWheelSetting('brakeReversePx', e.currentTarget.value))}
            />
            <span>{Math.round(wheelBrakeReversePx())}px</span>
          </div>
        </div>
      </div>
    </>
  );

  const renderMobileSidebar = () => (
    <>
      <div
        class={`${styles.mobileSidebarBackdrop} ${mobileSidebarOpen() ? styles.mobileSidebarBackdropOpen : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
      />
      <div
        class={`${styles.mobileSidebar} ${mobileSidebarOpen() ? styles.mobileSidebarOpen : ''}`}
        aria-hidden={!mobileSidebarOpen()}
      >
        <div class={styles.mobileSidebarContent}>
          <div class={styles.wheelField}>
            <span class={styles.wheelFieldLabel}>分辨率</span>
            <div class={styles.wheelFieldRow}>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={resolutionDraft()}
                onInput={(e) => setResolutionDraft(parseFloat(e.currentTarget.value))}
                onChange={commitResolution}
              />
              <span>{resolutionDraft().toFixed(2)}x</span>
            </div>
          </div>

          <div class={styles.wheelField}>
            <span class={styles.wheelFieldLabel}>FPS</span>
            <div class={styles.wheelFieldRow}>
              <input
                type="range"
                min="1"
                max="30"
                step="1"
                value={frameRateDraft()}
                onInput={(e) => setFrameRateDraft(parseInt(e.currentTarget.value, 10))}
                onChange={commitFrameRate}
              />
              <span>{frameRateDraft()}</span>
            </div>
          </div>

          <div class={styles.wheelField}>
            <span class={styles.wheelFieldLabel}>列数</span>
            <div class={styles.wheelFieldRow}>
              <input
                type="range"
                min="2"
                max={String(getLayoutMaxColumns())}
                step="1"
                value={previewColumns()}
                onInput={(e) => setColumnsDraft(clampColumns(parseInt(e.currentTarget.value, 10), getLayoutMaxColumns()))}
                onChange={commitColumns}
              />
              <span>{previewColumns()}</span>
            </div>
          </div>

          <div class={styles.mobileSidebarSection}>
            <label class={styles.mobileSidebarSectionLabel}>滚轮设置</label>
            <div class={styles.mobileSidebarWheelPanel}>
              {renderWheelSettingsContent()}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <Show when={props.isOpen}>
      <div 
        class={`${styles.modalOverlay} ${styles.noBackdrop} ${(isFullscreen() || isViewportMobile()) ? styles.fullscreen : ''}`} 
      >
        <div 
          ref={(el) => { 
            panelRef = el;
            syncPanelWidth(el.getBoundingClientRect().width);
            panelResizeObserver?.disconnect();
            panelResizeObserver = new ResizeObserver((entries) => {
              const entry = entries[0];
              syncPanelWidth(entry?.contentRect.width ?? el.getBoundingClientRect().width);
            });
            panelResizeObserver.observe(el);
            // 初始化位置（仅桌面端）
            if (!windowInitialized() && !isFullscreen() && !isViewportMobile()) {
              requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect();
                setWindowPos({ x: rect.left, y: rect.top });
                setWindowSize({ width: rect.width, height: rect.height });
                syncPanelWidth(rect.width);
                setWindowInitialized(true);
              });
            }
          }}
          class={`${styles.batchRemoteModal} ${usesSidebarLayout() ? styles.sidebarLayout : ''} ${(isFullscreen() || isViewportMobile()) ? styles.fullscreen : ''} ${isDragging() ? styles.dragging : ''}`} 
          style={!isFullscreen() && !isViewportMobile() && windowInitialized() ? {
            position: 'fixed',
            left: `${windowPos().x}px`,
            top: `${windowPos().y}px`,
            width: windowSize().width > 0 ? `${windowSize().width}px` : undefined,
            height: windowSize().height > 0 ? `${windowSize().height}px` : undefined,
            transform: 'none'
          } : undefined}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* 头部 - 可拖动区域（仅桌面端非全屏时可拖动） */}
          <div 
            class={styles.modalHeader} 
            onMouseDown={handleDragStart}
            style={{ cursor: (isFullscreen() || isViewportMobile()) ? 'default' : 'move' }}
          >
            <div class={styles.headerTitleGroup}>
              <Show when={usesSidebarLayout()}>
                <button
                  type="button"
                  class={styles.mobileSidebarTrigger}
                  onClick={() => setMobileSidebarOpen(!mobileSidebarOpen())}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="切换侧边栏"
                  aria-label="切换侧边栏"
                >
                  <div class={`${styles.hamburger} ${mobileSidebarOpen() ? styles.hamburgerOpen : ''}`}>
                    <span />
                    <span />
                    <span />
                  </div>
                </button>
              </Show>
              <h3>批量实时控制</h3>
            </div>
            <div class={styles.headerButtons}>
              <button 
                class={styles.fullscreenToggle}
                onClick={toggleFullscreen}
                onMouseDown={(e) => e.stopPropagation()}
                title={isFullscreen() ? '退出全页面' : '全页面'}
                aria-label={isFullscreen() ? '退出全页面' : '全页面'}
              >
                <Show
                  when={isFullscreen()}
                  fallback={<CgMaximizeAlt size={16} />}
                >
                  <CgMinimizeAlt size={16} />
                </Show>
              </button>
              <button class={styles.closeButton} onClick={handleClose} onMouseDown={(e) => e.stopPropagation()} title="关闭">
                <IconXmark size={16} />
              </button>
            </div>
          </div>
          <div class={styles.bodyArea}>
            {/* 工具栏 */}
            <div class={styles.toolbar}>
              <div class={styles.toolbarLeft}>
                <button class={styles.toolButton} onClick={handleHomeButton} title="主屏幕" disabled={checkedDevices().size === 0}>
                  <IconHouse size={14} />
                </button>
                <button class={styles.toolButton} onClick={handleVolumeDown} title="音量-" disabled={checkedDevices().size === 0}>
                  <IconVolumeDecrease size={14} />
                </button>
                <button class={styles.toolButton} onClick={handleVolumeUp} title="音量+" disabled={checkedDevices().size === 0}>
                  <IconVolumeIncrease size={14} />
                </button>
                <button class={styles.toolButton} onClick={handleLockScreen} title="锁屏" disabled={checkedDevices().size === 0}>
                  <IconLock size={14} />
                </button>
                <button class={styles.toolButton} onClick={handlePaste} title="粘贴" disabled={checkedDevices().size === 0}>
                  <IconPaste size={14} /> 粘贴
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

            <Show when={!usesSidebarLayout()}>
              <div class={styles.controlBar}>
                <div class={styles.sliderGroup}>
                  <label>分辨率</label>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1.0" 
                    step="0.05"
                    value={resolutionDraft()}
                    onInput={(e) => setResolutionDraft(parseFloat(e.currentTarget.value))}
                    onChange={commitResolution}
                  />
                  <span>{resolutionDraft().toFixed(2)}x</span>
                </div>
                
                <div class={styles.sliderGroup}>
                  <label>FPS</label>
                  <input 
                    type="range" 
                    min="1" 
                    max="30" 
                    step="1"
                    value={frameRateDraft()}
                    onInput={(e) => setFrameRateDraft(parseInt(e.currentTarget.value, 10))}
                    onChange={commitFrameRate}
                  />
                  <span>{frameRateDraft()}</span>
                </div>
                
                <div class={styles.sliderGroup}>
                  <label>列数</label>
                  <input 
                    type="range" 
                    min="2" 
                    max={String(getLayoutMaxColumns())}
                    step="1"
                    value={previewColumns()}
                    onInput={(e) => setColumnsDraft(clampColumns(parseInt(e.currentTarget.value, 10), getLayoutMaxColumns()))}
                    onChange={commitColumns}
                  />
                  <span>{previewColumns()}</span>
                </div>

                <div class={styles.wheelSettingsSection} ref={(el) => { wheelSettingsRef = el; }}>
                  <button
                    type="button"
                    class={styles.wheelSettingsToggle}
                    title="滚轮设置"
                    aria-label="滚轮设置"
                    onClick={() => setWheelSettingsOpen(!wheelSettingsOpen())}
                  >
                    <IconGear size={14} />
                  </button>

                  <Show when={wheelSettingsOpen()}>
                    <div class={styles.wheelSettingsPopover}>
                      <div class={styles.wheelSettingsPanel}>
                        {renderWheelSettingsContent()}
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={usesSidebarLayout()}>
              {renderMobileSidebar()}
            </Show>

            {/* 设备网格 */}
            <div 
              ref={(el) => { gridRef = el; }}
              class={styles.deviceGrid}
              style={{ '--columns': `${previewColumns()}` }}
            >
              <For each={cachedDevices()}>
                {(device) => {
                  const viewState = () => connectionStates[device.udid];
                  const isChecked = () => checkedDevices().has(device.udid);
                  const isConnected = () => viewState()?.state === 'connected';
                  const hasStream = () => !!viewState()?.hasStream;
                  
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
                              <Show when={viewState()?.state === 'connecting'}>
                                <span>连接中...</span>
                              </Show>
                              <Show when={viewState()?.state === 'disconnected'}>
                                <button 
                                  class={styles.connectButton}
                                  onClick={() => void handleConnectButton(device)}
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
                            onWheel={(e) => handleDeviceWheel(device.udid, e)}
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
          </div>

          {/* 调整大小手柄 */}
          <Show when={!isFullscreen() && !isViewportMobile()}>
            <div 
              class={styles.resizeHandle}
              onMouseDown={handleResizeStart}
            />
          </Show>
        </div>

        {/* 粘贴模态框 */}
        <Show when={showPasteModal()}>
          <div 
            class={`${styles.pasteModalOverlay} ${(isFullscreen() || isViewportMobile()) ? styles.fullscreen : ''}`} 
            onClick={() => setShowPasteModal(false)}
          >
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
