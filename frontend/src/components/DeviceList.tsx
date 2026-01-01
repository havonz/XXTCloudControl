import { Component, createSignal, For, Accessor, Show, createEffect, createMemo, JSX, onMount } from 'solid-js';
import { Device } from '../services/AuthService';
import { WebSocketService } from '../services/WebSocketService';
import { useDialog } from './DialogContext';
import RealTimeControl from './RealTimeControl';
import styles from './DeviceList.module.css';
import DeviceBindingModal from './DeviceBindingModal';
import DictionaryModal from './DictionaryModal';
import { ScriptSelectionModal } from './ScriptSelectionModal';
import ServerFileBrowser from './ServerFileBrowser';
import { IconRotate } from '../icons';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import { useScriptConfigManager } from '../hooks/useScriptConfigManager';
import ScriptConfigModal from './ScriptConfigModal';


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
  checkedGroups?: Accessor<Set<string>>; // 选中的分组ID列表
  getPreferredGroupScript?: () => { scriptPath: string; groupId: string } | null; // 获取分组绑定脚本
  getGroupedDevicesForLaunch?: (selectedDeviceIds: string[]) => Array<{ groupId: string; groupName: string; scriptPath: string | undefined; deviceIds: string[] }>; // 获取按分组分配的设备列表
  sidebar?: JSX.Element;
}

