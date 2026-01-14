import { createSignal, For, Show, onCleanup, createEffect, onMount, createMemo } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import styles from './RealTimeControl.module.css';
import ClipboardModal from './ClipboardModal';
import type { Device } from '../services/AuthService';
import type { WebSocketService } from '../services/WebSocketService';

export interface RealTimeControlProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDevices: () => Device[];
  webSocketService: WebSocketService | null;
  currentScreenshot?: () => string;
  onUpdateScreenshot?: (screenshot: string) => void;
  onReadClipboard: () => void;
  onWriteClipboard: (uti: string, data: string) => void;
}

export default function RealTimeControl(props: RealTimeControlProps) {
  const [selectedControlDevice, setSelectedControlDevice] = createSignal<string>('');
  const [currentScreenshot, setCurrentScreenshot] = createSignal<string>('');
  const [screenshotScale, setScreenshotScale] = createSignal(30);
  const [frameRate, setFrameRate] = createSignal(5); // 默认5帧/秒
  
  // Options for Ark-UI Select components
  const scaleOptions = [
    { value: 20, label: '20% (最小)' },
    { value: 30, label: '30% (推荐)' },
    { value: 50, label: '50%' },
    { value: 70, label: '70%' },
    { value: 100, label: '100% (原始大小)' },
  ];
  const scaleOptionsCollection = createMemo(() => 
    createListCollection({ items: scaleOptions.map(o => String(o.value)) })
  );
  
  const frameRateOptions = [
    { value: 1, label: '1 帧/秒 (最慢)' },
    { value: 2, label: '2 帧/秒' },
    { value: 3, label: '3 帧/秒' },
    { value: 5, label: '5 帧/秒 (推荐)' },
    { value: 10, label: '10 帧/秒' },
    { value: 15, label: '15 帧/秒' },
    { value: 20, label: '20 帧/秒' },
    { value: 25, label: '25 帧/秒 (最快)' },
  ];
  const frameRateOptionsCollection = createMemo(() => 
    createListCollection({ items: frameRateOptions.map(o => String(o.value)) })
  );
  const [isCapturingScreen, setIsCapturingScreen] = createSignal(false);
  const [syncControl, setSyncControl] = createSignal(false); // 同步控制开关
  const [showClipboardModal, setShowClipboardModal] = createSignal(false); // 剪贴板模态框状态
  let screenshotInterval: number | undefined;
  let screenshotUnsubscribe: (() => void) | null = null;
  let screenshotService: WebSocketService | null = null;
  
  // 流量控制相关变量
  let pendingRequests = 0; // 待回复的请求数量
  let isInBackoffMode = false; // 是否处于退避模式
  let backoffTimeout: number | undefined; // 退避计时器
  const BACKOFF_DELAY = 2000; // 退避延迟时间（2秒）
  
  // 动态计算最大待回复请求数（当前帧率的两倍）
  const getMaxPendingRequests = () => frameRate() * 2;
  
  // 获取目标设备列表（根据同步控制状态）
  const getTargetDevices = (): string[] => {
    if (syncControl()) {
      // 同步控制开启：返回所有选中设备的UDID
      return props.selectedDevices().map(device => device.udid);
    } else {
      // 同步控制关闭：只返回当前显示设备的UDID
      const currentDevice = selectedControlDevice();
      return currentDevice ? [currentDevice] : [];
    }
  };
  
  // 触控相关状态
  const [isTouching, setIsTouching] = createSignal(false);
  let screenImageRef: HTMLImageElement | undefined;
  let lastTouchPoint: { x: number; y: number } | null = null;

  // 当组件打开时，默认选择第一个设备
  const handleOpen = () => {
    if (props.selectedDevices().length > 0) {
      const firstDevice = props.selectedDevices()[0];
      setSelectedControlDevice(firstDevice.udid);
      setCurrentScreenshot('');
      startScreenCapture(firstDevice.udid);
    }
  };

  // 清理资源函数
  const cleanup = () => {
    setIsCapturingScreen(false);
    setSelectedControlDevice('');
    setCurrentScreenshot('');
    // 清理截图定时器
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
      screenshotInterval = undefined;
    }
    // 清理退避定时器
    if (backoffTimeout) {
      clearTimeout(backoffTimeout);
      backoffTimeout = undefined;
    }
    // 重置状态
    pendingRequests = 0;
    isInBackoffMode = false;
    lastTouchPoint = null;
    if (screenshotUnsubscribe) {
      screenshotUnsubscribe();
      screenshotUnsubscribe = null;
      screenshotService = null;
    }
  };

  // 处理关闭模态框
  const handleClose = () => {
    cleanup();
    props.onClose();
  };

  // 剪贴板内容接收回调
  const [clipboardContentReceiver, setClipboardContentReceiver] = createSignal<((content: string, uti: string) => void) | null>(null);

  // 设置剪贴板内容接收器
  const handleClipboardContentReceived = (receiverFn: (content: string, uti: string) => void) => {
    setClipboardContentReceiver(() => receiverFn);
  };

  // 监听剪贴板响应消息
  createEffect(() => {
    if (props.webSocketService && props.isOpen) {
      const handleMessage = (message: any) => {
        // 处理剪贴板读取响应
        if (message.type === 'pasteboard/read' && message.body && message.udid) {
          const currentDevice = selectedControlDevice();
          // 只处理当前选中设备的剪贴板响应
          if (currentDevice === message.udid) {
            const content = message.body.data || '';
            const uti = message.body.uti || 'public.plain-text';
            
            console.log('收到剪贴板内容:', { udid: message.udid, uti, content });
            
            // 调用剪贴板内容接收器自动填充
            const receiver = clipboardContentReceiver();
            if (receiver) {
              receiver(content, uti);
            }
          }
        }
      };
      
      // 注册消息监听器
      const unsubscribe = props.webSocketService.onMessage(handleMessage);
      
      // 清理函数
      onCleanup(() => {
        unsubscribe();
      });
    }
  });

  // 剪贴板操作包装函数，根据同步控制状态决定操作设备
  const handleReadClipboard = () => {
    if (syncControl()) {
      // 同步控制开启时不允许读取剪贴板
      console.warn('同步控制模式下不支持读取剪贴板');
      return;
    }
    
    // 同步控制关闭：仅操作当前设备
    const currentDevice = selectedControlDevice();
    if (currentDevice && props.webSocketService) {
      props.webSocketService.readClipboard([currentDevice]);
    }
  };

  const handleWriteClipboard = (uti: string, data: string) => {
    if (syncControl()) {
      // 同步控制开启：操作所有选中设备
      const deviceUdids = props.selectedDevices().map(d => d.udid);
      if (deviceUdids.length > 0 && props.webSocketService) {
        props.webSocketService.writeClipboard(deviceUdids, uti, data);
      }
    } else {
      // 同步控制关闭：仅操作当前设备
      const currentDevice = selectedControlDevice();
      if (currentDevice && props.webSocketService) {
        props.webSocketService.writeClipboard([currentDevice], uti, data);
      }
    }
  };

  // 选择控制设备
  const selectControlDevice = (deviceUdid: string) => {
    if (deviceUdid === selectedControlDevice()) return;
    
    console.log(`切换控制设备: ${selectedControlDevice()} -> ${deviceUdid}`);
    
    // 停止当前截图并清理状态
    stopScreenCapture();
    
    // 清空当前截图显示
    setCurrentScreenshot('');
    
    // 清理所有滞留的截图请求状态
    pendingRequests = 0;
    isInBackoffMode = false;
    if (backoffTimeout) {
      clearTimeout(backoffTimeout);
      backoffTimeout = undefined;
    }
    lastTouchPoint = null;
    
    // 设置新的控制设备
    setSelectedControlDevice(deviceUdid);
    
    // 开始新设备的截图
    startScreenCapture(deviceUdid);
  };

  const handleScreenshotMessage = (message: any) => {
    // 处理截图消息
    if (message.type === 'screen/snapshot') {
      const currentSelectedDevice = selectedControlDevice();
      
      // 如果消息来自当前选中的设备
      if (message.udid === currentSelectedDevice && isCapturingScreen() && props.isOpen) {
        // 收到回复，减少待回复请求计数
        if (pendingRequests > 0) {
          pendingRequests--;
          // console.log(`收到当前设备截图回复 (${message.udid})，待回复请求: ${pendingRequests}`);
        }
        
        if (message.error) {
          console.error('屏幕截图失败:', message.error);
        } else if (message.body) {
          // console.log('更新截图显示，设备:', message.udid);
          updateScreenshot(`data:image/png;base64,${message.body}`);
        }
        
        // 如果处于退避模式且待回复请求已降到阈值以下，可以考虑恢复正常请求
        if (isInBackoffMode && pendingRequests <= getMaxPendingRequests()) {
          console.log('退避模式中，待回复请求已降低，等待退避时间结束');
        }
      } else {
        // 丢弃不是当前选中设备的截图消息
        console.log(`丢弃非当前设备的截图消息: ${message.udid} (当前选中: ${currentSelectedDevice})`);
        
        // 如果这是一个滞留的请求回复，也需要减少计数以保持状态一致
        if (pendingRequests > 0) {
          pendingRequests--;
          console.log(`丢弃滞留截图回复，待回复请求: ${pendingRequests}`);
        }
      }
    }
  };

  const ensureScreenshotHandler = () => {
    if (!props.webSocketService) return;
    if (screenshotService === props.webSocketService && screenshotUnsubscribe) return;
    if (screenshotUnsubscribe) {
      screenshotUnsubscribe();
    }
    screenshotService = props.webSocketService;
    screenshotUnsubscribe = props.webSocketService.onMessage(handleScreenshotMessage);
  };

  // 开始截图
  const startScreenCapture = (deviceUdid: string) => {
    if (!deviceUdid || !props.webSocketService) return;
    
    console.log('开始截图，设备:', deviceUdid);
    setIsCapturingScreen(true);
    
    // 确保消息处理器已设置
    ensureScreenshotHandler();
    
    // 重置流量控制状态
    pendingRequests = 0;
    isInBackoffMode = false;
    if (backoffTimeout) {
      clearTimeout(backoffTimeout);
      backoffTimeout = undefined;
    }
    
    // 立即截一次图
    sendScreenshotRequest(deviceUdid);
    
    // 根据帧率设置定时截图间隔
    const intervalMs = Math.round(1000 / frameRate()); // 将帧率转换为毫秒间隔
    console.log(`设置截图间隔: ${intervalMs}ms (${frameRate()}帧/秒)`);
    
    screenshotInterval = window.setInterval(() => {
      if (props.webSocketService && isCapturingScreen() && props.isOpen) {
        // 始终使用当前选中的设备UDID，而不是闭包中的deviceUdid
        const currentDevice = selectedControlDevice();
        if (currentDevice) {
          sendScreenshotRequest(currentDevice);
        }
      }
    }, intervalMs);
  };

  // 智能截图请求函数（包含拥塞控制）
  const sendScreenshotRequest = (deviceUdid: string) => {
    // 如果处于退避模式，跳过此次请求
    if (isInBackoffMode) {
      console.log('处于退避模式，跳过截图请求');
      return;
    }
    
    // 检查是否超过最大待回复请求数
    const maxPending = getMaxPendingRequests();
    if (pendingRequests >= maxPending) {
      console.warn(`待回复请求过多 (${pendingRequests}/${maxPending})，启动退避模式（帧率: ${frameRate()}帧/秒）`);
      isInBackoffMode = true;
      
      // 设置退避计时器
      backoffTimeout = window.setTimeout(() => {
        console.log('退避模式结束，恢复请求');
        isInBackoffMode = false;
        backoffTimeout = undefined;
        
        // 退避结束后，如果仍然有过多待回复请求，继续退避
        const currentMaxPending = getMaxPendingRequests();
        if (pendingRequests >= currentMaxPending) {
          console.log(`退避结束后仍有过多待回复请求 (${pendingRequests}/${currentMaxPending})，继续退避`);
          sendScreenshotRequest(deviceUdid); // 递归调用，会再次触发退避检查
        }
      }, BACKOFF_DELAY);
      
      return;
    }
    
    // 发送截图请求
    if (props.webSocketService) {
      props.webSocketService.takeScreenshot(deviceUdid, screenshotScale());
      pendingRequests++;
      // console.log(`发送截图请求，待回复请求: ${pendingRequests}`);
    }
  };

  // 停止截图
  const stopScreenCapture = () => {
    setIsCapturingScreen(false);
    
    // 清理定时器
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
      screenshotInterval = undefined;
    }
    
    // 清理退避计时器
    if (backoffTimeout) {
      clearTimeout(backoffTimeout);
      backoffTimeout = undefined;
    }
    
    // 重置流量控制状态
    pendingRequests = 0;
    isInBackoffMode = false;
    lastTouchPoint = null;
    
    // 重置触控状态
    setIsTouching(false);
    
    console.log('截图已停止，流量控制状态已重置');
  };

  // 处理缩放变化
  const handleScaleChange = (newScale: number) => {
    setScreenshotScale(newScale);
    // 如果正在截图，重新开始以应用新的缩放比例
    if (isCapturingScreen() && selectedControlDevice()) {
      stopScreenCapture();
      startScreenCapture(selectedControlDevice());
    }
  };

  // 处理帧率变化
  const handleFrameRateChange = (newFrameRate: number) => {
    setFrameRate(newFrameRate);
    console.log(`帧率已更改为: ${newFrameRate}帧/秒`);
    // 如果正在截图，重新开始以应用新的帧率
    if (isCapturingScreen() && selectedControlDevice()) {
      stopScreenCapture();
      startScreenCapture(selectedControlDevice());
    }
  };

  // 坐标转换函数：将鼠标在图像上的位置转换为设备坐标
  const convertToDeviceCoordinates = (event: MouseEvent, imageElement: HTMLImageElement) => {
    const device = props.selectedDevices().find(d => d.udid === selectedControlDevice());
    if (!device || !device.system) {
      console.error('未找到设备信息或设备屏幕信息');
      return null;
    }

    const containerRect = imageElement.getBoundingClientRect();
    const clickX = event.clientX - containerRect.left;
    const clickY = event.clientY - containerRect.top;

    // 获取图像的原始尺寸
    const imageNaturalWidth = imageElement.naturalWidth;
    const imageNaturalHeight = imageElement.naturalHeight;
    
    if (imageNaturalWidth === 0 || imageNaturalHeight === 0) {
      console.error('图像尺寸为0，无法计算坐标');
      return null;
    }

    // 计算图像在容器中的实际显示尺寸和位置（object-fit: contain）
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    const imageAspectRatio = imageNaturalWidth / imageNaturalHeight;
    const containerAspectRatio = containerWidth / containerHeight;

    let displayedImageWidth, displayedImageHeight, imageStartX, imageStartY;

    if (imageAspectRatio > containerAspectRatio) {
      // 图像比容器更宽，以容器宽度为准
      displayedImageWidth = containerWidth;
      displayedImageHeight = containerWidth / imageAspectRatio;
      imageStartX = 0;
      imageStartY = (containerHeight - displayedImageHeight) / 2;
    } else {
      // 图像比容器更高，以容器高度为准
      displayedImageWidth = containerHeight * imageAspectRatio;
      displayedImageHeight = containerHeight;
      imageStartX = (containerWidth - displayedImageWidth) / 2;
      imageStartY = 0;
    }

    // 检查点击是否在图像区域内
    const relativeX = clickX - imageStartX;
    const relativeY = clickY - imageStartY;

    if (relativeX < 0 || relativeX > displayedImageWidth || relativeY < 0 || relativeY > displayedImageHeight) {
      console.log('点击位置在图像区域外，不进行映射');
      return null;
    }

    // 计算点击位置在图像上的比例
    const ratioX = relativeX / displayedImageWidth;
    const ratioY = relativeY / displayedImageHeight;

    // 转换为设备坐标
    const deviceX = ratioX * device.system.scrw;
    const deviceY = ratioY * device.system.scrh;

    return { x: deviceX, y: deviceY, nx: ratioX, ny: ratioY };
  };

  // 鼠标按下事件（仅处理左键）
  const handleMouseDown = (event: MouseEvent) => {
    // 只处理左键（button === 0），忽略右键和中键
    if (event.button !== 0) return;
    
    event.preventDefault();
    if (!props.webSocketService || !screenImageRef) return;

    const coords = convertToDeviceCoordinates(event, screenImageRef);
    if (coords) {
      setIsTouching(true);
      lastTouchPoint = coords;
      // 根据同步控制状态发送到对应设备
      const targetDevices = getTargetDevices();
      props.webSocketService!.touchDownMultipleNormalized(targetDevices, coords.nx, coords.ny);
    }
  };

  // 鼠标移动事件
  const handleMouseMove = (event: MouseEvent) => {
    event.preventDefault();
    if (!isTouching() || !props.webSocketService || !screenImageRef) return;

    const coords = convertToDeviceCoordinates(event, screenImageRef);
    if (coords) {
      lastTouchPoint = coords;
      // 根据同步控制状态发送到对应设备
      const targetDevices = getTargetDevices();
      props.webSocketService!.touchMoveMultipleNormalized(targetDevices, coords.nx, coords.ny);
    }
  };

  // 鼠标抬起事件
  const handleMouseUp = (event: MouseEvent) => {
    event.preventDefault();
    if (!isTouching()) return;
    
    if (props.webSocketService && screenImageRef) {
      const coords = convertToDeviceCoordinates(event, screenImageRef) || lastTouchPoint;
      if (coords) {
        // 根据同步控制状态发送到对应设备
        const targetDevices = getTargetDevices();
        props.webSocketService!.touchUpMultipleNormalized(targetDevices);
      }
    }
    setIsTouching(false);
    lastTouchPoint = null;
  };

  // 鼠标右键事件（模拟Home键）
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault(); // 阻止默认的右键菜单
    
    if (!props.webSocketService || !screenImageRef) return;
    
    // 检查右键点击是否在图像区域内
    const coords = convertToDeviceCoordinates(event, screenImageRef);
    if (coords) {
      // 根据同步控制状态发送到对应设备
      const targetDevices = getTargetDevices();
      props.webSocketService!.pressHomeButtonMultiple(targetDevices);
      // console.log(`右键点击图像区域，模拟Home键发送到 ${targetDevices.length} 台设备: ${targetDevices.join(', ')}`);
    } else {
      console.log('右键点击在图像区域外，不触发Home键');
    }
  };

  // 全局鼠标事件处理（处理拖拽时鼠标移出图像区域的情况）
  const handleGlobalMouseMove = (event: MouseEvent) => {
    if (isTouching() && props.webSocketService && screenImageRef) {
      const coords = convertToDeviceCoordinates(event, screenImageRef);
      if (coords) {
        lastTouchPoint = coords;
        // 根据同步控制状态发送到对应设备
        const targetDevices = getTargetDevices();
        props.webSocketService!.touchMoveMultipleNormalized(targetDevices, coords.nx, coords.ny);
      }
    }
  };

  const handleGlobalMouseUp = (event: MouseEvent) => {
    if (isTouching()) {
      if (props.webSocketService && screenImageRef) {
        const coords = convertToDeviceCoordinates(event, screenImageRef) || lastTouchPoint;
        if (coords) {
          // 根据同步控制状态发送到对应设备
          const targetDevices = getTargetDevices();
          props.webSocketService!.touchUpMultipleNormalized(targetDevices);
        }
      }
      setIsTouching(false);
      lastTouchPoint = null;
    }
  };

  // 设置全局事件监听器
  createEffect(() => {
    if (props.isOpen) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      
      onCleanup(() => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        // 清理触控状态
        if (isTouching() && selectedControlDevice() && props.webSocketService) {
          if (lastTouchPoint) {
            props.webSocketService.touchUp(selectedControlDevice(), lastTouchPoint.x, lastTouchPoint.y);
          } else {
            props.webSocketService.touchUp(selectedControlDevice(), 0, 0);
          }
        }
        setIsTouching(false);
        lastTouchPoint = null;
      });
    }
  });

  // 使用父组件传入的截图状态，或使用本地状态
  const getScreenshot = () => {
    return props.currentScreenshot ? props.currentScreenshot() : currentScreenshot();
  };

  // 更新截图
  const updateScreenshot = (screenshot: string) => {
    if (props.onUpdateScreenshot) {
      props.onUpdateScreenshot(screenshot);
    } else {
      setCurrentScreenshot(screenshot);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showClipboardModal()) {
        setShowClipboardModal(false);
      } else if (props.isOpen) {
        handleClose();
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  // 监听 isOpen 变化
  createEffect(() => {
    if (props.isOpen) {
      handleOpen();
    } else {
      stopScreenCapture();
      setSelectedControlDevice('');
      setCurrentScreenshot('');
    }
  });

  createEffect(() => {
    if (!props.isOpen) return;
    const devices = props.selectedDevices();
    const current = selectedControlDevice();
    const stillSelected = current && devices.some(d => d.udid === current);
    if (!stillSelected) {
      stopScreenCapture();
      const nextDevice = devices[0];
      if (nextDevice) {
        setSelectedControlDevice(nextDevice.udid);
        startScreenCapture(nextDevice.udid);
      } else {
        setSelectedControlDevice('');
        setCurrentScreenshot('');
      }
    }
  });

  createEffect(() => {
    if (!props.isOpen) {
      if (screenshotUnsubscribe) {
        screenshotUnsubscribe();
        screenshotUnsubscribe = null;
        screenshotService = null;
      }
      return;
    }
    if (isCapturingScreen()) {
      ensureScreenshotHandler();
    }
  });

  // 组件卸载时清理
  onCleanup(() => {
    stopScreenCapture();
    if (screenshotUnsubscribe) {
      screenshotUnsubscribe();
      screenshotUnsubscribe = null;
      screenshotService = null;
    }
    window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onClick={handleClose}>
        <div class={styles.realTimeModal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h3>实时控制</h3>
          </div>
          
          <div class={styles.realTimeContent}>
            {/* 左侧设备列表 */}
            <div class={styles.devicePanel}>
              <h4>设备画面</h4>
              <div class={styles.deviceList}>
                <For each={props.selectedDevices()}>
                  {(device) => (
                    <div 
                      class={`${styles.deviceItem} ${selectedControlDevice() === device.udid ? styles.active : ''}`}
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
              
              {/* 缩放控制 */}
              <div class={styles.scaleControl}>
                <label class={styles.inputLabel}>缩放比例:</label>
                <Select.Root
                  collection={scaleOptionsCollection()}
                  value={[String(screenshotScale())]}
                  onValueChange={(e) => {
                    const val = parseInt(e.value[0] ?? '30');
                    handleScaleChange(val);
                  }}
                >
                  <Select.Control>
                    <Select.Trigger class="cbx-select" style={{ 'min-width': '140px' }}>
                      <span>{scaleOptions.find(o => o.value === screenshotScale())?.label || '30% (推荐)'}</span>
                      <span class="dropdown-arrow">▼</span>
                    </Select.Trigger>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner style={{ 'z-index': 10300, width: 'var(--reference-width)' }}>
                      <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                        <Select.ItemGroup>
                          <For each={scaleOptions}>{(option) => (
                            <Select.Item item={String(option.value)} class="cbx-item">
                              <div class="cbx-item-content">
                                <Select.ItemIndicator>✓</Select.ItemIndicator>
                                <Select.ItemText>{option.label}</Select.ItemText>
                              </div>
                            </Select.Item>
                          )}</For>
                        </Select.ItemGroup>
                      </Select.Content>
                    </Select.Positioner>
                  </Portal>
                </Select.Root>
              </div>
              
              {/* 帧率控制 */}
              <div class={styles.scaleControl}>
                <label class={styles.inputLabel}>刷新帧率:</label>
                <Select.Root
                  collection={frameRateOptionsCollection()}
                  value={[String(frameRate())]}
                  onValueChange={(e) => {
                    const val = parseInt(e.value[0] ?? '5');
                    handleFrameRateChange(val);
                  }}
                >
                  <Select.Control>
                    <Select.Trigger class="cbx-select" style={{ 'min-width': '140px' }}>
                      <span>{frameRateOptions.find(o => o.value === frameRate())?.label || '5 帧/秒 (推荐)'}</span>
                      <span class="dropdown-arrow">▼</span>
                    </Select.Trigger>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner style={{ 'z-index': 10300, width: 'var(--reference-width)' }}>
                      <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                        <Select.ItemGroup>
                          <For each={frameRateOptions}>{(option) => (
                            <Select.Item item={String(option.value)} class="cbx-item">
                              <div class="cbx-item-content">
                                <Select.ItemIndicator>✓</Select.ItemIndicator>
                                <Select.ItemText>{option.label}</Select.ItemText>
                              </div>
                            </Select.Item>
                          )}</For>
                        </Select.ItemGroup>
                      </Select.Content>
                    </Select.Positioner>
                  </Portal>
                </Select.Root>
              </div>
              
              {/* 同步控制 */}
              <div class={`${styles.scaleControl} ${styles.syncControlSection}`}>
                <label class={styles.checkboxLabel}>
                  <input 
                    type="checkbox" 
                    class="themed-checkbox"
                    checked={syncControl()}
                    onChange={(e) => setSyncControl(e.target.checked)}
                  />
                  <div class={styles.checkboxContent}>
                    同步控制
                    <div class={styles.checkboxHint}>
                      勾选后操作将同步到所有选中设备
                    </div>
                  </div>
                </label>
              </div>
              
              {/* 剪贴板操作按钮 */}
              <div class={`${styles.scaleControl} ${styles.clipboardSection}`}>
                <button 
                  class={styles.clipboardButton}
                  onClick={() => setShowClipboardModal(true)}
                  disabled={props.selectedDevices().length === 0}
                  title="剪贴板操作"
                >
                  剪贴板操作
                </button>
              </div>
            </div>
            
            {/* 右侧屏幕显示 */}
            <div class={styles.screenPanel}>
              <div class={styles.screenContainer}>
                <Show when={getScreenshot()} fallback={
                  <div class={styles.screenPlaceholder}>
                    <div class={styles.loadingText}>
                      {isCapturingScreen() ? '正在获取屏幕截图...' : '请选择设备开始实时控制'}
                    </div>
                  </div>
                }>
                  <img 
                    ref={screenImageRef}
                    src={getScreenshot()} 
                    alt="设备屏幕" 
                    class={styles.screenImage}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onContextMenu={handleContextMenu}
                    style={{ cursor: isTouching() ? 'grabbing' : 'crosshair', 'user-select': 'none' }}
                    draggable={false}
                  />
                </Show>
              </div>
              
              <div class={styles.screenInfo}>
                <span>当前设备: {props.selectedDevices().find(d => d.udid === selectedControlDevice())?.system?.name || '未选择'}</span>
                <span>状态: {isCapturingScreen() ? '实时更新中' : '已停止'}</span>
              </div>
            </div>
          </div>
          
          <div class={styles.modalActions}>
            <button 
              class={styles.cancelButton}
              onClick={handleClose}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
      
      {/* 剪贴板操作模态框 */}
      <ClipboardModal 
        isOpen={showClipboardModal()}
        onClose={() => setShowClipboardModal(false)}
        onReadClipboard={handleReadClipboard}
        onWriteClipboard={handleWriteClipboard}
        selectedDevicesCount={syncControl() ? props.selectedDevices().length : (selectedControlDevice() ? 1 : 0)}
        isSyncControlEnabled={syncControl()}
        onClipboardContentReceived={handleClipboardContentReceived}
      />
    </Show>
  );
}
