import { Component, createSignal, For, Accessor, Show, createEffect, createMemo } from 'solid-js';
import { Device } from '../services/AuthService';
import { WebSocketService } from '../services/WebSocketService';
import { useTheme } from './ThemeContext';
import { useDialog } from './DialogContext';
import RealTimeControl from './RealTimeControl';
import styles from './DeviceList.module.css';
import DeviceBindingModal from './DeviceBindingModal';
import DictionaryModal from './DictionaryModal';
import { ScriptSelectionModal } from './ScriptSelectionModal';
import ServerFileBrowser from './ServerFileBrowser';
import { IconMoon, IconSun, IconRotate } from '../icons';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';


interface DeviceListProps {
  devices: Device[];
  onDeviceSelect: (devices: Device[]) => void;
  selectedDevices: Accessor<Device[]>;
  onRespring: () => void;
  onRefresh: () => void;
  onStartScript: (scriptName: string) => void;
  onStopScript: () => void;
  onRespringDevices: () => void;
  onUploadFiles: (files: File[], uploadPath: string) => Promise<void>;
  onOpenFileBrowser: (deviceUdid: string, deviceName: string) => void;
  onReadClipboard: () => void;
  onWriteClipboard: (uti: string, data: string) => void;
  webSocketService: WebSocketService | null;
  isLoading: boolean;
  serverHost: string;
  serverPort: string;
}

