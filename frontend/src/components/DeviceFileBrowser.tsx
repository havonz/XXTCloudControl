import { createSignal, createEffect, For, Show, onCleanup, createMemo, on } from 'solid-js';
import { useDialog } from './DialogContext';
import { useToast } from './ToastContext';
import {
  IconFolderPlus,
  IconFileCirclePlus,
  IconRotate,
  IconSquareCheck,
  IconXmark,
  IconDownload,
  IconTrash,
  IconHouse,
  IconCode,
  IconBoxesStacked,
  IconChartColumn,
  IconUpload,
  IconPen,
  IconICursor,
  IconClipboardCheck,
  IconCircleCheck,
  IconCheck,
  IconCheckDouble,
  IconCircleXmark,
  IconCopy,
  IconScissors,
  IconPaste,
} from '../icons';
import { renderFileIcon } from '../utils/fileIcons';
import { createBackdropClose } from '../hooks/useBackdropClose';
import styles from './DeviceFileBrowser.module.css';
import { scanEntries, ScannedFile } from '../utils/fileUpload';
import SendToCloudModal from './SendToCloudModal';
import ContextMenu, { ContextMenuButton, ContextMenuDivider } from './ContextMenu';
import { debugLog } from '../utils/debugLogger';
import { useI18n } from '../i18n';
import { runWithConcurrency } from '../utils/runWithConcurrency';
import type { DeviceFileEntry } from '../services/WebSocketService';

export type FileItem = DeviceFileEntry;

// Files larger than 128KB should use HTTP transfer instead of WebSocket
const LARGE_FILE_THRESHOLD = 128 * 1024;

export interface DeviceFileBrowserProps {
  deviceUdid: string;
  deviceName: string;
  isOpen: boolean;
  onClose: () => void;
  onListFiles: (deviceUdid: string, path: string) => void;
  onListFilesAsync?: (deviceUdid: string, path: string) => Promise<FileItem[]>;
  onDeleteFile: (deviceUdid: string, path: string) => void;
  onCreateDirectory: (deviceUdid: string, path: string) => void;
  onUploadFile: (deviceUdid: string, path: string, file: File) => Promise<void>;
  onUploadLargeFile?: (deviceUdid: string, path: string, file: File) => Promise<void>; // For files > 128KB
  onDownloadFile: (deviceUdid: string, path: string) => void;
  onDownloadLargeFile?: (deviceUdid: string, path: string, fileName: string) => Promise<void>; // For files > 128KB  
  onMoveFile: (deviceUdid: string, fromPath: string, toPath: string) => void;
  onCopyFile: (deviceUdid: string, fromPath: string, toPath: string) => void;
  onReadFile: (deviceUdid: string, path: string) => Promise<string>;
  onSelectScript: (deviceUdid: string, scriptName: string) => void;
  selectedScript: string | null | undefined;
  files: FileItem[];
  isLoading: boolean;
  onPullFileFromDevice?: (deviceUdid: string, sourcePath: string, category: 'scripts' | 'files' | 'reports', targetPath: string) => Promise<{success: boolean; error?: string}>;
}

