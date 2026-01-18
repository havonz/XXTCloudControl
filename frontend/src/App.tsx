import { Component, createSignal, onCleanup, createMemo, createEffect, Show } from 'solid-js';
import { WebSocketService, Device } from './services/WebSocketService';
import { AuthService, LoginCredentials } from './services/AuthService';
import { createGroupStore } from './services/GroupStore';
import { FileTransferService } from './services/FileTransferService';
import LoginForm from './components/LoginForm';
import DeviceList from './components/DeviceList';
import DeviceFileBrowser from './components/DeviceFileBrowser';
import GroupList from './components/GroupList';
import NewGroupModal from './components/NewGroupModal';
import AddToGroupModal from './components/AddToGroupModal';
import { useTheme } from './components/ThemeContext';
import { IconMoon, IconSun } from './icons';
import styles from './App.module.css';
import { ScannedFile } from './utils/fileUpload';
import { setApiBaseUrl } from './services/httpAuth';

const VERSION_CACHE_KEY = 'xxt_server_version';

type PendingFileGet =
  | { kind: 'download'; deviceUdid: string; fileName: string; path: string }
  | { kind: 'read'; deviceUdid: string; path: string };

const App: Component = () => {
  const { theme, toggleTheme } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = createSignal(false);
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [loginError, setLoginError] = createSignal('');
  const [devices, setDevices] = createSignal<Device[]>([]);
  const [selectedDevices, setSelectedDevices] = createSignal<Device[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = createSignal(false);
  
  // Server information for device binding
  const [serverHost, setServerHost] = createSignal('');
  const [serverPort, setServerPort] = createSignal('');
  const [serverVersion, setServerVersion] = createSignal('');
  
  // Version update toast state
  const [showVersionUpdateToast, setShowVersionUpdateToast] = createSignal(false);
  const [versionUpdateMessage, setVersionUpdateMessage] = createSignal('');
  
  // File browser state
  const [fileBrowserOpen, setFileBrowserOpen] = createSignal(false);
  const [fileBrowserDevice, setFileBrowserDevice] = createSignal<{udid: string, name: string} | null>(null);
  const [fileList, setFileList] = createSignal<any[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = createSignal(false);
  const [fileContent, setFileContent] = createSignal<{path: string, content: string} | null>(null);
  
  // Mobile UI state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = createSignal(false);
  
  // Group management state
  const groupStore = createGroupStore();
  const [showNewGroupModal, setShowNewGroupModal] = createSignal(false);
  const [showAddToGroupModal, setShowAddToGroupModal] = createSignal(false);
  
  // Filter devices based on selected groups
  const filteredDevices = createMemo(() => {
    const visible = groupStore.visibleDeviceIds();
    if (visible === null) return devices(); // Show all devices
    return devices().filter(d => visible.has(d.udid));
  });
  
  let wsService: WebSocketService | null = null;
  const pendingFileGets = new Map<string, PendingFileGet[]>();
  const authService = AuthService.getInstance();
  const fileTransferService = FileTransferService.getInstance();

  // Prevent browser default context menu and Cmd+A select all (except in input fields)
  const handleGlobalContextMenu = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    // Allow context menu in input/textarea/contenteditable elements
    if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
      return;
    }
    e.preventDefault();
  };

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    // Allow shortcuts in input/textarea/contenteditable elements
    if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
      return;
    }
    // Block Cmd+A (select all) outside of input fields
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
    }
  };

  const enqueuePendingFileGet = (entry: PendingFileGet) => {
    const list = pendingFileGets.get(entry.deviceUdid) || [];
    list.push(entry);
    pendingFileGets.set(entry.deviceUdid, list);
  };

  const dequeuePendingFileGet = (deviceUdid: string): PendingFileGet | undefined => {
    const list = pendingFileGets.get(deviceUdid);
    if (!list || list.length === 0) return undefined;
    const entry = list.shift();
    if (list.length === 0) {
      pendingFileGets.delete(deviceUdid);
    }
    return entry;
  };

  // Setup global event listeners
  document.addEventListener('contextmenu', handleGlobalContextMenu);
  document.addEventListener('keydown', handleGlobalKeyDown);

  onCleanup(() => {
    document.removeEventListener('contextmenu', handleGlobalContextMenu);
    document.removeEventListener('keydown', handleGlobalKeyDown);
    if (wsService) {
      wsService.disconnect();
    }
  });

  const handleLogin = async (credentials: LoginCredentials) => {
    setIsConnecting(true);
    setLoginError('');
    
    try {
      // 构建 WebSocket URL
      const wsUrl = authService.getWebSocketUrl(credentials.server, credentials.port);
      
      // 处理存储的密码hash
      let actualPassword = credentials.password;
      if (credentials.password.startsWith('__STORED_PASSHASH__')) {
        // 使用存储的passhash，直接传递给WebSocketService
        // AuthService会识别这个前缀并直接使用存储的passhash
        actualPassword = credentials.password; // 保持前缀，让AuthService处理

      } else {

      }
      
      // 创建 WebSocket 服务实例
      wsService = new WebSocketService(wsUrl, actualPassword);
      
      // 监听认证结果
      wsService.onAuthResult((success, error) => {
        setIsConnecting(false);
        
        if (success) {
          // 先写入 AuthService，避免依赖 isAuthenticated 的 effect 先触发导致 HTTP 请求缺少签名
          authService.setAuthenticated(true, { ...credentials, password: actualPassword });
          setIsAuthenticated(true);
          setLoginError('');
          
          // 设置服务器信息用于设备绑定
          setServerHost(credentials.server.trim());
          setServerPort(credentials.port.trim());
          const httpBaseUrl = authService.getHttpBaseUrl(credentials.server.trim(), credentials.port.trim());
          setApiBaseUrl(httpBaseUrl);
          fileTransferService.setBaseUrl(httpBaseUrl);
          
          // 只在成功登录后保存服务器信息和密码hash
          // 保存服务器信息
          if (credentials.server.trim()) {
            localStorage.setItem('xxt_server', credentials.server.trim());
          }
          if (credentials.port.trim()) {
            localStorage.setItem('xxt_port', credentials.port.trim());
          }
          
          // 保存密码hash（只有当传入的不是已存储的hash时）
          if (credentials.password.trim() && !credentials.password.startsWith('__STORED_PASSHASH__')) {
            const authServiceInstance = AuthService.getInstance();
            const passwordHash = authServiceInstance.hmacSHA256("XXTouch", credentials.password);
            localStorage.setItem('xxt_password_hash', passwordHash);
          }
        } else {
          setIsAuthenticated(false);
          authService.setAuthenticated(false);
          setLoginError(error || '登录失败');
          if (wsService) {
            wsService.disconnect();
            wsService = null;
          }
        }
      });
      
      // 监听设备列表更新
      wsService.onDeviceUpdate((deviceList) => {
        setDevices(deviceList);
        setIsLoadingDevices(false);
      });
      
      // 监听文件操作响应
      wsService.onMessage((message) => {
        if (message.type === 'file/list') {

          if (message.body && Array.isArray(message.body)) {
            // 将后端返回的文件类型从 "dir" 映射为 "directory"
            const mappedFiles = message.body.map((file: any) => ({
              ...file,
              type: file.type === 'dir' ? 'directory' : 'file'
            }));
            setFileList(mappedFiles);
          } else {
            setFileList([]);
          }
          setIsLoadingFiles(false);
        } else if (message.type === 'file/put' || message.type === 'file/delete') {

          if (message.error) {
            console.error('文件操作失败:', message.error);
          }
        } else if (message.type === 'file/get') {

          if (message.error) {
            console.error('文件操作失败:', message.error);
            if (message.udid) {
              dequeuePendingFileGet(message.udid);
            }
          } else if (message.body && typeof message.body === 'string') {
            if (!message.udid) {
              return;
            }
            const pending = dequeuePendingFileGet(message.udid);
            if (!pending) {
              return;
            }
            if (pending.kind === 'read') {
              // 解码 Base64 内容
              try {
                const decodedContent = decodeURIComponent(escape(atob(message.body)));
                setFileContent({ path: pending.path, content: decodedContent });
              } catch (e) {
                // 如果解码失败，直接使用原始内容
                setFileContent({ path: pending.path, content: atob(message.body) });
              }
            } else if (pending.kind === 'download') {
              handleFileDownload(pending.fileName, message.body);
            }
          }
        } else if (message.type === 'pasteboard/read') {

          // 剪贴板读取响应会通过消息系统传递给DeviceList组件
        } else if (message.type === 'pasteboard/write') {

          if (message.error) {
            console.error('剪贴板写入失败:', message.error);
          } else {

          }
        } else if (message.type === 'transfer/progress') {
          const { percent, currentBytes, totalBytes, targetPath } = message.body;
          console.log(`⏳ Transfer progress (${targetPath}): ${percent.toFixed(1)}% (${currentBytes}/${totalBytes})`);
          // Note: Device message update is now handled in WebSocketService.ts
        } else if (message.type === 'device/message') {
          // Note: Device message update is now handled in WebSocketService.ts
        } else if (message.type === 'transfer/fetch/complete' || message.type === 'transfer/send/complete') {
          // Note: Device message update is now handled in WebSocketService.ts
          
          if (message.error) {
            console.error('❌ 大文件传输失败:', message.error);
          } else {
            console.log('✅ 大文件传输成功:', message.body);
            
            // 如果是从设备上传到服务器完成（设备主动发送 file/upload/complete）
            // 服务器此时已经收到了文件，我们需要触发浏览器下载
            if (message.type === 'transfer/send/complete' && message.body.savePath) {
              const downloadPath = `/api/server-files/download/files/${message.body.savePath}`;
              const fileName = message.body.sourcePath.split('/').pop() || 'downloaded_file';
              const tempFilePath = message.body.savePath;
              console.log(`💾 Triggering authenticated browser download: ${downloadPath}`);
              
              // Use authenticated fetch to download the file (wrapped in async IIFE)
              (async () => {
                try {
                  const response = await fileTransferService.downloadFromServer(downloadPath);
                  if (response.ok) {
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    
                    const link = document.createElement('a');
                    link.href = blobUrl;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    // Clean up blob URL
                    URL.revokeObjectURL(blobUrl);
                    console.log(`✅ File downloaded: ${fileName}`);
                    
                    // Clean up temp file on server
                    await fileTransferService.deleteTempFile('files', tempFilePath);
                    console.log(`🧹 Cleaned up temp file: ${tempFilePath}`);
                  } else {
                    console.error(`❌ Download failed: ${response.status} ${response.statusText}`);
                  }
                } catch (err) {
                  console.error('❌ Download error:', err);
                }
              })();
            }
            
            // 只在上传到设备完成时刷新文件列表（设备文件有变化）
            // 下载时不需要刷新（设备文件没有变化）
            if (message.type === 'transfer/fetch/complete' && fileBrowserOpen() && fileBrowserDevice()?.udid === message.udid) {
              handleListFiles(message.udid, fileList()[0]?.path?.match(/(.*\/)/)?.[1] || '/');
            }
          }
        }
      });
      
      // 开始连接
      wsService.connect();
      
    } catch (error) {
      setIsConnecting(false);
      setLoginError('连接失败: ' + (error as Error).message);
    }
  };

  const handleRespring = () => {
    if (wsService) {
      wsService.disconnect();
      wsService = null;
    }
    pendingFileGets.clear();
    
    setIsAuthenticated(false);
    setDevices([]);
    setSelectedDevices([]);
    setLoginError('');
    authService.respring();
  };

  const handleDeviceSelect = (devices: Device[]) => {


    setSelectedDevices(devices);

    // Show selection count in page title for debugging
    document.title = `XXT 云控制器 (${devices.length} selected)`;
  };

  const handleRefreshDevices = () => {
    if (wsService) {
      setIsLoadingDevices(true);
      // 使用 control/refresh 命令让服务器从设备端获取实时状态
      wsService.refreshDeviceStates();
      // 设置一个较短的加载时间，因为实时更新会通过 app/state 消息进行
      setTimeout(() => {
        setIsLoadingDevices(false);
      }, 1000);
    }
  };

  const handleStartScript = (scriptName: string) => {
    if (wsService && selectedDevices().length > 0) {
      const deviceUdids = selectedDevices().map(device => device.udid);
      wsService.startScript(deviceUdids, scriptName);

    } else {
      console.warn('未选择设备或WebSocket服务未连接');
    }
  };

  const handleStopScript = () => {
    if (wsService && selectedDevices().length > 0) {
      const deviceUdids = selectedDevices().map(device => device.udid);
      wsService.stopScript(deviceUdids);

    } else {
      console.warn('未选择设备或WebSocket服务未连接');
    }
  };

  const handleRespringDevices = () => {
    if (wsService && selectedDevices().length > 0) {
      const deviceUdids = selectedDevices().map(device => device.udid);
      wsService.respringDevices(deviceUdids);

    } else {
      console.warn('未选择设备或WebSocket服务未连接');
    }
  };



  const handleUploadFiles = async (scannedFiles: ScannedFile[], uploadPath: string) => {
    if (!wsService) {
      console.warn('WebSocket服务未连接');
      return;
    }

    if (selectedDevices().length === 0) {
      console.warn('未选择设备');
      return;
    }

    if (!scannedFiles || scannedFiles.length === 0) {
      console.warn('未选择文件');
      return;
    }

    const deviceUdids = selectedDevices().map(device => device.udid);
    
    // 上传每个文件
    for (const { file, relativePath } of scannedFiles) {
      try {
        // 将文件转换为Base64
        const base64Data = await fileToBase64(file);
        // 构建完整的文件路径
        const fullPath = uploadPath.endsWith('/') ? `${uploadPath}${relativePath}` : `${uploadPath}/${relativePath}`;
        
        // 发送上传请求
        await wsService.uploadFile(deviceUdids, fullPath, base64Data);

      } catch (error) {
        console.error(`上传文件 ${relativePath} 失败:`, error);
      }
    }
  };

  // 将文件转换为Base64格式
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // 移除data:xxx;base64,前缀
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 处理文件下载
  const handleFileDownload = (fileName: string, base64Data: string) => {
    try {
      // 将Base64数据转换为Blob
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray]);
      
      // 创建下载链接
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      

    } catch (error) {
      console.error('文件下载失败:', error);
    }
  };

  // 处理下载文件请求
  const handleDownloadFile = (udid: string, path: string) => {
    if (wsService) {
      // 从路径中提取文件名
      const fileName = path.split('/').pop() || 'unknown';
      enqueuePendingFileGet({ kind: 'download', deviceUdid: udid, fileName, path });
      wsService.downloadFile(udid, path);

    } else {
      console.warn('WebSocket服务未连接');
    }
  };

  // 处理读取剪贴板
  const handleReadClipboard = () => {
    if (!wsService) {
      console.warn('WebSocket服务未连接');
      return;
    }

    if (selectedDevices().length === 0) {
      console.warn('未选择设备');
      return;
    }

    const deviceUdids = selectedDevices().map(device => device.udid);
    wsService.readClipboard(deviceUdids);

  };

  // 处理写入剪贴板
  const handleWriteClipboard = (uti: string, data: string) => {
    if (!wsService) {
      console.warn('WebSocket服务未连接');
      return;
    }

    if (selectedDevices().length === 0) {
      console.warn('未选择设备');
      return;
    }

    const deviceUdids = selectedDevices().map(device => device.udid);
    wsService.writeClipboard(deviceUdids, uti, data);

  };

  // File browser handlers
  const handleOpenFileBrowser = (deviceUdid: string, deviceName: string) => {
    setFileBrowserDevice({ udid: deviceUdid, name: deviceName });
    setFileBrowserOpen(true);
    setFileList([]);
  };

  const handleCloseFileBrowser = () => {
    setFileBrowserOpen(false);
    setFileBrowserDevice(null);
    setFileList([]);
  };

  const handleListFiles = (deviceUdid: string, path: string) => {
    if (wsService) {
      setIsLoadingFiles(true);
      wsService.listFiles(deviceUdid, path);
    }
  };

  const handleListFilesAsync = async (deviceUdid: string, path: string): Promise<{name: string; type: 'file' | 'directory'; size?: number}[]> => {
    if (!wsService) {
      console.warn('WebSocket服务未连接');
      return [];
    }
    return wsService.listFilesAsync(deviceUdid, path);
  };

  const handleDeleteFile = (deviceUdid: string, path: string) => {
    if (wsService) {
      wsService.deleteFile(deviceUdid, path);
    }
  };

  const handleCreateDirectory = (deviceUdid: string, path: string) => {
    if (wsService) {
      wsService.createDirectory(deviceUdid, path);
    }
  };

  const handleUploadSingleFile = async (deviceUdid: string, path: string, file: File) => {
    if (wsService) {
      try {
        const base64Data = await fileToBase64(file);
        await wsService.uploadFile([deviceUdid], path, base64Data);

      } catch (error) {
        console.error(`上传文件 ${file.name} 失败:`, error);
      }
    }
  };

  const handleMoveFile = (deviceUdid: string, fromPath: string, toPath: string) => {
    if (wsService) {
      wsService.moveFile(deviceUdid, fromPath, toPath);
    }
  };

  const handleCopyFile = (deviceUdid: string, fromPath: string, toPath: string) => {
    if (wsService) {
      wsService.copyFile(deviceUdid, fromPath, toPath);
    }
  };

  const handleReadFile = (deviceUdid: string, path: string) => {
    if (wsService) {
      enqueuePendingFileGet({ kind: 'read', deviceUdid, path });
      wsService.readFile(deviceUdid, path);
    }
  };

  // Large file upload handler (for files > 128KB)
  const handleUploadLargeFile = async (deviceUdid: string, path: string, file: File) => {
    console.log(`📤 Large file upload: ${file.name} (${file.size} bytes) to device ${deviceUdid}`);
    
    const result = await fileTransferService.uploadFileToDevice(
      deviceUdid,
      file,
      path
    );
    
    if (result.success) {
      console.log(`✅ Large file upload initiated: token=${result.token}`);
    } else {
      console.error(`❌ Large file upload failed: ${result.error}`);
    }
  };

  const handleSelectScript = (deviceUdid: string, scriptName: string) => {
    if (wsService) {
      wsService.selectScript([deviceUdid], scriptName);
    }
  };

  // Large file download handler (for files > 128KB)
  const handleDownloadLargeFile = async (deviceUdid: string, path: string, fileName: string) => {
    console.log(`📥 Large file download: ${path} from device ${deviceUdid}`);
    
    const result = await fileTransferService.downloadFileFromDevice(
      deviceUdid,
      path,
      fileName
    );
    
    if (result.success) {
      console.log(`✅ Large file download initiated: token=${result.token}, savePath=${result.savePath}`);
      // TODO: Listen for file/upload/complete WebSocket message, then download from server
    } else {
      console.error(`❌ Large file download failed: ${result.error}`);
    }
  };

  // Pull file from device to cloud handler
  const handlePullFileFromDevice = async (
    deviceUdid: string, 
    sourcePath: string, 
    category: 'scripts' | 'files' | 'reports', 
    targetPath: string
  ): Promise<{success: boolean; error?: string}> => {
    console.log(`📥 Pull file from device: ${sourcePath} -> ${category}/${targetPath}`);
    
    try {
      const result = await fileTransferService.pullFromDevice(
        deviceUdid,
        sourcePath,
        category,
        targetPath
      );
      
      if (result.success) {
        console.log(`✅ Pull file initiated: token=${result.token}`);
        return { success: true };
      } else {
        console.error(`❌ Pull file failed: ${result.error}`);
        return { success: false, error: result.error };
      }
    } catch (err) {
      const errorMessage = (err as Error).message || 'Unknown error';
      console.error(`❌ Pull file error:`, err);
      return { success: false, error: errorMessage };
    }
  };

  // Load groups and group settings when authenticated
  createEffect(() => {
    if (isAuthenticated()) {
      groupStore.loadGroups();
      groupStore.loadGroupSettings();
      
      // Fetch server version and check for updates
      const fetchVersion = async () => {
        try {
          const proto = window.location.protocol === 'https:' ? 'https' : 'http';
          const baseUrl = `${proto}://${serverHost()}:${serverPort()}`;
          const response = await fetch(`${baseUrl}/api/config?format=json`);
          if (response.ok) {
            const config = await response.json();
            if (config.version) {
              const cachedVersion = localStorage.getItem(VERSION_CACHE_KEY);
              
              // If cached version exists and differs from server version, trigger refresh
              if (cachedVersion && cachedVersion !== config.version) {
                setVersionUpdateMessage(`检测到新版本 ${config.version}，3秒后自动刷新...`);
                setShowVersionUpdateToast(true);
                
                // Clear cached version and refresh after 3 seconds
                setTimeout(() => {
                  localStorage.removeItem(VERSION_CACHE_KEY);
                  window.location.reload();
                }, 3000);
              } else {
                // Cache the current version
                localStorage.setItem(VERSION_CACHE_KEY, config.version);
              }
              
              setServerVersion(config.version);
            }
          }
        } catch (e) {
          // Ignore network errors
        }
      };
      fetchVersion();
    }
  });

  // Handle adding selected devices to a group
  const handleAddDevicesToGroup = async (groupId: string): Promise<boolean> => {
    const deviceIds = selectedDevices().map(d => d.udid);
    if (deviceIds.length === 0) return false;
    return await groupStore.addDevicesToGroup(groupId, deviceIds);
  };

  return (
    <div class={styles.App}>
      {/* Version Update Toast */}
      <Show when={showVersionUpdateToast()}>
        <div class="version-update-toast">
          {versionUpdateMessage()}
        </div>
      </Show>
      
      {!isAuthenticated() ? (
        <LoginForm 
          onLogin={handleLogin}
          isConnecting={isConnecting()}
          error={loginError()}
        />
      ) : (
        <div class={styles.appContainer}>
          <header class={styles.appHeader}>
            <div class={styles.headerLeft}>
              <button 
                class={styles.mobileMenuToggle} 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen())}
                title="切换菜单"
              >
                <div class={`${styles.hamburger} ${isMobileMenuOpen() ? styles.open : ''}`}>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </button>
              <img src="/favicon-48.png" alt="Logo" class={styles.logo} />
              <h1 class={styles.appTitle}>XXT 云控</h1>
              {serverVersion() && (
                <span class={styles.versionBadge}>{serverVersion()}</span>
              )}
            </div>
            <div class={styles.headerRight}>
              <div class={styles.serverInfo}>
                <span class={styles.serverIp}>{serverHost()}</span>
              </div>
              <button
                onClick={toggleTheme}
                class={styles.themeToggle}
                title={theme() === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
              >
                {theme() === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
              </button>
            </div>
          </header>
          <main class={`${styles.appMain} ${isMobileMenuOpen() ? styles.sidebarOpen : ''}`}>
            <DeviceList 
              devices={filteredDevices()}
              onDeviceSelect={handleDeviceSelect}
              selectedDevices={selectedDevices}
              onRespring={handleRespring}
              onRefresh={handleRefreshDevices}
              onStartScript={handleStartScript}
              onStopScript={handleStopScript}
              onRespringDevices={handleRespringDevices}
              onUploadFiles={handleUploadFiles}
              onOpenFileBrowser={handleOpenFileBrowser}
              onReadClipboard={handleReadClipboard}
              onWriteClipboard={handleWriteClipboard}
              webSocketService={wsService}
              isLoading={isLoadingDevices()}
              serverHost={serverHost()}
              serverPort={serverPort()}
              checkedGroups={groupStore.checkedGroups}
              getPreferredGroupScript={groupStore.getPreferredGroupScript}
              getGroupedDevicesForLaunch={groupStore.getGroupedDevicesForLaunch}
              onOpenAddToGroupModal={() => setShowAddToGroupModal(true)}
              isMobileMenuOpen={isMobileMenuOpen()}
              onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
              sidebar={
                <GroupList
                  groupStore={groupStore}
                  deviceCount={devices().length}
                  allDevices={devices()}
                  onOpenNewGroupModal={() => setShowNewGroupModal(true)}
                  selectedDeviceCount={selectedDevices().length}
                  onDeviceSelectionChange={(deviceIds) => {
                    // 当分组选中改变时，同步设备选中
                    const allDevices = devices();
                    const newSelection = allDevices.filter(d => deviceIds.has(d.udid));
                    setSelectedDevices(newSelection);
                    // On mobile, close sidebar after selection
                    if (window.innerWidth < 768) {
                      setIsMobileMenuOpen(false);
                    }
                  }}
                />
              }
            />
          </main>
        </div>
      )}
      
      {/* Modals */}
      <NewGroupModal
        open={showNewGroupModal()}
        onClose={() => setShowNewGroupModal(false)}
        onCreateGroup={groupStore.createGroup}
      />
      
      <AddToGroupModal
        open={showAddToGroupModal()}
        onClose={() => setShowAddToGroupModal(false)}
        groups={groupStore.groups()}
        selectedDeviceCount={selectedDevices().length}
        onAddToGroup={handleAddDevicesToGroup}
      />
      
      <DeviceFileBrowser
        deviceUdid={fileBrowserDevice()?.udid || ''}
        deviceName={fileBrowserDevice()?.name || ''}
        isOpen={fileBrowserOpen()}
        onClose={handleCloseFileBrowser}
        onListFiles={handleListFiles}
        onListFilesAsync={handleListFilesAsync}
        onDeleteFile={handleDeleteFile}
        onCreateDirectory={handleCreateDirectory}
        onUploadFile={handleUploadSingleFile}
        onUploadLargeFile={handleUploadLargeFile}
        onDownloadFile={handleDownloadFile}
        onDownloadLargeFile={handleDownloadLargeFile}
        onMoveFile={handleMoveFile}
        onCopyFile={handleCopyFile}
        onReadFile={handleReadFile}
        onSelectScript={handleSelectScript}
        selectedScript={fileBrowserDevice() ? devices().find(d => d.udid === fileBrowserDevice()?.udid)?.script?.select : null}
        files={fileList()}
        isLoading={isLoadingFiles()}
        fileContent={fileContent()}
        onPullFileFromDevice={handlePullFileFromDevice}
      />
    </div>
  );
};

export default App;
