import { createSignal, createEffect, For, Show } from 'solid-js';
import {
  IconFolderPlus,
  IconFileCirclePlus,
  IconRotate,
  IconSquareCheck,
  IconXmark,
  IconDownload,
  IconTrash,
  IconHouse,
} from '../icons';
import { renderFileIcon } from '../utils/fileIcons';
import styles from './FileBrowser.module.css';

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  path?: string;
}

export interface FileBrowserProps {
  deviceUdid: string;
  deviceName: string;
  isOpen: boolean;
  onClose: () => void;
  onListFiles: (deviceUdid: string, path: string) => void;
  onDeleteFile: (deviceUdid: string, path: string) => void;
  onCreateDirectory: (deviceUdid: string, path: string) => void;
  onUploadFile: (deviceUdid: string, path: string, file: File) => void;
  onDownloadFile: (deviceUdid: string, path: string) => void;
  files: FileItem[];
  isLoading: boolean;
}

export default function FileBrowser(props: FileBrowserProps) {
  const [currentPath, setCurrentPath] = createSignal('/lua/scripts');
  const [newFolderName, setNewFolderName] = createSignal('');
  const [showNewFolderInput, setShowNewFolderInput] = createSignal(false);
  const [showHidden, setShowHidden] = createSignal(false);
  const [isSelectMode, setIsSelectMode] = createSignal(false);
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(new Set<string>());

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

  const handleDeleteFile = (file: FileItem) => {
    if (!confirm(`确定要删除 "${file.name}" 吗？`)) return;
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

  const handleCreateFolder = () => {
    const folderName = newFolderName().trim();
    if (!folderName) return;

    const folderPath = currentPath() === '/' 
      ? `/${folderName}` 
      : `${currentPath()}/${folderName}`;
    
    props.onCreateDirectory(props.deviceUdid, folderPath);
    setNewFolderName('');
    setShowNewFolderInput(false);
    
    // 刷新当前目录
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 500);
  };

  const handleFileSelect = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      // 自动上传
      handleUploadFile(file);
    }
  };

  const handleUploadFile = (file: File) => {
    if (!file) return;

    const filePath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    
    props.onUploadFile(props.deviceUdid, filePath, file);
    
    // 刷新当前目录
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 1000);
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
    <Show when={props.isOpen}>
      <div class={styles.overlay} onClick={props.onClose}>
        <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h2>设备文件浏览器 - {props.deviceName}</h2>
            <button class={styles.closeButton} onClick={props.onClose}>
              <IconXmark size={18} />
            </button>
          </div>
          
          <div class={styles.toolbar}>
             <div class={styles.actions}>
              <button 
                class={styles.actionButton}
                onClick={() => setShowNewFolderInput(!showNewFolderInput())}
              >
                <IconFolderPlus size={16} />
                <span>新建文件夹</span>
              </button>
              
              <label class={styles.uploadButton}>
                <IconFileCirclePlus size={16} />
                <span>上传文件</span>
                <input 
                  type="file" 
                  style="display: none;" 
                  onChange={handleFileSelect}
                />
              </label>

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
                onClick={() => {
                  if (confirm(`确定要删除选中的 ${selectedItems().size} 个项目吗？`)) {
                    alert('批量删除功能待完善');
                  }
                }}
              >
                <IconTrash size={14} />
                <span>删除</span>
              </button>
            </div>
          </Show>

          <Show when={showNewFolderInput()}>
            <div class={styles.newFolderInput}>
              <input
                type="text"
                placeholder="输入文件夹名称"
                value={newFolderName()}
                onInput={(e) => setNewFolderName(e.currentTarget.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                }}
                class={styles.folderNameInput}
                autofocus
              />
              <button class={styles.confirmButton} onClick={handleCreateFolder}>创建</button>
              <button 
                class={styles.cancelButton} 
                onClick={() => {
                  setShowNewFolderInput(false);
                  setNewFolderName('');
                }}
              >
                取消
              </button>
            </div>
          </Show>
          
          <div class={styles.fileList}>
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
  );
}
