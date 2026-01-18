import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { useDialog } from './DialogContext';
import {
  IconCode,
  IconBoxesStacked,
  IconChartColumn,
  IconFileCirclePlus,
  IconFolderPlus,
  IconFolderOpen,
  IconRotate,
  IconSquareCheck,
  IconUpload,
  IconDownload,
  IconTrash,
  IconPen,
  IconICursor,
  IconEye,
  IconHouse,
  IconXmark,
} from '../icons';
import { renderFileIcon } from '../utils/fileIcons';
import { createBackdropClose } from '../hooks/useBackdropClose';
import styles from './ServerFileBrowser.module.css';
import { authFetch, appendAuthQuery } from '../services/httpAuth';
import { scanEntries, ScannedFile } from '../utils/fileUpload';

export interface ServerFileItem {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modTime: string;
}

export interface ServerFileBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  serverBaseUrl: string;
}

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
  const mainBackdropClose = createBackdropClose(() => props.onClose());
  const editorBackdropClose = createBackdropClose(() => setShowEditorModal(false));
  const imagePreviewBackdropClose = createBackdropClose(() => setShowImagePreview(false));

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

  // 加载文件列表
  const loadFiles = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const params = new URLSearchParams({
        category: currentCategory(),
        path: currentPath()
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
      if (contextMenuFile()) {
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

  const sortedFiles = () => {
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
  };

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
    // 文件点击不做处理，使用右键菜单操作
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

  const handleDownload = (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    const url = appendAuthQuery(
      `${props.serverBaseUrl}/api/server-files/download/${currentCategory()}/${filePath}`
    );
    window.open(url, '_blank');
  };

  const handleDelete = async (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    if (!await dialog.confirm(`确定要删除 "${file.name}" 吗？`)) return;
    
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
    if (!await dialog.confirm(`确定要删除选中的 ${selected.size} 个项目吗？`)) return;
    
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
              <span>脚本目录</span>
            </button>
            <button 
              class={`${styles.tab} ${currentCategory() === 'files' ? styles.active : ''}`} 
              onClick={() => handleCategoryChange('files')}
            >
              <IconBoxesStacked size={16} />
              <span>资源目录</span>
            </button>
            <button 
              class={`${styles.tab} ${currentCategory() === 'reports' ? styles.active : ''}`} 
              onClick={() => handleCategoryChange('reports')}
            >
              <IconChartColumn size={16} />
              <span>报告目录</span>
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
          
          {/* 面包屑导航 */}
          <div class={styles.breadcrumbs}>
            <button class={styles.breadcrumbItem} onClick={() => handleNavigate('')}>
              <IconHouse size={14} />
              <span>根目录</span>
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
          
          <Show when={isSelectMode()}>
            <div class={styles.selectToolbar}>
              <span>已选 {selectedItems().size} 项</span>
              <button class={styles.selectAction} onClick={selectAll}>全选</button>
              <button class={styles.selectAction} onClick={clearSelection}>清除</button>
              <button class={styles.deleteAction} onClick={handleBatchDelete} disabled={selectedItems().size === 0}>
                <IconTrash size={14} />
                <span>删除</span>
              </button>
            </div>
          </Show>
          
          {/* 文件列表表格 */}
          <div class={`${styles.fileList} ${isDragOver() ? styles.dragOver : ''}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
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
                      <span class={styles.fileIcon}>
                        {renderFileIcon(file.name, { isDirectory: file.type === 'dir' })}
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
            
            <Show when={!isLoading() && !error() && files().length === 0}>
              <div class={styles.emptyMessage}>
                <div>此目录为空</div>
                <div class={styles.emptyHint}>拖拽文件到此处上传</div>
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

      {/* 右键菜单 */}
      <Show when={contextMenuFile()}>
        <div class={styles.contextBackdrop} onClick={closeContextMenu}>
          <div 
            class={styles.contextMenu}
            style={{ 
              left: `${contextMenuPosition().x}px`, 
              top: `${contextMenuPosition().y}px` 
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class={styles.contextMenuLabel}>{contextMenuFile()?.name}</div>
            <Show when={contextMenuFile()?.type === 'file' && isTextFile(contextMenuFile()!.name)}>
              <button onClick={() => { handleEditFile(contextMenuFile()!); closeContextMenu(); }}>
                <IconICursor size={14} /> 编辑
              </button>
            </Show>
            <Show when={contextMenuFile()?.type === 'file' && isImageFile(contextMenuFile()!.name)}>
              <button onClick={() => { handlePreviewImage(contextMenuFile()!); closeContextMenu(); }}>
                <IconEye size={14} /> 预览
              </button>
            </Show>
            <button onClick={() => { handleRename(contextMenuFile()!); closeContextMenu(); }}>
              <IconPen size={14} /> 重命名
            </button>
            <Show when={contextMenuFile()?.type === 'file'}>
              <button onClick={() => { handleDownload(contextMenuFile()!); closeContextMenu(); }}>
                <IconDownload size={14} /> 下载
              </button>
            </Show>
            <div class={styles.contextMenuDivider}></div>
            <button onClick={() => { handleDelete(contextMenuFile()!); closeContextMenu(); }}>
              <IconTrash size={14} /> 删除
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}
