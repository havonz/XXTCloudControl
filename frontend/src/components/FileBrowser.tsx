import { createSignal, createEffect, For, Show } from 'solid-js';
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
  const [selectedFile, setSelectedFile] = createSignal<File | null>(null);

  // 当组件打开时，加载默认目录
  createEffect(() => {
    if (props.isOpen) {
      setCurrentPath('/lua/scripts');
      props.onListFiles(props.deviceUdid, '/lua/scripts');
    }
  });

  // 文件排序函数：文件夹在前，文件在后，都按名称正序排序
  const sortedFiles = () => {
    return [...props.files].sort((a, b) => {
      // 先按类型排序：文件夹在前
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      
      // 相同类型按名称正序排序
      return a.name.localeCompare(b.name);
    });
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    props.onListFiles(props.deviceUdid, path);
  };

  const handleGoUp = () => {
    const path = currentPath();
    // 不允许导航到根目录之上
    if (path === '/' || path === '') return;
    
    // 移除尾部斜杠（如果有的话）
    const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
    const parentPath = cleanPath.split('/').slice(0, -1).join('/') || '/';
    handleNavigate(parentPath);
  };

  const handleFileClick = (file: FileItem) => {
    if (file.type === 'directory') {
      const newPath = currentPath() === '/' 
        ? `/${file.name}` 
        : `${currentPath()}/${file.name}`;
      handleNavigate(newPath);
    }
  };

  const handleDeleteFile = (file: FileItem) => {
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
      setSelectedFile(file);
    }
  };

  const handleUploadFile = () => {
    const file = selectedFile();
    if (!file) return;

    const filePath = currentPath() === '/' 
      ? `/${file.name}` 
      : `${currentPath()}/${file.name}`;
    
    props.onUploadFile(props.deviceUdid, filePath, file);
    setSelectedFile(null);
    
    // 刷新当前目录
    setTimeout(() => {
      props.onListFiles(props.deviceUdid, currentPath());
    }, 1000);
  };

  const getFileIcon = (file: FileItem) => {
    if (file.type === 'directory') {
      return '📁';
    }
    
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'lua': return '📜';
      case 'txt': return '📄';
      case 'png':
      case 'jpg':
      case 'jpeg': return '🖼️';
      case 'zip':
      case 'rar': return '📦';
      default: return '📄';
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class={styles.overlay} onClick={props.onClose}>
        <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h2>文件浏览器 - {props.deviceName}</h2>
            <button class={styles.closeButton} onClick={props.onClose}>×</button>
          </div>
          
          <div class={styles.toolbar}>
            <div class={styles.pathBar}>
              <button 
                class={styles.navButton} 
                onClick={handleGoUp}
                disabled={currentPath() === '/' || currentPath() === ''}
              >
                ⬆️ 上级
              </button>
              <span class={styles.currentPath}>{currentPath()}</span>
            </div>
            
            <div class={styles.actions}>
              <button 
                class={styles.actionButton}
                onClick={() => setShowNewFolderInput(!showNewFolderInput())}
              >
                📁 新建文件夹
              </button>
              
              <label class={styles.uploadButton}>
                📤 选择文件
                <input 
                  type="file" 
                  style="display: none;" 
                  onChange={handleFileSelect}
                />
              </label>
              
              <Show when={selectedFile()}>
                <button class={styles.actionButton} onClick={handleUploadFile}>
                  ⬆️ 上传 {selectedFile()?.name}
                </button>
              </Show>
            </div>
          </div>

          <Show when={showNewFolderInput()}>
            <div class={styles.newFolderInput}>
              <input
                type="text"
                placeholder="输入文件夹名称"
                value={newFolderName()}
                onInput={(e) => setNewFolderName(e.currentTarget.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder();
                  }
                }}
                class={styles.folderNameInput}
              />
              <button class={styles.confirmButton} onClick={handleCreateFolder}>
                创建
              </button>
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
              <For each={sortedFiles()}>
                {(file) => (
                  <div class={styles.fileItem}>
                    <div 
                      class={styles.fileInfo}
                      onClick={() => handleFileClick(file)}
                    >
                      <span class={styles.fileIcon}>{getFileIcon(file)}</span>
                      <span class={styles.fileName}>{file.name}</span>
                      <span class={styles.fileType}>
                        {file.type === 'directory' ? '文件夹' : '文件'}
                      </span>
                    </div>
                    <div class={styles.fileActions}>
                      <Show when={file.type === 'file'}>
                        <button 
                          class={styles.downloadButton}
                          onClick={() => handleDownloadFile(file)}
                          title="下载"
                        >
                          ⬇️
                        </button>
                      </Show>
                      <button 
                        class={styles.deleteButton}
                        onClick={() => handleDeleteFile(file)}
                        title="删除"
                      >
                        🗑️
                      </button>
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
