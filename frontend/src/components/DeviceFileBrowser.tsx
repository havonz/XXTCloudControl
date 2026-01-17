import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { useDialog } from './DialogContext';
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
} from '../icons';
import { renderFileIcon } from '../utils/fileIcons';
import { createBackdropClose } from '../hooks/useBackdropClose';
import styles from './DeviceFileBrowser.module.css';
import { scanEntries, ScannedFile } from '../utils/fileUpload';

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  path?: string;
}

export interface DeviceFileBrowserProps {
  deviceUdid: string;
  deviceName: string;
  isOpen: boolean;
  onClose: () => void;
  onListFiles: (deviceUdid: string, path: string) => void;
  onDeleteFile: (deviceUdid: string, path: string) => void;
  onCreateDirectory: (deviceUdid: string, path: string) => void;
  onUploadFile: (deviceUdid: string, path: string, file: File) => void;
  onDownloadFile: (deviceUdid: string, path: string) => void;
  onMoveFile: (deviceUdid: string, fromPath: string, toPath: string) => void;
  onReadFile: (deviceUdid: string, path: string) => void;
  files: FileItem[];
  isLoading: boolean;
  fileContent?: { path: string; content: string } | null;
}

export default function DeviceFileBrowser(props: DeviceFileBrowserProps) {
  const dialog = useDialog();
  const [currentPath, setCurrentPath] = createSignal('/lua/scripts');
  const [showHidden, setShowHidden] = createSignal(false);
  const [isSelectMode, setIsSelectMode] = createSignal(false);
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(new Set<string>());
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);
  const mainBackdropClose = createBackdropClose(() => props.onClose());
  const editorBackdropClose = createBackdropClose(() => setShowEditorModal(false));
  let dragCounter = 0;

  // 编辑器弹窗
  const [showEditorModal, setShowEditorModal] = createSignal(false);
  const [editorFileName, setEditorFileName] = createSignal('');
  const [editorFilePath, setEditorFilePath] = createSignal('');
  const [editorContent, setEditorContent] = createSignal('');
  const [editorSaving, setEditorSaving] = createSignal(false);

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
      if (showEditorModal()) {
        setShowEditorModal(false);
      } else if (props.isOpen) {
        props.onClose();
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  const handleFileClick = (file: FileItem) => {
    if (isSelectMode()) {
      const current = new Set<string>(selectedItems());
      if (current.has(file.name)) {
        current.delete(file.name);
      } else {
        current.add(file.name);
      }
      setSelectedItems(current);
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

  const handleDownloadFile = (file: FileItem) => {
    const fullPath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    props.onDownloadFile(props.deviceUdid, fullPath);
  };

  // 判断是否为文本文件
  const isTextFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['txt', 'lua', 'json', 'md', 'log', 'xml', 'html', 'css', 'js', 'ts', 'conf', 'ini', 'sh', 'py'].includes(ext || '');
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
        props.onUploadFile(props.deviceUdid, fullPath, file);
      }
      
      // 刷新当前目录
      setTimeout(() => {
        setIsUploading(false);
        props.onListFiles(props.deviceUdid, currentPath());
      }, 1500);
    }
  };

  const breadcrumbs = () => {
    const path = currentPath();
    if (!path || path === '/') return [];
    return path.split('/').filter(p => p);
  };

  const toggleAllSelection = () => {
    const allFileNames = sortedFiles().map(f => f.name);
    if (selectedItems().size === allFileNames.length) {
      setSelectedItems(new Set<string>());
    } else {
      setSelectedItems(new Set<string>(allFileNames));
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
              <span>脚本目录</span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/res' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/res')}
            >
              <IconBoxesStacked size={16} />
              <span>资源目录</span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/log' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/log')}
            >
              <IconChartColumn size={16} />
              <span>日志目录</span>
            </button>
            <button 
              class={`${styles.tab} ${currentPath() === '/' || currentPath() === '' ? styles.active : ''}`} 
              onClick={() => handleNavigate('/')}
            >
              <IconHouse size={16} />
              <span>主目录</span>
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

          <div class={styles.breadcrumbs}>
            <button class={styles.breadcrumbItem} onClick={() => handleNavigate('/')}>
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
                      handleNavigate('/' + parts.join('/'));
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
              <button class={styles.selectAction} onClick={toggleAllSelection}>
                {selectedItems().size === sortedFiles().length ? '取消全选' : '全选'}
              </button>
              <button 
                class={styles.deleteAction} 
                disabled={selectedItems().size === 0}
                onClick={async () => {
                  if (await dialog.confirm(`确定要删除选中的 ${selectedItems().size} 个项目吗？`)) {
                    await dialog.alert('批量删除功能待完善');
                  }
                }}
              >
                <IconTrash size={14} />
                <span>删除</span>
              </button>
            </div>
          </Show>

          
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
                <div class={`${styles.tableCell} ${styles.actionsColumn}`}>操作</div>
              </div>

              <For each={sortedFiles()}>
                {(file) => (
                  <div class={`${styles.tableRow} ${selectedItems().has(file.name) ? styles.selected : ''}`}>
                    <Show when={isSelectMode()}>
                      <div class={styles.tableCell} style={{ width: '40px' }}>
                        <input 
                          type="checkbox" 
                          class="themed-checkbox"
                          checked={selectedItems().has(file.name)} 
                          onChange={() => {
                            const current = new Set(selectedItems());
                            if (current.has(file.name)) current.delete(file.name);
                            else current.add(file.name);
                            setSelectedItems(current);
                          }}
                        />
                      </div>
                    </Show>
                    <div class={`${styles.tableCell} ${styles.typeColumn}`} onClick={() => handleFileClick(file)}>
                      <span class={styles.fileIcon}>
                        {renderFileIcon(file.name, { isDirectory: file.type === 'directory' })}
                      </span>
                    </div>
                    <div class={`${styles.tableCell} ${styles.nameColumn}`} onClick={() => handleFileClick(file)}>
                      <span class={styles.fileName}>{file.name}</span>
                    </div>
                    <div class={`${styles.tableCell} ${styles.actionsColumn}`}>
                      <Show when={!isSelectMode()}>
                        <Show when={file.type === 'file' && isTextFile(file.name)}>
                          <button 
                            class={styles.actionBtn}
                            onClick={() => handleEditFile(file)}
                            title="编辑"
                          >
                            <IconICursor size={14} />
                          </button>
                        </Show>
                        <button 
                          class={styles.actionBtn}
                          onClick={() => handleRenameFile(file)}
                          title="重命名"
                        >
                          <IconPen size={14} />
                        </button>
                        <Show when={file.type === 'file'}>
                          <button 
                            class={styles.actionBtn}
                            onClick={() => handleDownloadFile(file)}
                            title="下载"
                          >
                            <IconDownload size={14} />
                          </button>
                        </Show>
                        <button 
                          class={styles.deleteBtn}
                          onClick={() => handleDeleteFile(file)}
                          title="删除"
                        >
                          <IconTrash size={14} />
                        </button>
                      </Show>
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
    </>
  );
}
