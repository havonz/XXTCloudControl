import { Component, createSignal, For, Accessor, Show, createEffect, createMemo, JSX, onMount, onCleanup } from 'solid-js';
import { AuthService, Device } from '../services/AuthService';
import { WebSocketService } from '../services/WebSocketService';
import { useDialog } from './DialogContext';
import { useToast } from './ToastContext';
import WebRTCControl from './WebRTCControl';
import BatchRemoteControl from './BatchRemoteControl';
import styles from './DeviceList.module.css';
import DeviceBindingModal from './DeviceBindingModal';
import DictionaryModal from './DictionaryModal';
import { ScriptSelectionModal } from './ScriptSelectionModal';
import { ScriptUploadModal } from './ScriptUploadModal';
import ServerFileBrowser from './ServerFileBrowser';
import LogStreamModal from './LogStreamModal';
import { 
  IconRotate, 
  IconLink, 
  IconFolderOpen, 
  IconPlay, 
  IconStop, 
  IconGear, 
  IconClipboardCheck, 
  IconEllipsis, 
  IconSliders, 
  IconCheckDouble, 
  IconArrowsRotate,
  IconGamepad,
  IconVideo,
  IconBook,
  IconListCheck,
  IconLock,
  IconUnlock,
  IconSun,
  IconVolumeHigh,
  IconPause,
  IconPowerOff,
  IconAnglesRight,
  IconLoader,
  IconUpload,
  IconCamera
} from '../icons';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { useScriptConfigManager } from '../hooks/useScriptConfigManager';
import ScriptConfigModal from './ScriptConfigModal';
import { authFetch } from '../services/httpAuth';
import { scanEntries, ScannedFile } from '../utils/fileUpload';
import { buildBatchSnapshotFeedback, type BatchScreenshotSaveResult } from '../utils/batchSnapshotFeedback';
import ContextMenu, { ContextMenuButton, ContextMenuDivider, ContextMenuSection } from './ContextMenu';
import BrightnessModal from '../modals/domain/BrightnessModal';
import VolumeModal from '../modals/domain/VolumeModal';
import { DeviceControlService } from '../services/DeviceControlService';
import { useI18n } from '../i18n';
import type { GroupInfo } from '../types';

interface DeviceListProps {
  devices: Device[];
  onDeviceSelect: (devices: Device[], touchedDeviceIds: readonly string[]) => void;
  selectedDevices: Accessor<Device[]>;
  onRefresh: () => void;
  onStartScript: (scriptName: string) => void;
  onStopScript: () => void;
  onRespringDevices: () => void;
  onUploadFiles: (files: ScannedFile[], uploadPath: string) => Promise<void>;
  onOpenFileBrowser: (deviceUdid: string, deviceName: string) => void;
  webSocketService: WebSocketService | null;
  isLoading: boolean;
  serverHost: string;
  serverPort: string;
  getGroupedDevicesForLaunch?: (selectedDeviceIds: string[]) => Array<{ groupId: string; groupName: string; scriptPath: string | undefined; deviceIds: string[] }>; // 获取按分组分配的设备列表
  onOpenAddToGroupModal?: () => void; // 打开添加到分组弹窗
  currentGroup?: GroupInfo | null;
  onRemoveDevicesFromGroup?: (groupId: string, deviceIds: string[]) => Promise<boolean>;
  sidebar?: JSX.Element;
  isMobileMenuOpen?: boolean;
  onCloseMobileMenu?: () => void;
}

interface DeviceDisplayInfo {
  name: string;
  version: string;
  battery: number;
  running: boolean;
  paused: boolean;
}