export default function DeviceFileBrowser(props: DeviceFileBrowserProps) {
  const dialog = useDialog();
  const { t } = useI18n();
  const [currentPath, setCurrentPath] = createSignal('/lua/scripts');
  const [showHidden, setShowHidden] = createSignal(false);
  const [lastSelectedItem, setLastSelectedItem] = createSignal<string | null>(null);
  const [isSelectMode, setIsSelectMode] = createSignal(false);
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(new Set<string>());
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);
  const mainBackdropClose = createBackdropClose(() => props.onClose());
  const editorBackdropClose = createBackdropClose(() => closeEditor());
  let dragCounter = 0;
  let listRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // 剪贴板状态
  const [clipboard, setClipboard] = createSignal<{
    items: string[];  // 文件名列表
    srcPath: string;  // 源目录路径
    mode: 'copy' | 'cut';
  } | null>(null);

  // 编辑器弹窗
  const [showEditorModal, setShowEditorModal] = createSignal(false);
  const [editorFileName, setEditorFileName] = createSignal('');
  const [editorContent, setEditorContent] = createSignal('');
  const [editorSaving, setEditorSaving] = createSignal(false);
  const [editorLoading, setEditorLoading] = createSignal(false);
  let editorRequest: { deviceUdid: string; path: string; directory: string } | null = null;

  const closeEditor = () => {
    editorRequest = null;
    setEditorLoading(false);
    setEditorSaving(false);
    setShowEditorModal(false);
  };

  // 右键菜单
  const [contextMenuFile, setContextMenuFile] = createSignal<FileItem | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  let contextLongPressTimer: ReturnType<typeof setTimeout> | null = null;

  // 发送到云控模态框
  const [showSendToCloudModal, setShowSendToCloudModal] = createSignal(false);
  const [sendToCloudPendingItems, setSendToCloudPendingItems] = createSignal<string[]>([]);
  const [isSendingToCloud, setIsSendingToCloud] = createSignal(false);
  // 扫描状态 - 用于递归扫描目录内的文件
  const [isScanning, setIsScanning] = createSignal(false);
  const [selectedDirectoryCount, setSelectedDirectoryCount] = createSignal(0);
  let sendToCloudTarget: {
    deviceUdid: string;
    path: string;
    pullFile: DeviceFileBrowserProps['onPullFileFromDevice'];
  } | null = null;
  
  const toast = useToast();

  // 当组件打开时，加载默认目录
  createEffect(on([() => props.isOpen, () => props.deviceUdid], ([isOpen, deviceUdid]) => {
    // 组件关闭后会保留实例，旧设备的扫描、编辑器和剪贴板不能带到下一台设备。
    sendToCloudTarget = null;
    setShowSendToCloudModal(false);
    setSendToCloudPendingItems([]);
    setIsScanning(false);
    closeEditor();
    setContextMenuFile(null);
    setClipboard(null);
    if (isOpen) {
      setCurrentPath('/lua/scripts');
      props.onListFiles(deviceUdid, '/lua/scripts');
      setIsSelectMode(false);
      setSelectedItems(new Set<string>());
    }
  }));

  const runtimeUpdated = (event: Event) => {
    if (!props.isOpen || (event as CustomEvent).detail?.deviceId !== props.deviceUdid) return;
    setSelectedItems(new Set<string>());
    setClipboard(null);
    props.onListFiles(props.deviceUdid, currentPath());
  };
  window.addEventListener('runtime-settings-updated', runtimeUpdated);
  onCleanup(() => window.removeEventListener('runtime-settings-updated', runtimeUpdated));

  // 文件排序函数：文件夹在前，文件在后，都按名称正序排序
  const sortedFiles = createMemo(() => {
    let result = [...props.files].sort((a, b) => {
      // 先按类型排序：文件夹在前
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      
      // 相同类型按名称正序排序
      return a.name.localeCompare(b.name);
    });

    if (!showHidden()) {
      result = result.filter(f => !f.name.startsWith('.'));
    }

    return result;
  });

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setSelectedItems(new Set<string>());
    props.onListFiles(props.deviceUdid, path);
  };

  const scheduleListRefresh = (delayMs: number, deviceUdid = props.deviceUdid, path = currentPath()) => {
    if (disposed || !props.isOpen || props.deviceUdid !== deviceUdid || currentPath() !== path) return;
    if (listRefreshTimer) {
      clearTimeout(listRefreshTimer);
    }
    listRefreshTimer = setTimeout(() => {
      listRefreshTimer = null;
      if (props.isOpen && props.deviceUdid === deviceUdid && currentPath() === path) {
        props.onListFiles(deviceUdid, path);
      }
    }, delayMs);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (contextMenuFile()) {
        setContextMenuFile(null);
      } else if (showEditorModal()) {
        closeEditor();
      } else if (props.isOpen) {
        props.onClose();
      }
    }
  };

  // 右键菜单处理
  const handleFileContextMenu = (e: MouseEvent, file: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuFile(file);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleFileTouchStartForContext = (file: FileItem) => {
    contextLongPressTimer = setTimeout(() => {
      setContextMenuFile(file);
      setContextMenuPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }, 500);
  };

  const handleFileTouchEndForContext = () => {
    if (contextLongPressTimer) {
      clearTimeout(contextLongPressTimer);
      contextLongPressTimer = null;
    }
  };

  const closeContextMenu = () => {
    setContextMenuFile(null);
  };

  createEffect(() => {
    if (!props.isOpen) return;

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  onCleanup(() => {
    disposed = true;
    sendToCloudTarget = null;
    editorRequest = null;
    if (listRefreshTimer) {
      clearTimeout(listRefreshTimer);
      listRefreshTimer = null;
    }
  });

  const handleFileClick = (file: FileItem, e?: MouseEvent) => {
    if (isSelectMode()) {
      const current = new Set<string>(selectedItems());
      
      if (e?.shiftKey && lastSelectedItem()) {
        const files = sortedFiles();
        const lastIndex = files.findIndex(f => f.name === lastSelectedItem());
        const currentIndex = files.findIndex(f => f.name === file.name);
        
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const range = files.slice(start, end + 1);
          
          range.forEach(f => current.add(f.name));
          setSelectedItems(current);
          setLastSelectedItem(file.name);
          return;
        }
      }

      if (current.has(file.name)) {
        current.delete(file.name);
      } else {
        current.add(file.name);
      }
      setSelectedItems(current);
      setLastSelectedItem(file.name);
    } else if (file.type === 'directory') {
      const newPath = currentPath() === '/' 
        ? `/${file.name}` 
        : `${currentPath()}/${file.name}`;
      handleNavigate(newPath);
    }
  };

  const handleDeleteFile = async (file: FileItem) => {
    const deviceUdid = props.deviceUdid;
    const directory = currentPath();
    const deleteFile = props.onDeleteFile;
    const fullPath = directory === '/' ? `/${file.name}` : `${directory}/${file.name}`;
    if (!await dialog.confirm(t('files.delete_confirm', { name: file.name }))) return;
    deleteFile(deviceUdid, fullPath);
    // 刷新文件列表
    scheduleListRefresh(500, deviceUdid, directory);
  };

  const handleDownloadFile = async (file: FileItem) => {
    const fullPath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    
    // Use large file transfer for files > 128KB
    const fileSize = file.size || 0;
    if (fileSize > LARGE_FILE_THRESHOLD && props.onDownloadLargeFile) {
      debugLog('transfer', `📥 Large file detected (${fileSize} bytes), using HTTP transfer`);
      await props.onDownloadLargeFile(props.deviceUdid, fullPath, file.name);
    } else {
      props.onDownloadFile(props.deviceUdid, fullPath);
    }
  };

  // 判断是否为文本文件
  const isTextFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['txt', 'lua', 'json', 'md', 'log', 'xml', 'html', 'css', 'js', 'ts', 'conf', 'ini', 'sh', 'py'].includes(ext || '');
  };

  // 判断是否可以作为脚本选中
  const isSelectableScript = (file: FileItem) => {
    const name = file.name.toLowerCase();
    if (file.type === 'file') {
      return name.endsWith('.lua') || name.endsWith('.xxt');
    } else {
      return name.endsWith('.xpp');
    }
  };

  // 选中脚本
  const handleSelectScript = (file: FileItem) => {
    props.onSelectScript(props.deviceUdid, file.name);
  };

  // 判断是否为当前选中的脚本
  const isSelectedScript = (file: FileItem) => {
    return currentPath() === '/lua/scripts' && props.selectedScript === file.name;
  };

  // 重命名文件
  const handleRenameFile = async (file: FileItem) => {
    const deviceUdid = props.deviceUdid;
    const directory = currentPath();
    const moveFile = props.onMoveFile;
    const newName = await dialog.prompt(t('files.rename_prompt'), file.name, t('common.rename'));
    if (!newName?.trim() || newName.trim() === file.name) return;

    const fromPath = directory === '/'
      ? `/${file.name}` 
      : `${directory}/${file.name}`;
    const toPath = directory === '/'
      ? `/${newName.trim()}` 
      : `${directory}/${newName.trim()}`;

    moveFile(deviceUdid, fromPath, toPath);

    // 刷新文件列表
    scheduleListRefresh(500, deviceUdid, directory);
  };

  // 编辑文件
  const handleEditFile = async (file: FileItem) => {
    const fullPath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    const request = { deviceUdid: props.deviceUdid, path: fullPath, directory: currentPath() };
    const readFile = props.onReadFile;
    closeEditor();
    editorRequest = request;
    setEditorFileName(file.name);
    setEditorContent(t('common.loading'));
    setEditorLoading(true);
    setShowEditorModal(true);
    try {
      const content = await readFile(request.deviceUdid, request.path);
      // 同一文件也可能被关闭后重新打开，路径相等不足以认定回包仍属于当前编辑器。
      if (editorRequest === request) setEditorContent(content);
    } catch (error) {
      if (editorRequest !== request) return;
      closeEditor();
      dialog.alert(t('files.read_failed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      if (editorRequest === request) setEditorLoading(false);
    }
  };

  // 保存文件
  const handleSaveFile = async () => {
    const request = editorRequest;
    if (!request || editorLoading() || editorSaving()) return;

    setEditorSaving(true);
    const file = new File([editorContent()], editorFileName(), { type: 'text/plain' });
    try {
      await props.onUploadFile(request.deviceUdid, request.path, file);
      scheduleListRefresh(0, request.deviceUdid, request.directory);
      if (editorRequest === request) closeEditor();
    } catch (error) {
      if (editorRequest === request) {
        toast.showError(t('files.save_failed', { msg: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      if (editorRequest === request) setEditorSaving(false);
    }
  };

  const handleCreateFolder = async () => {
    const deviceUdid = props.deviceUdid;
    const directory = currentPath();
    const createDirectory = props.onCreateDirectory;
    const folderName = await dialog.prompt(t('files.new_folder_prompt'), '', t('common.new_folder'));
    if (!folderName?.trim()) return;

    const folderPath = directory === '/'
      ? `/${folderName.trim()}` 
      : `${directory}/${folderName.trim()}`;
    
    createDirectory(deviceUdid, folderPath);

    // 刷新当前目录
    scheduleListRefresh(500, deviceUdid, directory);
  };

  const handleCreateFile = async () => {
    const deviceUdid = props.deviceUdid;
    const directory = currentPath();
    const names = new Set(props.files.map(file => file.name));
    const uploadFile = props.onUploadFile;
    const fileName = await dialog.prompt(t('files.new_file_prompt'), '', t('common.new_file'));
    if (!fileName?.trim()) return;

    const name = fileName.trim();

    // 检查文件是否已存在
    const exists = names.has(name);
    if (exists) {
      await dialog.alert(t('files.exists', { name }));
      return;
    }

    const filePath = directory === '/'
      ? `/${name}` 
      : `${directory}/${name}`;
    
    // 创建空文件（模拟上传一个空 Blob）
    const emptyFile = new File([], name, { type: 'text/plain' });
    try {
      await uploadFile(deviceUdid, filePath, emptyFile);
      scheduleListRefresh(0, deviceUdid, directory);
    } catch (error) {
      toast.showError(t('files.upload_failed', { msg: error instanceof Error ? error.message : String(error) }));
    }
  };


  // 拖拽上传处理
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) setIsDragOver(true);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) setIsDragOver(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    dragCounter = 0;
    setIsDragOver(false);
    if (isUploading()) return;
    const deviceUdid = props.deviceUdid;
    const directory = currentPath();
    const uploadFile = props.onUploadFile;
    const uploadLargeFile = props.onUploadLargeFile;
    setIsUploading(true);
    try {
      let scannedFiles: ScannedFile[];
      if (e.dataTransfer?.items) {
        scannedFiles = await scanEntries(e.dataTransfer.items);
      } else {
        scannedFiles = Array.from(e.dataTransfer?.files || []).map(file => ({ file, relativePath: file.name }));
      }
      for (const { file, relativePath } of scannedFiles) {
        const fullPath = directory === '/'
          ? `/${relativePath}` 
          : `${directory}/${relativePath}`;
        
        // Use large file transfer for files > 128KB
        if (file.size > LARGE_FILE_THRESHOLD && uploadLargeFile) {
          debugLog('transfer', `📤 Large file detected (${file.size} bytes), using HTTP transfer`);
          await uploadLargeFile(deviceUdid, fullPath, file);
        } else {
          await uploadFile(deviceUdid, fullPath, file);
        }
      }
      if (scannedFiles.length > 0) scheduleListRefresh(2000, deviceUdid, directory);
    } catch (error) {
      toast.showError(t('files.upload_failed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      setIsUploading(false);
    }
  };

  const breadcrumbs = () => {
    const path = currentPath();
    if (!path || path === '/') return [];
    return path.split('/').filter(p => p);
  };

  const formatSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const toggleAllSelection = () => {
    const allFileNames = sortedFiles().map(f => f.name);
    if (selectedItems().size === allFileNames.length) {
      setSelectedItems(new Set<string>());
    } else {
      setSelectedItems(new Set<string>(allFileNames));
    }
  };

  // 复制选中的项目到剪贴板
  const handleCopy = () => {
    const selected = selectedItems();
    if (selected.size === 0) return;
    setClipboard({
      items: Array.from(selected),
      srcPath: currentPath(),
      mode: 'copy'
    });
  };

  // 剪切选中的项目到剪贴板
  const handleCut = () => {
    const selected = selectedItems();
    if (selected.size === 0) return;
    setClipboard({
      items: Array.from(selected),
      srcPath: currentPath(),
      mode: 'cut'
    });
  };

  // 粘贴剪贴板中的项目
  const handlePaste = async () => {
    const cb = clipboard();
    if (!cb || cb.items.length === 0) return;
    
    // 不能粘贴到相同目录
    if (cb.srcPath === currentPath()) {
      await dialog.alert(t('files.same_dir'));
      return;
    }
    
    // 逐个执行复制或移动操作
    for (const item of cb.items) {
      const fromPath = cb.srcPath === '/' ? `/${item}` : `${cb.srcPath}/${item}`;
      const toPath = currentPath() === '/' ? `/${item}` : `${currentPath()}/${item}`;
      
      if (cb.mode === 'copy') {
        props.onCopyFile(props.deviceUdid, fromPath, toPath);
      } else {
        props.onMoveFile(props.deviceUdid, fromPath, toPath);
      }
    }
    
    // 剪切操作完成后清空剪贴板
    if (cb.mode === 'cut') {
      setClipboard(null);
    }
    
    // 刷新文件列表
    scheduleListRefresh(500 * cb.items.length);
  };

  // 检查是否可以粘贴
  const canPaste = () => {
    const cb = clipboard();
    if (!cb || cb.items.length === 0) return false;
    // 不能粘贴到源目录
    return cb.srcPath !== currentPath();
  };

  const prepareSendToCloud = async (selected: FileItem[], emptyMessage: string) => {
    if (isSendingToCloud() || selected.length === 0) return;
    const directories = selected.filter(file => file.type === 'directory');
    const listFiles = props.onListFilesAsync;
    if (directories.length > 0 && !listFiles) {
      dialog.alert(t('files.send_cloud_unsupported_dir'));
      return;
    }

    const target = {
      deviceUdid: props.deviceUdid,
      path: currentPath(),
      pullFile: props.onPullFileFromDevice,
    };
    sendToCloudTarget = target;
    const allFiles = selected.filter(file => file.type === 'file').map(file => file.name);
    setSelectedDirectoryCount(directories.length);
    setSendToCloudPendingItems([...allFiles]);
    setIsScanning(directories.length > 0);
    setShowSendToCloudModal(true);

    const ancestorDirectories = new Set<string>();
    const scanDirectory = async (directory: string, relativePath: string, entry: FileItem): Promise<void> => {
      if (sendToCloudTarget !== target) return;
      const identity = Number.isSafeInteger(entry.dev) && Number.isSafeInteger(entry.ino) && (entry.ino ?? 0) > 0
        ? `${entry.dev}:${entry.ino}` : null;
      if (identity && ancestorDirectories.has(identity)) {
        throw new Error(t('files.directory_cycle', { path: relativePath }));
      }
      // 不同分支可以合法引用同一目录，只检查当前祖先链，避免误判目录别名。
      if (identity) ancestorDirectories.add(identity);
      try {
        const files = await listFiles!(target.deviceUdid, directory);
        if (sendToCloudTarget !== target) return;
        for (const file of files) {
          if (sendToCloudTarget !== target) return;
          const name = `${relativePath}/${file.name}`;
          if (file.type === 'directory') {
            await scanDirectory(`${directory}/${file.name}`, name, file);
          } else {
            allFiles.push(name);
          }
        }
      } finally {
        if (identity) ancestorDirectories.delete(identity);
      }
    };

    try {
      for (const directory of directories) {
        const path = target.path === '/' ? `/${directory.name}` : `${target.path}/${directory.name}`;
        await scanDirectory(path, directory.name, directory);
        if (sendToCloudTarget !== target) return;
        setSendToCloudPendingItems([...allFiles]);
      }
      if (sendToCloudTarget !== target) return;
      setIsScanning(false);
      if (allFiles.length === 0) {
        sendToCloudTarget = null;
        setShowSendToCloudModal(false);
        dialog.alert(t(emptyMessage));
      }
    } catch (error) {
      if (sendToCloudTarget !== target) return;
      sendToCloudTarget = null;
      setIsScanning(false);
      setShowSendToCloudModal(false);
      setSendToCloudPendingItems([]);
      dialog.alert(t('files.load_failed', { msg: error instanceof Error ? error.message : String(error) }));
    }
  };

  const handleSendToCloud = async (category: 'scripts' | 'files' | 'reports', targetPath: string) => {
    const target = sendToCloudTarget;
    if (!target || isScanning() || isSendingToCloud()) return;
    const pullFile = target.pullFile;
    if (!pullFile) {
      dialog.alert(t('files.send_cloud_unavailable'));
      return;
    }
    const items = [...sendToCloudPendingItems()];
    if (items.length === 0) return;

    sendToCloudTarget = null;
    setSendToCloudPendingItems([]);
    setShowSendToCloudModal(false);
    setIsSendingToCloud(true);
    try {
      // 队列后续任务沿用发起时的目标，不能跟随仍可切换的设备和目录。
      const results = await runWithConcurrency(items, 4, async name => {
        const sourcePath = target.path === '/' ? `/${name}` : `${target.path}/${name}`;
        const finalTargetPath = targetPath === '/' || targetPath === ''
          ? name
          : (targetPath.endsWith('/') ? targetPath + name : targetPath + '/' + name);
        try {
          const result = await pullFile(target.deviceUdid, sourcePath, category, finalTargetPath);
          if (!result.success) console.error(t('files.send_file_failed', { name }), result.error);
          return result.success;
        } catch (error) {
          console.error(t('files.send_file_failed', { name }), error);
          return false;
        }
      });
      const successCount = results.filter(Boolean).length;
      const failCount = results.length - successCount;
      if (failCount === 0) {
        toast.showSuccess(t('files.send_cloud_success', { count: successCount }));
      } else if (successCount > 0) {
        toast.showWarning(t('files.send_cloud_partial', { success: successCount, fail: failCount }));
      } else {
        toast.showError(t('files.send_cloud_failed_count', { fail: failCount }));
      }
    } finally {
      setIsSendingToCloud(false);
    }
  };

  return (
    <>
    <Show when={props.isOpen}>
      <div class={styles.overlay} onMouseDown={mainBackdropClose.onMouseDown} onMouseUp={mainBackdropClose.onMouseUp}>
        <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h2>{t('files.device_title', { name: props.deviceName })}</h2>
            <button class={styles.closeButton} onClick={props.onClose}>
              <IconXmark size={18} />
            </button>
          </div>

          {/* 目录切换按钮 */}
          <div class={styles.tabs}>
            <button 
              class={`${styles.tab} ${currentPath() === '/lua/scripts' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/lua/scripts')}
            >
              <IconCode size={16} />
              <span>{t('files.scripts_root')}</span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/res' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/res')}
            >
              <IconBoxesStacked size={16} />
              <span>{t('files.files_root')}</span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/log' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/log')}
            >
              <IconChartColumn size={16} />
              <span>{t('files.logs_root')}</span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/' || currentPath() === '' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/')}
            >
              <IconHouse size={16} />
              <span>{t('files.home_root')}</span>
            </button>
          </div>
          
          <div class={styles.toolbar}>
             <div class={styles.actions}>
              <button 
                class={styles.actionButton}
                onClick={handleCreateFile}
              >
                <IconFileCirclePlus size={16} />
                <span>{t('common.new_file')}</span>
              </button>

              <button 
                class={styles.actionButton}
                onClick={handleCreateFolder}
              >
                <IconFolderPlus size={16} />
                <span>{t('common.new_folder')}</span>
              </button>

              <button class={styles.actionButton} onClick={() => props.onListFiles(props.deviceUdid, currentPath())}>
                <IconRotate size={16} />
                <span>{t('common.refresh')}</span>
              </button>

              <button 
                class={`${styles.actionButton} ${isSelectMode() ? styles.activeAction : ''}`} 
                onClick={() => { 
                  setIsSelectMode(!isSelectMode()); 
                  if (!isSelectMode()) setSelectedItems(new Set<string>()); 
                }}
              >
                <IconSquareCheck size={16} />
                <span>{t('common.select_mode')}</span>
              </button>

              <label class={styles.showHiddenLabel}>
                <input 
                  type="checkbox" 
                  class="themed-checkbox"
                  checked={showHidden()} 
                  onChange={(e) => setShowHidden(e.currentTarget.checked)} 
                />
                <span>{t('files.show_hidden')}</span>
              </label>
            </div>
          </div>

          <Show when={isSelectMode()}>
            <div class={styles.selectToolbar}>
              <div class={styles.selectInfo}>
                <span class={styles.selectedCount}>
                  <span class={styles.mobileCheck}><IconCheck size={14} /></span>
                  {t('common.selected_items', { count: selectedItems().size })}
                </span>
                <Show when={clipboard()}>
                  <span class={styles.clipboardInfo}>
                    {t('files.clipboard', { count: clipboard()!.items.length, mode: clipboard()!.mode === 'copy' ? t('files.copy_mode') : t('files.cut_mode') })}
                  </span>
                </Show>
              </div>
              <div class={styles.selectActions}>
                <button class={styles.selectAction} onClick={toggleAllSelection}>
                  <IconCheckDouble size={14} />
                  <span>{selectedItems().size === sortedFiles().length ? t('files.unselect_all') : t('common.select_all')}</span>
                </button>
                <button class={styles.selectAction} onClick={() => setSelectedItems(new Set())} disabled={selectedItems().size === 0}>
                  <IconCircleXmark size={14} />
                  <span>{t('common.clear_selection')}</span>
                </button>
                
                <div class={styles.selectDivider} />
                
                <button class={styles.selectAction} onClick={handleCopy} disabled={selectedItems().size === 0}>
                  <IconCopy size={14} />
                  <span>{t('common.copy')}</span>
                </button>
                <button class={styles.selectAction} onClick={handleCut} disabled={selectedItems().size === 0}>
                  <IconScissors size={14} />
                  <span>{t('common.cut')}</span>
                </button>
                <button class={styles.selectAction} onClick={handlePaste} disabled={!canPaste()}>
                  <IconPaste size={14} />
                  <span>{t('common.paste')}</span>
                </button>
                
                <div class={styles.selectDivider} />

                <Show when={props.onPullFileFromDevice}>
                  <button 
                    class={`${styles.selectAction} ${styles.sendToCloudAction}`}
                    onClick={() => prepareSendToCloud(sortedFiles().filter(file => selectedItems().has(file.name)), 'files.send_cloud_selected_empty')}
                    disabled={selectedItems().size === 0 || isSendingToCloud()}
                  >
                    <IconUpload size={14} />
                    <span>{isSendingToCloud() ? t('files.sending_to_cloud') : t('files.send_to_cloud')}</span>
                  </button>
                  
                  <div class={styles.selectDivider} />
                </Show>
                
                <button 
                  class={styles.deleteAction} 
                  disabled={selectedItems().size === 0}
                  onClick={async () => {
                    const items = [...selectedItems()];
                    const deviceUdid = props.deviceUdid;
                    const directory = currentPath();
                    const deleteFile = props.onDeleteFile;
                    if (await dialog.confirm(t('files.batch_delete_confirm', { count: items.length }))) {
                      // 批量删除
                      for (const name of items) {
                        const fullPath = directory === '/'
                          ? `/${name}` 
                          : `${directory}/${name}`;
                        deleteFile(deviceUdid, fullPath);
                      }
                      if (props.isOpen && props.deviceUdid === deviceUdid && currentPath() === directory) {
                        const remaining = new Set(selectedItems());
                        items.forEach(name => remaining.delete(name));
                        setSelectedItems(remaining);
                      }
                      // 刷新文件列表
                      scheduleListRefresh(500, deviceUdid, directory);
                    }
                  }}
                >
                  <IconTrash size={14} />
                  <span>{t('common.delete')}</span>
                </button>
              </div>
            </div>
          </Show>

          <div class={styles.breadcrumbs}>
            <button class={styles.breadcrumbItem} onClick={() => handleNavigate('/')}>
              <IconHouse size={14} />
              <span>{t('files.root')}</span>
            </button>
            <For each={breadcrumbs()}>
              {(part, index) => (
                <>
                  <span class={styles.breadcrumbSeparator}>/</span>
                  <button 
                    class={styles.breadcrumbItem}
                    onClick={() => {
                      const parts = breadcrumbs().slice(0, index() + 1);
                      handleNavigate('/' + parts.join('/'));
                    }}
                  >
                    {part}
                  </button>
                </>
              )}
            </For>
          </div>

          
          <div 
            class={`${styles.fileList} ${styles.mainFileList} ${isDragOver() ? styles.dragOver : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ position: 'relative' }}
          >
            <Show when={isDragOver()}>
              <div class={styles.dropOverlay}>
                <div class={styles.dropHint}>
                  <IconUpload size={20} />
                  <span>{t('files.drop_to_device')}</span>
                </div>
              </div>
            </Show>

            <Show when={isUploading()}>
              <div class={styles.uploadingOverlay}>
                <div class={styles.uploadingHint}>{t('common.uploading')}</div>
              </div>
            </Show>

            <Show when={props.isLoading}>
              <div class={styles.loading}>{t('common.loading')}</div>
            </Show>
            
            <Show when={!props.isLoading}>
              <div class={styles.tableHeader}>
                <Show when={isSelectMode()}>
                  <div class={styles.tableCell} style={{ width: '40px' }}></div>
                </Show>
                <div class={`${styles.tableCell} ${styles.typeColumn}`}>{t('files.type')}</div>
                <div class={`${styles.tableCell} ${styles.nameColumn}`}>{t('files.name')}</div>
                <div class={`${styles.tableCell} ${styles.sizeColumn}`}>{t('files.size')}</div>
              </div>

              <div class={styles.tableBody}>
                <Show when={props.files.length > 0} fallback={<div class={styles.emptyMessage}>{t('files.empty')}</div>}>
                  <For each={sortedFiles()}>
                    {(file) => (
                      <div 
                        class={`${styles.tableRow} ${selectedItems().has(file.name) ? styles.selected : ''}`}
                        onMouseDown={(e) => {
                          if (isSelectMode() && e.button === 0) {
                            e.preventDefault(); // Prevent text selection on shift-click
                          }
                        }}
                        onClick={(e) => handleFileClick(file, e)}
                        onContextMenu={(e) => handleFileContextMenu(e, file)}
                        onTouchStart={() => handleFileTouchStartForContext(file)}
                        onTouchEnd={handleFileTouchEndForContext}
                        onTouchMove={handleFileTouchEndForContext}
                      >
                        <Show when={isSelectMode()}>
                          <div class={styles.tableCell} style={{ width: '40px' }}>
                            <input 
                              type="checkbox" 
                              class="themed-checkbox"
                              checked={selectedItems().has(file.name)} 
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                handleFileClick(file, e as any);
                              }}
                            />
                          </div>
                        </Show>
                         <div class={`${styles.tableCell} ${styles.typeColumn}`}>
                          <span class={styles.fileIconWrapper}>
                            <span class={`${styles.fileIcon} ${isSelectedScript(file) ? styles.selectedFileIcon : ''}`}>
                              {renderFileIcon(file.name, { isDirectory: file.type === 'directory' })}
                            </span>
                            <Show when={isSelectedScript(file)}>
                              <span class={styles.selectionBadge}>
                                <IconCircleCheck size={10} />
                              </span>
                            </Show>
                          </span>
                        </div>
                        <div class={`${styles.tableCell} ${styles.nameColumn}`}>
                          <span class={styles.fileName}>{file.name}</span>
                        </div>
                        <div class={`${styles.tableCell} ${styles.sizeColumn}`}>
                          {file.type === 'file' ? formatSize(file.size) : '-'}
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>

    {/* 编辑器弹窗 */}
    <Show when={showEditorModal()}>
      <div class={styles.editorOverlay} onMouseDown={editorBackdropClose.onMouseDown} onMouseUp={editorBackdropClose.onMouseUp}>
        <div class={styles.editorModal} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.editorHeader}>
            <h3>{t('files.edit_title', { name: editorFileName() })}</h3>
            <button class={styles.closeButton} onClick={closeEditor}>
              <IconXmark size={16} />
            </button>
          </div>
          <textarea 
            class={styles.editorTextarea} 
            value={editorContent()} 
            readOnly={editorLoading() || editorSaving()}
            onInput={(e) => setEditorContent(e.currentTarget.value)} 
          />
          <div class={styles.editorFooter}>
            <button class={styles.cancelBtn} onClick={closeEditor}>{t('common.cancel')}</button>
            <button class={styles.confirmBtn} onClick={handleSaveFile} disabled={editorSaving() || editorLoading()}>
              {editorSaving() ? t('files.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Show>

    {/* 右键菜单 */}
    <ContextMenu
      isOpen={!!contextMenuFile()}
      position={contextMenuPosition()}
      onClose={closeContextMenu}
      label={contextMenuFile()?.name}
    >
      <>
        <Show when={contextMenuFile()?.type === 'file' && isTextFile(contextMenuFile()!.name)}>
          <ContextMenuButton icon={<IconICursor size={14} />} onClick={() => { handleEditFile(contextMenuFile()!); closeContextMenu(); }}>
            {t('common.edit')}
          </ContextMenuButton>
        </Show>
        <Show when={contextMenuFile() && isSelectableScript(contextMenuFile()!)}>
          <ContextMenuButton icon={<IconClipboardCheck size={14} />} onClick={() => { handleSelectScript(contextMenuFile()!); closeContextMenu(); }}>
            {t('files.select_script')}
          </ContextMenuButton>
        </Show>
        <ContextMenuButton icon={<IconPen size={14} />} onClick={() => { handleRenameFile(contextMenuFile()!); closeContextMenu(); }}>
          {t('common.rename')}
        </ContextMenuButton>
        <Show when={contextMenuFile()?.type === 'file'}>
          <ContextMenuButton icon={<IconDownload size={14} />} onClick={() => { handleDownloadFile(contextMenuFile()!); closeContextMenu(); }}>
            {t('common.download')}
          </ContextMenuButton>
        </Show>
        <Show when={props.onPullFileFromDevice && (contextMenuFile()?.type === 'file' || props.onListFilesAsync)}>
          <ContextMenuButton icon={<IconUpload size={14} />} onClick={() => { prepareSendToCloud([contextMenuFile()!], 'files.send_cloud_empty_dir'); closeContextMenu(); }}>
            {t('files.send_to_cloud')}
          </ContextMenuButton>
        </Show>
        <ContextMenuDivider />
        <ContextMenuButton icon={<IconTrash size={14} />} danger onClick={() => { handleDeleteFile(contextMenuFile()!); closeContextMenu(); }}>
          {t('common.delete')}
        </ContextMenuButton>
      </>
    </ContextMenu>

    {/* 发送到云控模态框 */}
    <SendToCloudModal 
      isOpen={showSendToCloudModal()} 
      onClose={() => {
        sendToCloudTarget = null;
        setShowSendToCloudModal(false);
        setIsScanning(false);
        setSendToCloudPendingItems([]);
      }}
      onConfirm={handleSendToCloud}
      itemCount={sendToCloudPendingItems().length}
      isScanning={isScanning()}
      directoryCount={selectedDirectoryCount()}
    />
    </>
  );
}
