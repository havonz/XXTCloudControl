import { Component, createSignal, onCleanup, createMemo, createEffect } from 'solid-js';
import { WebSocketService, Device } from './services/WebSocketService';
import { AuthService, LoginCredentials } from './services/AuthService';
import { createGroupStore } from './services/GroupStore';
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
  
  // File browser state
  const [fileBrowserOpen, setFileBrowserOpen] = createSignal(false);
  const [fileBrowserDevice, setFileBrowserDevice] = createSignal<{udid: string, name: string} | null>(null);
  const [fileList, setFileList] = createSignal<any[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = createSignal(false);
  const [pendingDownload, setPendingDownload] = createSignal<{fileName: string, deviceUdid: string} | null>(null);
  const [pendingReadFile, setPendingReadFile] = createSignal<{path: string, deviceUdid: string} | null>(null);
  const [fileContent, setFileContent] = createSignal<{path: string, content: string} | null>(null);
  
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
  const authService = AuthService.getInstance();

  onCleanup(() => {
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
            setPendingDownload(null);
            setPendingReadFile(null);
          } else if (message.body && typeof message.body === 'string') {
            // 检查是否是读取操作（编辑）
            const readInfo = pendingReadFile();
            if (readInfo && message.udid === readInfo.deviceUdid) {
              // 解码 Base64 内容
              try {
                const decodedContent = decodeURIComponent(escape(atob(message.body)));
                setFileContent({ path: readInfo.path, content: decodedContent });
              } catch (e) {
                // 如果解码失败，直接使用原始内容
                setFileContent({ path: readInfo.path, content: atob(message.body) });
              }
              setPendingReadFile(null);
            }
            // 检查是否是下载操作
            const downloadInfo = pendingDownload();
            if (downloadInfo && message.udid === downloadInfo.deviceUdid) {
              handleFileDownload(downloadInfo.fileName, message.body);
              setPendingDownload(null);
            }
          }
        } else if (message.type === 'pasteboard/read') {

          // 剪贴板读取响应会通过消息系统传递给DeviceList组件
        } else if (message.type === 'pasteboard/write') {

          if (message.error) {
            console.error('剪贴板写入失败:', message.error);
          } else {

          }
        } else if (message.type === 'screen/snapshot') {

          // 屏幕截图响应会通过消息系统传递给DeviceList组件
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
      // 保存待下载文件信息
      setPendingDownload({ fileName, deviceUdid: udid });
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

  const handleReadFile = (deviceUdid: string, path: string) => {
    if (wsService) {
      setPendingReadFile({ path, deviceUdid });
      wsService.readFile(deviceUdid, path);
    }
  };

  // Load groups and group settings when authenticated
  createEffect(() => {
    if (isAuthenticated()) {
      groupStore.loadGroups();
      groupStore.loadGroupSettings();
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
              <img src="/favicon-48.png" alt="Logo" class={styles.logo} />
              <h1 class={styles.appTitle}>XXT 云控制器</h1>
            </div>
            <div class={styles.headerRight}>
              <button
                onClick={toggleTheme}
                class={styles.themeToggle}
                title={theme() === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
              >
                {theme() === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
              </button>
            </div>
          </header>
          <main class={styles.appMain}>
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
              sidebar={
                <GroupList
                  groupStore={groupStore}
                  deviceCount={devices().length}
                  allDevices={devices()}
                  onOpenNewGroupModal={() => setShowNewGroupModal(true)}
                  onOpenAddToGroupModal={() => setShowAddToGroupModal(true)}
                  selectedDeviceCount={selectedDevices().length}
                  onDeviceSelectionChange={(deviceIds) => {
                    // 当分组选中改变时，同步设备选中
                    const allDevices = devices();
                    const newSelection = allDevices.filter(d => deviceIds.has(d.udid));
                    setSelectedDevices(newSelection);
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
        onDeleteFile={handleDeleteFile}
        onCreateDirectory={handleCreateDirectory}
        onUploadFile={handleUploadSingleFile}
        onDownloadFile={handleDownloadFile}
        onMoveFile={handleMoveFile}
        onReadFile={handleReadFile}
        files={fileList()}
        isLoading={isLoadingFiles()}
        fileContent={fileContent()}
      />
    </div>
  );
};

export default App;