const DeviceList: Component<DeviceListProps> = (props) => {
  const dialog = useDialog();
  const toast = useToast();
  const { t } = useI18n();
  const authService = AuthService.getInstance();
  
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
  let lastAppliedWidth = 0;

  const [isMobile, setIsMobile] = createSignal(
    window.matchMedia('(max-width: 768px)').matches
  );
  let mobileMedia: MediaQueryList | null = null;
  let mobileMediaHandler: ((event?: MediaQueryListEvent) => void) | null = null;

  const handleResizeStart = (e: MouseEvent, colId: string) => {
    e.stopPropagation();
    resizingColumn = colId;
    startX = e.pageX;
    startWidth = columnWidths()[colId] || DEFAULT_WIDTHS[colId];
    lastAppliedWidth = startWidth;
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeStop);
    document.body.classList.add('resizing');
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingColumn) return;
    const delta = e.pageX - startX;
    
    // If we've dragged more than a few pixels, update widths and mark as dragged
    if (Math.abs(delta) > 3) {
      document.body.classList.add('resizing');
      const newWidth = Math.max(50, startWidth + delta);
      if (newWidth === lastAppliedWidth) return;
      lastAppliedWidth = newWidth;
      setColumnWidths(prev => ({
        ...prev,
        [resizingColumn!]: newWidth
      }));
    }
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
  const [showScriptSelectionModal, setShowScriptSelectionModal] = createSignal(false);
  const [showScriptUploadModal, setShowScriptUploadModal] = createSignal(false);
  const [showServerFileBrowser, setShowServerFileBrowser] = createSignal(false);
  const [showLogStreamModal, setShowLogStreamModal] = createSignal(false);
  const [logStreamDevice, setLogStreamDevice] = createSignal<Device | null>(null);
  const [showUploadModal, setShowUploadModal] = createSignal(false);
  const [modalUploadPath, setModalUploadPath] = createSignal('/lua/scripts');
  const [modalUploadFiles, setModalUploadFiles] = createSignal<ScannedFile[]>([]);
  const [modalIsDragOver, setModalIsDragOver] = createSignal(false);
  let modalFileInputRef: HTMLInputElement | undefined;
  
  // More actions menu state
  const [showMoreActions, setShowMoreActions] = createSignal(false);
  
  // Device control modals state
  const [showBrightnessModal, setShowBrightnessModal] = createSignal(false);
  const [brightnessValue, setBrightnessValue] = createSignal(50);
  const [isSettingBrightness, setIsSettingBrightness] = createSignal(false);
  const [showVolumeModal, setShowVolumeModal] = createSignal(false);
  const [volumeValue, setVolumeValue] = createSignal(50);
  const [isSettingVolume, setIsSettingVolume] = createSignal(false);
  const [isBatchSnapshotting, setIsBatchSnapshotting] = createSignal(false);
  
  // DeviceControlService instance (lazily created when needed)
  let deviceControlService: DeviceControlService | null = null;
  const getDeviceControlService = () => {
    if (!deviceControlService && props.webSocketService) {
      const password = authService.getCurrentCredentials()?.password || '';
      deviceControlService = new DeviceControlService(props.webSocketService, password);
    }
    return deviceControlService;
  };

  onCleanup(() => {
    deviceControlService?.destroy();
    deviceControlService = null;
  });
  
  // Device messages: local immediate write, then backend message overwrites on arrival.
  const [localDeviceMessages, setLocalDeviceMessages] = createSignal<Record<string, string>>({}, { equals: false });
  const [lastLogs, setLastLogs] = createStore<Record<string, string>>({});
  const localMessageTimers = new Map<string, number>();
  const localMessageTTL = 10000;
  const setDeviceMessage = (udid: string, message: string) => {
    setLocalDeviceMessages((prev) => {
      if (prev[udid] === message) {
        return prev;
      }
      return {
        ...prev,
        [udid]: message,
      };
    });
    const timer = localMessageTimers.get(udid);
    if (timer) {
      clearTimeout(timer);
    }
    const nextTimer = window.setTimeout(() => {
      setLocalDeviceMessages((prev) => {
        if (prev[udid] !== message) {
          return prev;
        }
        const next = { ...prev };
        delete next[udid];
        return next;
      });
      localMessageTimers.delete(udid);
    }, localMessageTTL);
    localMessageTimers.set(udid, nextTimer);

    props.webSocketService?.updateDeviceMessage(udid, message);
  };
  const getDisplayMessage = (device: Device): string => {
    return localDeviceMessages()[device.udid] || device.system?.message || '';
  };
  const getDisplayLog = (device: Device): string => {
    return lastLogs[device.udid] ?? device.system?.log ?? '';
  };
  const formatLogPreview = (log: string, maxLen = 50): string => {
    if (!log) return t('device_list.no_log');
    return log.length > maxLen ? `${log.substring(0, maxLen)}...` : log;
  };
  
  // Device context menu state
  const [contextMenuDevice, setContextMenuDevice] = createSignal<Device | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  const [lastSelectedUdid, setLastSelectedUdid] = createSignal<string | null>(null);
  const [isRemovingDevicesFromGroup, setIsRemovingDevicesFromGroup] = createSignal(false);
  const canRemoveSelectedFromCurrentGroup = createMemo(() => (
    !!props.currentGroup
    && !!props.onRemoveDevicesFromGroup
    && props.selectedDevices().length > 0
  ));
  const contextMenuDeviceIsOnlySelectedDevice = createMemo(() => {
    const device = contextMenuDevice();
    const selectedDevices = props.selectedDevices();
    return !!device && selectedDevices.length === 1 && selectedDevices[0].udid === device.udid;
  });
  const showSelectedDevicesContextSection = createMemo(() => {
    const selectedDeviceCount = props.selectedDevices().length;
    return !!contextMenuDevice()
      && (selectedDeviceCount > 1 || (selectedDeviceCount === 1 && !contextMenuDeviceIsOnlySelectedDevice()));
  });
  const canRemoveContextMenuDeviceFromCurrentGroup = createMemo(() => {
    const group = props.currentGroup;
    const device = contextMenuDevice();
    return !!group
      && !!props.onRemoveDevicesFromGroup
      && contextMenuDeviceIsOnlySelectedDevice()
      && !!device
      && group.deviceIds.includes(device.udid);
  });
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

  const removeDevicesFromCurrentGroup = async (candidateDeviceIds: string[]) => {
    const group = props.currentGroup;
    const removeDevices = props.onRemoveDevicesFromGroup;
    if (!group || !removeDevices || isRemovingDevicesFromGroup()) return;

    const groupDeviceIds = new Set(group.deviceIds);
    const deviceIds = Array.from(new Set(candidateDeviceIds.filter((udid) => groupDeviceIds.has(udid))));
    closeContextMenu();

    if (deviceIds.length === 0) {
      toast.showWarning(t('group.remove_current_no_members'));
      return;
    }

    setIsRemovingDevicesFromGroup(true);
    try {
      const success = await removeDevices(group.id, deviceIds);
      if (success) {
        toast.showSuccess(t('group.remove_current_success', { name: group.name, count: deviceIds.length }));
      } else {
        toast.showError(t('group.remove_current_failed'));
      }
    } catch {
      toast.showError(t('group.remove_current_failed'));
    } finally {
      setIsRemovingDevicesFromGroup(false);
    }
  };

  const handleRemoveSelectedFromCurrentGroup = () => (
    removeDevicesFromCurrentGroup(props.selectedDevices().map((device) => device.udid))
  );

  const handleRemoveContextMenuDeviceFromCurrentGroup = () => {
    const device = contextMenuDevice();
    if (!device) return;
    return removeDevicesFromCurrentGroup([device.udid]);
  };

  const copyContextMenuDeviceValue = (
    type: string,
    resolveValue: (device: Device) => string,
    emptyMessage?: string,
  ) => {
    const device = contextMenuDevice();
    const value = device ? resolveValue(device) : '';

    if (value || !emptyMessage) {
      void copyToClipboard(value, type);
    } else {
      showToastMessage(emptyMessage);
    }

    closeContextMenu();
  };

  const copySelectedDeviceValues = (
    type: string,
    resolveValue: (device: Device) => string,
    emptyMessage?: string,
  ) => {
    const value = props.selectedDevices()
      .map(resolveValue)
      .filter((item) => item !== '')
      .join('\n');

    if (value || !emptyMessage) {
      void copyToClipboard(value, type);
    } else {
      showToastMessage(emptyMessage);
    }

    closeContextMenu();
  };
  
  const handleContextMenuCopyUdid = () => {
    copyContextMenuDeviceValue('UDID', (device) => device.udid);
  };
  
  const handleContextMenuCopyName = () => {
    copyContextMenuDeviceValue(t('device_list.copy_type_name'), (device) => device.system?.name || t('device.unknown'));
  };
  
  const handleContextMenuCopyIp = () => {
    copyContextMenuDeviceValue(t('device_list.copy_type_ip'), (device) => device.system?.ip || t('common.unknown'));
  };
  
  const handleContextMenuOpenFileBrowser = () => {
    const device = contextMenuDevice();
    if (device) {
      const name = device.system?.name || t('device.unknown');
      props.onOpenFileBrowser(device.udid, name);
    }
    closeContextMenu();
  };

  const handleContextMenuOpenLogStream = () => {
    const device = contextMenuDevice();
    if (device) {
      setLogStreamDevice(device);
      setShowLogStreamModal(true);
    }
    closeContextMenu();
  };
  
  // 批量拷贝选中设备信息
  const handleContextMenuCopySelectedUdids = () => {
    copySelectedDeviceValues(t('device_list.copy_type_selected_udid'), (device) => device.udid);
  };
  
  const handleContextMenuCopySelectedNames = () => {
    copySelectedDeviceValues(t('device_list.copy_type_selected_name'), (device) => device.system?.name || t('device.unknown'));
  };
  
  const handleContextMenuCopySelectedIps = () => {
    copySelectedDeviceValues(t('device_list.copy_type_selected_ip'), (device) => device.system?.ip || t('common.unknown'));
  };
  
  // 拷贝最后日志
  const handleContextMenuCopyLastLog = () => {
    copyContextMenuDeviceValue(t('device_list.last_log'), (device) => getDisplayLog(device), t('device_list.no_device_log'));
  };
  
  // 拷贝选中设备最后日志
  const handleContextMenuCopySelectedLastLogs = () => {
    copySelectedDeviceValues(
      t('device_list.copy_type_selected_last_log'),
      (device) => {
        const log = getDisplayLog(device);
        if (!log) {
          return '';
        }

        const name = device.system?.name || device.udid;
        return `[${name}] ${log}`;
      },
      t('device_list.no_selected_log'),
    );
  };

  // 拷贝脚本文件名
  const handleContextMenuCopyScriptSelect = () => {
    copyContextMenuDeviceValue(t('device_list.script_file_name'), (device) => device.script?.select || '', t('device_list.no_device_script'));
  };

  // 拷贝选中设备的脚本文件名
  const handleContextMenuCopySelectedScriptSelects = () => {
    copySelectedDeviceValues(
      t('device_list.copy_type_selected_script'),
      (device) => {
        const scriptName = device.script?.select || '';
        if (!scriptName) {
          return '';
        }

        const name = device.system?.name || device.udid;
        return `[${name}] ${scriptName}`;
      },
      t('device_list.no_selected_script'),
    );
  };
  
  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    mobileMedia = window.matchMedia('(max-width: 768px)');
    mobileMediaHandler = (event?: MediaQueryListEvent) => {
      const matches = event ? event.matches : mobileMedia?.matches ?? window.innerWidth <= 768;
      setIsMobile(matches);
    };
    mobileMediaHandler();
    if ('addEventListener' in mobileMedia) {
      mobileMedia.addEventListener('change', mobileMediaHandler);
    } else {
      // @ts-expect-error Legacy Safari API
      mobileMedia.addListener(mobileMediaHandler);
    }
  });
  
  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside);
    if (mobileMedia) {
      if (mobileMediaHandler) {
        if ('removeEventListener' in mobileMedia) {
          mobileMedia.removeEventListener('change', mobileMediaHandler);
        } else {
          // @ts-expect-error Legacy Safari API
          mobileMedia.removeListener(mobileMediaHandler);
        }
      }
      mobileMedia = null;
      mobileMediaHandler = null;
    }
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    localMessageTimers.forEach((timer) => clearTimeout(timer));
    localMessageTimers.clear();
  });

  createEffect(() => {
    const devices = props.devices;
    setLocalDeviceMessages((prev) => {
      if (Object.keys(prev).length === 0) {
        return prev;
      }
      let next: Record<string, string> | null = null;
      for (const device of devices) {
        const localMessage = prev[device.udid];
        if (!localMessage) {
          continue;
        }
        const backendMessage = device.system?.message || '';
        if (backendMessage && backendMessage !== localMessage) {
          if (next === null) {
            next = { ...prev };
          }
          delete next[device.udid];
          const timer = localMessageTimers.get(device.udid);
          if (timer) {
            clearTimeout(timer);
            localMessageTimers.delete(device.udid);
          }
        }
      }
      if (next === null) {
        return prev;
      }
      return next;
    });
  });

  createEffect(() => {
    const ws = props.webSocketService;
    if (!ws) {
      return;
    }

    const unsubscribe = ws.onLastLogUpdate((udid, lastLine) => {
      setLastLogs(udid, lastLine);
    });

    onCleanup(unsubscribe);
  });
  

  
  // Real-time control modal state

  
  // WebRTC control modal state
  const [showWebRTCModal, setShowWebRTCModal] = createSignal(false);
  
  // Batch Remote control modal state
  const [showBatchRemoteModal, setShowBatchRemoteModal] = createSignal(false);
  
  // Sorting state
  const [sortField, setSortField] = createSignal<string>('');
  const [sortDirection, setSortDirection] = createSignal<'asc' | 'desc'>('asc');

  // Selectable scripts state
  const [selectableScripts, setSelectableScripts] = createSignal<string[]>([]);
  const [isLoadingScripts, setIsLoadingScripts] = createSignal(false);
  const [isSubmittingScriptAction, setIsSubmittingScriptAction] = createSignal(false);
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

  const formatScriptOption = (script: string) => {
    if (script === DEVICE_SELECTED_PLACEHOLDER) return t('group.device_selected_script');
    return script;
  };

  // Script config manager
  const scriptConfigManager = useScriptConfigManager();
  const [isConfigurable, setIsConfigurable] = createSignal(false);
  const cancelableScriptStartDevices = createMemo(() =>
    props.selectedDevices().filter((device) => device.scriptStart?.active && device.scriptStart?.cancelable)
  );
  const hasCancelableScriptStarts = createMemo(() => cancelableScriptStartDevices().length > 0);

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

  const syncScriptStartStates = async () => {
    const ws = props.webSocketService;
    if (!ws) {
      return;
    }

    try {
      const response = await authFetch('/api/scripts/start-state');
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      ws.replaceScriptStartStates(data?.states && typeof data.states === 'object' ? data.states : {});
    } catch (error) {
      console.error('加载脚本启动状态失败:', error);
    }
  };

  createEffect(() => {
    const ws = props.webSocketService;
    if (!ws) {
      return;
    }

    void syncScriptStartStates();

    const unsubscribe = ws.onStatusChange((status) => {
      if (status === 'connected') {
        void syncScriptStartStates();
      }
    });

    onCleanup(unsubscribe);
  });


  // Fetch selectable scripts from server
  const fetchSelectableScripts = async () => {
    if (isLoadingScripts()) return;
    
    setIsLoadingScripts(true);
    try {
      const response = await authFetch('/api/scripts/selectable');
      const data = await response.json();
      
      if (data.scripts && Array.isArray(data.scripts)) {
        // API returns array of {name, path} objects, extract names
        const names = data.scripts.map((s: { name: string; path: string }) => s.name);
        setSelectableScripts(names);
      }
    } catch (error) {
      console.error('获取可选脚本失败:', error);
    } finally {
      setIsLoadingScripts(false);
    }
  };

  const resolveScriptName = (name: string | undefined): string => {
    if (!name) return '';
    if (name === DEVICE_SELECTED_PLACEHOLDER || name.includes('设备端已选中')) {
      return '';
    }
    return name;
  };

  const handleSendAndStartScript = async () => {
    if (props.selectedDevices().length === 0) return;
    if (isSubmittingScriptAction()) return;

    type LaunchBatch = {
      deviceIds: string[];
      scriptName: string;
      selectedGroups: string[];
      groupId?: string;
      groupName?: string;
    };

    const selectedDeviceIds = props.selectedDevices().map((d: Device) => d.udid);
    const groupedDevices = props.getGroupedDevicesForLaunch?.(selectedDeviceIds) || [];
    const batches: LaunchBatch[] = [];

    if (groupedDevices.length > 0) {
      for (const group of groupedDevices) {
        const rawScriptName = group.scriptPath || serverScriptName();
        const scriptToRun = resolveScriptName(rawScriptName);

        if (!rawScriptName && !serverScriptName()) {
          console.warn(`分组 ${group.groupName} 没有绑定脚本且未选择全局脚本，跳过`);
          continue;
        }

        batches.push({
          deviceIds: group.deviceIds,
          scriptName: scriptToRun,
          selectedGroups: [group.groupId],
          groupId: group.groupId,
          groupName: group.groupName,
        });
      }
    } else {
      const effectiveScriptName = resolveScriptName(serverScriptName());

      if (effectiveScriptName === '' && serverScriptName() !== DEVICE_SELECTED_PLACEHOLDER) {
        showToastMessage(t('device_list.choose_script_first'));
        return;
      }

      batches.push({
        deviceIds: selectedDeviceIds,
        scriptName: effectiveScriptName,
        selectedGroups: ['__all__'],
      });
    }

    setIsSubmittingScriptAction(true);
    try {
      for (const batch of batches) {
        if (!batch.scriptName) continue;
        const confirmed = batch.groupId
          ? await scriptConfigManager.ensureGroupLaunchConfig(batch.groupId, batch.groupName || batch.groupId, batch.scriptName)
          : await scriptConfigManager.ensureGlobalLaunchConfig(batch.scriptName);
        if (!confirmed) {
          showToastMessage(t('device_list.script_start_canceled'));
          return;
        }
      }

      selectedDeviceIds.forEach((udid) => {
        setDeviceMessage(udid, t('device_list.msg_starting_script'));
      });

      if (groupedDevices.length > 0) {
        // 按分组分批发送
        let successCount = 0;
        let failCount = 0;

        for (const batch of batches) {
          try {
            const response = await authFetch('/api/scripts/send-and-start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                devices: batch.deviceIds,
                name: batch.scriptName,
                selectedGroups: batch.selectedGroups,
                serverBaseUrl: getTransferBaseUrl(),
              }),
            });
            
            const result = await response.json();
            if (result.success) {
              successCount += batch.deviceIds.length;
            } else {
              failCount += batch.deviceIds.length;
              console.error(`分组 ${batch.groupName || batch.groupId} 发送失败:`, result.error);
            }
          } catch (error) {
            failCount += batch.deviceIds.length;
            console.error(`分组 ${batch.groupName || batch.groupId} 发送错误:`, error);
          }
        }
        
        if (failCount === 0) {
          showToastMessage(t('device_list.script_started_count', { count: successCount }));
        } else {
          showToastMessage(t('device_list.partial_success', { success: successCount, fail: failCount }));
        }
      } else {
        // 没有分组（选中"所有设备"），使用全局配置
        const batch = batches[0];
        const response = await authFetch('/api/scripts/send-and-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devices: batch.deviceIds,
            name: batch.scriptName,
            selectedGroups: batch.selectedGroups,
            serverBaseUrl: getTransferBaseUrl(),
          }),
        });
        
        const result = await response.json();
        if (result.success) {
          showToastMessage(t('device_list.script_started'));
        } else {
          console.error('发送脚本失败:', result.error);
          showToastMessage(t('device_list.send_script_failed', { msg: result.error || t('common.unknown_error') }));
        }
      }
    } catch (error) {
      console.error('发送脚本错误:', error);
      showToastMessage(t('device_list.send_script_network_failed'));
    } finally {
      setIsSubmittingScriptAction(false);
    }
  };

  const handleCancelScriptStart = async () => {
    const devicesToCancel = cancelableScriptStartDevices();
    if (devicesToCancel.length === 0) {
      showToastMessage(t('device_list.no_cancelable_start'));
      return;
    }

    const confirmed = await dialog.confirm(
      t('device_list.cancel_start_confirm', { count: devicesToCancel.length }),
      t('device_list.cancel_start_title')
    );
    if (!confirmed) {
      return;
    }

    setIsSubmittingScriptAction(true);
    try {
      const deviceIds = devicesToCancel.map((device) => device.udid);
      deviceIds.forEach((udid) => {
        setDeviceMessage(udid, t('device_list.msg_canceling_start'));
      });

      const response = await authFetch('/api/scripts/send-and-start/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devices: deviceIds }),
      });
      const result = await response.json();

      if (!response.ok) {
        showToastMessage(t('device_list.cancel_start_failed', { msg: result?.error || t('common.unknown_error') }));
        return;
      }

      const canceledCount = Array.isArray(result?.canceled) ? result.canceled.length : 0;
      if (canceledCount > 0) {
        showToastMessage(t('device_list.cancel_start_requested', { count: canceledCount }));
      } else {
        showToastMessage(t('device_list.no_cancelable_start'));
      }
    } catch (error) {
      console.error('取消启动脚本失败:', error);
      showToastMessage(t('device_list.cancel_start_network_failed'));
    } finally {
      setIsSubmittingScriptAction(false);
    }
  };

  const handleScriptStartButtonClick = async () => {
    if (hasCancelableScriptStarts()) {
      await handleCancelScriptStart();
      return;
    }

    await handleSendAndStartScript();
  };


  // Copy to clipboard function
  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToastMessage(t('device_list.copied_to_clipboard', { type }));
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
        showToastMessage(t('device_list.copied_to_clipboard', { type }));
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
        showToastMessage(t('device_list.copy_failed'));
      }
    }
  };
  
  // Show toast notification
  const showToastMessage = (message: string) => {
    toast.showInfo(message);
  };

  const getTransferBaseUrl = () => {
    const host = props.serverHost?.trim();
    const port = props.serverPort?.trim();
    if (!host || !port) {
      return window.location.origin;
    }
    return authService.getHttpBaseUrl(host, port);
  };
  
  // Handle table header click for sorting
  const handleSort = (field: string) => {
    // Prevent sort if a drag just finished
    if (document.body.classList.contains('resizing')) {
      return;
    }

    if (sortField() === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new field and default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  const sortConfig = createMemo(() => ({
    field: sortField(),
    direction: sortDirection(),
  }));

  const getSortValue = (device: Device, field: string): string | number => {
    switch (field) {
      case 'name':
        return device.system?.name || '';
      case 'udid':
        return device.udid || '';
      case 'ip':
        return device.system?.ip || '';
      case 'version':
        return device.system?.version || '';
      case 'battery':
        return device.system?.battery || 0;
      case 'running':
        return device.script?.running ? 1 : 0;
      case 'script':
        return device.script?.select || '';
      case 'log':
        return getDisplayLog(device);
      default:
        return '';
    }
  };

  const filteredDevices = createMemo(() => {
    const { field, direction } = sortConfig();
    if (!field) return props.devices;

    const sorted = [...props.devices];
    const multiplier = direction === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      const aValue = getSortValue(a, field);
      const bValue = getSortValue(b, field);

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return aValue.localeCompare(bValue) * multiplier;
      }
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * multiplier;
      }
      return 0;
    });
    return sorted;
  });

  const selectedUdidSet = createMemo(() => {
    return new Set(props.selectedDevices().map(d => d.udid));
  });

  const selectedCountInView = createMemo(() => {
    const selectedSet = selectedUdidSet();
    let selectedCount = 0;
    for (const device of filteredDevices()) {
      if (selectedSet.has(device.udid)) {
        selectedCount++;
      }
    }
    return selectedCount;
  });

  const isAllSelected = createMemo(() => {
    const allDevices = filteredDevices();
    return allDevices.length > 0 && selectedCountInView() === allDevices.length;
  });

  const isPartiallySelected = createMemo(() => {
    const allDevices = filteredDevices();
    const selectedCount = selectedCountInView();
    return selectedCount > 0 && selectedCount < allDevices.length;
  });

  const gridTemplateColumns = createMemo(() => {
    const widths = columnWidths();
    const columns = visibleColumns();
    const rest = columns.map((id) => {
      const width = widths[id] || DEFAULT_WIDTHS[id];
      return `${width}px`;
    }).join(' ');
    // Append a 1fr spacer column to the end to consume any remaining horizontal container width
    // while keeping all defined columns fixed to their actual designated widths
    return `${widths.selection || DEFAULT_WIDTHS.selection}px ${rest} 1fr`;
  });

  const handleDeviceToggle = (device: Device, e?: MouseEvent) => {
    const isSelected = selectedUdidSet().has(device.udid);
    const devices = filteredDevices();
    
    if (e?.shiftKey && lastSelectedUdid()) {
      const lastUdid = lastSelectedUdid();
      let lastIndex = -1;
      let currentIndex = -1;
      for (let i = 0; i < devices.length; i++) {
        const udid = devices[i].udid;
        if (udid === lastUdid) lastIndex = i;
        if (udid === device.udid) currentIndex = i;
        if (lastIndex !== -1 && currentIndex !== -1) break;
      }
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const range = devices.slice(start, end + 1);
        
        const currentSelectedUdids = new Set(props.selectedDevices().map(d => d.udid));
        
        // If the clicked device is NOT selected, we select the range.
        // If it IS selected, we also select the range (standard behavior usually adds to existing selection).
        range.forEach(d => currentSelectedUdids.add(d.udid));
        
        const newSelection = props.devices.filter(d => currentSelectedUdids.has(d.udid));
        props.onDeviceSelect(newSelection, range.map((item) => item.udid));
        setLastSelectedUdid(device.udid);
        return;
      }
    }

    if (isSelected) {
      // 取消选择
      const newSelection = props.selectedDevices().filter(d => d.udid !== device.udid);
      props.onDeviceSelect(newSelection, [device.udid]);
    } else {
      // 添加到选择
      const newSelection = [...props.selectedDevices(), device];
      props.onDeviceSelect(newSelection, [device.udid]);
    }
    setLastSelectedUdid(device.udid);
  };

  const handleSelectAll = () => {
    const allDevices = filteredDevices();
    const selectedSet = selectedUdidSet();
    const allSelected = isAllSelected();
    const touchedDeviceIds = allDevices.map(device => device.udid);
    const allDeviceUdidSet = new Set(touchedDeviceIds);
    
    if (allSelected) {
      // 取消全选
      const remainingDevices = props.selectedDevices().filter(device => 
        !allDeviceUdidSet.has(device.udid)
      );
      props.onDeviceSelect(remainingDevices, touchedDeviceIds);
    } else {
      // 全选
      const newDevices = allDevices.filter(device => 
        !selectedSet.has(device.udid)
      );
      props.onDeviceSelect([...props.selectedDevices(), ...newDevices], touchedDeviceIds);
    }
  };

  const handleInvertSelection = () => {
    const allDevices = filteredDevices();
    const selectedSet = selectedUdidSet();
    const newSelection = allDevices.filter(d => !selectedSet.has(d.udid));
    props.onDeviceSelect(newSelection, allDevices.map((device) => device.udid));
  };

  const toggleColumn = (col: string) => {
    const columns = visibleColumns();
    if (columns.includes(col)) {
      if (columns.length > 1) {
        setVisibleColumns(columns.filter(c => c !== col));
      }
    } else {
      setVisibleColumns([...columns, col]);
    }
  };

  const getSelectAllIndicatorClass = (): string => {
    if (isAllSelected()) {
      return styles.checked;
    }
    if (isPartiallySelected()) {
      return styles.indeterminate;
    }
    return '';
  };

  const getSelectAllIndicatorText = (): string => {
    if (isAllSelected()) {
      return '✓';
    }
    if (isPartiallySelected()) {
      return '−';
    }
    return '';
  };

  const getSortIndicator = (field: string): string => {
    if (sortField() !== field) {
      return '';
    }
    return sortDirection() === 'asc' ? ' ↑' : ' ↓';
  };

  const formatDeviceInfo = (device: Device): DeviceDisplayInfo => {
    if (device.system) {
      return {
        name: device.system.name || t('device.unknown'),
        version: device.system.version || t('device_list.unknown_version'),
        battery: Math.round((device.system.battery || 0) * 100),
        running: device.system.running || false,
        paused: device.system.paused || false
      };
    }
    return {
      name: t('device.unknown'),
      version: t('device_list.unknown_version'),
      battery: 0,
      running: false,
      paused: false
    };
  };

  const getBatteryColor = (battery: number): string => {
    if (battery > 80) return 'var(--battery-5)';
    if (battery > 60) return 'var(--battery-4)';
    if (battery > 40) return 'var(--battery-3)';
    if (battery > 20) return 'var(--battery-2)';
    return 'var(--battery-1)';
  };

  const getRunningStatusClass = (info: DeviceDisplayInfo): string => {
    if (!info.running) {
      return styles.stopped;
    }
    if (info.paused) {
      return styles.paused;
    }
    return styles.running;
  };

  const getRunningStatusText = (info: DeviceDisplayInfo): string => {
    if (!info.running) {
      return t('device.status_stopped');
    }
    if (info.paused) {
      return t('device.status_paused');
    }
    return t('device.status_running');
  };
  
  const handleRespringDevices = async () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage(t('device.choose_first'));
      return;
    }
    if (await dialog.confirm(t('device_list.respring_confirm', { count: props.selectedDevices().length }))) {
      handleConfirmRespring();
    }
  };

  const handleConfirmRespring = () => {
    props.onRespringDevices();
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
      showToastMessage(t('device_list.upload_request_sent'));
      setModalUploadFiles([]);
      setShowUploadModal(false);
    } catch (error) {
      console.error('文件上传失败:', error);
      showToastMessage(t('device_list.upload_failed'));
    }
  };



  // WebRTC 实时控制
  const handleOpenWebRTCControl = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage(t('device.choose_first'));
      return;
    }
    setShowWebRTCModal(true);
  };

  const handleCloseWebRTCControl = () => {
    setShowWebRTCModal(false);
  };
  
  // 批量实时控制
  const handleOpenBatchRemoteControl = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage(t('device.choose_first'));
      return;
    }
    setShowBatchRemoteModal(true);
  };

  const handleCloseBatchRemoteControl = () => {
    setShowBatchRemoteModal(false);
  };

  const handleBatchSnapshot = async () => {
    const selectedDevices = props.selectedDevices();
    if (selectedDevices.length === 0 || isBatchSnapshotting()) {
      return;
    }

    const deviceIds = Array.from(new Set(selectedDevices.map((device) => device.udid).filter(Boolean)));
    if (deviceIds.length === 0) {
      return;
    }

    setIsBatchSnapshotting(true);
    deviceIds.forEach((udid) => setDeviceMessage(udid, t('device_list.msg_screenshotting')));

    try {
      const response = await authFetch('/api/devices/snapshot-save-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds }),
      });
      const payload = await response.json().catch(() => ({} as { error?: string; results?: BatchScreenshotSaveResult[] }));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const feedback = buildBatchSnapshotFeedback(
        deviceIds,
        Array.isArray(payload.results) ? payload.results : [],
        t,
      );

      for (const [udid, message] of Object.entries(feedback.perDeviceMessages)) {
        setDeviceMessage(udid, message);
      }

      if (feedback.toastType === 'success') {
        toast.showSuccess(feedback.toastMessage);
      } else if (feedback.toastType === 'warning') {
        toast.showWarning(feedback.toastMessage);
      } else {
        toast.showError(feedback.toastMessage);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const msg = reason || t('common.unknown_error');
      deviceIds.forEach((udid) => setDeviceMessage(udid, t('device_list.screenshot_failed', { msg })));
      toast.showError(t('device_list.batch_snapshot_failed', { msg }));
    } finally {
      setIsBatchSnapshotting(false);
    }
  };
  
  const handleDeviceBinding = () => {
    setShowDeviceBindingModal(true);
  };

  const handleScriptSelection = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage(t('device.choose_first'));
      return;
    }
    setShowScriptSelectionModal(true);
  };

  const handleSelectScript = async (scriptName: string) => {
    if (!props.webSocketService) {
      showToastMessage(t('device_list.websocket_not_connected'));
      return;
    }

    try {
      const deviceUdids = props.selectedDevices().map(d => d.udid);
      await props.webSocketService.selectScript(deviceUdids, scriptName);
      showToastMessage(t('device_list.script_selected_count', { count: deviceUdids.length, name: scriptName }));
    } catch (error) {
      console.error('选择脚本失败:', error);
      showToastMessage(t('device_list.select_script_failed'));
    }
  };
  
  const handleModalCancel = () => {
    setModalUploadFiles([]);
    setShowUploadModal(false);
  };
  
  const handleUploadScript = async (scriptName: string) => {
    try {
      const deviceUdids = props.selectedDevices().map(d => d.udid);
      const response = await authFetch('/api/scripts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devices: deviceUdids,
          name: scriptName,
          selectedGroups: ['__all__'],
          serverBaseUrl: getTransferBaseUrl(),
        }),
      });
      
      const result = await response.json();
      if (result.success) {
        showToastMessage(t('device_list.script_uploaded_count', { count: deviceUdids.length, name: scriptName }));
      } else {
        showToastMessage(t('files.upload_failed', { msg: result.error || t('common.unknown_error') }));
      }
    } catch (error) {
      console.error('上传脚本失败:', error);
      showToastMessage(t('modal.script_upload_failed'));
    }
  };
  
  const handleStopScript = () => {
    if (props.selectedDevices().length === 0) {
      console.warn('请先选择要控制的设备');
      return;
    }
    
    props.onStopScript();
  };
  


  // 词典操作处理函数
  const handleDictionaryAccess = () => {
    if (props.selectedDevices().length === 0) {
      showToastMessage(t('device.choose_first'));
      return;
    }
    setShowDictionaryModal(true);
  };

  const handleSetProcValue = async (key: string, value: string) => {
    if (!props.webSocketService) {
      showToastMessage(t('device_list.websocket_not_connected'));
      return;
    }

    const selectedDevices = props.selectedDevices();
    const deviceUdids = selectedDevices.map(device => device.udid);
    
    try {
      await props.webSocketService.setProcValue(deviceUdids, key, value);
      showToastMessage(t('device_list.dictionary_set_success', { key, value, count: deviceUdids.length }));
      setShowDictionaryModal(false);
    } catch (error) {
      console.error('设置词典值失败:', error);
      showToastMessage(t('device_list.dictionary_set_failed'));
    }
  };

  const handlePushToQueue = async (key: string, value: string) => {
    if (!props.webSocketService) {
      showToastMessage(t('device_list.websocket_not_connected'));
      return;
    }

    const selectedDevices = props.selectedDevices();
    const deviceUdids = selectedDevices.map(device => device.udid);
    
    try {
      await props.webSocketService.pushToQueue(deviceUdids, key, value);
      showToastMessage(t('device_list.dictionary_queue_success', { key, value, count: deviceUdids.length }));
      setShowDictionaryModal(false);
    } catch (error) {
      console.error('推送到队列失败:', error);
      showToastMessage(t('device_list.dictionary_queue_failed'));
    }
  };

  return (
    <div class={styles.deviceListContainer}>
      {/* Action Toolbar */}
      <div class={styles.actionToolbar}>
        {/* Row 1 */}
        <div class={styles.actionToolbarRow}>
          <div class={styles.deviceActionGroup}>
            <button 
              onClick={handleDeviceBinding}
              class={styles.toolbarActionButton}
            >
              <IconLink size={14} />
              <span>{t('bind.modal_title')}</span>
            </button>
            <button 
              onClick={() => setShowServerFileBrowser(true)}
              class={styles.toolbarActionButton}
            >
              <IconFolderOpen size={14} />
              <span>{t('files.server_title')}</span>
            </button>
          </div>
          
          <div class={styles.scriptSelectionGroup}>
            <button 
              onClick={() => {
                if (props.selectedDevices().length === 0) {
                  showToastMessage(t('device.choose_first'));
                  return;
                }
                setShowScriptUploadModal(true);
              }}
              class={styles.toolbarActionButton}
              disabled={props.selectedDevices().length === 0}
            >
              <IconUpload size={14} />
              <span>{t('device_list.upload_script')}</span>
            </button>

            <button 
              onClick={handleScriptSelection}
              class={styles.toolbarActionButton}
              disabled={props.selectedDevices().length === 0}
            >
              <IconClipboardCheck size={14} />
              <span>{t('files.select_script')}</span>
            </button>
          </div>
        </div>

        {/* Row 2 */}
        <div class={styles.actionToolbarRow}>
          <div class={styles.scriptActionGroup}>
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
                      {serverScriptName() ? formatScriptOption(serverScriptName()) : t('device_list.select_script_placeholder')}
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
                                <Select.ItemText>{formatScriptOption(script)}</Select.ItemText>
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
                title={t('device_list.refresh_scripts')}
              >
                <IconRotate size={14} class={isLoadingScripts() ? styles.spin : ''} />
              </button>
              <Show when={isConfigurable()}>
                <button 
                  onClick={() => scriptConfigManager.openGlobalConfig(serverScriptName())}
                  class={`${styles.toolbarActionButton} ${styles.scriptControlButton}`}
                  title={t('device_list.config')}
                >
                  <IconGear size={14} />
                  <span class={styles.hideOnMobile}>{t('device_list.config')}</span>
                </button>
              </Show>
            </div>

            <div class={styles.scriptControlGroup}>
              <button 
                class={`${styles.toolbarActionButton} ${styles.scriptControlButton}`}
                disabled={props.selectedDevices().length === 0 || isSubmittingScriptAction()}
                onClick={handleScriptStartButtonClick}
                title={hasCancelableScriptStarts() ? t('device_list.cancel_start_script') : t('device_list.start_script')}
              >
                <Show
                  when={hasCancelableScriptStarts()}
                  fallback={<IconPlay size={14} />}
                >
                  <IconLoader size={14} class={styles.spin} />
                </Show>
                <span class={styles.hideOnMobile}>{hasCancelableScriptStarts() ? t('device_list.starting_script') : t('device_list.start_script')}</span>
              </button>
            
              <button 
                onClick={handleStopScript}
                class={`${styles.toolbarActionButton} ${styles.scriptControlButton}`}
                disabled={props.selectedDevices().length === 0}
                title={t('device_list.stop_script')}
              >
                <IconStop size={14} />
                <span class={styles.hideOnMobile}>{t('device_list.stop_script')}</span>
              </button>
            </div>
          
          <div class={styles.moreActionsContainer} ref={moreActionsRef}>
            <button 
              class={styles.toolbarActionButton}
              onClick={() => setShowMoreActions(!showMoreActions())}
              disabled={props.selectedDevices().length === 0}
            >
              <IconEllipsis size={14} />
              <span>{t('device_list.more_actions')}</span>
            </button>
            <Show when={showMoreActions()}>
              <div class={styles.moreActionsMenu}>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    handleOpenWebRTCControl();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0 || showBatchRemoteModal()}
                >
                  <IconVideo size={14} />
                  <span>{t('device_list.webrtc_control')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    handleOpenBatchRemoteControl();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0 || showBatchRemoteModal()}
                >
                  <IconGamepad size={14} />
                  <span>{t('remote.batch_title')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    handleDictionaryAccess();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconBook size={14} />
                  <span>{t('modal.dictionary_title')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={async () => {
                    setShowMoreActions(false);
                    const service = getDeviceControlService();
                    if (!service || props.selectedDevices().length === 0) return;
                    const devices = props.selectedDevices();
                    // Show pending message for each device
                    devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_locking_screen')));
                    const result = await service.lockScreen(devices.map(d => d.udid));
                    // Update with result
                    devices.forEach(d => setDeviceMessage(d.udid, result.success ? t('device_list.msg_screen_locked') : t('device_list.msg_lock_failed', { msg: result.error || t('common.unknown_error') })));
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconLock size={14} />
                  <span>{t('device_list.lock_screen')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={async () => {
                    setShowMoreActions(false);
                    const service = getDeviceControlService();
                    if (!service || props.selectedDevices().length === 0) return;
                    const devices = props.selectedDevices();
                    // Show pending message for each device
                    devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_unlocking_screen')));
                    const result = await service.unlockScreen(devices.map(d => d.udid));
                    // Update with result
                    devices.forEach(d => setDeviceMessage(d.udid, result.success ? t('device_list.msg_screen_unlocked') : t('device_list.msg_unlock_failed', { msg: result.error || t('common.unknown_error') })));
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconUnlock size={14} />
                  <span>{t('device_list.unlock_screen')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    setShowMoreActions(false);
                    if (props.selectedDevices().length > 0) {
                      setShowBrightnessModal(true);
                    }
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconSun size={14} />
                  <span>{t('modal.brightness_title')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    setShowMoreActions(false);
                    if (props.selectedDevices().length > 0) {
                      setShowVolumeModal(true);
                    }
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconVolumeHigh size={14} />
                  <span>{t('modal.volume_title')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    setShowMoreActions(false);
                    void handleBatchSnapshot();
                  }}
                  disabled={props.selectedDevices().length === 0 || isBatchSnapshotting()}
                >
                  <IconCamera size={14} />
                  <span>{isBatchSnapshotting() ? t('device_list.batch_snapshotting') : t('device_list.batch_snapshot')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={async () => {
                    setShowMoreActions(false);
                    if (!props.webSocketService || props.selectedDevices().length === 0) return;
                    const devices = props.selectedDevices();
                    devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_pausing_script')));
                    await props.webSocketService.pauseScript(devices.map(d => d.udid));
                    devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_pause_sent')));
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconPause size={14} />
                  <span>{t('device_list.pause_script')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={async () => {
                    setShowMoreActions(false);
                    if (!props.webSocketService || props.selectedDevices().length === 0) return;
                    const devices = props.selectedDevices();
                    devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_resuming_script')));
                    await props.webSocketService.resumeScript(devices.map(d => d.udid));
                    devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_resume_sent')));
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconAnglesRight size={14} />
                  <span>{t('device_list.resume_script')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={() => {
                    handleRespringDevices();
                    setShowMoreActions(false);
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconLoader size={14} />
                  <span>{t('device_list.respring_devices')}</span>
                </button>
                <button 
                  class={styles.menuItem}
                  onClick={async () => {
                    setShowMoreActions(false);
                    if (!props.webSocketService || props.selectedDevices().length === 0) return;
                    if (await dialog.confirm(t('device_list.reboot_confirm', { count: props.selectedDevices().length }))) {
                      const devices = props.selectedDevices();
                      devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_rebooting')));
                      await props.webSocketService.rebootDevices(devices.map(d => d.udid));
                      devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_reboot_sent')));
                    }
                  }}
                  disabled={props.selectedDevices().length === 0}
                >
                  <IconPowerOff size={14} />
                  <span>{t('device_list.reboot_devices')}</span>
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
                  <IconSliders size={14} />
                  <span>{t('device_list.column_settings')}</span>
                </button>
                <Show when={showColumnSettings()}>
                  <div class={styles.columnDropdown}>
                    <For each={[
                      { id: 'name', label: t('device_list.column_name') },
                      { id: 'udid', label: 'UDID' },
                      { id: 'ip', label: t('device_list.column_ip') },
                      { id: 'version', label: t('device_list.column_system') },
                      { id: 'battery', label: t('device_list.column_battery') },
                      { id: 'running', label: t('device_list.column_script') },
                      { id: 'message', label: t('device_list.column_message') },
                      { id: 'log', label: t('device_list.column_last_log') },
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
                <IconArrowsRotate size={14} class={props.isLoading ? styles.spin : ''} />
                <span>{props.isLoading ? t('device_list.refreshing') : t('device_list.request_refresh')}</span>
              </button>
              <button 
                onClick={handleSelectAll}
                class={styles.toolbarButton}
              >
                <IconCheckDouble size={14} />
                <span>{t('common.select_all')}</span>
              </button>
              <button 
                onClick={handleInvertSelection}
                class={styles.toolbarButton}
              >
                <IconListCheck size={14} />
                <span>{t('device_list.invert_selection')}</span>
              </button>
            </div>
            <div class={styles.toolbarRight}>
              <div class={styles.deviceCountSummary}>
                {t('device_list.total_devices', { count: props.devices.length })}
                <Show when={props.selectedDevices().length > 0}> | {t('device.selected_count', { count: props.selectedDevices().length })}</Show>
              </div>
            </div>
          </div>

          <div class={styles.tableArea}>
            <Show when={props.isLoading && props.devices.length === 0}>
              <div class={styles.loadingState}>
                <div class={styles.spinner}></div>
                <p>{t('device_list.loading_devices')}</p>
              </div>
            </Show>
            <Show when={!props.isLoading && filteredDevices().length === 0}>
              <div class={styles.emptyState}>
                <p>{t('device_list.empty_group')}</p>
              </div>
            </Show>
            <Show when={filteredDevices().length > 0}>
          <Show when={!isMobile()}>
            <div 
              class={styles.deviceTable}
              style={{ 
                'grid-template-columns': gridTemplateColumns()
              }}
            >
                <div class={styles.tableHeader} style={{ 
                  'grid-template-columns': gridTemplateColumns()
                }}>
                  <div class={styles.headerCell}>
                    <div 
                      class={`${styles.selectAllCheckbox} ${getSelectAllIndicatorClass()}`}
                      onClick={handleSelectAll}
                    >
                      {getSelectAllIndicatorText()}
                    </div>
                    <div 
                      class={styles.resizeHandle} 
                      onMouseDown={(e) => handleResizeStart(e, 'selection')}
                    />
                  </div>
                  
                  <Show when={visibleColumns().includes('name')}>
                    <div class={`${styles.headerCell} ${styles.sortableHeader}`} onClick={() => handleSort('name')}>
                      {t('device_list.column_name')}
                      <span class={styles.sortIndicator}>
                        {getSortIndicator('name')}
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
                        {getSortIndicator('udid')}
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
                      {t('device_list.column_ip')}
                      <span class={styles.sortIndicator}>
                        {getSortIndicator('ip')}
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
                      {t('device_list.column_system')}
                      <span class={styles.sortIndicator}>
                        {getSortIndicator('version')}
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
                      {t('device_list.column_battery')}
                      <span class={styles.sortIndicator}>
                        {getSortIndicator('battery')}
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
                      {t('device_list.column_script')}
                      <span class={styles.sortIndicator}>
                        {getSortIndicator('running')}
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
                      {t('device_list.column_message')}
                      <span class={styles.sortIndicator}>
                        {getSortIndicator('message')}
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
                      {t('device_list.column_last_log')}
                      <span class={styles.sortIndicator}>
                        {getSortIndicator('log')}
                      </span>
                      <div 
                        class={styles.resizeHandle} 
                        onMouseDown={(e) => handleResizeStart(e, 'log')}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </Show>
                </div>
                
                <div class={styles.tableBody}>
                  <For each={filteredDevices()}>
                    {(device) => {
                      const info = formatDeviceInfo(device);
                      const isSelected = createMemo(() => selectedUdidSet().has(device.udid));
                      const displayMessage = createMemo(() => getDisplayMessage(device));
                      const displayLog = createMemo(() => getDisplayLog(device));
                    
                      return (
                        <div 
                          class={`${styles.tableRow} ${isSelected() ? styles.selected : ''}`}
                          style={{ 
                            'grid-template-columns': gridTemplateColumns()
                          }}
                          onClick={(e) => handleDeviceToggle(device, e)}
                          onContextMenu={(e) => handleDeviceContextMenu(e, device)}
                        >
                        <div class={styles.tableCell}>
                          <div 
                            class={`${styles.deviceCheckbox} ${isSelected() ? styles.checked : ''}`}
                          >
                            {isSelected() ? '✓' : ''}
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
                              {device.system?.ip || t('common.unknown')}
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
                              class={`${styles.runningStatus} ${getRunningStatusClass(info)}`}
                              title={device.script?.select || t('device_list.no_script')}
                            >
                              {getRunningStatusText(info)}
                            </div>
                          </div>
                        </Show>
                        
                        <Show when={visibleColumns().includes('message')}>
                          <div class={styles.tableCell}>
                            <div 
                              class={styles.deviceMessage}
                              title={displayMessage() || t('device_list.no_message')}
                            >
                              {displayMessage()}
                            </div>
                          </div>
                        </Show>
                        
                        <Show when={visibleColumns().includes('log')}>
                          <div class={styles.tableCell}>
                            <div
                              class={styles.lastLog}
                              title={displayLog() || t('device_list.no_log')}
                            >
                              {formatLogPreview(displayLog())}
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

          <Show when={isMobile()}>
            <div class={styles.deviceCardList}>
              <For each={filteredDevices()}>
                {(device) => {
                  const info = formatDeviceInfo(device);
                  const isSelected = createMemo(() => selectedUdidSet().has(device.udid));
                  const displayMessage = createMemo(() => getDisplayMessage(device));
                  const displayLog = createMemo(() => getDisplayLog(device));
                  return (
                    <div 
                      class={styles.deviceCard}
                      classList={{ [styles.selected]: isSelected() }}
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
                        <Show when={isSelected()}>
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
                          <div class={`${styles.cardRunningStatus} ${getRunningStatusClass(info)}`}>
                            {getRunningStatusText(info)}
                          </div>
                        </div>
                      </div>
                      
                      <div class={styles.cardDetailsGrid}>
                        <div class={styles.detailItem}>
                          <span class={styles.detailLabel}>{t('device_list.column_ip')}</span>
                          <span class={styles.detailValue}>{device.system?.ip || t('common.unknown')}</span>
                        </div>
                        <div class={styles.detailItem}>
                          <span class={styles.detailLabel}>{t('device_list.system_version')}</span>
                          <span class={styles.detailValue}>{info.version}</span>
                        </div>
                      </div>
                      
                      <Show when={displayMessage()}>
                        <div class={styles.cardMessageArea}>
                          <div class={styles.cardMessageText}>{displayMessage()}</div>
                        </div>
                      </Show>
                      
                      <Show when={displayLog()}>
                        <div class={styles.cardLogArea}>
                          {displayLog()}
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
            </Show>
          </div>
        </div>
      </div>
        
        {/* Upload Modal */}
        <Show when={showUploadModal()}>
          <div class={styles.modalOverlay} onClick={handleModalCancel}>
            <div class={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div class={styles.modalHeader}>
                <h3>{t('device_list.upload_to_selected_devices')}</h3>
              </div>
              
              <div class={styles.modalBody}>
                <div class={styles.inputGroup}>
                  <label class={styles.inputLabel}>{t('device_list.upload_path')}</label>
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
                    {t('device_list.drop_or_click')}
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
                  {t('device_list.upload_target_count', { count: props.selectedDevices().length })}
                </div>
              </div>
              
              <div class={styles.modalFooter}>
                <button 
                  onClick={handleModalCancel}
                  class={styles.cancelButton}
                >
                  {t('common.cancel')}
                </button>
                <button 
                  onClick={handleModalUpload}
                  class={styles.confirmUploadButton}
                  disabled={modalUploadFiles().length === 0}
                >
                  {t('device_list.start_upload')}
                </button>
              </div>
            </div>
          </div>
        </Show>
        
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
        
        {/* 批量实时控制弹窗 */}
        <Show when={showBatchRemoteModal()}>
          <BatchRemoteControl
            isOpen={showBatchRemoteModal()}
            onClose={handleCloseBatchRemoteControl}
            devices={props.selectedDevices()}
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
        <ScriptSelectionModal
          isOpen={showScriptSelectionModal()}
          onClose={() => setShowScriptSelectionModal(false)}
          onSelectScript={handleSelectScript}
          selectedDeviceCount={props.selectedDevices().length}
          serverBaseUrl={authService.getHttpBaseUrl(props.serverHost, props.serverPort)}
        />

        {/* 脚本上传弹窗 */}
        <ScriptUploadModal
          isOpen={showScriptUploadModal()}
          onClose={() => setShowScriptUploadModal(false)}
          onUploadScript={handleUploadScript}
          selectedDeviceCount={props.selectedDevices().length}
          serverBaseUrl={authService.getHttpBaseUrl(props.serverHost, props.serverPort)}
        />
        
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

        <LogStreamModal
          isOpen={showLogStreamModal()}
          device={logStreamDevice()}
          onClose={() => {
            setShowLogStreamModal(false);
            setLogStreamDevice(null);
          }}
          webSocketService={props.webSocketService}
        />
        
        {/* Device Context Menu */}
        <ContextMenu
          isOpen={!!contextMenuDevice()}
          position={contextMenuPosition()}
          onClose={closeContextMenu}
        >
          <>
            <Show when={showSelectedDevicesContextSection()}>
              <ContextMenuSection label={t('device_list.selected_devices_section', { count: props.selectedDevices().length })}>
                <ContextMenuButton onClick={handleContextMenuCopySelectedUdids}>{t('device_list.copy_selected_udid')}</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedNames}>{t('device_list.copy_selected_name')}</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedIps}>{t('device_list.copy_selected_ip')}</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedLastLogs}>{t('device_list.copy_selected_last_log')}</ContextMenuButton>
                <ContextMenuButton onClick={handleContextMenuCopySelectedScriptSelects}>{t('device_list.copy_selected_script')}</ContextMenuButton>
                <Show when={props.onOpenAddToGroupModal}>
                  <ContextMenuButton onClick={() => {
                    closeContextMenu();
                    props.onOpenAddToGroupModal?.();
                  }}>{t('device_list.add_to_group_count', { count: props.selectedDevices().length })}</ContextMenuButton>
                </Show>
                <Show when={canRemoveSelectedFromCurrentGroup()}>
                  <ContextMenuButton
                    onClick={handleRemoveSelectedFromCurrentGroup}
                    disabled={isRemovingDevicesFromGroup()}
                  >
                    {t('group.remove_current')}
                  </ContextMenuButton>
                </Show>
              </ContextMenuSection>
              <ContextMenuDivider />
            </Show>
            
            {/* 当前设备操作 */}
            <ContextMenuSection label={contextMenuDevice()?.system?.name || t('device.unknown')}>
              <ContextMenuButton onClick={handleContextMenuCopyUdid}>{t('device_list.copy_udid')}</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyName}>{t('device_list.copy_name')}</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyIp}>{t('device_list.copy_ip')}</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyLastLog}>{t('device_list.copy_last_log')}</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuCopyScriptSelect}>{t('device_list.copy_script')}</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuOpenFileBrowser}>{t('device_list.browse_files')}</ContextMenuButton>
              <ContextMenuButton onClick={handleContextMenuOpenLogStream}>{t('device_list.view_live_logs')}</ContextMenuButton>
              <Show when={props.onOpenAddToGroupModal && contextMenuDeviceIsOnlySelectedDevice()}>
                <ContextMenuButton onClick={() => {
                  closeContextMenu();
                  props.onOpenAddToGroupModal?.();
                }}>{t('group.add_to_group')}</ContextMenuButton>
              </Show>
              <Show when={canRemoveContextMenuDeviceFromCurrentGroup()}>
                <ContextMenuButton
                  onClick={handleRemoveContextMenuDeviceFromCurrentGroup}
                  disabled={isRemovingDevicesFromGroup()}
                >
                  {t('group.remove_current')}
                </ContextMenuButton>
              </Show>
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
        submitLabel={scriptConfigManager.submitLabel()}
        validateOnOpen={scriptConfigManager.validateOnOpen()}
        onClose={scriptConfigManager.closeConfig}
        onSubmit={scriptConfigManager.submitConfig}
      />

      {/* Brightness Modal */}
      <BrightnessModal
        open={showBrightnessModal()}
        setting={isSettingBrightness()}
        value={brightnessValue()}
        onChange={setBrightnessValue}
        onCancel={() => setShowBrightnessModal(false)}
        selectedDeviceCount={props.selectedDevices().length}
        onConfirm={async () => {
          const service = getDeviceControlService();
          if (!service || props.selectedDevices().length === 0) {
            setShowBrightnessModal(false);
            return;
          }
          setIsSettingBrightness(true);
          const devices = props.selectedDevices();
          devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_setting_brightness', { value: brightnessValue() })));
          try {
            const result = await service.setBrightness(devices.map(d => d.udid), brightnessValue());
            devices.forEach(d => setDeviceMessage(d.udid, result.success ? t('device_list.msg_brightness_set', { value: brightnessValue() }) : t('device_list.msg_brightness_failed', { msg: result.error || t('common.unknown_error') })));
          } finally {
            setIsSettingBrightness(false);
            setShowBrightnessModal(false);
          }
        }}
      />

      {/* Volume Modal */}
      <VolumeModal
        open={showVolumeModal()}
        setting={isSettingVolume()}
        value={volumeValue()}
        onChange={setVolumeValue}
        onCancel={() => setShowVolumeModal(false)}
        selectedDeviceCount={props.selectedDevices().length}
        onConfirm={async () => {
          const service = getDeviceControlService();
          if (!service || props.selectedDevices().length === 0) {
            setShowVolumeModal(false);
            return;
          }
          setIsSettingVolume(true);
          const devices = props.selectedDevices();
          devices.forEach(d => setDeviceMessage(d.udid, t('device_list.msg_setting_volume', { value: volumeValue() })));
          try {
            const result = await service.setVolume(devices.map(d => d.udid), volumeValue());
            devices.forEach(d => setDeviceMessage(d.udid, result.success ? t('device_list.msg_volume_set', { value: volumeValue() }) : t('device_list.msg_volume_failed', { msg: result.error || t('common.unknown_error') })));
          } finally {
            setIsSettingVolume(false);
            setShowVolumeModal(false);
          }
        }}
      />
    </div>
  );
};

export default DeviceList;
