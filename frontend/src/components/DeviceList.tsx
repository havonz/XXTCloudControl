import { Component, createSignal, For, Accessor, Show, createEffect, createMemo, JSX, onMount, onCleanup } from 'solid-js';
import { AuthService, Device } from '../services/AuthService';
import { WebSocketService } from '../services/WebSocketService';
import { useDialog } from './DialogContext';
import { useToast } from './ToastContext';
import RealTimeControl from './RealTimeControl';
import WebRTCControl from './WebRTCControl';
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
import { authFetch } from '../services/httpAuth';
import { scanEntries, ScannedFile } from '../utils/fileUpload';
import ContextMenu, { ContextMenuButton, ContextMenuDivider, ContextMenuSection } from './ContextMenu';


interface DeviceListProps {
  devices: Device[];
  onDeviceSelect: (devices: Device[]) => void;
  selectedDevices: Accessor<Device[]>;
  onRespring: () => void;
  onRefresh: () => void;
  onStartScript: (scriptName: string) => void;
  onStopScript: () => void;
  onRespringDevices: () => void;
  onUploadFiles: (files: ScannedFile[], uploadPath: string) => Promise<void>;
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
  onOpenAddToGroupModal?: () => void; // 打开添加到分组弹窗
  sidebar?: JSX.Element;
  isMobileMenuOpen?: boolean;
  onCloseMobileMenu?: () => void;
}