const DeviceList: Component<DeviceListProps> = (props) => {
  const dialog = useDialog();
  const { theme, toggleTheme } = useTheme();
  const [searchTerm, setSearchTerm] = createSignal('');
  const [forceUpdate, setForceUpdate] = createSignal(0);

  
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = createSignal(false);

  const [showDeviceBindingModal, setShowDeviceBindingModal] = createSignal(false);
  const [showDictionaryModal, setShowDictionaryModal] = createSignal(false);
  const [showRespringConfirm, setShowRespringConfirm] = createSignal(false);
  const [showScriptSelectionModal, setShowScriptSelectionModal] = createSignal(false);
  const [showServerFileBrowser, setShowServerFileBrowser] = createSignal(false);
  const [modalUploadFiles, setModalUploadFiles] = createSignal<File[]>([]);
  const [modalUploadPath, setModalUploadPath] = createSignal('/lua/scripts');
  const [modalIsDragOver, setModalIsDragOver] = createSignal(false);
  let modalFileInputRef: HTMLInputElement | undefined;
  
  // Script control state
  const [scriptName, setScriptName] = createSignal('main.lua');
  

  
  // Real-time control modal state
  const [showRealTimeModal, setShowRealTimeModal] = createSignal(false);
  const [currentScreenshot, setCurrentScreenshot] = createSignal<string>('');
  
  // Toast notification state
  const [toastMessage, setToastMessage] = createSignal('');
  const [showToast, setShowToast] = createSignal(false);
  
  // Sorting state
  const [sortField, setSortField] = createSignal<string>('');
  const [sortDirection, setSortDirection] = createSignal<'asc' | 'desc'>('asc');

  // Selectable scripts state
  const [selectableScripts, setSelectableScripts] = createSignal<string[]>([]);
  const [isLoadingScripts, setIsLoadingScripts] = createSignal(false);
  const [isSendingScript, setIsSendingScript] = createSignal(false);
  const [serverScriptName, setServerScriptName] = createSignal(''); // 独立的服务器脚本选择
  
  // Collection for Select component (reactive)
  const selectableScriptsCollection = createMemo(() => 
    createListCollection({ items: selectableScripts() })
  );

  // Force reactivity tracking
  createEffect(() => {
    props.selectedDevices().length;
    props.selectedDevices().map(d => d.udid);
    setForceUpdate(prev => prev + 1); // Force component update
  });


  // Fetch selectable scripts from server
  const fetchSelectableScripts = async () => {
    if (isLoadingScripts()) return;
    
    setIsLoadingScripts(true);
    try {
      const serverUrl = window.location.origin;
      const response = await fetch(`${serverUrl}/api/scripts/selectable`);
      const data = await response.json();
      
      if (data.scripts) {
        setSelectableScripts(data.scripts);
      }
    } catch (error) {
      console.error('获取可选脚本失败:', error);
    } finally {
      setIsLoadingScripts(false);
    }
  };

  const handleSendAndStartScript = async () => {
    if (!serverScriptName() || props.selectedDevices().length === 0) return;
    
    setIsSendingScript(true);
    try {
      const response = await fetch('/api/scripts/send-and-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          devices: props.selectedDevices().map((d: Device) => d.udid),
          name: serverScriptName(),
        }),
      });
      
      const result = await response.json();
      if (result.success) {
        showToastMessage('脚本已发送并启动');
      } else {
        console.error('发送脚本失败:', result.error);
        showToastMessage('发送脚本失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('发送脚本错误:', error);
      showToastMessage('发送脚本网络错误');
    } finally {
      setIsSendingScript(false);
    }
  };

  // Copy to clipboard function
  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log(`${type} copied to clipboard: ${text}`);
      showToastMessage(`${type} 已复制到剪贴板`);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      try {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        console.log(`${type} copied to clipboard (fallback): ${text}`);
        showToastMessage(`${type} 已复制到剪贴板`);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
        showToastMessage('复制失败，请手动复制');
      }
    }
  };
  
  // Show toast notification
  const showToastMessage = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    
    // Auto hide after 2 seconds
    setTimeout(() => {
      setShowToast(false);
    }, 2000);
  };
  
  // Handle table header click for sorting
  const handleSort = (field: string) => {
    if (sortField() === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new field and default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  // Sort devices based on current sort settings
  const sortDevices = (devices: Device[]) => {
    if (!sortField()) return devices;
    
    return [...devices].sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortField()) {
        case 'name':
          aValue = a.system?.name || '';
          bValue = b.system?.name || '';
          break;
        case 'udid':
          aValue = a.udid || '';
          bValue = b.udid || '';
          break;
        case 'ip':
          aValue = a.system?.ip || '';
          bValue = b.system?.ip || '';
          break;
        case 'version':
          aValue = a.system?.version || '';
          bValue = b.system?.version || '';
          break;
        case 'battery':
          aValue = a.system?.battery || 0;
          bValue = b.system?.battery || 0;
          break;
        case 'running':
          aValue = a.script?.running ? 1 : 0;
          bValue = b.script?.running ? 1 : 0;
          break;
        case 'script':
          aValue = a.script?.select || '';
          bValue = b.script?.select || '';
          break;
        case 'log':
          aValue = a.system?.log || '';
          bValue = b.system?.log || '';
          break;
        default:
          return 0;
      }
      
      // Handle string comparison
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.localeCompare(bValue);
        return sortDirection() === 'asc' ? comparison : -comparison;
      }
      
      // Handle numeric comparison
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        const comparison = aValue - bValue;
        return sortDirection() === 'asc' ? comparison : -comparison;
      }
      
      return 0;
    });
  };

  // // DEBUG: Track when selectedDevices prop changes
  // console.log('DeviceList render - selectedDevices count:', props.selectedDevices().length);
  // console.log('DeviceList render - selectedDevices UDIDs:', props.selectedDevices().map(d => d.udid));
  // console.log('DeviceList render - forceUpdate:', forceUpdate());

  const filteredDevices = () => {
    const term = searchTerm().toLowerCase();
    let devices = props.devices;
    
    // Apply search filter
    if (term) {
      devices = devices.filter(device => 
        device.udid.toLowerCase().includes(term) ||
        (device.system?.name && device.system.name.toLowerCase().includes(term))
      );
    }
    
    // Apply sorting
    return sortDevices(devices);
  };

  const handleDeviceToggle = (device: Device) => {
    const isSelected = props.selectedDevices().some(d => d.udid === device.udid);
    
    console.log(`CLICK: ${device.udid} - currently ${isSelected ? 'SELECTED' : 'NOT SELECTED'}`);
    
    if (isSelected) {
      // 取消选择
      const newSelection = props.selectedDevices().filter(d => d.udid !== device.udid);
      console.log(`DESELECT: ${device.udid} - new count: ${newSelection.length}`);
      props.onDeviceSelect(newSelection);
    } else {
      // 添加到选择
      const newSelection = [...props.selectedDevices(), device];
      console.log(`SELECT: ${device.udid} - new count: ${newSelection.length}`);
      props.onDeviceSelect(newSelection);
    }
  };

  const handleSelectAll = () => {
    const allDevices = filteredDevices();
    const allSelected = allDevices.length > 0 && allDevices.every(device => 
      props.selectedDevices().some(selected => selected.udid === device.udid)
    );
    
    if (allSelected) {
      // 取消全选
      const remainingDevices = props.selectedDevices().filter(device => 
        !allDevices.some(selected => selected.udid === device.udid)
      );
      props.onDeviceSelect(remainingDevices);
    } else {
      // 全选
      const newDevices = allDevices.filter(device => 
        !props.selectedDevices().some(selected => selected.udid === device.udid)
      );
      props.onDeviceSelect([...props.selectedDevices(), ...newDevices]);
    }
  };

  const isAllSelected = () => {
    const allDevices = filteredDevices();
    return allDevices.length > 0 && allDevices.every(device => 
      props.selectedDevices().some(selected => selected.udid === device.udid)
    );
  };

  const isPartiallySelected = () => {
    const allDevices = filteredDevices();
    const selectedCount = allDevices.filter(device => 
      props.selectedDevices().some(selected => selected.udid === device.udid)
    ).length;
    return selectedCount > 0 && selectedCount < allDevices.length;
  };

  const formatDeviceInfo = (device: Device) => {
    if (device.system) {
      return {
        name: device.system.name || '未知设备',
        version: device.system.version || '未知版本',
        battery: Math.round((device.system.battery || 0) * 100), // 转换为 0-100 百分比
        running: device.system.running || false, // 从 device.system 读取运行状态
        paused: device.system.paused || false   // 从 device.system 读取暂停状态
      };
    }
    return {
      name: '未知设备',
      version: '未知版本',
      battery: 0,
      running: false,
      paused: false
    };
  };

  const getBatteryColor = (battery: number) => {
    if (battery > 50) return '#4CAF50';
    if (battery > 20) return '#FF9800';
    return '#F44336';
  };


  

  
  const handleRespringDevices = async () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage('请先选择设备');
      return;
    }
    
    // 显示确认弹窗
    if (await dialog.confirm(`确定要注销选中的 ${props.selectedDevices().length} 台设备吗？`)) {
      handleConfirmRespring();
    }
  };

  const handleConfirmRespring = () => {
    console.log('注销选中设备:', props.selectedDevices().map(d => d.udid));
    props.onRespringDevices();
    setShowRespringConfirm(false);
  };

  const handleCancelRespring = () => {
    setShowRespringConfirm(false);
  };

  // Modal upload functions
  const handleModalDragOver = (e: DragEvent) => {
    e.preventDefault();
    setModalIsDragOver(true);
  };

  const handleModalDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setModalIsDragOver(false);
  };

  const handleModalDrop = (e: DragEvent) => {
    e.preventDefault();
    setModalIsDragOver(false);
    
    const files = Array.from(e.dataTransfer?.files || []);
    setModalUploadFiles(prev => [...prev, ...files]);
  };

  const handleModalFileSelect = (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      const files = Array.from(target.files);
      setModalUploadFiles(prev => [...prev, ...files]);
    }
  };

  const openModalFileDialog = () => {
    if (modalFileInputRef) {
      modalFileInputRef.click();
    }
  };

  const removeModalFile = (index: number) => {
    setModalUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleModalUpload = async () => {
    if (modalUploadFiles().length === 0 || props.selectedDevices().length === 0) {
      return;
    }

    try {
      await props.onUploadFiles(modalUploadFiles(), modalUploadPath());
      showToastMessage('文件上传请求已发送');
      setModalUploadFiles([]);
      setShowUploadModal(false);
    } catch (error) {
      console.error('文件上传失败:', error);
      showToastMessage('文件上传失败');
    }
  };



  // 实时控制操作处理函数
  const handleOpenRealTimeControl = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage('请先选择设备');
      return;
    }
    setShowRealTimeModal(true);
  };

  const handleCloseRealTimeControl = () => {
    setShowRealTimeModal(false);
    setCurrentScreenshot('');
  };
  
  const handleDeviceBinding = () => {
    setShowDeviceBindingModal(true);
  };

  const handleScriptSelection = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage('请先选择设备');
      return;
    }
    setShowScriptSelectionModal(true);
  };

  const handleSelectScript = async (scriptName: string) => {
    if (!props.webSocketService) {
      showToastMessage('WebSocket服务未连接');
      return;
    }

    try {
      const deviceUdids = props.selectedDevices().map(d => d.udid);
      await props.webSocketService.selectScript(deviceUdids, scriptName);
      showToastMessage(`已为 ${deviceUdids.length} 台设备选择脚本: ${scriptName}`);
    } catch (error) {
      console.error('选择脚本失败:', error);
      showToastMessage('选择脚本失败');
    }
  };
  
  const handleModalCancel = () => {
    setModalUploadFiles([]);
    setShowUploadModal(false);
  };

  const handleStartScript = () => {
    const script = scriptName().trim();
    
    if (props.selectedDevices().length === 0) {
      showToastMessage('请先选择设备');
      return;
    }
    
    console.log('启动脚本:', script || '(空脚本名称)', '在选中设备:', props.selectedDevices().map(d => d.udid));
    props.onStartScript(script);
  };
  
  const handleStopScript = () => {
    if (props.selectedDevices().length === 0) {
      console.warn('请先选择要控制的设备');
      return;
    }
    
    console.log('停止脚本在选中设备:', props.selectedDevices().map(d => d.udid));
    props.onStopScript();
  };
  
  const handleCopySelectedUDIDs = () => {
    const selectedDevices = props.selectedDevices();
    if (selectedDevices.length === 0) {
      showToastMessage('请先选择设备');
      return;
    }
    
    const udids = selectedDevices.map(device => device.udid);
    const udidText = udids.join('\n');
    
    copyToClipboard(udidText, `${udids.length}个UDID`);
  };

  // 词典操作处理函数
  const handleDictionaryAccess = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage('请先选择设备');
      return;
    }
    setShowDictionaryModal(true);
  };

  const handleSetProcValue = async (key: string, value: string) => {
    if (!props.webSocketService) {
      showToastMessage('WebSocket服务未连接');
      return;
    }

    const selectedDevices = props.selectedDevices();
    const deviceUdids = selectedDevices.map(device => device.udid);
    
    try {
      await props.webSocketService.setProcValue(deviceUdids, key, value);
      showToastMessage(`已设置词典值 ${key}=${value} 到 ${deviceUdids.length} 台设备`);
      setShowDictionaryModal(false);
    } catch (error) {
      console.error('设置词典值失败:', error);
      showToastMessage('设置词典值失败');
    }
  };

  const handlePushToQueue = async (key: string, value: string) => {
    if (!props.webSocketService) {
      showToastMessage('WebSocket服务未连接');
      return;
    }

    const selectedDevices = props.selectedDevices();
    const deviceUdids = selectedDevices.map(device => device.udid);
    
    try {
      await props.webSocketService.pushToQueue(deviceUdids, key, value);
      showToastMessage(`已推送 ${key}=${value} 到 ${deviceUdids.length} 台设备队列`);
      setShowDictionaryModal(false);
    } catch (error) {
      console.error('推送到队列失败:', error);
      showToastMessage('推送到队列失败');
    }
  };

  return (
    <div class={styles.deviceListContainer}>
      {/* Three Cards Layout */}
      <div class={styles.cardsContainer}>
        {/* Device Management Card */}
        <div class={styles.card}>
          <h2 class={styles.cardTitle}>列表管理</h2>
          <div class={styles.cardContent}>
            <div class={styles.searchContainer}>
              <input
                type="text"
                placeholder="搜索设备 UDID 或名称..."
                value={searchTerm()}
                onInput={(e) => setSearchTerm(e.currentTarget.value)}
                class={styles.searchInput}
              />
            </div>
            
            <div class={styles.deviceCount}>
              共 {props.devices.length} 台设备
              {searchTerm() && ` (显示 ${filteredDevices().length} 台)`}
              <Show when={props.selectedDevices().length > 0}> | 已选择 {props.selectedDevices().length} 台</Show>
            </div>
            
            {/* Action buttons */}
            <div class={styles.buttonGroup}>
              <button 
                onClick={props.onRefresh}
                class={styles.refreshButton}
                disabled={props.isLoading}
              >
                {props.isLoading ? '刷新中...' : '请求刷新'}
              </button>
              <button 
                onClick={handleCopySelectedUDIDs}
                class={styles.copyUdidButton}
                disabled={props.selectedDevices().length === 0}
              >
                复制UDID
              </button>
              <button
                onClick={toggleTheme}
                class={styles.themeToggle}
                title={theme() === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
              >
                <span class={styles.themeIcon}>
                  {theme() === 'light' ? <IconMoon size={14} /> : <IconSun size={14} />}
                </span>
                {theme() === 'light' ? '暗色' : '亮色'}
              </button>
            </div>
          </div>
        </div>
        
        {/* Server Control Card */}
        <div class={styles.card}>
          <h2 class={styles.cardTitle}>服务器相关</h2>
          <div class={styles.cardContent}>
            <div class={styles.buttonGroup}>
              <button 
                onClick={handleDeviceBinding}
                class={styles.compactButton}
              >
                设备绑定到云控
              </button>
              <button 
                onClick={() => setShowServerFileBrowser(true)}
                class={styles.compactButton}
              >
                浏览服务器文件
              </button>
            </div>
            
            <div class={styles.scriptSelectorContainer}>
              <div class={styles.scriptSelectorHeader}>
                <label class={styles.inputLabel}>服务器脚本列表:</label>
                <button 
                  class={styles.iconButton} 
                  onClick={fetchSelectableScripts}
                  disabled={isLoadingScripts()}
                  title="刷新脚本列表"
                >
                  <IconRotate size={14} class={isLoadingScripts() ? styles.spin : ''} />
                </button>
              </div>
              <div class={styles.scriptSelectorRow}>
                <Select.Root
                  collection={selectableScriptsCollection()}
                  value={serverScriptName() ? [serverScriptName()] : []}
                  onValueChange={(e) => {
                    const next = e.value[0] ?? '';
                    setServerScriptName(next);
                  }}
                  onOpenChange={(e) => {
                    if (e.open) fetchSelectableScripts();
                  }}
                >
                  <Select.Control>
                    <Select.Trigger class="cbx-select">
                      <span>{serverScriptName() || '-- 选择脚本 --'}</span>
                      <span class="dropdown-arrow">▼</span>
                    </Select.Trigger>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                      <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                        <Select.ItemGroup>
                          <For each={selectableScripts()}>{(script) => (
                            <Select.Item item={script} class="cbx-item">
                              <div class="cbx-item-content">
                                <Select.ItemIndicator>✓</Select.ItemIndicator>
                                <Select.ItemText>{script}</Select.ItemText>
                              </div>
                            </Select.Item>
                          )}</For>
                        </Select.ItemGroup>
                      </Select.Content>
                    </Select.Positioner>
                  </Portal>
                  <Select.HiddenSelect />
                </Select.Root>
                <button 
                  class={styles.sendStartButton}
                  disabled={!serverScriptName() || props.selectedDevices().length === 0 || isSendingScript()}
                  onClick={handleSendAndStartScript}
                >
                  {isSendingScript() ? '发送中...' : '发送并启动'}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* Script Control Card */}
        <div class={styles.card}>
          <h2 class={styles.cardTitle}>设备相关</h2>
          <div class={styles.cardContent}>
            <div class={styles.inputGroup}>
              <label class={styles.inputLabel}>脚本名称:</label>
              <input
                type="text"
                value={scriptName()}
                onInput={(e) => setScriptName(e.currentTarget.value)}
                class={styles.scriptInput}
              />
            </div>
            
            {/* 第一排按钮：主要操作 */}
            <div class={styles.compactButtonRow}>
              <button 
                onClick={handleStartScript}
                class={styles.compactButton}
                disabled={props.selectedDevices().length === 0}
                title="启动脚本"
              >
                启动脚本
              </button>
              <button 
                onClick={handleStopScript}
                class={styles.compactButton}
                disabled={props.selectedDevices().length === 0}
                title="停止脚本"
              >
                停止脚本
              </button>
              <button 
                onClick={() => setShowUploadModal(true)}
                class={styles.compactButton}
                disabled={props.selectedDevices().length === 0}
                title="上传文件"
              >
                上传文件
              </button>
              <button 
                onClick={handleScriptSelection}
                class={styles.compactButton}
                disabled={props.selectedDevices().length === 0}
                title="脚本选择"
              >
                脚本选择
              </button>
            </div>
            
            {/* 第二排按钮：扩展功能 */}
            <div class={styles.compactButtonRow}>
              <button 
                onClick={handleOpenRealTimeControl}
                class={styles.compactButton}
                disabled={props.selectedDevices().length === 0}
                title="实时控制"
              >
                实时控制
              </button>

              <button 
                onClick={handleDictionaryAccess}
                class={styles.compactButton}
                disabled={props.selectedDevices().length === 0}
                title="词典发送"
              >
                词典发送
              </button>
              <button 
                onClick={handleRespringDevices}
                class={styles.compactButton}
                disabled={props.selectedDevices().length === 0}
                title="注销设备"
              >
                注销设备
              </button>
            </div>
          </div>
        </div>
      </div>

      {props.isLoading && props.devices.length === 0 ? (
        <div class={styles.loadingState}>
          <div class={styles.spinner}></div>
          <p>正在获取设备列表...</p>
        </div>
      ) : filteredDevices().length === 0 ? (
        <div class={styles.emptyState}>
          {searchTerm() ? (
            <>
              <p>未找到匹配的设备</p>
              <button 
                onClick={() => setSearchTerm('')}
                class={styles.clearSearchButton}
              >
                清除搜索
              </button>
            </>
          ) : (
            <p>暂无设备连接</p>
          )}
        </div>
      ) : (
        <div class={styles.deviceTable}>
            <div class={styles.tableHeader}>
              <div class={styles.headerCell}>
                <div 
                  class={`${styles.selectAllCheckbox} ${
                    isAllSelected() ? styles.checked : 
                    isPartiallySelected() ? styles.indeterminate : ''
                  }`}
                  onClick={handleSelectAll}
                >
                  {isAllSelected() ? '✓' : isPartiallySelected() ? '−' : ''}
                </div>
              </div>
              <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('name')}>
                设备名称
                <span class={styles.sortIndicator}>
                  {sortField() === 'name' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </div>
              <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('udid')}>
                UDID
                <span class={styles.sortIndicator}>
                  {sortField() === 'udid' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </div>
              <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('ip')}>
                IP地址
                <span class={styles.sortIndicator}>
                  {sortField() === 'ip' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </div>
              <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('version')}>
                系统
                <span class={styles.sortIndicator}>
                  {sortField() === 'version' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </div>
              <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('battery')}>
                电量
                <span class={styles.sortIndicator}>
                  {sortField() === 'battery' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </div>
              <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('running')}>
                脚本
                <span class={styles.sortIndicator}>
                  {sortField() === 'running' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </div>
              <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('log')}>
                最后日志
                <span class={styles.sortIndicator}>
                  {sortField() === 'log' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </div>
            </div>
            
            <div class={styles.tableBody}>
              <For each={filteredDevices().map(device => ({
                ...device,
                _selectionKey: `${device.udid}-${props.selectedDevices().some(d => d.udid === device.udid)}-${forceUpdate()}`
              }))}>
                {(deviceWithKey) => {
                const device = deviceWithKey;
                const info = formatDeviceInfo(device);
                const isSelected = props.selectedDevices().some(d => d.udid === device.udid);
                
                // Debug selection state
                // console.log(`Device ${device.udid}: isSelected=${isSelected}, selectedCount=${props.selectedDevices().length}, key=${device._selectionKey}`);
                
                return (
                  <div 
                    class={`${styles.tableRow} ${isSelected ? styles.selected : ''}`}
                    onClick={() => handleDeviceToggle(device)}
                  >
                    <div class={styles.tableCell}>
                      <div 
                        style={{
                          width: '20px',
                          height: '20px',
                          border: '2px solid white',
                          'border-radius': '4px',
                          display: 'flex',
                          'align-items': 'center',
                          'justify-content': 'center',
                          'font-weight': 'bold',
                          background: isSelected ? '#4CAF50' : 'transparent',
                          'border-color': isSelected ? '#4CAF50' : 'rgba(255,255,255,0.3)',
                          color: isSelected ? 'white' : 'transparent'
                        }}
                      >
                        {isSelected ? '✓' : ''}
                      </div>
                    </div>
                    
                    <div class={styles.tableCell}>
                      <div 
                        class={styles.deviceName}
                        title={`点击复制设备名称: ${info.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(info.name, '设备名称');
                        }}
                      >
                        {info.name}
                      </div>
                    </div>
                    
                    <div class={styles.tableCell}>
                      <div 
                        class={styles.deviceUdid} 
                        title={`点击复制 UDID，双击打开文件浏览器: ${device.udid}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(device.udid, 'UDID');
                        }}
                        onDblClick={(e) => {
                          e.stopPropagation();
                          const deviceName = info.name || '未知设备';
                          props.onOpenFileBrowser(device.udid, deviceName);
                        }}
                      >
                        {device.udid}
                      </div>
                    </div>
                    
                    <div class={styles.tableCell}>
                      <div 
                        class={styles.deviceIp} 
                        title={`点击复制 IP: ${device.system?.ip || '未知'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(device.system?.ip || '未知', 'IP地址');
                        }}
                      >
                        {device.system?.ip || '未知'}
                      </div>
                    </div>
                    
                    <div class={styles.tableCell}>
                      <div 
                        class={styles.deviceVersion}
                        title={`点击复制系统版本: ${info.version}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(info.version, '系统版本');
                        }}
                      >
                        {info.version}
                      </div>
                    </div>
                    
                    <div class={styles.tableCell}>
                      <div 
                        class={styles.batteryIndicator}
                        style={{ color: getBatteryColor(info.battery) }}
                        title={`点击复制电量: ${info.battery}%`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(`${info.battery}%`, '电量');
                        }}
                      >
                        {info.battery}%
                      </div>
                    </div>
                    
                    <div class={styles.tableCell}>
                      <div 
                        class={`${styles.runningStatus} ${info.running ? styles.running : styles.stopped}`}
                        title={`点击复制设备上已选中脚本的名称: ${device.script?.select || '无脚本'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(device.script?.select || '无脚本', '设备上已选中脚本的名称');
                        }}
                      >
                        {info.running ? (info.paused ? '暂停中' : '运行中') : '已停止'}
                      </div>
                    </div>
                    
                    <div class={styles.tableCell}>
                      <div 
                        class={styles.lastLog} 
                        title={`点击复制日志: ${device.system?.log || '无日志'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(device.system?.log || '无日志', '最后日志');
                        }}
                      >
                        {device.system?.log ? 
                          (device.system.log.length > 50 ? 
                            device.system.log.substring(0, 50) + '...' : 
                            device.system.log
                          ) : 
                          '无日志'
                        }
                      </div>
                    </div>
                  </div>
                );
                }}
              </For>
            </div>
          </div>
        )}
        
        {/* Upload Modal */}
        <Show when={showUploadModal()}>
          <div class={styles.modalOverlay} onClick={handleModalCancel}>
            <div class={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div class={styles.modalHeader}>
                <h3>上传文件到选中设备</h3>
              </div>
              
              <div class={styles.modalBody}>
                <div class={styles.inputGroup}>
                  <label class={styles.inputLabel}>上传路径:</label>
                  <input
                    type="text"
                    value={modalUploadPath()}
                    onInput={(e) => setModalUploadPath(e.currentTarget.value)}
                    class={styles.pathInput}
                  />
                </div>
                
                <div 
                  class={`${styles.dropZone} ${modalIsDragOver() ? styles.dragOver : ''}`}
                  onDragOver={handleModalDragOver}
                  onDragLeave={handleModalDragLeave}
                  onDrop={handleModalDrop}
                  onClick={openModalFileDialog}
                >
                  <div class={styles.dropText}>
                    拖拽文件到此处或点击选择
                  </div>
                  <input
                    ref={(el) => modalFileInputRef = el}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleModalFileSelect}
                  />
                </div>
                
                <Show when={modalUploadFiles().length > 0}>
                  <div class={styles.fileList}>
                    <For each={modalUploadFiles()}>
                      {(file, index) => (
                        <div class={styles.fileItem}>
                          <span class={styles.fileName}>{file.name}</span>
                          <button 
                            onClick={() => removeModalFile(index())}
                            class={styles.removeFileButton}
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                
                <div class={styles.selectedDevicesInfo}>
                  将上传到 {props.selectedDevices().length} 台设备
                </div>
              </div>
              
              <div class={styles.modalFooter}>
                <button 
                  onClick={handleModalCancel}
                  class={styles.cancelButton}
                >
                  取消
                </button>
                <button 
                  onClick={handleModalUpload}
                  class={styles.confirmUploadButton}
                  disabled={modalUploadFiles().length === 0}
                >
                  开始上传
                </button>
              </div>
            </div>
          </div>
        </Show>
        
        {/* 实时控制弹窗 */}
        <RealTimeControl 
          isOpen={showRealTimeModal()}
          onClose={handleCloseRealTimeControl}
          selectedDevices={props.selectedDevices}
          webSocketService={props.webSocketService}
          currentScreenshot={currentScreenshot}
          onUpdateScreenshot={setCurrentScreenshot}
          onReadClipboard={props.onReadClipboard}
          onWriteClipboard={props.onWriteClipboard}
        />
        
        {/* 字典设置弹窗 */}
        <DictionaryModal
          isOpen={showDictionaryModal()}
          onClose={() => setShowDictionaryModal(false)}
          onSetValue={handleSetProcValue}
          onPushToQueue={handlePushToQueue}
          selectedDeviceCount={props.selectedDevices().length}
        />
        
        {/* 脚本选择弹窗 */}
        {(() => {
          const isOpen = showScriptSelectionModal(); // 必要的响应式读取
          return (
            <ScriptSelectionModal
              isOpen={isOpen}
              onClose={() => setShowScriptSelectionModal(false)}
              onSelectScript={handleSelectScript}
              selectedDeviceCount={props.selectedDevices().length}
            />
          );
        })()}
        
        {/* 注销设备确认弹窗 */}
        <Show when={showRespringConfirm()}>
          <div class={styles.modalOverlay} onClick={handleCancelRespring}>
            <div class={styles.confirmModal} onClick={(e) => e.stopPropagation()}>
              <div class={styles.confirmHeader}>
                <h3>确认注销设备</h3>
              </div>
              <div class={styles.confirmBody}>
                <p>确定要注销选中的 {props.selectedDevices().length} 台设备吗？</p>
                <p class={styles.warningText}>注销后设备将重新启动SpringBoard，所有运行中的应用将被关闭。</p>
              </div>
              <div class={styles.confirmFooter}>
                <button 
                  onClick={handleCancelRespring}
                  class={styles.cancelButton}
                >
                  取消
                </button>
                <button 
                  onClick={handleConfirmRespring}
                  class={styles.confirmButton}
                >
                  确认注销
                </button>
              </div>
            </div>
          </div>
        </Show>
        
        {/* 设备绑定弹窗 */}
        <DeviceBindingModal 
          isOpen={showDeviceBindingModal()}
          onClose={() => setShowDeviceBindingModal(false)}
          serverHost={props.serverHost}
          serverPort={props.serverPort}
        />
        
        {/* 服务器文件浏览弹窗 */}
        <ServerFileBrowser
          isOpen={showServerFileBrowser()}
          onClose={() => setShowServerFileBrowser(false)}
          serverBaseUrl={`http://${props.serverHost}:${props.serverPort}`}
        />
        
        {/* Toast Notification */}
        <Show when={showToast()}>
          <div class={styles.toast}>
            {toastMessage()}
          </div>
        </Show>
    </div>
  );
};

export default DeviceList;
