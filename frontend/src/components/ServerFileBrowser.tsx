import { createSignal, createEffect, For, Show } from 'solid-js';
import {
  IconCode,
  IconBoxesStacked,
  IconChartColumn,
  IconFileCirclePlus,
  IconFolderPlus,
  IconRotate,
  IconSquareCheck,
  IconUpload,
  IconDownload,
  IconTrash,
  IconPen,
  IconEye,
  IconArrowUp,
  IconHouse,
  IconXmark,
} from '../icons';
import { renderFileIcon } from '../utils/fileIcons';
import styles from './ServerFileBrowser.module.css';

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
  const [currentCategory, setCurrentCategory] = createSignal<'scripts' | 'files' | 'reports'>('scripts');
  const [currentPath, setCurrentPath] = createSignal('');
  const [files, setFiles] = createSignal<ServerFileItem[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);
  const [showHidden, setShowHidden] = createSignal(false);
  
  // 选择模式
  const [isSelectMode, setIsSelectMode] = createSignal(false);
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(new Set());
  
  // 创建弹窗
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [createType, setCreateType] = createSignal<'file' | 'dir'>('file');
  const [createName, setCreateName] = createSignal('');
  
  // 重命名弹窗
  const [showRenameModal, setShowRenameModal] = createSignal(false);
  const [renameOldName, setRenameOldName] = createSignal('');
  const [renameNewName, setRenameNewName] = createSignal('');
  
  // 编辑器弹窗
  const [showEditorModal, setShowEditorModal] = createSignal(false);
  const [editorFileName, setEditorFileName] = createSignal('');
  const [editorContent, setEditorContent] = createSignal('');
  const [editorSaving, setEditorSaving] = createSignal(false);
  
  // 图片预览
  const [showImagePreview, setShowImagePreview] = createSignal(false);
  const [previewImageUrl, setPreviewImageUrl] = createSignal('');

  // 加载文件列表
  const loadFiles = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const params = new URLSearchParams({
        category: currentCategory(),
        path: currentPath()
      });
      
      const response = await fetch(`${props.serverBaseUrl}/api/server-files/list?${params}`);
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

  const handleGoUp = () => {
    const path = currentPath();
    if (!path) return;
    const parts = path.split('/').filter(p => p);
    parts.pop();
    setCurrentPath(parts.join('/'));
    setSelectedItems(new Set<string>());
    loadFiles();
  };

  const handleFileClick = (file: ServerFileItem) => {
    if (isSelectMode()) {
      toggleSelection(file.name);
    } else if (file.type === 'dir') {
      const newPath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
      handleNavigate(newPath);
    } else {
      // 点击文件 - 根据类型处理
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext || '')) {
        handlePreviewImage(file);
      } else if (['txt', 'lua', 'json', 'md', 'log', 'xml', 'html', 'css', 'js', 'ts'].includes(ext || '')) {
        handleEditFile(file);
      }
    }
  };

  const toggleSelection = (name: string) => {
    const current = new Set<string>(selectedItems());
    if (current.has(name)) {
      current.delete(name);
    } else {
      current.add(name);
    }
    setSelectedItems(current);
  };

  const selectAll = () => setSelectedItems(new Set<string>(files().map(f => f.name)));
  const clearSelection = () => setSelectedItems(new Set<string>());

  const handleDownload = (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    const url = `${props.serverBaseUrl}/api/server-files/download/${currentCategory()}/${filePath}`;
    window.open(url, '_blank');
  };

  const handleDelete = async (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    if (!confirm(`确定要删除 "${file.name}" 吗？`)) return;
    
    try {
      const params = new URLSearchParams({ category: currentCategory(), path: filePath });
      const response = await fetch(`${props.serverBaseUrl}/api/server-files/delete?${params}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.error) alert('删除失败: ' + data.error);
      else loadFiles();
    } catch (err) {
      alert('删除失败: ' + (err as Error).message);
    }
  };

  const handleBatchDelete = async () => {
    const selected = selectedItems();
    if (selected.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selected.size} 个项目吗？`)) return;
    
    for (const name of selected) {
      const filePath = currentPath() ? `${currentPath()}/${name}` : name;
      try {
        const params = new URLSearchParams({ category: currentCategory(), path: filePath });
        await fetch(`${props.serverBaseUrl}/api/server-files/delete?${params}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Delete failed:', name, err);
      }
    }
    setSelectedItems(new Set<string>());
    loadFiles();
  };

  // 创建
  const handleCreate = async () => {
    const name = createName().trim();
    if (!name) { alert('请输入名称'); return; }
    
    try {
      const response = await fetch(`${props.serverBaseUrl}/api/server-files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCategory(), path: currentPath(), name, type: createType() })
      });
      const data = await response.json();
      if (data.error) alert('创建失败: ' + data.error);
      else { setShowCreateModal(false); setCreateName(''); loadFiles(); }
    } catch (err) {
      alert('创建失败: ' + (err as Error).message);
    }
  };

  // 重命名
  const openRenameDialog = (file: ServerFileItem) => {
    setRenameOldName(file.name);
    setRenameNewName(file.name);
    setShowRenameModal(true);
  };

  const handleRename = async () => {
    const newName = renameNewName().trim();
    if (!newName) { alert('请输入新名称'); return; }
    if (newName === renameOldName()) { setShowRenameModal(false); return; }
    
    try {
      const response = await fetch(`${props.serverBaseUrl}/api/server-files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCategory(), path: currentPath(), oldName: renameOldName(), newName })
      });
      const data = await response.json();
      if (data.error) alert('重命名失败: ' + data.error);
      else { setShowRenameModal(false); loadFiles(); }
    } catch (err) {
      alert('重命名失败: ' + (err as Error).message);
    }
  };

  // 编辑文件
  const handleEditFile = async (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    try {
      const params = new URLSearchParams({ category: currentCategory(), path: filePath });
      const response = await fetch(`${props.serverBaseUrl}/api/server-files/read?${params}`);
      const data = await response.json();
      if (data.error) { alert('读取失败: ' + data.error); return; }
      setEditorFileName(file.name);
      setEditorContent(data.content);
      setShowEditorModal(true);
    } catch (err) {
      alert('读取失败: ' + (err as Error).message);
    }
  };

  const handleSaveFile = async () => {
    const filePath = currentPath() ? `${currentPath()}/${editorFileName()}` : editorFileName();
    setEditorSaving(true);
    try {
      const response = await fetch(`${props.serverBaseUrl}/api/server-files/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: currentCategory(), path: filePath, content: editorContent() })
      });
      const data = await response.json();
      if (data.error) alert('保存失败: ' + data.error);
      else setShowEditorModal(false);
    } catch (err) {
      alert('保存失败: ' + (err as Error).message);
    } finally {
      setEditorSaving(false);
    }
  };

  // 图片预览
  const handlePreviewImage = (file: ServerFileItem) => {
    const filePath = currentPath() ? `${currentPath()}/${file.name}` : file.name;
    const url = `${props.serverBaseUrl}/api/server-files/download/${currentCategory()}/${filePath}`;
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
    const droppedFiles = Array.from(e.dataTransfer?.files || []);
    if (droppedFiles.length > 0) await uploadFiles(droppedFiles);
  };

  const handleFileSelect = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const selectedFiles = Array.from(input.files || []);
    if (selectedFiles.length > 0) await uploadFiles(selectedFiles);
    input.value = '';
  };

  const uploadFiles = async (filesToUpload: File[]) => {
    setIsUploading(true);
    try {
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', currentCategory());
        formData.append('path', currentPath());
        const response = await fetch(`${props.serverBaseUrl}/api/server-files/upload`, { method: 'POST', body: formData });
        const data = await response.json();
        if (data.error) alert(`上传 ${file.name} 失败: ` + data.error);
      }
      loadFiles();
    } catch (err) {
      alert('上传失败: ' + (err as Error).message);
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
      <div class={styles.modalOverlay} onClick={props.onClose}>
        <div class={styles.modalContent} onClick={(e) => e.stopPropagation()}>
          <div class={styles.modalHeader}>
            <h2>文件管理器</h2>
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
                onClick={() => { setCreateType('file'); setCreateName(''); setShowCreateModal(true); }}
              >
                <IconFileCirclePlus size={16} />
                <span>新建文件</span>
              </button>
              <button 
                class={styles.actionButton} 
                onClick={() => { setCreateType('dir'); setCreateName(''); setShowCreateModal(true); }}
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
              <label class={styles.uploadButton}>
                <IconUpload size={16} />
                <span>在本机打开当前根目录</span>
                <input type="file" multiple style="display:none" onChange={handleFileSelect} />
              </label>
              <label class={styles.showHiddenLabel}>
                <input 
                  type="checkbox" 
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
                <div class={`${styles.tableCell} ${styles.sizeColumn}`}>大小</div>
                <div class={`${styles.tableCell} ${styles.actionsColumn}`}>操作</div>
              </div>
              
              <For each={sortedFiles()}>
                {(file) => (
                  <div class={`${styles.tableRow} ${selectedItems().has(file.name) ? styles.selected : ''}`}>
                    <Show when={isSelectMode()}>
                      <div class={styles.tableCell} style={{ width: '40px' }}>
                        <input type="checkbox" class={styles.checkbox} checked={selectedItems().has(file.name)} onChange={() => toggleSelection(file.name)} />
                      </div>
                    </Show>
                    <div class={`${styles.tableCell} ${styles.typeColumn}`} onClick={() => handleFileClick(file)}>
                      <span class={styles.fileIcon}>
                        {renderFileIcon(file.name, { isDirectory: file.type === 'dir' })}
                      </span>
                    </div>
                    <div class={`${styles.tableCell} ${styles.nameColumn}`} onClick={() => handleFileClick(file)}>
                      <span class={styles.fileName}>{file.name}</span>
                    </div>
                    <div class={`${styles.tableCell} ${styles.sizeColumn}`}>
                      {file.type === 'file' ? formatSize(file.size) : '-'}
                    </div>
                    <Show when={!isSelectMode()}>
                      <div class={`${styles.tableCell} ${styles.actionsColumn}`}>
                        <Show when={file.type === 'file' && isTextFile(file.name)}>
                          <button class={styles.actionBtn} onClick={() => handleEditFile(file)} title="编辑">
                            <IconPen size={14} />
                          </button>
                        </Show>
                        <Show when={file.type === 'file' && isImageFile(file.name)}>
                          <button class={styles.actionBtn} onClick={() => handlePreviewImage(file)} title="预览">
                            <IconEye size={14} />
                          </button>
                        </Show>
                        <button class={styles.actionBtn} onClick={() => openRenameDialog(file)} title="重命名">
                          <IconPen size={14} />
                        </button>
                        <Show when={file.type === 'file'}>
                          <button class={styles.downloadButton} onClick={() => handleDownload(file)} title="下载">
                            <IconDownload size={14} />
                          </button>
                        </Show>
                        <button class={styles.deleteButton} onClick={() => handleDelete(file)} title="删除">
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </Show>
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
      
      {/* 创建弹窗 */}
      <Show when={showCreateModal()}>
        <div class={styles.createOverlay} onClick={() => setShowCreateModal(false)}>
          <div class={styles.createModal} onClick={(e) => e.stopPropagation()}>
            <h3>{createType() === 'file' ? '新建文件' : '新建文件夹'}</h3>
            <input type="text" class={styles.createInput} placeholder={createType() === 'file' ? '文件名' : '文件夹名'} value={createName()} onInput={(e) => setCreateName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
            <div class={styles.createActions}>
              <button class={styles.cancelBtn} onClick={() => setShowCreateModal(false)}>取消</button>
              <button class={styles.confirmBtn} onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      </Show>
      
      {/* 重命名弹窗 */}
      <Show when={showRenameModal()}>
        <div class={styles.createOverlay} onClick={() => setShowRenameModal(false)}>
          <div class={styles.createModal} onClick={(e) => e.stopPropagation()}>
            <h3>重命名</h3>
            <input type="text" class={styles.createInput} value={renameNewName()} onInput={(e) => setRenameNewName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && handleRename()} />
            <div class={styles.createActions}>
              <button class={styles.cancelBtn} onClick={() => setShowRenameModal(false)}>取消</button>
              <button class={styles.confirmBtn} onClick={handleRename}>确定</button>
            </div>
          </div>
        </div>
      </Show>
      
      {/* 编辑器弹窗 */}
      <Show when={showEditorModal()}>
        <div class={styles.editorOverlay} onClick={() => setShowEditorModal(false)}>
          <div class={styles.editorModal} onClick={(e) => e.stopPropagation()}>
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
        <div class={styles.imagePreviewOverlay} onClick={() => setShowImagePreview(false)}>
          <div class={styles.imagePreviewContent} onClick={(e) => e.stopPropagation()}>
            <button class={styles.closeButton} onClick={() => setShowImagePreview(false)}>
              <IconXmark size={16} />
            </button>
            <img src={previewImageUrl()} alt="Preview" class={styles.previewImage} />
          </div>
        </div>
      </Show>
    </Show>
  );
}