const DeviceList: Component<DeviceListProps> = (props) => {
  const dialog = useDialog();
  const toast = useToast();
  const authService = AuthService.getInstance();
  const [forceUpdate, setForceUpdate] = createSignal(0);
  
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = createSignal<string[]>(['name', 'udid', 'ip', 'version', 'battery', 'running', 'message', 'log']);
  const [showColumnSettings, setShowColumnSettings] = createSignal(false);

  // Column widths state
  const DEFAULT_WIDTHS: Record<string, number> = {
    selection: 60,
    name: 160,
    udid: 200,
    ip: 140,
    version: 80,
    battery: 80,
    running: 100,
    message: 200,
    log: 400
  };

  const [columnWidths, setColumnWidths] = createSignal<Record<string, number>>((() => {
    const saved = localStorage.getItem('deviceListColumnWidths');
    if (saved) {
      try {
        return { ...DEFAULT_WIDTHS, ...JSON.parse(saved) };
      } catch (e) {
        console.error('Failed to parse saved column widths:', e);
      }
    }
    return DEFAULT_WIDTHS;
  })());

  const saveWidths = (widths: Record<string, number>) => {
    localStorage.setItem('deviceListColumnWidths', JSON.stringify(widths));
  };

  let resizingColumn: string | null = null;
  let startX = 0;
  let startWidth = 0;

  const handleResizeStart = (e: MouseEvent, colId: string) => {
    e.stopPropagation();
    resizingColumn = colId;
    startX = e.pageX;
    startWidth = columnWidths()[colId] || DEFAULT_WIDTHS[colId];
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeStop);
    document.body.classList.add('resizing');
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingColumn) return;
    const delta = e.pageX - startX;
    const newWidth = Math.max(50, startWidth + delta);
    
    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn!]: newWidth
    }));
  };

  const handleResizeStop = () => {
    if (resizingColumn) {
      saveWidths(columnWidths());
    }
    resizingColumn = null;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeStop);
    document.body.classList.remove('resizing');
  };

  
  // Upload modal state
  const [showDeviceBindingModal, setShowDeviceBindingModal] = createSignal(false);
  const [showDictionaryModal, setShowDictionaryModal] = createSignal(false);
  const [showRespringConfirm, setShowRespringConfirm] = createSignal(false);
  const [showScriptSelectionModal, setShowScriptSelectionModal] = createSignal(false);
  const [showServerFileBrowser, setShowServerFileBrowser] = createSignal(false);
  const [showUploadModal, setShowUploadModal] = createSignal(false);
  const [modalUploadPath, setModalUploadPath] = createSignal('/lua/scripts');
  const [modalUploadFiles, setModalUploadFiles] = createSignal<ScannedFile[]>([]);
  const [modalIsDragOver, setModalIsDragOver] = createSignal(false);
  let modalFileInputRef: HTMLInputElement | undefined;
  
  // More actions menu state
  const [showMoreActions, setShowMoreActions] = createSignal(false);
  
  // Device context menu state
  const [contextMenuDevice, setContextMenuDevice] = createSignal<Device | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  const [lastSelectedUdid, setLastSelectedUdid] = createSignal<string | null>(null);
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Refs for click-outside detection
  let moreActionsRef: HTMLDivElement | undefined;
  let columnSettingsRef: HTMLDivElement | undefined;
  
  // Click-outside handler to close dropdown menus
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    
    // Close "更多操作" menu if clicking outside
    if (showMoreActions() && moreActionsRef && !moreActionsRef.contains(target)) {
      setShowMoreActions(false);
    }
    
    // Close "表头设置" menu if clicking outside
    if (showColumnSettings() && columnSettingsRef && !columnSettingsRef.contains(target)) {
      setShowColumnSettings(false);
    }
    
    // Close device context menu if clicking outside
    if (contextMenuDevice()) {
      setContextMenuDevice(null);
    }
  };
  
  // Device context menu handlers
  const handleDeviceContextMenu = (e: MouseEvent, device: Device) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuDevice(device);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };
  
  const handleDeviceTouchStart = (device: Device) => {
    longPressTimer = setTimeout(() => {
      // Use center of screen for mobile
      setContextMenuDevice(device);
      setContextMenuPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }, 500);
  };
  
  const handleDeviceTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  
  const closeContextMenu = () => {
    setContextMenuDevice(null);
  };
  
  const handleContextMenuCopyUdid = () => {
    const device = contextMenuDevice();
    if (device) {
      copyToClipboard(device.udid, 'UDID');
    }
    closeContextMenu();
  };
  
  const handleContextMenuCopyName = () => {
    const device = contextMenuDevice();
    if (device) {
      const name = device.system?.name || '未知设备';
      copyToClipboard(name, '设备名称');
    }
    closeContextMenu();
  };
  
  const handleContextMenuCopyIp = () => {
    const device = contextMenuDevice();
    if (device) {
      copyToClipboard(device.system?.ip || '未知', 'IP地址');
    }
    closeContextMenu();
  };
  
  const handleContextMenuOpenFileBrowser = () => {
    const device = contextMenuDevice();
    if (device) {
      const name = device.system?.name || '未知设备';
      props.onOpenFileBrowser(device.udid, name);
    }
    closeContextMenu();
  };
  
  // 批量拷贝选中设备信息
  const handleContextMenuCopySelectedUdids = () => {
    const udids = props.selectedDevices().map(d => d.udid).join('\n');
    copyToClipboard(udids, '选中设备 UDID');
    closeContextMenu();
  };
  
  const handleContextMenuCopySelectedNames = () => {
    const names = props.selectedDevices().map(d => d.system?.name || '未知设备').join('\n');
    copyToClipboard(names, '选中设备名称');
    closeContextMenu();
  };
  
  const handleContextMenuCopySelectedIps = () => {
    const ips = props.selectedDevices().map(d => d.system?.ip || '未知').join('\n');
    copyToClipboard(ips, '选中设备 IP');
    closeContextMenu();
  };
  
  // 拷贝最后日志
  const handleContextMenuCopyLastLog = () => {
    const device = contextMenuDevice();
    if (device) {
      const log = device.system?.log || '';
      if (log) {
        copyToClipboard(log, '最后日志');
      } else {
        showToastMessage('该设备暂无日志');
      }
    }
    closeContextMenu();
  };
  
  // 拷贝选中设备最后日志
  const handleContextMenuCopySelectedLastLogs = () => {
    const logs = props.selectedDevices()
      .map(d => {
        const name = d.system?.name || d.udid;
        const log = d.system?.log || '';
        return log ? `[${name}] ${log}` : '';
      })
      .filter(log => log) // 过滤掉空日志
      .join('\n');
    
    if (logs) {
      copyToClipboard(logs, '选中设备最后日志');
    } else {
      showToastMessage('选中设备暂无日志');
    }
    closeContextMenu();
  };

  // 拷贝脚本文件名
  const handleContextMenuCopyScriptSelect = () => {
    const device = contextMenuDevice();
    if (device) {
      const scriptName = device.script?.select || '';
      if (scriptName) {
        copyToClipboard(scriptName, '脚本文件名');
      } else {
        showToastMessage('该设备未选中任何脚本');
      }
    }
    closeContextMenu();
  };

  // 拷贝选中设备的脚本文件名
  const handleContextMenuCopySelectedScriptSelects = () => {
    const scriptNames = props.selectedDevices()
      .map(d => {
        const name = d.system?.name || d.udid;
        const scriptName = d.script?.select || '';
        return scriptName ? `[${name}] ${scriptName}` : '';
      })
      .filter(sn => sn) // 过滤掉空脚本名
      .join('\n');
    
    if (scriptNames) {
      copyToClipboard(scriptNames, '选中设备脚本文件名');
    } else {
      showToastMessage('选中设备暂无脚本选中');
    }
    closeContextMenu();
  };
  
  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('contextmenu', handleClickOutside);
  });
  
  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('contextmenu', handleClickOutside);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });
  

  
  // Real-time control modal state
  const [showRealTimeModal, setShowRealTimeModal] = createSignal(false);
  const [currentScreenshot, setCurrentScreenshot] = createSignal<string>('');
  
  // WebRTC control modal state
  const [showWebRTCModal, setShowWebRTCModal] = createSignal(false);
  
  // Sorting state
  const [sortField, setSortField] = createSignal<string>('');
  const [sortDirection, setSortDirection] = createSignal<'asc' | 'desc'>('asc');

  // Selectable scripts state
  const [selectableScripts, setSelectableScripts] = createSignal<string[]>([]);
  const [isLoadingScripts, setIsLoadingScripts] = createSignal(false);
  const [isSendingScript, setIsSendingScript] = createSignal(false);
  // Placeholder for device-selected script option
  const DEVICE_SELECTED_PLACEHOLDER = '<设备端已选中>';
  const [serverScriptName, setServerScriptName] = createSignal(DEVICE_SELECTED_PLACEHOLDER); // 默认选择设备端已选中
  
  // Script items for display in dropdowns
  const selectableScriptsWithPlaceholder = createMemo(() => 
    [DEVICE_SELECTED_PLACEHOLDER, ...selectableScripts()]
  );
  
  // Collection for Select component (reactive)
  const selectableScriptsCollection = createMemo(() => 
    createListCollection({ items: selectableScriptsWithPlaceholder() })
  );

  // Script config manager
  const scriptConfigManager = useScriptConfigManager();
  const [isConfigurable, setIsConfigurable] = createSignal(false);

  // Handle configuration status check when script selection changes
  createEffect(() => {
    const scriptName = serverScriptName();
    let cancelled = false;

    onCleanup(() => {
      cancelled = true;
    });

    if (scriptName && scriptName !== DEVICE_SELECTED_PLACEHOLDER) {
      scriptConfigManager.checkConfigurable(scriptName)
        .then((configurable) => {
          if (!cancelled && serverScriptName() === scriptName) {
            setIsConfigurable(configurable);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setIsConfigurable(false);
          }
        });
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
      const response = await authFetch('/api/app-settings');
      if (response.ok) {
        const data = await response.json();
        if (data.selectedScript) {
          setServerScriptName(data.selectedScript);
        } else {
          setServerScriptName(DEVICE_SELECTED_PLACEHOLDER);
        }
      }
    } catch (error) {
      console.error('Failed to load saved script:', error);
    }
  };

  // Save selected script to backend
  const saveSelectedScript = async (scriptName: string) => {
    try {
      await authFetch('/api/app-settings', {
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
      const response = await authFetch('/api/scripts/selectable');
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
      // Helper: Convert placeholder values to actual API values
      const resolveScriptName = (name: string | undefined): string => {
        if (!name) return '';
        // Match both the constant and any string containing the device-selected text
        if (name === DEVICE_SELECTED_PLACEHOLDER || name.includes('设备端已选中')) {
          return ''; // Empty string means device-selected mode
        }
        return name;
      };

      // 获取按分组分配的设备列表
      const selectedDeviceIds = props.selectedDevices().map((d: Device) => d.udid);
      const groupedDevices = props.getGroupedDevicesForLaunch?.(selectedDeviceIds) || [];
      
      if (groupedDevices.length > 0) {
        // 按分组分批发送
        let successCount = 0;
        let failCount = 0;
        
        for (const group of groupedDevices) {
          // 使用分组绑定的脚本，如果没有则使用全局选择的脚本
          const rawScriptName = group.scriptPath || serverScriptName();
          const scriptToRun = resolveScriptName(rawScriptName);
          
          // Skip only if: no script at all (empty raw) AND global is also empty/unset
          if (!rawScriptName && !serverScriptName()) {
            console.warn(`分组 ${group.groupName} 没有绑定脚本且未选择全局脚本，跳过`);
            continue;
          }
          
          try {
            const response = await authFetch('/api/scripts/send-and-start', {
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
        // 没有分组（选中"所有设备"），使用全局配置
        const effectiveScriptName = resolveScriptName(serverScriptName());
        
        // Only block if nothing is selected at all
        if (effectiveScriptName === '' && serverScriptName() !== DEVICE_SELECTED_PLACEHOLDER) {
          showToastMessage('请先选择脚本');
          return;
        }
        
        const response = await authFetch('/api/scripts/send-and-start', {
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
      showToastMessage(`${type} 已拷贝到剪贴板`);
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
        showToastMessage(`${type} 已拷贝到剪贴板`);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
        showToastMessage('拷贝失败，请手动拷贝');
      }
    }
  };
  
  // Show toast notification
  const showToastMessage = (message: string) => {
    toast.showInfo(message);
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

  const handleDeviceToggle = (device: Device, e?: MouseEvent) => {
    const isSelected = props.selectedDevices().some(d => d.udid === device.udid);
    const devices = filteredDevices();
    
    if (e?.shiftKey && lastSelectedUdid()) {
      const lastIndex = devices.findIndex(d => d.udid === lastSelectedUdid());
      const currentIndex = devices.findIndex(d => d.udid === device.udid);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const range = devices.slice(start, end + 1);
        
        const currentSelectedUdids = new Set(props.selectedDevices().map(d => d.udid));
        
        // If the clicked device is NOT selected, we select the range.
        // If it IS selected, we also select the range (standard behavior usually adds to existing selection).
        range.forEach(d => currentSelectedUdids.add(d.udid));
        
        const newSelection = props.devices.filter(d => currentSelectedUdids.has(d.udid));
        props.onDeviceSelect(newSelection);
        setLastSelectedUdid(device.udid);
        return;
      }
    }

    if (isSelected) {
      // 取消选择
      const newSelection = props.selectedDevices().filter(d => d.udid !== device.udid);
      props.onDeviceSelect(newSelection);
    } else {
      // 添加到选择
      const newSelection = [...props.selectedDevices(), device];
      props.onDeviceSelect(newSelection);
    }
    setLastSelectedUdid(device.udid);
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
    if (battery > 50) return 'var(--success)';
    if (battery > 20) return 'var(--warning)';
    return 'var(--danger)';
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

  const handleModalDrop = async (e: DragEvent) => {
    e.preventDefault();
    setModalIsDragOver(false);
    
    if (e.dataTransfer?.items) {
      const scannedFiles = await scanEntries(e.dataTransfer.items);
      if (scannedFiles.length > 0) {
        setModalUploadFiles(prev => [...prev, ...scannedFiles]);
      }
    } else if (e.dataTransfer?.files) {
      const files = Array.from(e.dataTransfer.files);
      const scannedFiles: ScannedFile[] = files.map(file => ({ file, relativePath: file.name }));
      setModalUploadFiles(prev => [...prev, ...scannedFiles]);
    }
  };

  const handleModalFileSelect = (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      const files = Array.from(target.files);
      const scannedFiles: ScannedFile[] = files.map(file => ({ 
        file, 
        relativePath: (file as any).webkitRelativePath || file.name 
      }));
      setModalUploadFiles(prev => [...prev, ...scannedFiles]);
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
  
  // WebRTC 实时控制
  const handleOpenWebRTCControl = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage('请先选择设备');
      return;
    }
    setShowWebRTCModal(true);
  };

  const handleCloseWebRTCControl = () => {
    setShowWebRTCModal(false);
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
            服务器文件浏览
          </button>
          
          <div class={styles.scriptSelectGroup}>
            <div class={styles.scriptSelectWrapper}>
              <Select.Root
                class="cbx-select-root"
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
                <Select.Control class="cbx-select-control">
                  <Select.Trigger class="cbx-select">
                    <span style={{ 
                      flex: 1, 
                      overflow: 'hidden', 
                      'text-overflow': 'ellipsis', 
                      'white-space': 'nowrap',
                      'text-align': 'left'
                    }}>
                      {serverScriptName() || '-- 选择脚本 --'}
                    </span>
                    <span class="dropdown-arrow">▼</span>
                  </Select.Trigger>
                </Select.Control>
                <Portal>
                  <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                    <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                        <Select.ItemGroup>
                          <For each={selectableScriptsWithPlaceholder()}>{(script) => (
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
              </div>
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
                disabled={props.selectedDevices().length === 0 || isSendingScript()}
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
            选中脚本
          </button>
          
          <div class={styles.moreActionsContainer} ref={moreActionsRef}>
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
                    handleOpenWebRTCControl();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  WebRTC控制
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
        <Show when={props.isMobileMenuOpen}>
          <div class={styles.mobileSidebarOverlay} onClick={props.onCloseMobileMenu}></div>
        </Show>
        
        <div class={`${styles.sidebarSection} ${props.isMobileMenuOpen ? styles.mobileOpen : ''}`}>
          {props.sidebar}
        </div>
        
        <div class={styles.contentArea}>
          {/* Management Toolbar moved here */}
          <div class={styles.managementToolbar}>
            <div class={styles.toolbarLeft}>
              <div class={styles.columnSettingsContainer} ref={columnSettingsRef}>
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
                      { id: 'message', label: '消息' },
                      { id: 'log', label: '最后日志' },
                    ]}>
                      {(col) => (
                        <label class={styles.columnOption}>
                          <input 
                            type="checkbox" 
                            class="themed-checkbox"
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
                onClick={handleSelectAll}
                class={styles.toolbarButton}
              >
                全选
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
                <p>该分组暂无已连接设备</p>
              </div>
            </Show>
            <Show when={filteredDevices().length > 0}>
          <div 
            class={styles.deviceTable}
            style={{ 
              'grid-template-columns': `${columnWidths().selection}px ${visibleColumns().map((id, index) => {
                if (index === visibleColumns().length - 1) return '1fr';
                const width = columnWidths()[id];
                return `${width}px`;
              }).join(' ')}`
            }}
          >
              <div class={styles.tableHeader} style={{ 
                'grid-template-columns': `${columnWidths().selection}px ${visibleColumns().map((id, index) => {
                  if (index === visibleColumns().length - 1) return '1fr';
                  const width = columnWidths()[id];
                  return `${width}px`;
                }).join(' ')}`
              }}>
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
                  <div 
                    class={styles.resizeHandle} 
                    onMouseDown={(e) => handleResizeStart(e, 'selection')}
                  />
                </div>
                
                <Show when={visibleColumns().includes('name')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('name')}>
                    设备名称
                    <span class={styles.sortIndicator}>
                      {sortField() === 'name' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'name')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('udid')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('udid')}>
                    UDID
                    <span class={styles.sortIndicator}>
                      {sortField() === 'udid' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'udid')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('ip')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('ip')}>
                    IP地址
                    <span class={styles.sortIndicator}>
                      {sortField() === 'ip' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'ip')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('version')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('version')}>
                    系统
                    <span class={styles.sortIndicator}>
                      {sortField() === 'version' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'version')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('battery')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('battery')}>
                    电量
                    <span class={styles.sortIndicator}>
                      {sortField() === 'battery' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'battery')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('running')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('running')}>
                    脚本
                    <span class={styles.sortIndicator}>
                      {sortField() === 'running' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'running')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('message')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('message')}>
                    消息
                    <span class={styles.sortIndicator}>
                      {sortField() === 'message' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'message')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Show>
                
                <Show when={visibleColumns().includes('log')}>
                  <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('log')}>
                    最后日志
                    <span class={styles.sortIndicator}>
                      {sortField() === 'log' ? (sortDirection() === 'asc' ? ' ↑' : ' ↓') : ''}
                    </span>
                    {/* Log is usually the last column, no handle needed unless we want to resize it against some future column */}
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
                      style={{ 
                        'grid-template-columns': `${columnWidths().selection}px ${visibleColumns().map((id, index) => {
                          if (index === visibleColumns().length - 1) return '1fr';
                          const width = columnWidths()[id];
                          return `${width}px`;
                        }).join(' ')}`
                      }}
                      onClick={(e) => handleDeviceToggle(device, e)}
                      onContextMenu={(e) => handleDeviceContextMenu(e, device)}
                    >
                      <div class={styles.tableCell}>
                        <div 
                          class={`${styles.deviceCheckbox} ${isSelected ? styles.checked : ''}`}
                        >
                          {isSelected ? '✓' : ''}
                        </div>
                      </div>
                      
                      <Show when={visibleColumns().includes('name')}>
                        <div class={styles.tableCell}>
                          <div class={styles.deviceName}>
                            {info.name}
                          </div>
                        </div>
                      </Show>
                      
                      <Show when={visibleColumns().includes('udid')}>
                        <div class={styles.tableCell}>
                          <div class={styles.deviceUdid}>
                            {device.udid}
                          </div>
                        </div>
                      </Show>
                      
                      <Show when={visibleColumns().includes('ip')}>
                        <div class={styles.tableCell}>
                          <div class={styles.deviceIp}>
                            {device.system?.ip || '未知'}
                          </div>
                        </div>
                      </Show>
                      
                      <Show when={visibleColumns().includes('version')}>
                        <div class={styles.tableCell}>
                          <div class={styles.deviceVersion}>
                            {info.version}
                          </div>
                        </div>
                      </Show>
                      
                      <Show when={visibleColumns().includes('battery')}>
                        <div class={styles.tableCell}>
                          <div 
                            class={styles.batteryIndicator}
                            style={{ color: getBatteryColor(info.battery) }}
                          >
                            {info.battery}%
                          </div>
                        </div>
                      </Show>
                      
                      <Show when={visibleColumns().includes('running')}>
                        <div class={styles.tableCell}>
                          <div 
                            class={`${styles.runningStatus} ${info.running ? styles.running : styles.stopped}`}
                            title={device.script?.select || '无脚本'}
                          >
                            {info.running ? (info.paused ? '暂停中' : '运行中') : '已停止'}
                          </div>
                        </div>
                      </Show>
                      
                      <Show when={visibleColumns().includes('message')}>
                        <div class={styles.tableCell}>
                          <div 
                            class={styles.deviceMessage}
                            title={device.system?.message || '无消息'}
                          >
                            {device.system?.message || ''}
                          </div>
                        </div>
                      </Show>
                      
                      <Show when={visibleColumns().includes('log')}>
                        <div class={styles.tableCell}>
                          <div 
                            class={styles.lastLog} 
                            title={device.system?.log || '无日志'}
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

          <div class={styles.deviceCardList}>
            <For each={filteredDevices()}>
              {(device) => {
                const info = formatDeviceInfo(device);
                return (
                  <div 
                    class={styles.deviceCard}
                    classList={{ [styles.selected]: props.selectedDevices().some(d => d.udid === device.udid) }}
                    onClick={(e) => handleDeviceToggle(device, e)}
                    onContextMenu={(e) => handleDeviceContextMenu(e, device)}
                    onTouchStart={() => handleDeviceTouchStart(device)}
                    onTouchEnd={handleDeviceTouchEnd}
                    onTouchMove={handleDeviceTouchEnd}
                  >
                    <div class={styles.deviceCardHeader}>
                      <div class={styles.cardTitleSection}>
                        <div class={styles.cardDeviceName}>{info.name}</div>
                        <div class={styles.cardDeviceUdid}>{device.udid}</div>
                      </div>
                      <Show when={props.selectedDevices().some(d => d.udid === device.udid)}>
                        <div class={styles.cardSelectionIndicator}>
                          <span class={styles.checkIcon}>✓</span>
                        </div>
                      </Show>
                      <div class={styles.cardStatusSection}>
                        <div 
                          class={styles.cardBattery} 
                          style={{ color: getBatteryColor(info.battery) }}
                        >
                          {info.battery}%
                        </div>
                        <div class={`${styles.cardRunningStatus} ${info.running ? styles.running : styles.stopped}`}>
                          {info.running ? (info.paused ? '暂停中' : '运行中') : '已停止'}
                        </div>
                      </div>
                    </div>
                    
                    <div class={styles.cardDetailsGrid}>
                      <div class={styles.detailItem}>
                        <span class={styles.detailLabel}>IP地址</span>
                        <span class={styles.detailValue}>{device.system?.ip || '未知'}</span>
                      </div>
                      <div class={styles.detailItem}>
                        <span class={styles.detailLabel}>系统版本</span>
                        <span class={styles.detailValue}>{info.version}</span>
                      </div>
                    </div>
                    
                    <Show when={device.system?.message}>
                      <div class={styles.cardMessageArea}>
                        <div class={styles.cardMessageText}>{device.system?.message}</div>
                      </div>
                    </Show>
                    
                    <Show when={device.system?.log}>
                      <div class={styles.cardLogArea}>
                        {device.system?.log}
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
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
                      {(item, index) => (
                        <div class={styles.fileItem}>
                          <span class={styles.modalFileName}>{item.relativePath}</span>
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
        
        {/* WebRTC 实时控制弹窗 */}
        <Show when={showWebRTCModal()}>
          <WebRTCControl
            isOpen={showWebRTCModal()}
            onClose={handleCloseWebRTCControl}
            selectedDevices={() => props.selectedDevices()}
            webSocketService={props.webSocketService}
            password={localStorage.getItem('xxt_password_hash') ? `__STORED_PASSHASH__${localStorage.getItem('xxt_password_hash')}` : ''}
          />
        </Show>
        
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
          serverBaseUrl={authService.getHttpBaseUrl(props.serverHost, props.serverPort)}
          selectedDevices={props.selectedDevices()}
        />
        
        {/* Device Context Menu */}
        <ContextMenu
          isOpen={!!contextMenuDevice()}
          position={contextMenuPosition()}
          onClose={closeContextMenu}
        >
          <>
            {/* 批量操作区域 - 仅当选中多个设备时显示 */}
            <Show when={props.selectedDevices().length > 1}>
              <ContextMenuSection label={`选中的 ${props.selectedDevices().length} 台设备`}>
                <ContextMenuButton onClick={handleContextMenuCopySelectedUdids}>拷贝选中设备 UDID</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedNames}>拷贝选中设备名称</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedIps}>拷贝选中设备 IP</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedLastLogs}>拷贝选中设备最后日志</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedScriptSelects}>拷贝选中设备的脚本文件名</ContextMenuButton>
                <Show when={props.onOpenAddToGroupModal}>
                  <ContextMenuButton onClick={() => {
                    closeContextMenu();
                    props.onOpenAddToGroupModal?.();
                  }}>添加到分组 ({props.selectedDevices().length})</ContextMenuButton>
                </Show>
              </ContextMenuSection>
              <ContextMenuDivider />
            </Show>
            
            {/* 当前设备操作 */}
            <ContextMenuSection label={contextMenuDevice()?.system?.name || '未知设备'}>
              <ContextMenuButton onClick={handleContextMenuCopyUdid}>拷贝 UDID</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyName}>拷贝设备名称</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyIp}>拷贝 IP 地址</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyLastLog}>拷贝最后日志</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyScriptSelect}>拷贝脚本文件名</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuOpenFileBrowser}>浏览设备文件</ContextMenuButton>
            </ContextMenuSection>
          </>
        </ContextMenu>

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
