import { createSignal, createEffect, For, Show, onMount, onCleanup, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Select, createListCollection } from '@ark-ui/solid';
import { FaSolidSquareArrowUpRight } from 'solid-icons/fa';
import { useDialog } from './DialogContext';
import { useToast } from './ToastContext';
import {
  IconCode,
  IconBoxesStacked,
  IconChartColumn,
  IconFileCirclePlus,
  IconFolderPlus,
  IconFolderOpen,
  IconRotate,
  IconSquareCheck,
  IconCheck,
  IconCheckDouble,
  IconCircleXmark,
  IconCopy,
  IconScissors,
  IconPaste,
  IconUpload,
  IconDownload,
  IconTrash,
  IconPen,
  IconICursor,
  IconEye,
  IconHouse,
  IconXmark,
  IconPaperPlane,
} from '../icons';
import { renderFileIcon } from '../utils/fileIcons';
import { createBackdropClose } from '../hooks/useBackdropClose';
import styles from './ServerFileBrowser.module.css';
import { authFetch, appendAuthQuery } from '../services/httpAuth';
import { scanEntries, ScannedFile } from '../utils/fileUpload';
import type { Device } from '../services/WebSocketService';
import ContextMenu, { ContextMenuButton, ContextMenuDivider } from './ContextMenu';

export interface ServerFileItem {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modTime: string;
  isSymlink?: boolean;
}

type LanControlArchiveMeta = {
  format?: string;
  formatVersion?: number;
  name?: string;
  version?: string;
  author?: string;
  description?: string;
  minXXTLCVersion?: string;
  maxXXTLCVersion?: string;
};

type LanControlArchiveSource =
  | { kind: 'managed'; category: 'scripts' | 'files' | 'reports'; path: string; displayName: string }
  | { kind: 'upload'; file: File; displayName: string };

export interface ServerFileBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  serverBaseUrl: string;
  selectedDevices?: Device[];
}

const LANCONTROL_ARCHIVE_EXT = '.xxtlca';

