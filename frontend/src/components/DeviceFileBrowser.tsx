import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
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

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  size?: number;
}

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
  onUploadFile: (deviceUdid: string, path: string, file: File) => void;
  onUploadLargeFile?: (deviceUdid: string, path: string, file: File) => Promise<void>; // For files > 128KB
  onDownloadFile: (deviceUdid: string, path: string) => void;
  onDownloadLargeFile?: (deviceUdid: string, path: string, fileName: string) => Promise<void>; // For files > 128KB  
  onMoveFile: (deviceUdid: string, fromPath: string, toPath: string) => void;
  onCopyFile: (deviceUdid: string, fromPath: string, toPath: string) => void;
  onReadFile: (deviceUdid: string, path: string) => void;
  onSelectScript: (deviceUdid: string, scriptName: string) => void;
  selectedScript: string | null | undefined;
  files: FileItem[];
  isLoading: boolean;
  fileContent?: { path: string; content: string } | null;
  onPullFileFromDevice?: (deviceUdid: string, sourcePath: string, category: 'scripts' | 'files' | 'reports', targetPath: string) => Promise<{success: boolean; error?: string}>;
}

export default function DeviceFileBrowser(props: DeviceFileBrowserProps) {
  const dialog = useDialog();
  const [currentPath, setCurrentPath] = createSignal('/lua/scripts');
  const [showHidden, setShowHidden] = createSignal(false);
  const [lastSelectedItem, setLastSelectedItem] = createSignal<string | null>(null);
  const [isSelectMode, setIsSelectMode] = createSignal(false);
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(new Set<string>());
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);
  const mainBackdropClose = createBackdropClose(() => props.onClose());
  const editorBackdropClose = createBackdropClose(() => setShowEditorModal(false));
  let dragCounter = 0;

  // 剪贴板状态
  const [clipboard, setClipboard] = createSignal<{
    items: string[];  // 文件名列表
    srcPath: string;  // 源目录路径
    mode: 'copy' | 'cut';
  } | null>(null);

  // 编辑器弹窗
  const [showEditorModal, setShowEditorModal] = createSignal(false);
  const [editorFileName, setEditorFileName] = createSignal('');
  const [editorFilePath, setEditorFilePath] = createSignal('');
  const [editorContent, setEditorContent] = createSignal('');
  const [editorSaving, setEditorSaving] = createSignal(false);

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
  
  const toast = useToast();

  // 监听文件内容更新
  createEffect(() => {
    const content = props.fileContent;
    if (content && showEditorModal() && editorFilePath() === content.path) {
      setEditorContent(content.content);
    }
  });

  // 当组件打开时，加载默认目录
  createEffect(() => {
    if (props.isOpen) {
      setCurrentPath('/lua/scripts');
      props.onListFiles(props.deviceUdid, '/lua/scripts');
      setIsSelectMode(false);
      setSelectedItems(new Set<string>());
    }
  });

  // 文件排序函数：文件夹在前，文件在后，都按名称正序排序
  const sortedFiles = () => {
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
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setSelectedItems(new Set<string>());
    props.onListFiles(props.deviceUdid, path);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (contextMenuFile()) {
        setContextMenuFile(null);
      } else if (showEditorModal()) {
        setShowEditorModal(false);
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

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
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
    if (!await dialog.confirm(`确定要删除 "${file.name}" 吗？`)) return;
    const fullPath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    props.onDeleteFile(props.deviceUdid, fullPath);
    // 刷新文件列表
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 500);
  };

  const handleDownloadFile = async (file: FileItem) => {
    const fullPath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    
    // Use large file transfer for files > 128KB
    const fileSize = file.size || 0;
    if (fileSize > LARGE_FILE_THRESHOLD && props.onDownloadLargeFile) {
      console.log(`📥 Large file detected (${fileSize} bytes), using HTTP transfer`);
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
    const newName = await dialog.prompt('请输入新名称', file.name, '重命名');
    if (!newName?.trim() || newName.trim() === file.name) return;

    const fromPath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    const toPath = currentPath() === '/' 
      ? `/${newName.trim()}` 
      : `${currentPath()}/${newName.trim()}`;

    props.onMoveFile(props.deviceUdid, fromPath, toPath);

    // 刷新文件列表
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 500);
  };

  // 编辑文件
  const handleEditFile = (file: FileItem) => {
    const fullPath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    
    setEditorFileName(file.name);
    setEditorFilePath(fullPath);
    setEditorContent('加载中...');
    setShowEditorModal(true);
    
    // 请求文件内容
    props.onReadFile(props.deviceUdid, fullPath);
  };

  // 保存文件
  const handleSaveFile = async () => {
    const path = editorFilePath();
    if (!path) return;

    setEditorSaving(true);
    
    const content = editorContent();
    
    // 创建一个带内容的虚拟文件进行上传
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], editorFileName(), { type: 'text/plain' });
    
    props.onUploadFile(props.deviceUdid, path, file);
    
    setTimeout(() => {
      setEditorSaving(false);
      setShowEditorModal(false);
      props.onListFiles(props.deviceUdid, currentPath());
    }, 800);
  };

  const handleCreateFolder = async () => {
    const folderName = await dialog.prompt('新建文件夹', '请输入文件夹名称');
    if (!folderName?.trim()) return;

    const folderPath = currentPath() === '/' 
      ? `/${folderName.trim()}` 
      : `${currentPath()}/${folderName.trim()}`;
    
    props.onCreateDirectory(props.deviceUdid, folderPath);
    
    // 刷新当前目录
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 500);
  };

  const handleCreateFile = async () => {
    const fileName = await dialog.prompt('新建文件', '请输入文件名称');
    if (!fileName?.trim()) return;

    const name = fileName.trim();

    // 检查文件是否已存在
    const exists = props.files.some(f => f.name === name);
    if (exists) {
      await dialog.alert(`文件 "${name}" 已存在！`);
      return;
    }

    const filePath = currentPath() === '/' 
      ? `/${name}` 
      : `${currentPath()}/${name}`;
    
    // 创建空文件（模拟上传一个空 Blob）
    const emptyFile = new File([], name, { type: 'text/plain' });
    props.onUploadFile(props.deviceUdid, filePath, emptyFile);
    
    // 刷新当前目录
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 1000);
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
    
    let scannedFiles: ScannedFile[] = [];
    if (e.dataTransfer?.items) {
      scannedFiles = await scanEntries(e.dataTransfer.items);
    } else {
      const droppedFiles = Array.from(e.dataTransfer?.files || []);
      scannedFiles = droppedFiles.map(file => ({ file, relativePath: file.name }));
    }

    if (scannedFiles.length > 0) {
      setIsUploading(true);
      
      for (const { file, relativePath } of scannedFiles) {
        const fullPath = currentPath() === '/' 
          ? `/${relativePath}` 
          : `${currentPath()}/${relativePath}`;
        
        // Use large file transfer for files > 128KB
        if (file.size > LARGE_FILE_THRESHOLD && props.onUploadLargeFile) {
          console.log(`📤 Large file detected (${file.size} bytes), using HTTP transfer`);
          await props.onUploadLargeFile(props.deviceUdid, fullPath, file);
        } else {
          props.onUploadFile(props.deviceUdid, fullPath, file);
        }
      }
      
      // 刷新当前目录
      setTimeout(() => {
        setIsUploading(false);
        props.onListFiles(props.deviceUdid, currentPath());
      }, 2000);
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
      await dialog.alert('不能粘贴到相同目录');
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
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 500 * cb.items.length);
  };

  // 检查是否可以粘贴
  const canPaste = () => {
    const cb = clipboard();
    if (!cb || cb.items.length === 0) return false;
    // 不能粘贴到源目录
    return cb.srcPath !== currentPath();
  };

  // 递归扫描目录，获取所有文件（返回 {sourcePath, relativePath}）
  const scanDirectoryRecursive = async (
    dirPath: string,
    basePath: string
  ): Promise<{sourcePath: string; relativePath: string}[]> => {
    if (!props.onListFilesAsync) {
      console.warn('onListFilesAsync not provided, cannot scan directory');
      return [];
    }

    const result: {sourcePath: string; relativePath: string}[] = [];
    const files = await props.onListFilesAsync(props.deviceUdid, dirPath);
    
    for (const file of files) {
      const fullPath = dirPath === '/' ? `/${file.name}` : `${dirPath}/${file.name}`;
      const relPath = basePath ? `${basePath}/${file.name}` : file.name;
      
      if (file.type === 'file') {
        result.push({ sourcePath: fullPath, relativePath: relPath });
      } else if (file.type === 'directory') {
        // 递归扫描子目录
        const subFiles = await scanDirectoryRecursive(fullPath, relPath);
        result.push(...subFiles);
      }
    }
    
    return result;
  };

  // 打开发送到云控模态框
  const openSendToCloudModal = async () => {
    const selected = selectedItems();
    if (selected.size === 0) return;
    
    // 统计选中的文件和目录
    const selectedFiles: string[] = [];
    const selectedDirs: string[] = [];
    
    Array.from(selected).forEach(name => {
      const file = sortedFiles().find(f => f.name === name);
      if (file) {
        if (file.type === 'file') {
          selectedFiles.push(name);
        } else if (file.type === 'directory') {
          selectedDirs.push(name);
        }
      }
    });
    
    setSelectedDirectoryCount(selectedDirs.length);
    
    // 如果选中了目录，需要先扫描
    if (selectedDirs.length > 0) {
      if (!props.onListFilesAsync) {
        dialog.alert('当前版本不支持发送目录到云控');
        return;
      }
      
      setIsScanning(true);
      setSendToCloudPendingItems(selectedFiles); // 先显示已选中的文件
      setShowSendToCloudModal(true);
      
      // 扫描所有选中的目录
      const allFiles: string[] = [...selectedFiles];
      
      for (const dirName of selectedDirs) {
        const dirPath = currentPath() === '/' ? `/${dirName}` : `${currentPath()}/${dirName}`;
        const scanned = await scanDirectoryRecursive(dirPath, dirName);
        // 将扫描到的文件的相对路径添加到列表
        scanned.forEach(f => allFiles.push(f.relativePath));
        setSendToCloudPendingItems([...allFiles]); // 实时更新计数
      }
      
      setIsScanning(false);
      
      if (allFiles.length === 0) {
        dialog.alert('选中的目录为空或扫描失败');
        setShowSendToCloudModal(false);
        return;
      }
      
      setSendToCloudPendingItems(allFiles);
    } else {
      // 只有文件，直接打开模态框
      setSendToCloudPendingItems(selectedFiles);
      setShowSendToCloudModal(true);
    }
  };

  // 执行发送到云控
  const handleSendToCloud = async (category: 'scripts' | 'files' | 'reports', targetPath: string) => {
    if (!props.onPullFileFromDevice) {
      dialog.alert('发送到云控功能不可用');
      return;
    }
    
    const items = sendToCloudPendingItems();
    if (items.length === 0) return;
    
    setShowSendToCloudModal(false);
    setIsSendingToCloud(true);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const name of items) {
      const sourcePath = currentPath() === '/' 
        ? `/${name}` 
        : `${currentPath()}/${name}`;
      
      // 构建目标路径：targetPath + 文件名
      const finalTargetPath = targetPath === '/' || targetPath === '' 
        ? name 
        : (targetPath.endsWith('/') ? targetPath + name : targetPath + '/' + name);
      
      try {
        const result = await props.onPullFileFromDevice(
          props.deviceUdid, 
          sourcePath, 
          category, 
          finalTargetPath
        );
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          console.error(`发送文件失败 ${name}:`, result.error);
        }
      } catch (err) {
        failCount++;
        console.error(`发送文件失败 ${name}:`, err);
      }
    }
    
    setIsSendingToCloud(false);
    
    if (successCount > 0 && failCount === 0) {
      toast.showSuccess(`成功发送 ${successCount} 个文件到云控`);
    } else if (successCount > 0 && failCount > 0) {
      toast.showWarning(`发送完成：${successCount} 个成功，${failCount} 个失败`);
    } else {
      toast.showError(`发送失败：${failCount} 个文件发送失败`);
    }
    
    setSendToCloudPendingItems([]);
  };

  // 单项发送到云控（支持文件和目录）
  const handleSendSingleFileToCloud = async (file: FileItem) => {
    if (file.type === 'directory') {
      // 扫描目录并发送
      if (!props.onListFilesAsync) {
        dialog.alert('当前版本不支持发送目录到云控');
        return;
      }
      
      setSelectedDirectoryCount(1);
      setIsScanning(true);
      setSendToCloudPendingItems([]); // 先清空
      setShowSendToCloudModal(true);
      
      const dirPath = currentPath() === '/' ? `/${file.name}` : `${currentPath()}/${file.name}`;
      const scanned = await scanDirectoryRecursive(dirPath, file.name);
      
      setIsScanning(false);
      
      if (scanned.length === 0) {
        dialog.alert('目录为空或扫描失败');
        setShowSendToCloudModal(false);
        return;
      }
      
      const fileNames = scanned.map(f => f.relativePath);
      setSendToCloudPendingItems(fileNames);
    } else {
      // 单个文件直接发送
      setSelectedDirectoryCount(0);
      setSendToCloudPendingItems([file.name]);
      setShowSendToCloudModal(true);
    }
  };

  return (
    <>
    <Show when={props.isOpen}>
      <div class={styles.overlay} onMouseDown={mainBackdropClose.onMouseDown} onMouseUp={mainBackdropClose.onMouseUp}>
        <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h2>设备文件浏览器 - {props.deviceName}</h2>
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
              <span>脚本<span class={styles.desktopText}>目录</span></span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/res' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/res')}
            >
              <IconBoxesStacked size={16} />
              <span>资源<span class={styles.desktopText}>目录</span></span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/log' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/log')}
            >
              <IconChartColumn size={16} />
              <span>日志<span class={styles.desktopText}>目录</span></span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/' || currentPath() === '' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/')}
            >
              <IconHouse size={16} />
              <span>主<span class={styles.desktopText}>目录</span></span>
            </button>
          </div>
          
          <div class={styles.toolbar}>
             <div class={styles.actions}>
              <button 
                class={styles.actionButton}
                onClick={handleCreateFile}
              >
                <IconFileCirclePlus size={16} />
                <span>新建文件</span>
              </button>

              <button 
                class={styles.actionButton}
                onClick={handleCreateFolder}
              >
                <IconFolderPlus size={16} />
                <span>新建文件夹</span>
              </button>

              <button class={styles.actionButton} onClick={() => props.onListFiles(props.deviceUdid, currentPath())}>
                <IconRotate size={16} />
                <span>刷新</span>
              </button>

              <button 
                class={`${styles.actionButton} ${isSelectMode() ? styles.activeAction : ''}`} 
                onClick={() => { 
                  setIsSelectMode(!isSelectMode()); 
                  if (!isSelectMode()) setSelectedItems(new Set<string>()); 
                }}
              >
                <IconSquareCheck size={16} />
                <span>选择模式</span>
              </button>

              <label class={styles.showHiddenLabel}>
                <input 
                  type="checkbox" 
                  class="themed-checkbox"
                  checked={showHidden()} 
                  onChange={(e) => setShowHidden(e.currentTarget.checked)} 
                />
                <span>显示隐藏文件</span>
              </label>
            </div>
          </div>

          <Show when={isSelectMode()}>
            <div class={styles.selectToolbar}>
              <div class={styles.selectInfo}>
                <span class={styles.selectedCount}>
                  <span class={styles.mobileCheck}><IconCheck size={14} /></span>
                  <span class={styles.desktopText}>已选择 </span>
                  {selectedItems().size}
                  <span class={styles.desktopText}> 项</span>
                </span>
                <Show when={clipboard()}>
                  <span class={styles.clipboardInfo}>
                    剪贴板: {clipboard()!.items.length} 项 ({clipboard()!.mode === 'copy' ? '复制' : '剪切'})
                  </span>
                </Show>
              </div>
              <div class={styles.selectActions}>
                <button class={styles.selectAction} onClick={toggleAllSelection}>
                  <IconCheckDouble size={14} />
                  <span>{selectedItems().size === sortedFiles().length ? '取消全选' : '全选'}</span>
                </button>
                <button class={styles.selectAction} onClick={() => setSelectedItems(new Set())} disabled={selectedItems().size === 0}>
                  <IconCircleXmark size={14} />
                  <span>清除选择</span>
                </button>
                
                <div class={styles.selectDivider} />
                
                <button class={styles.selectAction} onClick={handleCopy} disabled={selectedItems().size === 0}>
                  <IconCopy size={14} />
                  <span>复制</span>
                </button>
                <button class={styles.selectAction} onClick={handleCut} disabled={selectedItems().size === 0}>
                  <IconScissors size={14} />
                  <span>剪切</span>
                </button>
                <button class={styles.selectAction} onClick={handlePaste} disabled={!canPaste()}>
                  <IconPaste size={14} />
                  <span>粘贴</span>
                </button>
                
                <div class={styles.selectDivider} />

                <Show when={props.onPullFileFromDevice}>
                  <button 
                    class={`${styles.selectAction} ${styles.sendToCloudAction}`}
                    onClick={openSendToCloudModal} 
                    disabled={selectedItems().size === 0 || isSendingToCloud()}
                  >
                    <IconUpload size={14} />
                    <span>{isSendingToCloud() ? '发送中...' : '发送到云控'}</span>
                  </button>
                  
                  <div class={styles.selectDivider} />
                </Show>
                
                <button 
                  class={styles.deleteAction} 
                  disabled={selectedItems().size === 0}
                  onClick={async () => {
                    if (await dialog.confirm(`确定要删除选中的 ${selectedItems().size} 个项目吗？`)) {
                      // 批量删除
                      for (const name of selectedItems()) {
                        const fullPath = currentPath() === '/' 
                          ? `/${name}` 
                          : `${currentPath()}/${name}`;
                        props.onDeleteFile(props.deviceUdid, fullPath);
                      }
                      setSelectedItems(new Set<string>());
                      // 刷新文件列表
                      setTimeout(() => {
                        props.onListFiles(props.deviceUdid, currentPath());
                      }, 500);
                    }
                  }}
                >
                  <IconTrash size={14} />
                  <span>删除</span>
                </button>
              </div>
            </div>
          </Show>

          <div class={styles.breadcrumbs}>
            <button class={styles.breadcrumbItem} onClick={() => handleNavigate('/')}>
              <IconHouse size={14} />
              <span>根<span class={styles.desktopText}>目录</span></span>
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
            class={`${styles.fileList} ${isDragOver() ? styles.dragOver : ''}`}
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
                  <span>释放上传到设备</span>
                </div>
              </div>
            </Show>

            <Show when={isUploading()}>
              <div class={styles.uploadingOverlay}>
                <div class={styles.uploadingHint}>上传中...</div>
              </div>
            </Show>

            <Show when={props.isLoading}>
              <div class={styles.loading}>加载中...</div>
            </Show>
            
            <Show when={!props.isLoading}>
              <div class={styles.tableHeader}>
                <Show when={isSelectMode()}>
                  <div class={styles.tableCell} style={{ width: '40px' }}></div>
                </Show>
                <div class={`${styles.tableCell} ${styles.typeColumn}`}>类型</div>
                <div class={`${styles.tableCell} ${styles.nameColumn}`}>名称</div>
                <div class={`${styles.tableCell} ${styles.sizeColumn}`}>尺寸</div>
              </div>

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
            
            <Show when={!props.isLoading && props.files.length === 0}>
              <div class={styles.emptyMessage}>此目录为空</div>
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
            <h3>编辑: {editorFileName()}</h3>
            <button class={styles.closeButton} onClick={() => setShowEditorModal(false)}>
              <IconXmark size={16} />
            </button>
          </div>
          <textarea 
            class={styles.editorTextarea} 
            value={editorContent()} 
            onInput={(e) => setEditorContent(e.currentTarget.value)} 
          />
          <div class={styles.editorFooter}>
            <button class={styles.cancelBtn} onClick={() => setShowEditorModal(false)}>取消</button>
            <button class={styles.confirmBtn} onClick={handleSaveFile} disabled={editorSaving()}>
              {editorSaving() ? '保存中...' : '保存'}
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
            编辑
          </ContextMenuButton>
        </Show>
        <Show when={contextMenuFile() && isSelectableScript(contextMenuFile()!)}>
          <ContextMenuButton icon={<IconClipboardCheck size={14} />} onClick={() => { handleSelectScript(contextMenuFile()!); closeContextMenu(); }}>
            选中脚本
          </ContextMenuButton>
        </Show>
        <ContextMenuButton icon={<IconPen size={14} />} onClick={() => { handleRenameFile(contextMenuFile()!); closeContextMenu(); }}>
          重命名
        </ContextMenuButton>
        <Show when={contextMenuFile()?.type === 'file'}>
          <ContextMenuButton icon={<IconDownload size={14} />} onClick={() => { handleDownloadFile(contextMenuFile()!); closeContextMenu(); }}>
            下载
          </ContextMenuButton>
        </Show>
        <Show when={props.onPullFileFromDevice && (contextMenuFile()?.type === 'file' || props.onListFilesAsync)}>
          <ContextMenuButton icon={<IconUpload size={14} />} onClick={() => { handleSendSingleFileToCloud(contextMenuFile()!); closeContextMenu(); }}>
            发送到云控
          </ContextMenuButton>
        </Show>
        <ContextMenuDivider />
        <ContextMenuButton icon={<IconTrash size={14} />} danger onClick={() => { handleDeleteFile(contextMenuFile()!); closeContextMenu(); }}>
          删除
        </ContextMenuButton>
      </>
    </ContextMenu>

    {/* 发送到云控模态框 */}
    <SendToCloudModal 
      isOpen={showSendToCloudModal()} 
      onClose={() => setShowSendToCloudModal(false)}
      onConfirm={handleSendToCloud}
      itemCount={sendToCloudPendingItems().length}
      isScanning={isScanning()}
      directoryCount={selectedDirectoryCount()}
    />
    </>
  );
}