const DeviceList: Component<DeviceListProps> = (props) => {
  const dialog = useDialog();
  const [forceUpdate, setForceUpdate] = createSignal(0);
  
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = createSignal<string[]>(['name', 'udid', 'ip', 'version', 'battery', 'running', 'log']);
  const [showColumnSettings, setShowColumnSettings] = createSignal(false);

  
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
  
  // More actions menu state
  const [showMoreActions, setShowMoreActions] = createSignal(false);
  

  
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

  // Script config manager
  const scriptConfigManager = useScriptConfigManager();
  const [isConfigurable, setIsConfigurable] = createSignal(false);

  // Handle configuration status check when script selection changes
  createEffect(async () => {
    const scriptName = serverScriptName();
    if (scriptName) {
      const configurable = await scriptConfigManager.checkConfigurable(scriptName);
      setIsConfigurable(configurable);
    } else {
      setIsConfigurable(false);
    }
  });

  // Force reactivity tracking
  createEffect(() => {
    props.selectedDevices().length;
    props.selectedDevices().map(d => d.udid);
    setForceUpdate(prev => prev + 1); // Force component update
  });

  // Load saved script from backend on mount
  const loadSavedScript = async () => {
    try {
      const response = await fetch('/api/app-settings/selected-script');
      if (response.ok) {
        const data = await response.json();
        if (data.selectedScript) {
          setServerScriptName(data.selectedScript);
        }
      }
    } catch (error) {
      console.error('Failed to load saved script:', error);
    }
  };

  // Save selected script to backend
  const saveSelectedScript = async (scriptName: string) => {
    try {
      await fetch('/api/app-settings/selected-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedScript: scriptName })
      });
    } catch (error) {
      console.error('Failed to save selected script:', error);
    }
  };

  // Load saved script on component mount
  onMount(() => {
    loadSavedScript();
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
    if (props.selectedDevices().length === 0) return;
    
    setIsSendingScript(true);
    try {
      // 获取按分组分配的设备列表
      const selectedDeviceIds = props.selectedDevices().map((d: Device) => d.udid);
      const groupedDevices = props.getGroupedDevicesForLaunch?.(selectedDeviceIds) || [];
      
      if (groupedDevices.length > 0) {
        // 按分组分批发送
        let successCount = 0;
        let failCount = 0;
        
        for (const group of groupedDevices) {
          // 使用分组绑定的脚本，如果没有则使用全局选择的脚本
          const scriptToRun = group.scriptPath || serverScriptName();
          if (!scriptToRun) {
            console.warn(`分组 ${group.groupName} 没有绑定脚本且未选择全局脚本，跳过`);
            continue;
          }
          
          try {
            const response = await fetch('/api/scripts/send-and-start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                devices: group.deviceIds,
                name: scriptToRun,
                selectedGroups: [group.groupId],
              }),
            });
            
            const result = await response.json();
            if (result.success) {
              successCount += group.deviceIds.length;
            } else {
              failCount += group.deviceIds.length;
              console.error(`分组 ${group.groupName} 发送失败:`, result.error);
            }
          } catch (error) {
            failCount += group.deviceIds.length;
            console.error(`分组 ${group.groupName} 发送错误:`, error);
          }
        }
        
        if (failCount === 0) {
          showToastMessage(`脚本已发送并启动 (${successCount} 台设备)`);
        } else {
          showToastMessage(`部分成功: ${successCount} 成功, ${failCount} 失败`);
        }
      } else {
        // 没有分组（选中“所有设备”），使用全局配置
        const effectiveScriptName = serverScriptName();
        if (!effectiveScriptName) {
          showToastMessage('请先选择脚本');
          return;
        }
        
        const response = await fetch('/api/scripts/send-and-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devices: selectedDeviceIds,
            name: effectiveScriptName,
            selectedGroups: ['__all__'],
          }),
        });
        
        const result = await response.json();
        if (result.success) {
          showToastMessage('脚本已发送并启动');
        } else {
          console.error('发送脚本失败:', result.error);
          showToastMessage('发送脚本失败: ' + (result.error || '未知错误'));
        }
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
    return sortDevices(props.devices);
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

  const handleInvertSelection = () => {
    const allDevices = filteredDevices();
    const currentlySelectedUdids = new Set(props.selectedDevices().map(d => d.udid));
    const newSelection = allDevices.filter(d => !currentlySelectedUdids.has(d.udid));
    props.onDeviceSelect(newSelection);
  };

  const toggleColumn = (col: string) => {
    if (visibleColumns().includes(col)) {
      if (visibleColumns().length > 1) {
        setVisibleColumns(visibleColumns().filter(c => c !== col));
      }
    } else {
      setVisibleColumns([...visibleColumns(), col]);
    }
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
      {/* Action Toolbar - Single Row */}
      <div class={styles.actionToolbar}>
        <div class={styles.actionToolbarRow}>
          <button 
            onClick={handleDeviceBinding}
            class={styles.toolbarActionButton}
          >
            设备绑定到云控
          </button>
          <button 
            onClick={() => setShowServerFileBrowser(true)}
            class={styles.toolbarActionButton}
          >
            浏览服务器文件
          </button>
          
          <div class={styles.scriptSelectGroup}>
            <Select.Root
              collection={selectableScriptsCollection()}
              value={serverScriptName() ? [serverScriptName()] : []}
              onValueChange={(e) => {
                const next = e.value[0] ?? '';
                setServerScriptName(next);
                saveSelectedScript(next);
              }}
              onOpenChange={(e) => {
                if (e.open) fetchSelectableScripts();
              }}
            >
              <Select.Control>
                <Select.Trigger class="cbx-select" style={{ 'min-width': '160px' }}>
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
              </Select.Root>
              <button 
                class={styles.iconButton} 
                onClick={fetchSelectableScripts}
                disabled={isLoadingScripts()}
                title="刷新脚本列表"
              >
                <IconRotate size={14} class={isLoadingScripts() ? styles.spin : ''} />
              </button>
            </div>

            <Show when={isConfigurable()}>
              <button 
                onClick={() => scriptConfigManager.openGlobalConfig(serverScriptName())}
                class={styles.toolbarActionButton}
              >
                配置
              </button>
            </Show>
            
            <div class={styles.scriptActionButtons}>
              <button 
                class={styles.toolbarActionButton}
                disabled={!serverScriptName() || props.selectedDevices().length === 0 || isSendingScript()}
                onClick={handleSendAndStartScript}
              >
                {isSendingScript() ? '启动中...' : '启动脚本'}
              </button>
            </div>
          
          <button 
            onClick={handleStopScript}
            class={styles.toolbarActionButton}
            disabled={props.selectedDevices().length === 0}
          >
            停止脚本
          </button>
          
          <button 
            onClick={handleScriptSelection}
            class={styles.toolbarActionButton}
            disabled={props.selectedDevices().length === 0}
          >
            脚本选择
          </button>
          
          <div class={styles.moreActionsContainer}>
            <button 
              class={styles.toolbarActionButton}
              onClick={() => setShowMoreActions(!showMoreActions())}
            >
              更多操作 ▼
            </button>
            <Show when={showMoreActions()}>
              <div class={styles.moreActionsMenu}>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    setShowUploadModal(true);
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  上传文件
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    handleOpenRealTimeControl();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  实时控制
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    handleDictionaryAccess();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  词典发送
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    handleRespringDevices();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  注销设备
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>

      <div class={styles.mainLayoutBody}>
        <div class={styles.sidebarSection}>
          {props.sidebar}
        </div>
        
        <div class={styles.contentArea}>
          {/* Management Toolbar moved here */}
          <div class={styles.managementToolbar}>
            <div class={styles.toolbarLeft}>
              <div class={styles.columnSettingsContainer}>
                <button 
                  class={styles.toolbarButton}
                  onClick={() => setShowColumnSettings(!showColumnSettings())}
                >
                  表头设置
                </button>
                <Show when={showColumnSettings()}>
                  <div class={styles.columnDropdown}>
                    <For each={[
                      { id: 'name', label: '设备名称' },
                      { id: 'udid', label: 'UDID' },
                      { id: 'ip', label: 'IP地址' },
                      { id: 'version', label: '系统' },
                      { id: 'battery', label: '电量' },
                      { id: 'running', label: '脚本' },
                      { id: 'log', label: '最后日志' },
                    ]}>
                      {(col) => (
                        <label class={styles.columnOption}>
                          <input 
                            type="checkbox" 
                            checked={visibleColumns().includes(col.id)}
                            onChange={() => toggleColumn(col.id)}
                          />
                          <span>{col.label}</span>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <button 
                onClick={props.onRefresh}
                class={styles.toolbarButton}
                disabled={props.isLoading}
              >
                {props.isLoading ? '刷新中...' : '请求刷新'}
              </button>
              <button 
                onClick={handleCopySelectedUDIDs}
                class={styles.toolbarButton}
                disabled={props.selectedDevices().length === 0}
              >
                复制UDID
              </button>
              <button 
                onClick={handleInvertSelection}
                class={styles.toolbarButton}
              >
                反选
              </button>
            </div>
            <div class={styles.toolbarRight}>
              <div class={styles.deviceCountSummary}>
                共 {props.devices.length} 台设备
                <Show when={props.selectedDevices().length > 0}> | 已选择 {props.selectedDevices().length} 台</Show>
              </div>
            </div>
          </div>

          <div class={styles.tableArea}>
            <Show when={props.isLoading && props.devices.length === 0}>
              <div class={styles.loadingState}>
                <div class={styles.spinner}></div>
                <p>正在获取设备列表...</p>
              </div>
            </Show>
            <Show when={!props.isLoading && filteredDevices().length === 0}>
              <div class={styles.emptyState}>
                <p>该分组暂无设备</p>
              </div>
            </Show>
            <Show when={filteredDevices().length > 0}>
          <div 
            class={styles.deviceTable}
            style={{ 
              'grid-template-columns': `60px ${visibleColumns().map(id => {
                if (id === 'log') return '2fr';
                if (id === 'udid') return '200px';
                if (id === 'name') return '160px';
                if (id === 'ip') return '140px';
                if (id === 'battery' || id === 'version') return '80px';
                if (id === 'running') return '100px';
                return '1fr';
              }).join(' ')}`
            }}
          >
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
                
                <Show when={visibleColumns().includes('name')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('name')}>
                    设备名称
                    <span class={styles.sortIndicator}>
                      {sortField() === 'name' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('udid')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('udid')}>
                    UDID
                    <span class={styles.sortIndicator}>
                      {sortField() === 'udid' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('ip')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('ip')}>
                    IP地址
                    <span class={styles.sortIndicator}>
                      {sortField() === 'ip' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('version')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('version')}>
                    系统
                    <span class={styles.sortIndicator}>
                      {sortField() === 'version' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('battery')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('battery')}>
                    电量
                    <span class={styles.sortIndicator}>
                      {sortField() === 'battery' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('running')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('running')}>
                    脚本
                    <span class={styles.sortIndicator}>
                      {sortField() === 'running' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('log')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('log')}>
                    最后日志
                    <span class={styles.sortIndicator}>
                      {sortField() === 'log' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                  </div>
                </Show>
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
                      
                      <Show when={visibleColumns().includes('name')}>
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
                      </Show>
                      
                      <Show when={visibleColumns().includes('udid')}>
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
                      </Show>
                      
                      <Show when={visibleColumns().includes('ip')}>
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
                      </Show>
                      
                      <Show when={visibleColumns().includes('version')}>
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
                      </Show>
                      
                      <Show when={visibleColumns().includes('battery')}>
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
                      </Show>
                      
                      <Show when={visibleColumns().includes('running')}>
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
                      </Show>
                      
                      <Show when={visibleColumns().includes('log')}>
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
                      </Show>
                    </div>
                  );
                  }}
                </For>
              </div>
          </div>
            </Show>
          </div>
        </div>
      </div>
        
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

      {/* Script Configuration Modal */}
      <ScriptConfigModal
        open={scriptConfigManager.isOpen()}
        title={scriptConfigManager.configTitle()}
        items={scriptConfigManager.uiItems()}
        initialValues={scriptConfigManager.initialValues()}
        scriptInfo={scriptConfigManager.scriptInfo()}
        onClose={scriptConfigManager.closeConfig}
        onSubmit={scriptConfigManager.submitConfig}
      />
    </div>
  );
};

export default DeviceList;