export default function ServerFileBrowser(props: ServerFileBrowserProps) {
  const dialog = useDialog();
  const [currentCategory, setCurrentCategory] = createSignal<'scripts' | 'files' | 'reports'>('scripts');
  const [currentPath, setCurrentPath] = createSignal('');
  const [files, setFiles] = createSignal<ServerFileItem[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);
  const [showHidden, setShowHidden] = createSignal(false);
  const [isLocal, setIsLocal] = createSignal(false);

  // 中控脚本包安装
  const [lanControlArchiveOpen, setLanControlArchiveOpen] = createSignal(false);
  const [lanControlArchiveMeta, setLanControlArchiveMeta] = createSignal<LanControlArchiveMeta>({});
  const [lanControlArchiveSource, setLanControlArchiveSource] = createSignal<LanControlArchiveSource | null>(null);
  const [lanControlArchiveInstallName, setLanControlArchiveInstallName] = createSignal('');
  const [lanControlArchiveExists, setLanControlArchiveExists] = createSignal(false);
  const [lanControlArchiveOverwrite, setLanControlArchiveOverwrite] = createSignal(false);
  const [lanControlArchiveDeletePackage, setLanControlArchiveDeletePackage] = createSignal(true);
  const [lanControlArchiveInstalling, setLanControlArchiveInstalling] = createSignal(false);
  const [lanControlArchiveError, setLanControlArchiveError] = createSignal('');
  let lanControlArchiveResolve: ((installed: boolean) => void) | null = null;

  const mainBackdropClose = createBackdropClose(() => props.onClose());
  const editorBackdropClose = createBackdropClose(() => setShowEditorModal(false));
  const imagePreviewBackdropClose = createBackdropClose(() => setShowImagePreview(false));
  const lanControlArchiveBackdropClose = createBackdropClose(() => {
    if (!lanControlArchiveInstalling()) {
      closeLanControlArchiveDialog(false);
    }
  });

  const loadConfig = async () => {
    try {
      const response = await authFetch(`${props.serverBaseUrl}/api/config?format=json`);
      if (!response.ok) return;
      const data = await response.json();
      setIsLocal(!!data?.ui?.isLocal);
    } catch {
      setIsLocal(false);
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      setIsLocal(false);
      loadConfig();
    }
  });
  
  // 选择模式
  const [isSelectMode, setIsSelectMode] = createSignal(false);
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(new Set());
  
  // 剪贴板状态
  const [clipboard, setClipboard] = createSignal<{
    items: string[];
    category: 'scripts' | 'files' | 'reports';
    srcPath: string;
    mode: 'copy' | 'cut';
  } | null>(null);
  
  // 编辑器弹窗
  const [showEditorModal, setShowEditorModal] = createSignal(false);
  const [editorFileName, setEditorFileName] = createSignal('');
  const [editorContent, setEditorContent] = createSignal('');
  const [editorSaving, setEditorSaving] = createSignal(false);
  
  // 图片预览
  const [showImagePreview, setShowImagePreview] = createSignal(false);
  const [previewImageUrl, setPreviewImageUrl] = createSignal('');

  // Range Selection
  const [lastSelectedItem, setLastSelectedItem] = createSignal<string | null>(null);

  // 右键菜单
  const [contextMenuFile, setContextMenuFile] = createSignal<ServerFileItem | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // 发送到设备
  const [showSendToDeviceModal, setShowSendToDeviceModal] = createSignal(false);
  const [targetDevicePath, setTargetDevicePath] = createSignal('/lua/scripts/');
  const [isSendingToDevices, setIsSendingToDevices] = createSignal(false);
  
  const toast = useToast();

  const runWithConcurrency = async <T,>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
  ) => {
    if (items.length === 0) return;
    const concurrency = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;

    const tasks = Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    });

    await Promise.all(tasks);
  };

  // 目标路径选项
  const targetPathOptions = [
    { value: '/lua/scripts/', label: '脚本目录 - /lua/scripts/' },
    { value: '/lua/', label: '脚本模块目录 - /lua/' },
    { value: '/res/', label: '资源目录 - /res/' },
    { value: '/', label: '主目录 - /' },
  ];

  const targetPathCollection = createMemo(() => 
    createListCollection({ items: targetPathOptions.map(opt => opt.value) })
  );

  // 加载文件列表
  const loadFiles = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const params = new URLSearchParams({
        category: currentCategory(),
        path: currentPath(),
        meta: '1',
      });
      
      const response = await authFetch(`${props.serverBaseUrl}/api/server-files/list?${params}`);
      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
        setFiles([]);
      } else {
        setFiles(data.files || []);
      }
    } catch (err) {
      setError('加载失败: ' + (err as Error).message);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      loadFiles();
      setIsSelectMode(false);
      setSelectedItems(new Set<string>());
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (lanControlArchiveOpen()) {
        if (!lanControlArchiveInstalling()) closeLanControlArchiveDialog(false);
      } else if (contextMenuFile()) {
        setContextMenuFile(null);
      } else if (showImagePreview()) {
        setShowImagePreview(false);
      } else if (showEditorModal()) {
        setShowEditorModal(false);
      } else if (props.isOpen) {
        props.onClose();
      }
    }
  };

  // 右键菜单处理
  const handleFileContextMenu = (e: MouseEvent, file: ServerFileItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuFile(file);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleFileTouchStart = (file: ServerFileItem) => {
    longPressTimer = setTimeout(() => {
      setContextMenuFile(file);
      setContextMenuPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }, 500);
  };

  const handleFileTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
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

  const sortedFiles = createMemo(() => {
    let result = [...files()].sort((a, b) => {
      if (a.type === 'dir' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    
    // Filter hidden files if not showing hidden
    if (!showHidden()) {
      result = result.filter(f => !f.name.startsWith('.'));
    }
    
    return result;
  });

  const handleCategoryChange = (category: 'scripts' | 'files' | 'reports') => {
    setCurrentCategory(category);
    setCurrentPath('');
    setSelectedItems(new Set<string>());
    loadFiles();
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setSelectedItems(new Set<string>());
    loadFiles();
  };


  const handleFileClick = (file: ServerFileItem, e?: MouseEvent) => {
    if (isSelectMode()) {
      toggleSelection(file.name, e);
    } else if (file.type === 'dir') {
      const newPath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
      handleNavigate(newPath);
    }
    // 其它文件点击不处理，保留右键菜单操作语义。
  };

  const handleFileDoubleClick = (file: ServerFileItem) => {
    if (isSelectMode()) return;
    if (file.type === 'file' && isLanControlArchiveFile(file.name)) {
      const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
      void openLanControlArchiveInstallDialog({
        kind: 'managed',
        category: currentCategory(),
        path: filePath,
        displayName: file.name
      });
    }
  };

  const toggleSelection = (name: string, e?: MouseEvent) => {
    const current = new Set<string>(selectedItems());
    
    if (e?.shiftKey && lastSelectedItem()) {
      const files = sortedFiles();
      const lastIndex = files.findIndex(f => f.name === lastSelectedItem());
      const currentIndex = files.findIndex(f => f.name === name);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const range = files.slice(start, end + 1);
        
        range.forEach(f => current.add(f.name));
        setSelectedItems(current);
        setLastSelectedItem(name);
        return;
      }
    }

    if (current.has(name)) {
      current.delete(name);
    } else {
      current.add(name);
    }
    setSelectedItems(current);
    setLastSelectedItem(name);
  };

  const selectAll = () => setSelectedItems(new Set<string>(files().map(f => f.name)));
  const clearSelection = () => setSelectedItems(new Set<string>());

  // 复制选中的项目到剪贴板
  const handleCopy = () => {
    const selected = selectedItems();
    if (selected.size === 0) return;
    setClipboard({
      items: Array.from(selected),
      category: currentCategory(),
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
      category: currentCategory(),
      srcPath: currentPath(),
      mode: 'cut'
    });
  };

  // 粘贴剪贴板中的项目
  const handlePaste = async () => {
    const cb = clipboard();
    if (!cb || cb.items.length === 0) return;
    
    // 不能粘贴到相同目录（同一 category 且同一路径）
    if (cb.category === currentCategory() && cb.srcPath === currentPath()) {
      await dialog.alert('不能粘贴到相同目录');
      return;
    }
    
    try {
      const endpoint = cb.mode === 'copy' 
        ? `${props.serverBaseUrl}/api/server-files/batch-copy`
        : `${props.serverBaseUrl}/api/server-files/batch-move`;
        
      const response = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srcCategory: cb.category,
          dstCategory: currentCategory(),
          items: cb.items,
          srcPath: cb.srcPath,
          dstPath: currentPath()
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        await dialog.alert(`${cb.mode === 'copy' ? '复制' : '移动'}失败: ` + data.error);
      } else if (data.errors && data.errors.length > 0) {
        await dialog.alert(`部分操作失败 (${data.successCount}/${data.totalCount}):\n${data.errors.join('\n')}`);
      }
      
      // 剪切操作完成后清空剪贴板
      if (cb.mode === 'cut') {
        setClipboard(null);
      }
      
      loadFiles();
    } catch (err) {
      await dialog.alert(`${cb.mode === 'copy' ? '复制' : '移动'}失败: ` + (err as Error).message);
    }
  };

  // 检查是否可以粘贴
  const canPaste = () => {
    const cb = clipboard();
    if (!cb || cb.items.length === 0) return false;
    // 不能粘贴到相同目录（同一 category 且同一路径）
    return !(cb.category === currentCategory() && cb.srcPath === currentPath());
  };

  const handleDownload = (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    const url = appendAuthQuery(
      `${props.serverBaseUrl}/api/server-files/download/${currentCategory()}/${filePath}`
    );
    window.open(url, '_blank');
  };

  const isLanControlArchiveFile = (name: string) => name.trim().toLowerCase().endsWith(LANCONTROL_ARCHIVE_EXT);

  const localizeLanControlArchiveError = (raw: unknown): string => {
    const message = String(raw || '').trim();
    if (!message) return '未知错误';

    const existsMatch = message.match(/^script "(.+)" already exists$/);
    if (existsMatch) {
      return `脚本“${existsMatch[1]}”已存在`;
    }

    return message;
  };

  const buildLanControlArchiveFormData = (source: Extract<LanControlArchiveSource, { kind: 'upload' }>, extra?: Record<string, string>) => {
    const formData = new FormData();
    formData.append('file', source.file, source.displayName || source.file.name);
    for (const [key, value] of Object.entries(extra || {})) {
      formData.append(key, value);
    }
    return formData;
  };

  const inspectLanControlArchive = async (source: LanControlArchiveSource) => {
    if (source.kind === 'managed') {
      const params = new URLSearchParams({ category: source.category, path: source.path });
      const response = await authFetch(`${props.serverBaseUrl}/api/scripts/lancontrol-archive/inspect?${params}`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || '读取中控脚本包失败');
      return data;
    }
    const response = await authFetch(`${props.serverBaseUrl}/api/scripts/lancontrol-archive/inspect`, {
      method: 'POST',
      body: buildLanControlArchiveFormData(source)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || '读取中控脚本包失败');
    return data;
  };

  const installLanControlArchive = async (source: LanControlArchiveSource) => {
    const installName = lanControlArchiveInstallName().trim();
    const overwrite = lanControlArchiveOverwrite() ? 'true' : 'false';
    if (source.kind === 'managed') {
      const params = new URLSearchParams({
        category: source.category,
        path: source.path,
        installName,
        overwrite
      });
      const response = await authFetch(`${props.serverBaseUrl}/api/scripts/lancontrol-archive/install?${params}`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || '安装中控脚本包失败');
      return data;
    }
    const response = await authFetch(`${props.serverBaseUrl}/api/scripts/lancontrol-archive/install`, {
      method: 'POST',
      body: buildLanControlArchiveFormData(source, { installName, overwrite })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || '安装中控脚本包失败');
    return data;
  };

  const deleteManagedLanControlArchivePackage = async (source: Extract<LanControlArchiveSource, { kind: 'managed' }>) => {
    const params = new URLSearchParams({ category: source.category, path: source.path });
    const response = await authFetch(`${props.serverBaseUrl}/api/server-files/delete?${params}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || '删除安装包失败');
  };

  const closeLanControlArchiveDialog = (installed: boolean) => {
    setLanControlArchiveOpen(false);
    setLanControlArchiveInstalling(false);
    setLanControlArchiveSource(null);
    setLanControlArchiveMeta({});
    setLanControlArchiveInstallName('');
    setLanControlArchiveExists(false);
    setLanControlArchiveOverwrite(false);
    setLanControlArchiveDeletePackage(true);
    setLanControlArchiveError('');
    const resolve = lanControlArchiveResolve;
    lanControlArchiveResolve = null;
    resolve?.(installed);
  };

  const openLanControlArchiveInstallDialog = async (source: LanControlArchiveSource): Promise<boolean> => {
    if (lanControlArchiveOpen()) {
      return false;
    }
    try {
      const result = await inspectLanControlArchive(source);
      const meta = (result?.meta || {}) as LanControlArchiveMeta;
      setLanControlArchiveMeta(meta);
      setLanControlArchiveSource(source);
      setLanControlArchiveInstallName(String(result?.installName || meta.name || source.displayName.replace(/\.xxtlca$/i, '') || ''));
      setLanControlArchiveExists(!!result?.exists);
      setLanControlArchiveOverwrite(false);
      setLanControlArchiveDeletePackage(true);
      setLanControlArchiveError('');
      setLanControlArchiveInstalling(false);
      setLanControlArchiveOpen(true);
      return await new Promise<boolean>((resolve) => {
        lanControlArchiveResolve = resolve;
      });
    } catch (error) {
      await dialog.alert(`读取中控脚本包失败: ${localizeLanControlArchiveError((error as Error).message)}`);
      return false;
    }
  };

  const confirmLanControlArchiveInstall = async () => {
    const source = lanControlArchiveSource();
    if (!source) {
      closeLanControlArchiveDialog(false);
      return;
    }
    if (!lanControlArchiveInstallName().trim()) {
      setLanControlArchiveError('请输入安装名称');
      return;
    }
    setLanControlArchiveInstalling(true);
    setLanControlArchiveError('');
    try {
      const result = await installLanControlArchive(source);
      const installedName = String(result?.installName || lanControlArchiveInstallName().trim());
      if (source.kind === 'managed' && lanControlArchiveDeletePackage()) {
        try {
          await deleteManagedLanControlArchivePackage(source);
        } catch (deleteError) {
          console.error('Delete LanControl archive package failed:', deleteError);
          toast.showError(`安装成功，但删除安装包失败: ${localizeLanControlArchiveError((deleteError as Error).message)}`);
        }
      }
      toast.showSuccess(`已安装中控脚本: ${installedName}`);
      closeLanControlArchiveDialog(true);
      loadFiles();
    } catch (error) {
      const localizedMessage = localizeLanControlArchiveError((error as Error).message);
      if (/已存在$/.test(localizedMessage) || /^script "(.+)" already exists$/.test(String((error as Error).message || ''))) {
        setLanControlArchiveExists(true);
      }
      setLanControlArchiveError(`安装失败: ${localizedMessage}`);
      setLanControlArchiveInstalling(false);
    }
  };

  const getDeleteConfirmMessage = (file: ServerFileItem): string => {
    if (file.type !== 'dir') {
      return `确定要删除 "${file.name}" 吗？`;
    }

    if (file.isSymlink === true) {
      return `确定要删除目录符号链接 "${file.name}" 吗？此操作仅删除符号链接本体，不会删除目标目录中的内容。`;
    }

    return `确定要删除目录 "${file.name}" 吗？此操作会删除目录中的所有内容。`;
  };

  const getBatchDeleteConfirmMessage = (selected: Set<string>): string => {
    const selectedFiles = files().filter((file) => selected.has(file.name));
    const dirCount = selectedFiles.filter((file) => file.type === 'dir' && file.isSymlink !== true).length;
    const dirSymlinkCount = selectedFiles.filter((file) => file.type === 'dir' && file.isSymlink === true).length;

    const detailParts: string[] = [];
    if (dirCount > 0) {
      detailParts.push(`${dirCount} 个目录会连同目录内内容一并删除`);
    }
    if (dirSymlinkCount > 0) {
      detailParts.push(`${dirSymlinkCount} 个目录符号链接仅删除链接本体，不影响目标目录内容`);
    }

    if (detailParts.length === 0) {
      return `确定要删除选中的 ${selected.size} 个项目吗？`;
    }

    return `确定要删除选中的 ${selected.size} 个项目吗？其中${detailParts.join('，')}。`;
  };

  const handleDelete = async (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    if (!await dialog.confirm(getDeleteConfirmMessage(file))) return;
    
    try {
      const params = new URLSearchParams({ category: currentCategory(), path: filePath });
      const response = await authFetch(`${props.serverBaseUrl}/api/server-files/delete?${params}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.error) await dialog.alert('删除失败: ' + data.error);
      else loadFiles();
    } catch (err) {
      await dialog.alert('删除失败: ' + (err as Error).message);
    }
  };

  const handleBatchDelete = async () => {
    const selected = selectedItems();
    if (selected.size === 0) return;
    if (!await dialog.confirm(getBatchDeleteConfirmMessage(selected))) return;
    
    for (const name of selected) {
      const filePath = currentPath() ? `${currentPath()}/${name}` : name;
      try {
        const params = new URLSearchParams({ category: currentCategory(), path: filePath });
        await authFetch(`${props.serverBaseUrl}/api/server-files/delete?${params}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Delete failed:', name, err);
      }
    }

    setSelectedItems(new Set<string>());
    loadFiles();
  };

  // 发送选中文件到设备
  const handleSendToDevices = async () => {
    const devices = props.selectedDevices || [];
    const selectedFileNames = Array.from(selectedItems());
    
    if (selectedFileNames.length === 0 || devices.length === 0) return;
    
    setIsSendingToDevices(true);
    setShowSendToDeviceModal(false);
    
    let sentCount = 0;
    
    // 递归获取目录中的所有文件
    const getAllFilesInDir = async (
      dirPath: string,
      basePath: string
    ): Promise<Array<{path: string, targetRelPath: string}>> => {
      const result: Array<{path: string, targetRelPath: string}> = [];
      
      try {
        const params = new URLSearchParams({
          category: currentCategory(),
          path: dirPath,
          meta: '1',
        });
        const response = await authFetch(`${props.serverBaseUrl}/api/server-files/list?${params}`);
        const data = await response.json();
        
        if (data.files) {
          for (const file of data.files as ServerFileItem[]) {
            const filePath = dirPath ? `${dirPath}/${file.name}` : file.name;
            const relPath = basePath ? `${basePath}/${file.name}` : file.name;
            
            if (file.type === 'dir') {
              // 统一规则：遍历中遇到目录符号链接直接忽略，不继续深入。
              if (file.isSymlink === true) {
                continue;
              }
              // 递归处理子目录
              const subFiles = await getAllFilesInDir(filePath, relPath);
              result.push(...subFiles);
            } else {
              // 文件（含文件符号链接）都按文件发送，后端会读取目标内容。
              result.push({ path: filePath, targetRelPath: relPath });
            }
          }
        }
      } catch (err) {
        console.error(`Failed to list directory ${dirPath}:`, err);
      }
      
      return result;
    };
    
    try {
      // 收集所有需要发送的文件
      const filesToSend: Array<{path: string, targetRelPath: string}> = [];
      
      for (const fileName of selectedFileNames) {
        const filePath = currentPath() ? `${currentPath()}/${fileName}` : fileName;
        const file = files().find(f => f.name === fileName);
        
        if (!file) continue;
        
        if (file.type === 'dir') {
          const dirFiles = await getAllFilesInDir(filePath, fileName);
          filesToSend.push(...dirFiles);
        } else {
          filesToSend.push({ path: filePath, targetRelPath: fileName });
        }
      }
      
      // 发送所有文件到设备
      // 语义保持：按 filesToSend 顺序逐个文件发送；
      // 每个文件内部对多设备并发，提高吞吐但不改变多文件先后关系。
      for (const fileInfo of filesToSend) {
        await runWithConcurrency(devices, 6, async (device) => {
          const targetPath = targetDevicePath() + fileInfo.targetRelPath;

          try {
            await authFetch(`${props.serverBaseUrl}/api/transfer/push-to-device`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deviceSN: device.udid,
                category: currentCategory(),
                path: fileInfo.path,
                targetPath: targetPath,
                serverBaseUrl: props.serverBaseUrl
              })
            });
            sentCount++;
          } catch (err) {
            console.error(`Failed to push ${fileInfo.path} to ${device.udid}:`, err);
          }
        });
      }
      
      toast.showSuccess(`已发送 ${sentCount} 个文件请求`);
    } catch (err) {
      await dialog.alert('发送失败: ' + (err as Error).message);
    } finally {
      setIsSendingToDevices(false);
    }
  };

  // 右键菜单发送单个文件/目录到设备
  const handleSendSingleItemToDevices = (file: ServerFileItem) => {
    // 将单个文件添加到选中项并开始发送流程
    setSelectedItems(new Set([file.name]));
    setShowSendToDeviceModal(true);
  };

  // 创建
  const handleCreate = async (type: 'file' | 'dir') => {
    const title = type === 'file' ? '新建文件' : '新建文件夹';
    const message = type === 'file' ? '请输入文件名称' : '请输入文件夹名称';
    const name = await dialog.prompt(title, message);
    if (!name?.trim()) return;
    
    try {
      const response = await authFetch(`${props.serverBaseUrl}/api/server-files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCategory(), path: currentPath(), name: name.trim(), type })
      });
      const data = await response.json();
      if (data.error) await dialog.alert('创建失败: ' + data.error);
      else loadFiles();
    } catch (err) {
      await dialog.alert('创建失败: ' + (err as Error).message);
    }
  };

  // 重命名
  const handleRename = async (file: ServerFileItem) => {
    const newName = await dialog.prompt('请输入新名称', file.name, '重命名');
    if (!newName?.trim() || newName.trim() === file.name) return;
    
    try {
      const response = await authFetch(`${props.serverBaseUrl}/api/server-files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCategory(), path: currentPath(), oldName: file.name, newName: newName.trim() })
      });
      const data = await response.json();
      if (data.error) await dialog.alert('重命名失败: ' + data.error);
      else loadFiles();
    } catch (err) {
      await dialog.alert('重命名失败: ' + (err as Error).message);
    }
  };

  // 编辑文件
  const handleEditFile = async (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    try {
      const params = new URLSearchParams({ category: currentCategory(), path: filePath });
      const response = await authFetch(`${props.serverBaseUrl}/api/server-files/read?${params}`);
      const data = await response.json();
      if (data.error) { await dialog.alert('读取失败: ' + data.error); return; }
      setEditorFileName(file.name);
      setEditorContent(data.content);
      setShowEditorModal(true);
    } catch (err) {
      await dialog.alert('读取失败: ' + (err as Error).message);
    }
  };

  const handleSaveFile = async () => {
    const filePath = currentPath() ? `${currentPath()}/${editorFileName()}` : editorFileName();
    setEditorSaving(true);
    try {
      const response = await authFetch(`${props.serverBaseUrl}/api/server-files/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCategory(), path: filePath, content: editorContent() })
      });
      const data = await response.json();
      if (data.error) await dialog.alert('保存失败: ' + data.error);
      else setShowEditorModal(false);
    } catch (err) {
      await dialog.alert('保存失败: ' + (err as Error).message);
    } finally {
      setEditorSaving(false);
    }
  };

  // 图片预览
  const handlePreviewImage = (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    const url = appendAuthQuery(
      `${props.serverBaseUrl}/api/server-files/download/${currentCategory()}/${filePath}`
    );
    setPreviewImageUrl(url);
    setShowImagePreview(true);
  };

  // 拖拽上传
  let dragCounter = 0;
  const handleDragEnter = (e: DragEvent) => { e.preventDefault(); dragCounter++; if (dragCounter === 1) setIsDragOver(true); };
  const handleDragOver = (e: DragEvent) => { e.preventDefault(); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) setIsDragOver(false); };
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault(); dragCounter = 0; setIsDragOver(false);
    if (e.dataTransfer?.items) {
      const scannedFiles = await scanEntries(e.dataTransfer.items);
      if (scannedFiles.length > 0) await uploadFiles(scannedFiles);
    } else {
      const droppedFiles = Array.from(e.dataTransfer?.files || []);
      if (droppedFiles.length > 0) {
        const scannedFiles: ScannedFile[] = droppedFiles.map(file => ({ file, relativePath: file.name }));
        await uploadFiles(scannedFiles);
      }
    }
  };

  const handleOpenLocal = async () => {
    try {
      const response = await authFetch(`${props.serverBaseUrl}/api/server-files/open-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCategory(), path: currentPath() })
      });
      const data = await response.json();
      if (data.error) await dialog.alert('打开失败: ' + data.error);
    } catch (err) {
      await dialog.alert('打开失败: ' + (err as Error).message);
    }
  };

  const uploadFiles = async (filesToUpload: ScannedFile[]) => {
    setIsUploading(true);
    try {
      for (const { file, relativePath } of filesToUpload) {
        if (currentCategory() === 'scripts' && isLanControlArchiveFile(relativePath || file.name)) {
          await openLanControlArchiveInstallDialog({
            kind: 'upload',
            file,
            displayName: file.name || relativePath
          });
          continue;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', currentCategory());
        
        // Calculate the target directory based on relativePath
        const lastSlash = relativePath.lastIndexOf('/');
        const relativeDir = lastSlash !== -1 ? relativePath.substring(0, lastSlash) : '';
        const targetPath = currentPath() 
          ? (relativeDir ? `${currentPath()}/${relativeDir}` : currentPath())
          : relativeDir;
          
        formData.append('path', targetPath);
        const response = await authFetch(`${props.serverBaseUrl}/api/server-files/upload`, { method: 'POST', body: formData });
        const data = await response.json();
        if (data.error) await dialog.alert(`上传 ${relativePath} 失败: ` + data.error);
      }
      loadFiles();
    } catch (err) {
      await dialog.alert('上传失败: ' + (err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImageFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext || '');
  };

  const isTextFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['txt', 'lua', 'json', 'md', 'log', 'xml', 'html', 'css', 'js', 'ts'].includes(ext || '');
  };

  // 面包屑导航
  const breadcrumbs = () => {
    const path = currentPath();
    if (!path) return [];
    return path.split('/').filter(p => p);
  };

  return (
    <Show when={props.isOpen}>
      <div class={styles.modalOverlay} onMouseDown={mainBackdropClose.onMouseDown} onMouseUp={mainBackdropClose.onMouseUp}>
        <div class={styles.modalContent} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h2>服务器文件浏览器</h2>
            <button class={styles.closeButton} onClick={props.onClose}>
              <IconXmark size={16} />
            </button>
          </div>
          
          {/* 目录切换按钮 */}
          <div class={styles.tabs}>
            <button 
              class={`${styles.tab} ${currentCategory() === 'scripts' ? styles.active : ''}`} 
              onClick={() => handleCategoryChange('scripts')}
            >
              <IconCode size={16} />
              <span>脚本<span class={styles.desktopText}>目录</span></span>
            </button>
            <button 
              class={`${styles.tab} ${currentCategory() === 'files' ? styles.active : ''}`} 
              onClick={() => handleCategoryChange('files')}
            >
              <IconBoxesStacked size={16} />
              <span>资源<span class={styles.desktopText}>目录</span></span>
            </button>
            <button 
              class={`${styles.tab} ${currentCategory() === 'reports' ? styles.active : ''}`} 
              onClick={() => handleCategoryChange('reports')}
            >
              <IconChartColumn size={16} />
              <span>报告<span class={styles.desktopText}>目录</span></span>
            </button>
          </div>
          
          {/* 操作工具栏 */}
          <div class={styles.toolbar}>
            <div class={styles.actions}>
              <button 
                class={styles.actionButton} 
                onClick={() => handleCreate('file')}
              >
                <IconFileCirclePlus size={16} />
                <span>新建文件</span>
              </button>
              <button 
                class={styles.actionButton} 
                onClick={() => handleCreate('dir')}
              >
                <IconFolderPlus size={16} />
                <span>新建文件夹</span>
              </button>
              <button class={styles.actionButton} onClick={loadFiles}>
                <IconRotate size={16} />
                <span>刷新</span>
              </button>
              <button 
                class={`${styles.actionButton} ${isSelectMode() ? styles.activeAction : ''}`} 
                onClick={() => { 
                  setIsSelectMode(!isSelectMode()); 
                  if (isSelectMode()) setSelectedItems(new Set<string>()); 
                }}
              >
                <IconSquareCheck size={16} />
                <span>选择模式</span>
              </button>
              <Show when={isLocal()}>
                <button 
                  class={styles.actionButton} 
                  onClick={handleOpenLocal}
                  title="在操作系统的文件资源管理器中打开当前目录"
                >
                  <IconFolderOpen size={16} />
                  <span>在本机打开当前目录</span>
                </button>
              </Show>
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
                <button class={styles.selectAction} onClick={selectAll}>
                  <IconCheckDouble size={14} />
                  <span>全选</span>
                </button>
                <button class={styles.selectAction} onClick={clearSelection} disabled={selectedItems().size === 0}>
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
                
                <Show when={(props.selectedDevices?.length || 0) > 0}>
                  <div class={styles.selectDivider} />
                  <button 
                    class={`${styles.selectAction} ${styles.sendAction}`}
                    onClick={() => setShowSendToDeviceModal(true)} 
                    disabled={selectedItems().size === 0 || isSendingToDevices()}
                  >
                    <IconPaperPlane size={14} />
                    <span>发送到设备 ({props.selectedDevices?.length})</span>
                  </button>
                </Show>
                
                <div class={styles.selectDivider} />
                
                <button class={styles.deleteAction} onClick={handleBatchDelete} disabled={selectedItems().size === 0}>
                  <IconTrash size={14} />
                  <span>删除</span>
                </button>
              </div>
            </div>
          </Show>

          {/* 面包屑导航 */}
          <div class={styles.breadcrumbs}>
            <button class={styles.breadcrumbItem} onClick={() => handleNavigate('')}>
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
                      handleNavigate(parts.join('/'));
                    }}
                  >
                    {part}
                  </button>
                </>
              )}
            </For>
          </div>
          
          {/* 文件列表表格 */}
          <div class={`${styles.fileList} ${styles.mainFileList} ${isDragOver() ? styles.dragOver : ''}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            <Show when={isDragOver()}><div class={styles.dropOverlay}><div class={styles.dropHint}><IconUpload size={20} /> 释放上传</div></div></Show>
            <Show when={isUploading()}><div class={styles.uploadingOverlay}><div class={styles.uploadingHint}>上传中...</div></div></Show>
            <Show when={isLoading()}><div class={styles.loading}>加载中...</div></Show>
            <Show when={error()}><div class={styles.error}>{error()}</div></Show>
            
            <Show when={!isLoading() && !error()}>
              {/* 表头 */}
              <div class={styles.tableHeader}>
                <Show when={isSelectMode()}>
                  <div class={styles.tableCell} style={{ width: '40px' }}></div>
                </Show>
                <div class={`${styles.tableCell} ${styles.typeColumn}`}>类型</div>
                <div class={`${styles.tableCell} ${styles.nameColumn}`}>名称</div>
                <div class={`${styles.tableCell} ${styles.sizeColumn}`}>尺寸</div>
              </div>

              <div class={styles.tableBody}>
                <Show
                  when={files().length > 0}
                  fallback={
                    <div class={styles.emptyMessage}>
                      <div>此目录为空</div>
                      <div class={styles.emptyHint}>拖拽文件到此处上传</div>
                    </div>
                  }
                >
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
                        onDblClick={() => handleFileDoubleClick(file)}
                        onContextMenu={(e) => handleFileContextMenu(e, file)}
                        onTouchStart={() => handleFileTouchStart(file)}
                        onTouchEnd={handleFileTouchEnd}
                        onTouchMove={handleFileTouchEnd}
                      >
                        <Show when={isSelectMode()}>
                          <div class={styles.tableCell} style={{ width: '40px' }}>
                            <input
                              type="checkbox"
                              class="themed-checkbox"
                              checked={selectedItems().has(file.name)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => toggleSelection(file.name, e as any)}
                            />
                          </div>
                        </Show>
                        <div class={`${styles.tableCell} ${styles.typeColumn}`}>
                          <span class={styles.fileIconWrap}>
                            <span class={styles.fileIcon}>
                              {renderFileIcon(file.name, { isDirectory: file.type === 'dir' })}
                            </span>
                            <Show when={file.isSymlink === true}>
                              <span class={styles.symlinkBadge} aria-hidden="true">
                                <FaSolidSquareArrowUpRight class={styles.symlinkBadgeIcon} size={7} />
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
            <textarea class={styles.editorTextarea} value={editorContent()} onInput={(e) => setEditorContent(e.currentTarget.value)} />
            <div class={styles.editorFooter}>
              <button class={styles.cancelBtn} onClick={() => setShowEditorModal(false)}>取消</button>
              <button class={styles.confirmBtn} onClick={handleSaveFile} disabled={editorSaving()}>{editorSaving() ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      </Show>
      
      {/* 图片预览 */}
      <Show when={showImagePreview()}>
        <div class={styles.imagePreviewOverlay} onMouseDown={imagePreviewBackdropClose.onMouseDown} onMouseUp={imagePreviewBackdropClose.onMouseUp}>
          <div class={styles.imagePreviewContent} onMouseDown={(e) => e.stopPropagation()}>
            <button class={styles.closeButton} onClick={() => setShowImagePreview(false)}>
              <IconXmark size={16} />
            </button>
            <img src={previewImageUrl()} alt="Preview" class={styles.previewImage} />
          </div>
        </div>
      </Show>

      {/* 中控脚本包安装弹窗 */}
      <Show when={lanControlArchiveOpen()}>
        <div class={styles.archiveOverlay} onMouseDown={lanControlArchiveBackdropClose.onMouseDown} onMouseUp={lanControlArchiveBackdropClose.onMouseUp}>
          <div class={styles.archiveModal} onMouseDown={(e) => e.stopPropagation()}>
            <div class={styles.archiveHeader}>
              <h3>安装中控脚本包</h3>
              <button class={styles.closeButton} onClick={() => !lanControlArchiveInstalling() && closeLanControlArchiveDialog(false)}>
                <IconXmark size={16} />
              </button>
            </div>
            <div class={styles.archiveBody}>
              <div class={styles.archiveInfo}>
                <div class={styles.archiveInfoHeader}>
                  <span class={styles.archiveInfoTitle}>脚本信息</span>
                  <span class={styles.archiveInfoSubtitle}>{lanControlArchiveSource()?.displayName || lanControlArchiveMeta().name || '未命名脚本'}</span>
                </div>
                <div class={styles.archiveInfoContent}>
                  <div class={styles.archiveInfoField}>
                    <span class={styles.archiveInfoLabel}>名称</span>
                    <span class={styles.archiveInfoValue}>{lanControlArchiveMeta().name || '未命名脚本'}</span>
                  </div>
                  <div class={styles.archiveInfoField}>
                    <span class={styles.archiveInfoLabel}>版本</span>
                    <span class={styles.archiveInfoValue}>{lanControlArchiveMeta().version || '未知'}</span>
                  </div>
                  <div class={styles.archiveInfoField}>
                    <span class={styles.archiveInfoLabel}>开发者</span>
                    <span class={styles.archiveInfoValue}>{lanControlArchiveMeta().author || '未知'}</span>
                  </div>
                  <div class={styles.archiveInfoField}>
                    <span class={styles.archiveInfoLabel}>使用说明</span>
                    <div class={styles.archiveInstructions}>{lanControlArchiveMeta().description || '未知'}</div>
                  </div>
                </div>
              </div>

              <label class={styles.archiveField}>
                <span class={styles.archiveInfoLabel}>安装名称</span>
                <input
                  class={styles.archiveInput}
                  value={lanControlArchiveInstallName()}
                  disabled={lanControlArchiveInstalling()}
                  onInput={(e) => {
                    setLanControlArchiveInstallName(e.currentTarget.value);
                    setLanControlArchiveError('');
                  }}
                />
              </label>

              <Show when={lanControlArchiveExists()}>
                <label class={styles.archiveOption}>
                  <input
                    type="checkbox"
                    class="themed-checkbox"
                    checked={lanControlArchiveOverwrite()}
                    disabled={lanControlArchiveInstalling()}
                    onChange={(e) => setLanControlArchiveOverwrite(e.currentTarget.checked)}
                  />
                  <span>目标已存在，覆盖安装</span>
                </label>
              </Show>

              <Show when={lanControlArchiveSource()?.kind === 'managed'}>
                <label class={styles.archiveOption}>
                  <input
                    type="checkbox"
                    class="themed-checkbox"
                    checked={lanControlArchiveDeletePackage()}
                    disabled={lanControlArchiveInstalling()}
                    onChange={(e) => setLanControlArchiveDeletePackage(e.currentTarget.checked)}
                  />
                  <span>安装成功后删除安装包</span>
                </label>
              </Show>

              <Show when={lanControlArchiveError()}>
                <div class={styles.archiveError}>{lanControlArchiveError()}</div>
              </Show>
            </div>
            <div class={styles.archiveFooter}>
              <button
                class={styles.cancelBtn}
                disabled={lanControlArchiveInstalling()}
                onClick={() => closeLanControlArchiveDialog(false)}
              >
                取消
              </button>
              <button
                class={styles.confirmBtn}
                disabled={lanControlArchiveInstalling()}
                onClick={() => { void confirmLanControlArchiveInstall(); }}
              >
                {lanControlArchiveInstalling() ? '安装中...' : '安装'}
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
          <Show when={contextMenuFile()?.type === 'file' && isLanControlArchiveFile(contextMenuFile()!.name)}>
            <ContextMenuButton
              icon={<IconCode size={14} />}
              onClick={() => {
                const file = contextMenuFile()!;
                const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
                void openLanControlArchiveInstallDialog({
                  kind: 'managed',
                  category: currentCategory(),
                  path: filePath,
                  displayName: file.name
                });
                closeContextMenu();
              }}
            >
              安装脚本包
            </ContextMenuButton>
          </Show>
          <Show when={contextMenuFile()?.type === 'file' && isTextFile(contextMenuFile()!.name)}>
            <ContextMenuButton icon={<IconICursor size={14} />} onClick={() => { handleEditFile(contextMenuFile()!); closeContextMenu(); }}>
              编辑
            </ContextMenuButton>
          </Show>
          <Show when={contextMenuFile()?.type === 'file' && isImageFile(contextMenuFile()!.name)}>
            <ContextMenuButton icon={<IconEye size={14} />} onClick={() => { handlePreviewImage(contextMenuFile()!); closeContextMenu(); }}>
              预览
            </ContextMenuButton>
          </Show>
          <ContextMenuButton icon={<IconPen size={14} />} onClick={() => { handleRename(contextMenuFile()!); closeContextMenu(); }}>
            重命名
          </ContextMenuButton>
          <Show when={contextMenuFile()?.type === 'file'}>
            <ContextMenuButton icon={<IconDownload size={14} />} onClick={() => { handleDownload(contextMenuFile()!); closeContextMenu(); }}>
              下载
            </ContextMenuButton>
          </Show>
          <Show when={props.selectedDevices && props.selectedDevices.length > 0}>
            <ContextMenuButton icon={<IconPaperPlane size={14} />} onClick={() => { handleSendSingleItemToDevices(contextMenuFile()!); closeContextMenu(); }}>
              发送到设备
            </ContextMenuButton>
          </Show>
          <ContextMenuDivider />
          <ContextMenuButton icon={<IconTrash size={14} />} danger onClick={() => { handleDelete(contextMenuFile()!); closeContextMenu(); }}>
            删除
          </ContextMenuButton>
        </>
      </ContextMenu>

      {/* Send to Device Modal */}
      <Show when={showSendToDeviceModal()}>
        <div class={styles.createOverlay} onClick={() => setShowSendToDeviceModal(false)}>
          <div class={styles.createModal} onClick={(e) => e.stopPropagation()}>
            <h3>发送到设备</h3>
            
            {/* 文件列表预览 */}
            <div style={{ 'margin-bottom': '16px' }}>
              <div style={{ 'font-weight': '500', 'margin-bottom': '8px', 'color': 'var(--text-secondary)' }}>
                选中文件 ({selectedItems().size} 个)
              </div>
              <div class={`${styles.fileList} scroll-standard`} style={{ 'max-height': '120px', 'min-height': 'auto', 'border': '1px solid var(--border)', 'border-radius': '6px', 'padding': '8px' }}>
                <For each={Array.from(selectedItems()).slice(0, 10)}>
                  {(name) => {
                    const file = files().find(f => f.name === name);
                    return (
                      <div style={{ 'display': 'flex', 'align-items': 'center', 'gap': '8px', 'padding': '4px 0', 'font-size': '13px', 'color': 'var(--text)' }}>
                        <span class={`${styles.fileIconWrap} ${styles.previewFileIconWrap}`}>
                          <span class={styles.fileIcon}>
                            {renderFileIcon(name, { isDirectory: file?.type === 'dir', size: 14 })}
                          </span>
                          <Show when={file?.isSymlink === true}>
                            <span class={styles.symlinkBadge} aria-hidden="true">
                              <FaSolidSquareArrowUpRight class={styles.symlinkBadgeIcon} size={7} />
                            </span>
                          </Show>
                        </span>
                        <span style={{ 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{name}</span>
                      </div>
                    );
                  }}
                </For>
                <Show when={selectedItems().size > 10}>
                  <div style={{ 'font-size': '12px', 'color': 'var(--text-muted)', 'padding-top': '4px' }}>
                    ... 还有 {selectedItems().size - 10} 个文件
                  </div>
                </Show>
              </div>
            </div>

            {/* 设备列表预览 */}
            <div style={{ 'margin-bottom': '16px' }}>
              <div style={{ 'font-weight': '500', 'margin-bottom': '8px', 'color': 'var(--text-secondary)' }}>
                目标设备 ({props.selectedDevices?.length || 0} 台)
              </div>
              <div class={`${styles.fileList} scroll-standard`} style={{ 'max-height': '100px', 'min-height': 'auto', 'border': '1px solid var(--border)', 'border-radius': '6px', 'padding': '8px', 'text-align': 'left' }}>
                <For each={props.selectedDevices?.slice(0, 5) || []}>
                  {(device) => (
                    <div style={{ 'padding': '4px 0', 'font-size': '13px', 'color': 'var(--text)' }}>
                      📱 {device.system?.name || device.udid} ({device.system?.ip || 'unknown'})
                    </div>
                  )}
                </For>
                <Show when={(props.selectedDevices?.length || 0) > 5}>
                  <div style={{ 'font-size': '12px', 'color': 'var(--text-muted)', 'padding-top': '4px' }}>
                    ... 还有 {(props.selectedDevices?.length || 0) - 5} 台设备
                  </div>
                </Show>
              </div>
            </div>

            {/* 目标路径选择 */}
            <div style={{ 'margin-bottom': '20px' }}>
              <div style={{ 'font-weight': '500', 'margin-bottom': '8px', 'color': 'var(--text-secondary)' }}>
                目标路径
              </div>
              <Select.Root
                class="cbx-select-root"
                collection={targetPathCollection()}
                value={[targetDevicePath()]}
                onValueChange={(e) => {
                  const next = e.value[0];
                  if (next) setTargetDevicePath(next);
                }}
              >
                <Select.Control class="cbx-select-control">
                  <Select.Trigger class="cbx-select" style={{ width: '100%' }}>
                    <span style={{ 
                      flex: 1, 
                      overflow: 'hidden', 
                      'text-overflow': 'ellipsis', 
                      'white-space': 'nowrap',
                      'text-align': 'left'
                    }}>
                      {targetPathOptions.find(opt => opt.value === targetDevicePath())?.label || targetDevicePath()}
                    </span>
                    <span class="dropdown-arrow">▼</span>
                  </Select.Trigger>
                </Select.Control>
                <Portal>
                  <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                    <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                      <Select.ItemGroup>
                        <For each={targetPathOptions}>{(opt) => (
                          <Select.Item item={opt.value} class="cbx-item">
                            <div class="cbx-item-content">
                              <Select.ItemIndicator>✓</Select.ItemIndicator>
                              <Select.ItemText>{opt.label}</Select.ItemText>
                            </div>
                          </Select.Item>
                        )}</For>
                      </Select.ItemGroup>
                    </Select.Content>
                  </Select.Positioner>
                </Portal>
              </Select.Root>
              <div style={{ 'margin-top': '4px', 'font-size': '12px', 'color': 'var(--text-muted)' }}>
                文件将被发送到设备上的此目录
              </div>
            </div>

            {/* 按钮 */}
            <div class={styles.createActions}>
              <button 
                class={styles.cancelBtn}
                onClick={() => setShowSendToDeviceModal(false)}
              >
                取消
              </button>
              <button 
                class={styles.confirmBtn}
                onClick={handleSendToDevices}
                disabled={selectedItems().size === 0 || !props.selectedDevices?.length}
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
}
