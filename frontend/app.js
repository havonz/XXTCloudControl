// 全局变量
let ws = null; // WebSocket连接
let isConnected = false; // 是否已连接
let devices = {}; // 设备列表
let selectedDevices = new Set(); // 选中的设备列表
let currentRemoteDevice = null; // 当前远程控制的设备
let deviceListUpdateTimer = null; // 设备列表更新定时器
let firstShow = true; // 第一次显示模态窗口标志
let currentBrowsingPath = null; // 当前浏览的路径
let fileBrowserActive = false; // 文件浏览器是否活跃
let uploadQueue = []; // 上传队列
let currentUploadIndex = 0; // 当前上传文件索引
let isUploading = false; // 是否正在上传文件
let uploadPath = '/lua/scripts/'; // 上传路径
let originalScreenWidth = 0; // 原始屏幕宽度
let originalScreenHeight = 0; // 原始屏幕高度
let frameCount = 0; // 帧计数
let lastFpsUpdateTime = 0; // 最后FPS更新时间
let screenCaptureActive = false; // 屏幕捕获是否活跃
let fpsUpdateInterval = null; // FPS更新间隔
let isWaitingForScreenshot = false; // 是否正在等待截图响应
let maxScreenshotWaitTime = (window.XXTConfig && window.XXTConfig.ui) ? window.XXTConfig.ui.maxScreenshotWaitTime : 500; // 最大等待时间，毫秒
let screenCaptureScale = (window.XXTConfig && window.XXTConfig.ui) ? window.XXTConfig.ui.screenCaptureScale : 30; // 截屏图像缩放比例，100 为原始大小
let screenCaptureTimeout = null; // 截图超时定时器
let canvasContext = null; // Canvas上下文
let canvasWidth = 0; // Canvas宽度
let canvasHeight = 0; // Canvas高度
let drawingRect = { x: 0, y: 0, width: 0, height: 0 }; // 绘制区域
let currentViewingFile = null; // 当前查看的文件路径
let currentDownloadFileName = null; // 当前下载的文件名

// WebSocket连接相关变量
let serverUrl;
let serverHostInput, serverPortInput, passwordInput;
let savedConfig;

// localStorage 配置键名
const CONFIG_KEYS = {
    SERVER_HOST: 'xxt_server_host',
    SERVER_PORT: 'xxt_server_port',
    PASSWORD_HASH: 'xxt_password_hash'
};

// 从 localStorage 读取配置
function loadUserConfig() {
    const savedHost = localStorage.getItem(CONFIG_KEYS.SERVER_HOST);
    const savedPort = localStorage.getItem(CONFIG_KEYS.SERVER_PORT);
    const savedPasswordHash = localStorage.getItem(CONFIG_KEYS.PASSWORD_HASH);
    
    return {
        host: savedHost,
        port: savedPort,
        passwordHash: savedPasswordHash
    };
}

// 保存配置到 localStorage
function saveConfig() {
    const host = serverHostInput.value.trim();
    const port = serverPortInput.value.trim();
    const password = passwordInput.value.trim();
    
    // 保存主机和端口
    if (host) {
        localStorage.setItem(CONFIG_KEYS.SERVER_HOST, host);
    }
    if (port) {
        localStorage.setItem(CONFIG_KEYS.SERVER_PORT, port);
    }
    
    // 保存密码的 passhash
    let passhash = localStorage.getItem(CONFIG_KEYS.PASSWORD_HASH);
    if (password) {
        passhash = CryptoJS.HmacSHA256(password, "XXTouch").toString().toLowerCase();
        localStorage.setItem(CONFIG_KEYS.PASSWORD_HASH, passhash);
        console.log('配置已保存到 localStorage');
    }
    
    savedConfig = {
        host: host,
        port: port,
        passwordHash: passhash
    };
}

// 验证密码是否与保存的 passhash 匹配
function validatePassword(inputPassword) {
    const savedPasswordHash = localStorage.getItem(CONFIG_KEYS.PASSWORD_HASH);
    if (!savedPasswordHash) {
        return true; // 没有保存的密码，允许任何密码
    }
    
    const inputPasswordHash = CryptoJS.HmacSHA256(inputPassword, "XXTouch").toString().toLowerCase();
    return inputPasswordHash === savedPasswordHash;
}

// 清除保存的配置
function clearConfig() {
    if (confirm('确定要清除所有保存的配置吗？这将删除保存的服务器地址、端口和密码。')) {
        localStorage.removeItem(CONFIG_KEYS.SERVER_HOST);
        localStorage.removeItem(CONFIG_KEYS.SERVER_PORT);
        localStorage.removeItem(CONFIG_KEYS.PASSWORD_HASH);
        
        // 重置输入框为默认值
        let defaultHost = window.location.hostname || 'localhost';
        let defaultPort = '46980';
        
        // 从配置文件获取默认值
        if (window.XXTConfig && window.XXTConfig.websocket) {
            if (window.XXTConfig.websocket.host) {
                defaultHost = window.XXTConfig.websocket.host;
            }
            if (window.XXTConfig.websocket.port) {
                defaultPort = window.XXTConfig.websocket.port.toString();
            }
        }
        
        serverHostInput.value = defaultHost;
        serverPortInput.value = defaultPort;
        passwordInput.value = '';
        passwordInput.placeholder = '请输入控制密码';
        
        // 更新WebSocket URL
        updateServerUrl();
        
        console.log('配置已清除，已重置为默认值');
        logInfo('已清除保存的配置');
    }
}

// 初始化服务器配置
function initServerConfig() {
    serverHostInput = document.getElementById('server-host');
    serverPortInput = document.getElementById('server-port');
    passwordInput = document.getElementById('password');
    
    // 加载保存的配置
    savedConfig = loadUserConfig();
    
    // 优先级：localStorage > 配置文件 > 默认值
    let defaultHost = window.location.hostname || 'localhost';
    let defaultPort = '46980';
    
    // 从配置文件获取默认值
    if (window.XXTConfig && window.XXTConfig.websocket) {
        if (window.XXTConfig.websocket.host) {
            defaultHost = window.XXTConfig.websocket.host;
        }
        if (window.XXTConfig.websocket.port) {
            defaultPort = window.XXTConfig.websocket.port.toString();
        }
    }
    
    // 设置输入框值（localStorage 优先）
    serverHostInput.value = savedConfig.host || defaultHost;
    serverPortInput.value = savedConfig.port || defaultPort;
    
    // 如果有保存的密码hash，显示提示
    if (savedConfig.passwordHash) {
        passwordInput.placeholder = '留空使用保存的密码';
        console.log('检测到已保存的密码配置');
    }
    
    console.log('配置已加载:', {
        host: serverHostInput.value,
        port: serverPortInput.value,
        hasPasswordHash: !!savedConfig.passwordHash
    });
    
    // 清除配置按钮事件
    // const clearConfigBtn = document.getElementById('clear-config-btn');
    // clearConfigBtn.addEventListener('click', clearConfig);
    
    // 初始化URL
    updateServerUrl();
}

// 更新服务器URL
function updateServerUrl() {
    const host = serverHostInput.value.trim() || 'localhost';
    const port = serverPortInput.value.trim() || '46980';
    
    // 验证端口号
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        console.warn('无效的端口号:', port);
        return;
    }
    
    serverUrl = `ws://${host}:${port}/api/ws`;
    console.log('服务器URL已更新:', serverUrl);
    
    // 如果已连接，提示用户重新连接
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('服务器地址已变更，请重新连接');
        addLog('服务器地址已变更，请重新连接', 'warning');
    }
}

// DOM 元素
let connectBtn, refreshBtn, devicesList, devicesTable, selectAllCheckbox;
let runScriptBtn, stopScriptBtn, scriptPathInput;
let restartDeviceBtn, respringDeviceBtn;
// passwordInput 已在上面声明
let connectionStatus = null;
let uploadPathInput = null;
let uploadFilesBtn = null;
let fileDropAreaFileInput = null;
let fileDropArea = null;
let uploadProgress = null;
let progressBar = null;
let progressInfo = null;
let commandSequenceContainer = null;
let logContent = null;
let uploadSelectedBtn = null; // 新添加的按钮

// 初始化页面元素引用
function initUIElements() {
    // DOM 元素
    connectBtn = document.getElementById('connect-btn');
    refreshBtn = document.getElementById('refresh-btn');
    passwordInput = document.getElementById('password');
    connectionStatus = document.getElementById('connection-status');
    devicesList = document.getElementById('devices-table');
    uploadPathInput = document.getElementById('upload-path');
    uploadFilesBtn = document.getElementById('upload-files-btn');
    fileDropAreaFileInput = document.getElementById('file-drop-area-file-input');
    fileDropArea = document.getElementById('file-drop-area');
    uploadProgress = document.querySelector('.upload-progress');
    progressBar = document.getElementById('progress-bar');
    progressInfo = document.getElementById('progress-info');
    commandSequenceContainer = document.getElementById('command-sequence');
    logContent = document.getElementById('log-content');
    scriptPathInput = document.getElementById('script-path');
    runScriptBtn = document.getElementById('run-script-btn');
    stopScriptBtn = document.getElementById('stop-script-btn');
    restartDeviceBtn = document.getElementById('restart-device-btn');
    respringDeviceBtn = document.getElementById('respring-device-btn');
    uploadSelectedBtn = document.getElementById('upload-selected-btn'); // 获取新添加的按钮
    clearLogBtn = document.getElementById('clear-log');

    clearLogBtn.addEventListener('click', clearLog);
    
    // 获取密码
    if (passwordInput) {
        password = passwordInput.value;
    }
    
    // 添加日志
    logInfo('系统初始化完成');
    
    // 初始化远程控制事件监听器
    initRemoteControlListeners();
    
    // 初始化文件上传事件监听器
    initFileUploadListeners();
    
    // 初始化脚本控制事件监听器
    initScriptControlListeners();
    
    // 初始化文件浏览器事件监听器
    initFileBrowserListeners();
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 初始化UI元素引用
    initUIElements();
    
    // 初始化服务器配置
    initServerConfig();
    
    // 添加事件监听器
    connectBtn.addEventListener('click', toggleConnection);
    refreshBtn.addEventListener('click', refreshDevices);
    uploadFilesBtn.addEventListener('click', startUploadFiles);
    
    // 向选中设备上传文件按钮事件
    if (uploadSelectedBtn) {
        uploadSelectedBtn.addEventListener('click', function() {
            if (!isConnected) {
                logError('请先连接到服务器');
                return;
            }
            
            if (selectedDevices.size === 0) {
                logError('请先选择至少一个设备');
                return;
            }
            
            uploadFileToSelectedDevicesFromInput();
        });
    }
    
    // 尝试自动连接
    if (savedConfig.passwordHash) {
        toggleConnection();
    }
});

// 生成签名
function generateSign(timestamp) {
    let passhash;
    
    // 如果使用保存的密码，直接使用保存的passhash
    if (password === 'SAVED_PASSWORD_PLACEHOLDER') {
        if (savedConfig.passwordHash) {
            passhash = savedConfig.passwordHash;
        } else {
            console.error('无法获取保存的密码hash');
            return null;
        }
    } else {
        // 首先计算 passhash = hmacSHA256("XXTouch", password)
        passhash = CryptoJS.HmacSHA256(password, "XXTouch").toString().toLowerCase();
    }
    
    // 然后计算 sign = hmacSHA256(passhash, 秒级时间戳转换成字符串)
    const sign = CryptoJS.HmacSHA256(timestamp.toString(), passhash).toString().toLowerCase();
    
    // console.log("生成签名:", {
    //     usingStoredPassword: password === 'SAVED_PASSWORD_PLACEHOLDER',
    //     timestamp,
    //     passhash,
    //     sign
    // });
    
    return sign;
}

// 更新按钮状态
function updateButtonStates() {
    if (!isConnected) return;
    
    uploadFilesBtn.disabled = selectedDevices.size === 0 || uploadQueue.length === 0;
    runScriptBtn.disabled = selectedDevices.size === 0 || !scriptPathInput.value.trim();
    stopScriptBtn.disabled = selectedDevices.size === 0;
    restartDeviceBtn.disabled = selectedDevices.size === 0;
    respringDeviceBtn.disabled = selectedDevices.size === 0;
}

// 初始化文件上传事件监听器
function initFileUploadListeners() {
    // 文件选择事件
    fileDropAreaFileInput.addEventListener('change', handleFileSelect);

    fileDropArea.addEventListener('click', function(e) {
        fileDropAreaFileInput.click();
    });
    
    // 拖放区域事件
    fileDropArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.add('highlight');
    });
    
    fileDropArea.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('highlight');
    });
    
    fileDropArea.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('highlight');
        
        const items = e.dataTransfer.items;
        if (items) {
            handleDroppedItems(items);
        } else {
            const files = e.dataTransfer.files;
            handleFiles(files);
        }
    });
    
    // 上传路径输入事件
    uploadPathInput.addEventListener('change', function() {
        uploadPath = this.value;
        if (!uploadPath.endsWith('/')) {
            uploadPath += '/';
        }
    });
}

// 处理文件选择
function handleFileSelect(e) {
    const files = e.target.files;
    handleFiles(files);
}

// 处理拖放项目
async function handleDroppedItems(items) {
    const entries = [];
    for (let i = 0; i<items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry) {
                entries.push(entry);
            }
        }
    }
    
    // 重置文件列表
    uploadQueue = [];
    
    // 处理所有条目
    for (const entry of entries) {
        await processEntry(entry, '');
    }
    
    // 更新UI
    updateFilesUI();
}

// 递归处理文件系统条目
async function processEntry(entry, path) {
    if (entry.isFile) {
        // 处理文件
        const file = await getFileFromEntry(entry);
        file.relativePath = path + file.name;
        uploadQueue.push(file);
    } else if (entry.isDirectory) {
        // 处理目录
        const dirPath = path + entry.name + '/';
        const dirReader = entry.createReader();
        
        // 创建一个空目录标记
        const dirMarker = new File([""], entry.name, { type: "directory" });
        dirMarker.relativePath = dirPath;
        dirMarker.isDirectory = true;
        uploadQueue.push(dirMarker);
        
        // 读取目录内容
        const entries = await readAllDirectoryEntries(dirReader);
        for (const childEntry of entries) {
            await processEntry(childEntry, dirPath);
        }
    }
}

// 从文件条目获取文件
function getFileFromEntry(entry) {
    return new Promise((resolve) => {
        entry.file(resolve);
    });
}

// 读取目录中的所有条目
function readAllDirectoryEntries(dirReader) {
    const entries = [];
    
    // 递归读取所有条目
    async function readEntries() {
        const results = await new Promise((resolve) => {
            dirReader.readEntries(resolve);
        });
        
        if (results.length > 0) {
            entries.push(...results);
            await readEntries();
        }
    }
    
    return readEntries().then(() => entries);
}

// 处理文件列表
function handleFiles(files) {
    // 转换FileList为数组
    const filesArray = Array.from(files);
    
    // 添加到上传列表
    filesArray.forEach(file => {
        file.relativePath = file.name;
        uploadQueue.push(file);
    });
    
    // 更新UI
    updateFilesUI();
}

// 更新文件列表UI
function updateFilesUI() {
    // 检查是否有文件列表元素
    let fileList = document.querySelector('.file-list');
    if (!fileList) {
        fileList = document.createElement('div');
        fileList.className = 'file-list';
        fileDropArea.after(fileList);
    }
    
    // 清空文件列表
    fileList.innerHTML = '';
    
    // 如果没有文件，隐藏文件列表
    if (uploadQueue.length === 0) {
        fileList.style.display = 'none';
        return;
    }
    
    // 显示文件列表
    fileList.style.display = 'block';
    
    // 添加文件项
    uploadQueue.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = file.isDirectory ? `📁 ${file.relativePath}` : file.relativePath;
        
        const fileSize = document.createElement('div');
        fileSize.className = 'file-size';
        fileSize.textContent = file.isDirectory ? '目录' : '文件';
        
        const fileRemove = document.createElement('div');
        fileRemove.className = 'file-remove';
        fileRemove.textContent = '×';
        fileRemove.addEventListener('click', () => {
            uploadQueue.splice(index, 1);
            updateFilesUI();
            updateButtonStates();
        });
        
        fileItem.appendChild(fileName);
        fileItem.appendChild(fileSize);
        fileItem.appendChild(fileRemove);
        fileList.appendChild(fileItem);
    });
    
    // 更新按钮状态
    updateButtonStates();
}

// 启动文件上传
function startUploadFiles() {
    if (!isConnected || selectedDevices.size === 0 || uploadQueue.length === 0 || isUploading) {
        return;
    }
    
    // 设置上传状态
    isUploading = true;
    currentUploadIndex = 0;
    
    // 显示进度条
    uploadProgress.classList.add('active');
    progressBar.style.width = '0%';
    progressInfo.textContent = '准备上传...';
    
    logInfo(`开始上传 ${uploadQueue.length} 个文件/目录到 ${selectedDevices.size} 个设备`);
    
    // 开始上传第一个文件
    uploadNextFileToSelectedDevices();
}

// 上传下一个文件到选中设备
function uploadNextFileToSelectedDevices() {
    if (currentUploadIndex >= uploadQueue.length) {
        // 所有文件上传完成
        finishUpload();
        return;
    }

    console.log('上传队列:', uploadQueue);
    console.log('上传文件:', uploadQueue[currentUploadIndex]);
    
    const file = uploadQueue[currentUploadIndex];
    const targetPath = uploadPath + file.relativePath;
    
    // 更新进度信息
    progressInfo.textContent = `上传中 (${currentUploadIndex + 1}/${uploadQueue.length}): ${file.relativePath}`;
    
    if (file.isDirectory) {
        // 创建目录
        createDirectoryForSelectedDevices(targetPath);
    } else {
        // 上传文件
        prepareAndUploadFileToSelectedDevices(file, targetPath);
    }
}

// 创建目录
function createDirectoryForSelectedDevices(path) {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
        logError('无法创建目录，WebSocket连接已断开');
        finishUpload();
        return;
    }
    
    createDirectoryOnSelectedDevices(path).then(() => {
        console.log('目录创建成功');
        logSuccess('目录创建成功');
        
        // 更新进度条
        updateUploadProgress();
        
        // 继续上传下一个文件
        currentUploadIndex++;
        setTimeout(uploadNextFileToSelectedDevices, 100);
    }).catch(error => {
        console.error('创建目录失败:', error);
        logError(`创建目录失败: ${error}`);
        
        // 跳过这个文件，继续上传下一个
        currentUploadIndex++;
        setTimeout(uploadNextFileToSelectedDevices, 100);
    });
}

// 上传文件
function prepareAndUploadFileToSelectedDevices(file, path) {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
        logError('无法上传文件，WebSocket连接已断开');
        finishUpload();
        return;
    }
    
    // 首先确保文件目录存在
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex > 0) {
        const dirPath = path.substring(0, lastSlashIndex + 1);
        
        // 先创建目录，然后再上传文件
        createDirectoryOnSelectedDevices(dirPath)
            .then(() => {
                console.log(`确保目录存在: ${dirPath}`);
                // 目录创建成功后，开始上传文件
                readAndUploadFileToSelectedDevices(file, path);
            })
            .catch(error => {
                console.log(`创建目录出错 (可能已存在): ${error}`);
                // 即使目录创建失败，也尝试上传文件（因为目录可能已经存在）
                readAndUploadFileToSelectedDevices(file, path);
            });
    } else {
        // 没有目录部分，直接上传文件
        readAndUploadFileToSelectedDevices(file, path);
    }
}

// 读取并上传文件内容
function readAndUploadFileToSelectedDevices(file, path) {
    // 读取文件内容
    const reader = new FileReader();
    reader.onload = function(e) {
        // 获取Base64编码的文件内容
        const base64Data = e.target.result.split(',')[1];
        
        // 上传文件
        uploadFileToSelectedDevices(path, base64Data).then(() => {
            console.log('文件上传成功');
            // logSuccess('文件上传成功');
            
            // 更新进度条
            updateUploadProgress();
            
            // 继续上传下一个文件
            currentUploadIndex++;
            setTimeout(uploadNextFileToSelectedDevices, 100);
        }).catch(error => {
            console.error('上传文件失败:', error);
            // logError(`上传文件失败: ${error}`);
            
            // 跳过这个文件，继续上传下一个
            currentUploadIndex++;
            setTimeout(uploadNextFileToSelectedDevices, 100);
        });
    };
    
    reader.onerror = function() {
        logError(`读取文件失败: ${file.name}`);
        
        // 跳过这个文件，继续上传下一个
        currentUploadIndex++;
        setTimeout(uploadNextFileToSelectedDevices, 100);
    };
    
    // 以Base64格式读取文件
    reader.readAsDataURL(file);
}

// 更新上传进度
function updateUploadProgress() {
    const progress = Math.round((currentUploadIndex + 1) / uploadQueue.length * 100);
    progressBar.style.width = `${progress}%`;
}

// 完成上传
function finishUpload() {
    isUploading = false;
    progressInfo.textContent = '上传完成';
    logSuccess(`所有文件上传完成，共 ${uploadQueue.length} 个文件/目录`);
    
    // 3秒后隐藏进度条
    setTimeout(() => {
        uploadProgress.classList.remove('active');
    }, 3000);
}

// 连接/断开 WebSocket
function toggleConnection() {
    saveConfig();
    if (isConnected) {
        disconnectWebSocket();
    } else {
        connectWebSocket();
    }
}

// 连接 WebSocket
function connectWebSocket() {
    const inputPassword = passwordInput.value.trim();
    const savedConfig = loadUserConfig();
    
    // 如果输入框为空且有保存的密码hash，使用保存的密码
    if (!inputPassword && savedConfig.passwordHash) {
        // 使用保存的密码hash作为password变量（这里需要特殊处理）
        password = 'SAVED_PASSWORD_PLACEHOLDER'; // 占位符，实际使用savedConfig.passwordHash
        console.log('使用保存的密码配置');
    } else if (inputPassword) {
        // 使用输入的密码
        password = inputPassword;
        // 保存新密码
        saveConfig();
        console.log('使用输入的密码并保存');
    } else {
        logError('请输入控制密码');
        return;
    }
    
    logInfo(`正在连接到服务器 ${serverUrl}...`);
    
    try {
        ws = new WebSocket(serverUrl);
        
        ws.onopen = () => {
            isConnected = true;
            updateConnectionStatus(true);
            logSuccess('已连接到服务器');
            console.log('WebSocket连接已打开，准备请求设备列表');
            // 延迟一点时间再请求设备列表
            setTimeout(() => {
                requestDeviceList();
            }, 500);
        };
        
        ws.onclose = () => {
            isConnected = false;
            updateConnectionStatus(false);
            logError('与服务器的连接已断开');
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
            logError('WebSocket 错误: ' + error.message);
            isConnected = false;
            updateConnectionStatus(false);
        };
        
        ws.onmessage = handleMessage;
    } catch (error) {
        console.error('连接错误:', error);
        logError('连接错误: ' + error.message);
    }
}

// 断开 WebSocket
function disconnectWebSocket() {
    if (ws) {
        ws.close();
    }
}

// 更新连接状态 UI
function updateConnectionStatus(connected) {
    isConnected = connected;
    
    if (connected) {
        connectionStatus.textContent = '已连接';
        connectionStatus.className = 'status-connected';
        connectBtn.textContent = '断开连接';
        refreshBtn.disabled = false;
        uploadFilesBtn.disabled = selectedDevices.size === 0 || uploadQueue.length === 0;
    } else {
        connectionStatus.textContent = '未连接';
        connectionStatus.className = 'status-disconnected';
        connectBtn.textContent = '连接服务器';
        refreshBtn.disabled = true;
        uploadFilesBtn.disabled = true;
        
        // 清空设备列表
        devices = {};
        selectedDevices.clear();
        updateDevicesList();
    }
}

// 处理WebSocket消息
function handleMessage(event) {
    try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'control/devices') {
            console.log('收到设备列表:', message.body);
            devices = message.body || {};
            updateDevicesList();
            logSuccess('已更新设备列表');
        } else if (message.type === 'screen/snapshot') {
            // console.log('收到屏幕截图:', message);
            handleScreenSnapshot(message);
        } else if (message.type === 'app/state') {
            console.log('收到设备状态更新:', message.udid, message.body);
            devices[message.udid] = message.body;
            updateDevicesList();
            // logInfo(`设备 ${message.udid.substring(0, 8)}... 状态已更新`);
        } else if (message.type === 'file/list') {
            // 处理文件列表响应
            handleFileList(message);
        } else if (message.type === 'file/delete') {
            // 处理文件删除响应
            handleFileDelete(message);
        } else if (message.type === 'file/get') {
            // 处理文件内容响应
            if (document.getElementById('download-file').disabled) {
                // 如果下载按钮被禁用，说明这是一个下载请求
                handleFileDownload(message);
            } else {
                // 否则是查看文件请求
                handleFileContent(message);
            }
        } else if (message.type === 'file/put') {
            // 处理文件上传响应或目录创建响应
            if (message.body && message.body.directory === true) {
                // 如果是目录操作
                handleDirectoryCreate(message);
            } else if (fileBrowserActive && currentRemoteDevice) {
                // 如果文件浏览器处于活动状态，并且有当前远程控制设备，那么这是上传到当前远程控制设备的响应
                handleFilePutForCurrentRemoteDevice(message);
            } else {
                // 否则认为是上传到选中设备的响应
                handleFilePutToSelectedDevices(message);
            }
        } else if (message.type === 'script/run') {
            // 处理脚本启动响应
            handleScriptRun(message);
        } else if (message.type === 'script/stop') {
            // 处理脚本停止响应
            handleScriptStop(message);
        } else if (message.type === 'system/restart') {
            // 处理系统重启响应
            handleSystemRestart(message);
        } else if (message.type === 'system/respring') {
            // 处理系统重启响应
            handleSystemRespring(message);
        } else if (message.type === 'device/disconnect') {
            // 处理设备断开响应
            handleDeviceDisconnect(message);
        } else if (
            message.type === 'touch/down' ||
            message.type === 'touch/up' ||
            message.type === 'touch/move' ||
            message.type === 'touch/tap' ||
            message.type === 'key/down' ||
            message.type === 'key/up' ||
            message.type === 'key/press'
        ) {
            // 忽略掉这些消息的返回 除非 error 不为空
            if (message.error) {
                logError(JSON.stringify(message.error));
            }
        } else {
            // 处理其他消息
            logInfo(`收到消息: ${JSON.stringify(message).substring(0, 100)}...`);
        }
    } catch (error) {
        console.error('解析消息失败:', error);
        logError('解析消息失败: ' + error.message);
    }
}

// 请求设备列表
function requestDeviceList() {
    if (!isConnected) return;
    
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSign(timestamp);
    
    const message = {
        ts: timestamp,
        sign: sign,
        type: 'control/devices'
    };
    
    console.log('发送请求设备列表消息:', message);
    ws.send(JSON.stringify(message));
    logInfo('已请求设备列表');
}

// 刷新设备状态
function refreshDevices() {
    if (!isConnected) return;
    
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSign(timestamp);
    
    const message = {
        ts: timestamp,
        sign: sign,
        type: 'control/refresh'
    };
    
    ws.send(JSON.stringify(message));
    logInfo('已请求刷新设备状态');
}

// 更新设备列表 UI
function updateDevicesList() {
    // 清空表格内容，但保留表头
    let tbody = devicesList.querySelector('tbody');
    if (tbody) {
        tbody.innerHTML = '';
    } else {
        // 如果没有tbody，创建一个
        const newTbody = document.createElement('tbody');
        devicesList.appendChild(newTbody);
        tbody = newTbody;
    }
    
    if (Object.keys(devices).length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="7" class="no-devices">暂无设备连接</td>';
        tbody.appendChild(row);
        return;
    }
    
    for (const [udid, deviceInfo] of Object.entries(devices)) {
        const deviceSystem = deviceInfo.system || {};
        const deviceScript = deviceInfo.script || {};
        
        // 格式化电量显示为百分比
        const batteryLevel = deviceSystem.battery ? Math.round(deviceSystem.battery * 100) + '%' : '未知';
        
        // 获取脚本运行状态
        const scriptRunning = deviceScript.running ? '▶️' : '⏹️';
        
        // 获取最后一条日志
        const lastLog = deviceSystem.log || '无日志';
        
        // 获取IP地址
        const ipAddress = deviceSystem.ip || '未知';
        
        const row = document.createElement('tr');
        row.className = selectedDevices.has(udid) ? 'selected' : '';
        
        row.innerHTML = `
            <td style="width: 5%; text-align: center;">
                <input type="checkbox" class="device-checkbox" data-udid="${udid}" ${selectedDevices.has(udid) ? 'checked' : ''}>
            </td>
            <td style="width: 10%" class="device-name" data-udid="${udid}">${deviceSystem.name || '未知设备'}</td>
            <td style="width: 15%">${udid.substring(0, 16)}...</td>
            <td style="width: 10%">${ipAddress}</td>
            <td style="width: 10%">${deviceSystem.version || '未知'}</td>
            <td style="width: 5%">${batteryLevel}</td>
            <td style="width: 5%">${scriptRunning}</td>
            <td style="width: 40%" title="${lastLog}">${lastLog.length > 40 ? lastLog.substring(0, 40) + '...' : lastLog}</td>
        `;
        
        tbody.appendChild(row);
    }
    
    // 添加全选/取消全选功能
    const selectAllCheckbox = document.getElementById('select-all-devices');
    selectAllCheckbox.addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.device-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = this.checked;
            const udid = checkbox.dataset.udid;
            if (this.checked) {
                selectedDevices.add(udid);
            } else {
                selectedDevices.delete(udid);
            }
        });
        updateButtonStates();
    });
    
    // 添加单个设备选择功能
    document.querySelectorAll('.device-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const udid = this.dataset.udid;
            if (this.checked) {
                selectedDevices.add(udid);
            } else {
                selectedDevices.delete(udid);
            }
            updateButtonStates();
        });
    });
    
    // 添加双击设备名称打开远程控制功能
    document.querySelectorAll('.device-name').forEach(deviceNameCell => {
        deviceNameCell.addEventListener('dblclick', function() {
            const udid = this.dataset.udid;
            openRemoteControl(udid);
        });
    });
}

// 打开远程控制模态窗口
function openRemoteControl(udid) {
    if (!udid || !devices[udid]) {
        console.error('设备不存在:', udid);
        return;
    }
    
    // 设置当前远程控制的设备
    currentRemoteDevice = udid;
    
    // 获取设备信息
    const deviceInfo = devices[udid];
    const deviceSystem = deviceInfo.system || {};
    const deviceName = deviceSystem.name || '未知设备';
    
    // 设置设备名称
    document.getElementById('remote-device-name').textContent = `远程控制: ${deviceName} (${udid.substring(0, 8)}...)`;
    
    // 显示模态窗口
    const modal = document.getElementById('remote-control-modal');
    modal.style.display = 'block';
    
    // 确保文件浏览器和文件查看器初始状态是关闭的
    const fileBrowser = document.getElementById('file-browser');
    fileBrowser.classList.remove('active');
    fileBrowserActive = false;
    
    const fileViewer = document.getElementById('file-viewer');
    if (fileViewer) {
        fileViewer.classList.remove('active');
    }
    
    // 清除之前的屏幕捕获
    stopScreenCapture();
    
    // 重置FPS计数器
    resetFpsCounter();
    
    // 记录当前设备的屏幕尺寸
    if (deviceSystem.scrw && deviceSystem.scrh) {
        originalScreenWidth = deviceSystem.scrw;
        originalScreenHeight = deviceSystem.scrh;
        console.log('设备屏幕尺寸:', originalScreenWidth, 'x', originalScreenHeight);
    } else {
        console.log('设备信息中没有屏幕尺寸数据');
    }
    
    // 自动开始屏幕捕获
    startScreenCapture();
}

// 关闭远程控制模态窗口
function closeRemoteControl() {
    stopScreenCapture();
    currentRemoteDevice = null;
    
    const modal = document.getElementById('remote-control-modal');
    modal.style.display = 'none';
    
    // 清除屏幕图像
    document.getElementById('device-screen').src = '';
}

// 开始屏幕捕获
function startScreenCapture() {
    if (!currentRemoteDevice || screenCaptureActive) return;
    
    // 设置捕获状态为活跃
    screenCaptureActive = true;
    
    // 重置FPS计数器
    resetFpsCounter();
    
    // 每秒更新FPS显示
    fpsUpdateInterval = setInterval(updateFpsDisplay, 1000);
    
    // 开始定期获取屏幕截图
    isWaitingForScreenshot = false;
    
    // 获取Canvas元素并初始化
    const canvas = document.getElementById('device-screen');
    if (canvas) {
        // 初始化Canvas上下文
        canvasContext = canvas.getContext('2d');
        
        // 设置Canvas尺寸为容器尺寸
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
        
        console.log('初始化Canvas:', canvasWidth, 'x', canvasHeight);
        
        // 重新绑定屏幕覆盖层事件
        rebindScreenOverlayEvents();
    }
    
    captureScreenshot();
    
    logInfo(`开始捕获设备 ${currentRemoteDevice.substring(0, 8)}... 的屏幕`);
}

// 停止屏幕捕获
function stopScreenCapture() {
    // 设置捕获状态为非活跃
    screenCaptureActive = false;
    
    // 清除定时器
    if (screenCaptureTimeout) {
        clearTimeout(screenCaptureTimeout);
        screenCaptureTimeout = null;
    }
    
    if (fpsUpdateInterval) {
        clearInterval(fpsUpdateInterval);
        fpsUpdateInterval = null;
    }
    
    if (currentRemoteDevice) {
        logInfo(`停止捕获设备 ${currentRemoteDevice.substring(0, 8)}... 的屏幕`);
    }
}

// 捕获屏幕截图
function captureScreenshot() {
    if (!screenCaptureActive || !ws || !isConnected || !currentRemoteDevice) {
        return;
    }
    
    // 如果已经有一个等待响应的请求，则不再发送新请求
    if (isWaitingForScreenshot) {
        console.log('已有等待响应的截图请求');
        return;
    }
    
    // 标记为正在等待截图响应
    isWaitingForScreenshot = true;
    
    // 发送屏幕快照请求
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            devices: [currentRemoteDevice],
            type: "screen/snapshot",
            body: {
                format: "png",
                scale: screenCaptureScale
            }
        }
    };
    
    // console.log('发送截图请求:', command);
    ws.send(JSON.stringify(command));
    
    // 设置最大等待时间，如果超时则强制发送下一个请求
    clearTimeout(screenCaptureTimeout);
    screenCaptureTimeout = setTimeout(() => {
        console.log(`截图请求超时(${maxScreenshotWaitTime}ms)，重新发送请求`);
        isWaitingForScreenshot = false;
        captureScreenshot(); // 重新发起请求
    }, maxScreenshotWaitTime);
}

// 处理屏幕截图响应
function handleScreenSnapshot(message) {
    // 接收到响应，重置等待状态
    isWaitingForScreenshot = false;
    clearTimeout(screenCaptureTimeout);
    
    // 如果屏幕捕获已停止，则不处理
    if (!screenCaptureActive) {
        return;
    }
    
    if (message.error && message.error !== "") {
        console.error('屏幕截图响应错误:', JSON.stringify(message.error));
        captureScreenshot(); // 立即请求下一帧
        return;
    }
    
    const imageData = message.body;
    if (!imageData) {
        console.error('屏幕截图响应数据无效');
        captureScreenshot(); // 立即请求下一帧
        return;
    }
    
    // 记录帧数
    frameCount++;
    
    // 获取Canvas元素
    const canvas = document.getElementById('device-screen');
    const ctx = canvas.getContext('2d');
    
    // 创建新的图像对象
    const img = new Image();
    img.onload = function() {
        // 保存原始屏幕尺寸
        originalScreenWidth = img.width * (100/screenCaptureScale); // 因为scale是30，所以原始大小是当前宽度的100/30倍
        originalScreenHeight = img.height * (100/screenCaptureScale);
        
        // 获取Canvas和容器的尺寸
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        
        // 设置Canvas大小与容器相同
        canvas.width = containerWidth;
        canvas.height = containerHeight;
        
        // 计算保持纵横比的绘制区域
        const imgRatio = img.width / img.height;
        const containerRatio = containerWidth / containerHeight;
        
        let drawWidth, drawHeight, x, y;
        
        if (imgRatio > containerRatio) {
            // 图像比容器更宽，以宽度为基准
            drawWidth = containerWidth;
            drawHeight = containerWidth / imgRatio;
            x = 0;
            y = (containerHeight - drawHeight) / 2;
        } else {
            // 图像比容器更高，以高度为基准
            drawHeight = containerHeight;
            drawWidth = containerHeight * imgRatio;
            x = (containerWidth - drawWidth) / 2;
            y = 0;
        }
        
        // 清除Canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 绘制图像
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
        
        // 保存绘制区域信息，用于触摸坐标转换
        drawingRect = { x, y, width: drawWidth, height: drawHeight };
        
        // 更新覆盖层大小
        const overlay = document.getElementById('screen-overlay');
        if (overlay) {
            overlay.style.width = `${canvas.width}px`;
            overlay.style.height = `${canvas.height}px`;
        }
        
        // 图像加载完成后立即请求下一帧
        captureScreenshot();
    };
    
    img.onerror = function() {
        console.error('图像加载失败');
        captureScreenshot(); // 错误时也立即请求下一帧
    };
    
    // 设置图像源
    img.src = `data:image/png;base64,${imageData}`;
}

// 日志函数
function logInfo(message) {
    addLogEntry(message, 'info');
}

function logSuccess(message) {
    addLogEntry(message, 'success');
}

function logError(message) {
    addLogEntry(message, 'error');
}

function addLogEntry(message, type) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    
    logContent.appendChild(logEntry);
    logContent.scrollTop = logContent.scrollHeight;
}

// 清空日志
function clearLog() {
    logContent.innerHTML = '';
}

// 重置FPS计数器
function resetFpsCounter() {
    frameCount = 0;
    lastFpsUpdateTime = 0;
    document.getElementById('fps-counter').textContent = '0 FPS';
}

// 更新FPS显示
function updateFpsDisplay() {
    document.getElementById('fps-counter').textContent = `${frameCount} FPS`;
    frameCount = 0;
}

// 发送按键命令
function sendKeyCommandToRemoteCurrentDevice(type, keyCode) {
    if (!currentRemoteDevice || !ws || ws.readyState !== WebSocket.OPEN) {
        console.log('无法发送按键命令，连接未建立或设备未选择');
        return;
    }
    
    console.log(`发送按键命令: ${type}, 按键: ${keyCode}`);
    
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            // 确保只发送到当前远程控制的设备，而不是设备列表中选择的设备
            devices: [currentRemoteDevice],
            type: type,
            body: {
                code: keyCode
            }
        }
    };
    
    console.log('发送按键命令:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
    logInfo(`发送 ${type} 命令到设备 ${currentRemoteDevice.substring(0, 8)}...，按键: ${keyCode}`);
}

// 向选中的设备上传文件
function uploadFileToSelectedDevicesFromInput() {
    if (!isConnected) {
        logError('请先连接到服务器');
        return;
    }
    
    if (selectedDevices.size === 0) {
        logError('请先选择至少一个设备');
        return;
    }
    
    // 创建一个隐藏的文件选择框
    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.multiple = true;
    hiddenFileInput.style.display = 'none';
    document.body.appendChild(hiddenFileInput);
    
    // 监听文件选择事件
    hiddenFileInput.addEventListener('change', function(e) {
        const files = e.target.files;
        if (files.length > 0) {
            // 清除上传队列
            uploadQueue = [];
            
            // 添加文件到上传队列
            filesArray = Array.from(files);
            filesArray.forEach(file => {
                file.relativePath = file.name;
                uploadQueue.push(file);
            });
            
            // 更新UI
            updateFilesUI();
            
            // 自动开始上传
            startUploadFiles();
        }
        
        // 清理临时元素
        document.body.removeChild(hiddenFileInput);
    });
    
    // 触发文件选择框
    hiddenFileInput.click();
}

// 处理文件列表响应
function handleFileList(message) {
    console.log('收到文件列表响应:', message);
    
    // 清除加载提示 - 直接清空file-browser-content内除table以外的所有内容
    const fileListContainer = document.getElementById('file-browser-content');
    if (fileListContainer) {
        // 找到所有直接子元素，保留table
        const children = Array.from(fileListContainer.children);
        for (const child of children) {
            if (child.id !== 'file-list' && child.id !== 'upload-overlay') {
                child.remove();
            }
        }
    }
    
    if (message.error && message.error !== '') {
        console.error('获取文件列表错误:', JSON.stringify(message.error));
        const fileList = document.getElementById('file-list');
        if (fileList) {
            const tbody = fileList.querySelector('tbody') || fileList;
            tbody.innerHTML = `<tr><td colspan="3" class="error">加载失败: ${JSON.stringify(message.error)}</td></tr>`;
        }
        return;
    }
    
    // 从消息中获取文件列表
    // 根据输出看出 message.body 本身就是数组
    let files = message.body;
    
    // 确保是有效数组
    if (!Array.isArray(files)) {
        files = [];
        console.error('文件列表格式无效，判定为空数组: ', files);
    }
    
    console.log('文件列表数据:', files);
    console.log('文件数量:', files.length);
    
    // 打印一些文件示例，帮助调试
    if (files.length > 0) {
        console.log('文件示例:', files[0]);
    }
    
    // 排序：目录在前，文件在后，然后按名称字母顺序排序
    files.sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
    });
    
    // 更新文件列表UI
    updateFileListUI(files);
}

// 更新文件列表UI
function updateFileListUI(files) {
    console.log('开始更新文件列表UI，文件数量:', files.length);
    
    const fileListTable = document.getElementById('file-list');
    if (!fileListTable) {
        console.error('未找到file-list表格元素');
        return;
    }
    
    // 获取或创建tbody元素
    let tbody = fileListTable.querySelector('tbody');
    if (!tbody) {
        console.log('未找到tbody元素，创建新的tbody');
        tbody = document.createElement('tbody');
        fileListTable.appendChild(tbody);
    } else {
        console.log('找到tbody元素');
    }
    
    console.log('清空文件列表');
    // 清空文件列表
    tbody.innerHTML = '';
    
    // 如果当前不在根目录，添加上级目录选项
    if (currentBrowsingPath !== '/') {
        console.log('添加上级目录选项');
        const parentPath = getParentPath(currentBrowsingPath);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="file-name"><i class="folder-icon">📁</i> <a href="#" class="parent-dir">..</a></td>
            <td class="file-type">目录</td>
            <td class="file-actions">-</td>
        `;
        
        // 添加点击事件
        const dirLink = row.querySelector('.parent-dir');
        dirLink.addEventListener('click', function(e) {
            e.preventDefault();
            loadFileList(parentPath);
        });
        
        tbody.appendChild(row);
    }
    
    // 添加文件和目录
    if (files.length === 0) {
        console.log('目录为空，显示空目录消息');
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="3" class="empty">目录为空</td>';
        tbody.appendChild(row);
    } else {
        console.log('添加文件和目录到列表');
        files.forEach(file => {
            const row = document.createElement('tr');
            const isDirectory = file.type === 'dir';
            const icon = isDirectory ? '📁' : '📄';
            const filePath = currentBrowsingPath.endsWith('/') ? 
                `${currentBrowsingPath}${file.name}` : 
                `${currentBrowsingPath}/${file.name}`;
            
            row.innerHTML = `
                <td class="file-name"><i class="${isDirectory ? 'folder-icon' : 'file-icon'}">${icon}</i> <a href="#" class="file-link" data-path="${filePath}" data-type="${file.type}">${file.name}</a></td>
                <td class="file-type">${isDirectory ? '目录' : '文件'}</td>
                <td class="file-actions">
                    ${isDirectory ? '' : '<button class="view-file-btn">查看</button> <button class="download-file-btn">下载</button>'} 
                    <button class="delete-file-btn" style="background-color: #ff4d4f; color: white;">删除</button>
                </td>
            `;
            
            // 添加点击事件
            const fileLink = row.querySelector('.file-link');
            fileLink.addEventListener('click', function(e) {
                e.preventDefault();
                if (isDirectory) {
                    loadFileList(filePath);
                } else {
                    viewFile(filePath);
                }
            });
            
            // 添加查看按钮事件
            const viewBtn = row.querySelector('.view-file-btn');
            if (viewBtn) {
                viewBtn.addEventListener('click', function() {
                    viewFile(filePath);
                });
            }
            
            // 添加下载按钮事件
            const downloadBtn = row.querySelector('.download-file-btn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', function() {
                    downloadFile(filePath, file.name);
                });
            }
            
            // 添加删除按钮事件
            const deleteBtn = row.querySelector('.delete-file-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function() {
                    if (confirm(`确定要删除${isDirectory ? '目录' : '文件'} "${file.name}" 吗？`)) {
                        deleteFile(filePath);
                    }
                });
            }
            
            tbody.appendChild(row);
        });
    }
    
    console.log('文件列表UI更新完成');
    
    // 确保文件浏览器是可见的
    const fileBrowser = document.getElementById('file-browser');
    if (fileBrowser && !fileBrowser.classList.contains('active')) {
        console.log('强制显示文件浏览器');
        fileBrowser.classList.add('active');
        fileBrowserActive = true;
    }
}

// 获取父路径
function getParentPath(path) {
    // 移除结尾的斜杠
    if (path.endsWith('/') && path !== '/') {
        path = path.slice(0, -1);
    }
    
    // 查找最后一个斜杠
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex <= 0) {
        return '/';
    }
    
    return path.substring(0, lastSlashIndex) || '/';
}

// 发送触控命令
function sendTouchCommand(type, x, y) {
    if (!currentRemoteDevice || !ws || ws.readyState !== WebSocket.OPEN) {
        console.error('无法发送触控命令，连接未建立或设备未选择');
        return;
    }
    
    // 确保坐标在有效范围内
    x = Math.max(0, Math.min(Math.floor(x), originalScreenWidth - 1));
    y = Math.max(0, Math.min(Math.floor(y), originalScreenHeight - 1));
    
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            // 确保只发送到当前远程控制的设备，而不是设备列表中选择的设备
            devices: [currentRemoteDevice],
            type: type,
            body: {
                x: x,
                y: y
            }
        }
    };
    
    console.log('发送触控命令:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
    console.log(`发送 ${type} 命令到设备 ${currentRemoteDevice.substring(0, 8)}...，坐标 (${x}, ${y})`);
}

// 处理文件上传响应（上传到选中设备）
function handleFilePut(message) {
    console.log('收到文件上传响应:', message);
    
    if (message.error && message.error !== "") {
        logError(`上传失败: ${JSON.stringify(message.error)}`);
    } else {
        if (message.body && message.body.directory) {
            logSuccess('目录创建成功');
        } else {
            logSuccess('文件上传成功');
        }
        
        // 如果当前正在批量上传，则继续处理上传队列
        if (isUploading && currentUploadIndex < uploadQueue.length) {
            currentUploadIndex++;
            setTimeout(processUploadQueue, 100);
        } else if (isUploading) {
            isUploading = false;
            loadFileList(currentBrowsingPath);
        } else {
            loadFileList(currentBrowsingPath);
        }
    }
}

// 向选中的设备上传文件
function uploadFileToSelectedDevices(filePath, fileData) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !ws) {
            reject('WebSocket 未连接');
            return;
        }
        
        // 获取选中的设备列表
        const selectedDevicesList = Array.from(selectedDevices);
        if (selectedDevicesList.length === 0) {
            reject('未选择任何设备');
            return;
        }
        
        const timestamp = Math.floor(Date.now() / 1000);
        const sign = generateSign(timestamp);
        
        const command = {
            ts: timestamp,
            sign: sign,
            type: "control/command",
            body: {
                devices: selectedDevicesList,
                type: "file/put",
                body: {
                    path: filePath,
                    data: fileData
                }
            }
        };
        
        console.log(`发送文件上传命令到 ${selectedDevicesList.length} 个选中设备，路径: ${filePath}`);
        
        try {
            ws.send(JSON.stringify(command));
            
            // 监听文件上传响应
            const messageHandler = function(event) {
                const message = JSON.parse(event.data);
                if (message.type === 'file/put') {
                    ws.removeEventListener('message', messageHandler);
                    
                    if (message.error && message.error !== '') {
                        reject(JSON.stringify(message.error));
                    } else {
                        resolve();
                    }
                }
            };
            
            ws.addEventListener('message', messageHandler);
            
            // 设置超时
            setTimeout(() => {
                ws.removeEventListener('message', messageHandler);
                reject('上传超时');
            }, 30000); // 30秒超时
        } catch (error) {
            console.error('发送上传命令失败:', error);
            reject(error.toString());
        }
    });
}

// 计算点击坐标映射到设备坐标的函数
function calculateDeviceCoordinates(clientX, clientY) {
    // 获取屏幕覆盖层元素
    const overlay = document.getElementById('screen-overlay');
    const canvas = document.getElementById('device-screen');
    if (!overlay || !canvas) {
        console.error('找不到必要的DOM元素');
        return null;
    }
    
    // 获取覆盖层位置和Canvas位置
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    
    // 计算点击相对于客户端视口的位置
    const viewportX = clientX;
    const viewportY = clientY;
    
    console.log('原始点击坐标:', viewportX, viewportY);
    console.log('覆盖层位置:', overlayRect.left, overlayRect.top, overlayRect.width, overlayRect.height);
    
    // 计算点击相对于覆盖层的位置
    const overlayX = viewportX - overlayRect.left;
    const overlayY = viewportY - overlayRect.top;
    
    // 使用Canvas的实际位置和尺寸，而不是保存的绘制区域信息
    // 检查点击是否在Canvas元素区域内
    if (
        viewportX < canvasRect.left || 
        viewportX > canvasRect.right || 
        viewportY < canvasRect.top || 
        viewportY > canvasRect.bottom
    ) {
        console.log('点击在Canvas区域外');
        return null;
    }
    
    // 计算点击在Canvas元素中的相对位置
    const canvasX = viewportX - canvasRect.left;
    const canvasY = viewportY - canvasRect.top;
    
    // 计算点击位置相对于Canvas内容区域的比例
    let relativeX, relativeY;
    
    // 使用保存的绘制区域信息
    const { x: drawX, y: drawY } = drawingRect; // 图像绘制区域的位置
    
    // 检查点击是否在图像绘制区域内
    if (canvasX < drawX || canvasX > drawX + drawingRect.width || canvasY < drawY || canvasY > drawY + drawingRect.height) {
        console.log('点击在图像绘制区域外');
        return null;
    }
    
    // 计算点击在图像上的相对位置 (0-1范围)
    relativeX = (canvasX - drawX) / drawingRect.width;
    relativeY = (canvasY - drawY) / drawingRect.height;
    
    // 确保相对位置在0-1范围内
    relativeX = Math.max(0, Math.min(1, relativeX));
    relativeY = Math.max(0, Math.min(1, relativeY));
    
    // 直接映射到设备坐标，不考虑截图缩放
    const deviceX = Math.floor(relativeX * originalScreenWidth);
    const deviceY = Math.floor(relativeY * originalScreenHeight);
    
    // 详细记录计算过程，便于调试
    console.log('坐标映射详情:');
    console.log('- 点击客户端坐标:', clientX, clientY);
    console.log('- Canvas位置和尺寸:', canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height);
    console.log('- 点击相对于Canvas位置:', canvasX, canvasY);
    console.log('- 图像绘制区域:', drawX, drawY, drawingRect.width, drawingRect.height);
    console.log('- 点击相对位置(0-1):', relativeX, relativeY);
    console.log('- 设备实际尺寸:', originalScreenWidth, 'x', originalScreenHeight);
    console.log('- 计算出的设备坐标:', deviceX, deviceY);
    
    return {
        clientX: canvasX - drawX, // 相对于图像的坐标
        clientY: canvasY - drawY, // 相对于图像的坐标
        deviceX: deviceX,
        deviceY: deviceY
    };
}

// 重新绑定屏幕覆盖层事件
function rebindScreenOverlayEvents() {
    // 获取覆盖层元素
    const overlay = document.getElementById('screen-overlay');
    if (!overlay) {
        console.error('找不到屏幕覆盖层元素');
        return;
    }
    
    // 移除所有现有事件监听器
    overlay.replaceWith(overlay.cloneNode(true));
    
    // 重新获取覆盖层元素（因为replaceWith会创建新元素）
    const newOverlay = document.getElementById('screen-overlay');
    
    // 记录触摸开始位置
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchMoved = false;
    
    // 鼠标按下事件
    newOverlay.addEventListener('mousedown', function(event) {
        // 只处理左键点击
        if (event.button !== 0) return;
        
        const coords = calculateDeviceCoordinates(event.clientX, event.clientY);
        if (!coords) return;
        
        // 记录触摸开始位置
        touchStartX = coords.deviceX;
        touchStartY = coords.deviceY;
        isTouchMoved = false;
        
        console.log('发送触摸按下命令:', coords.deviceX, coords.deviceY);
        sendTouchCommand('touch/down', coords.deviceX, coords.deviceY);
        
        // 显示触摸点动画
        showTouchPoint(coords.clientX, coords.clientY);
    });
    
    // 鼠标移动事件
    newOverlay.addEventListener('mousemove', function(event) {
        // 只有在按下鼠标时才处理移动
        if (event.buttons !== 1) return;
        
        const coords = calculateDeviceCoordinates(event.clientX, event.clientY);
        if (!coords) return;
        
        // 计算移动距离
        const dx = coords.deviceX - touchStartX;
        const dy = coords.deviceY - touchStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // 只有移动超过一定距离才发送移动命令，避免频繁发送
        if (distance > 5) {
            isTouchMoved = true;
            console.log('发送触摸移动命令:', coords.deviceX, coords.deviceY);
            sendTouchCommand('touch/move', coords.deviceX, coords.deviceY);
            
            // 更新触摸位置
            touchStartX = coords.deviceX;
            touchStartY = coords.deviceY;
            
            // 显示触摸点动画
            showTouchPoint(coords.clientX, coords.clientY);
        }
    });
    
    // 鼠标抬起事件
    newOverlay.addEventListener('mouseup', function(event) {
        // 只处理左键释放
        if (event.button !== 0) return;
        
        const coords = calculateDeviceCoordinates(event.clientX, event.clientY);
        if (!coords) return;
        
        console.log('发送触摸抬起命令:', coords.deviceX, coords.deviceY);
        sendTouchCommand('touch/up', coords.deviceX, coords.deviceY);
        
        // 如果没有移动，则发送点击命令
        if (!isTouchMoved) {
            console.log('发送触摸点击命令:', coords.deviceX, coords.deviceY);
            sendTouchCommand('touch/tap', coords.deviceX, coords.deviceY);
        }
    });
    
    // 添加鼠标右键事件 - 发送Home键命令
    newOverlay.addEventListener('contextmenu', function(event) {
        // 阻止默认的右键菜单
        event.preventDefault();
        
        // 发送Home键按下命令
        sendKeyCommandToRemoteCurrentDevice('key/down', 'home');
        
        // 延迟50ms后发送抬起命令，模拟按键行为
        setTimeout(() => {
            sendKeyCommandToRemoteCurrentDevice('key/up', 'home');
        }, 50);
        
        return false;
    });
    
    console.log('屏幕覆盖层事件重新绑定完成');
}

// 显示触摸点动画
function showTouchPoint(x, y) {
    // 清除所有现有的触摸点
    clearTouchPoints();
    
    // 获取覆盖层元素
    const overlay = document.getElementById('screen-overlay');
    if (!overlay) return;
    
    // 获取canvas元素和位置信息
    const canvas = document.getElementById('device-screen');
    if (!canvas) return;
    
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    
    // 计算触摸点相对于覆盖层的位置
    // 需要将相对于图像的坐标转换为相对于覆盖层的坐标
    const { x: drawX, y: drawY } = drawingRect; // 图像绘制区域的位置
    
    // 计算点在覆盖层中的绝对位置
    const pointX = x + drawX; // x是相对于图像的x坐标，加上图像绘制区域的x偏移
    const pointY = y + drawY; // y是相对于图像的y坐标，加上图像绘制区域的y偏移
    
    console.log('触摸点位置计算:');
    console.log('- 原始坐标:', x, y);
    console.log('- 图像绘制区域:', drawX, drawY);
    console.log('- 计算后的触摸点位置:', pointX, pointY);
    
    // 创建触摸点元素
    const touchPoint = document.createElement('div');
    touchPoint.className = 'touch-point';
    touchPoint.style.left = `${pointX}px`;
    touchPoint.style.top = `${pointY}px`;
    
    // 添加到覆盖层
    overlay.appendChild(touchPoint);
    
    // 设置定时器，在动画结束后移除触摸点
    setTimeout(() => {
        if (touchPoint.parentNode) {
            touchPoint.parentNode.removeChild(touchPoint);
        }
    }, 500); // 与CSS动画持续时间一致
}

// 清除所有触摸点
function clearTouchPoints() {
    const overlay = document.getElementById('screen-overlay');
    if (!overlay) return;
    
    // 移除所有触摸点元素
    const touchPoints = overlay.querySelectorAll('.touch-point');
    touchPoints.forEach(point => {
        if (point.parentNode) {
            point.parentNode.removeChild(point);
        }
    });
}

// 重启设备
function restartDevice(udid) {
    if (!isConnected) {
        logError('未连接到服务器');
        return;
    }
    
    logInfo(`正在重启设备: ${udid.substring(0, 8)}...`);
    
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSign(timestamp);
    
    const command = {
        ts: timestamp,
        sign: sign,
        type: "control/command",
        body: {
            devices: [udid],
            type: "system/reboot"
        }
    };
    
    console.log('发送重启设备请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
}

// 在特定设备上运行脚本
function runDevicesScript(udids, scriptName) {
    if (!isConnected) {
        logError('未连接到服务器');
        return;
    }
    
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSign(timestamp);
    
    const command = {
        ts: timestamp,
        sign: sign,
        type: "control/command",
        body: {
            devices: udids,
            type: "script/run",
            body: {
                name: scriptName
            }
        }
    };
    
    console.log('发送启动脚本请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
}

// 停止特定设备上的脚本
function stopDevicesScript(udids) {
    if (!isConnected) {
        logError('未连接到服务器');
        return;
    }
    
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSign(timestamp);
    
    const command = {
        ts: timestamp,
        sign: sign,
        type: "control/command",
        body: {
            devices: udids,
            type: "script/stop"
        }
    };
    
    console.log('发送停止脚本请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
}

// 重启特定设备
function restartDevices(udids) {
    if (!isConnected) {
        logError('未连接到服务器');
        return;
    }
    
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSign(timestamp);
    
    const command = {
        ts: timestamp,
        sign: sign,
        type: "control/command",
        body: {
            devices: udids,
            type: "system/reboot"
        }
    };
    
    console.log('发送重启设备请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
}

// 注销特定设备
function respringDevices(udids) {
    if (!isConnected) {
        logError('未连接到服务器');
        return;
    }
    
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSign(timestamp);
    
    const command = {
        ts: timestamp,
        sign: sign,
        type: "control/command",
        body: {
            devices: udids,
            type: "system/respring"
        }
    };
    
    console.log('发送注销设备请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
}

// 更新设备信息面板
function updateDeviceInfoPanel(udid) {
    if (!udid || !devices[udid]) {
        console.error('设备不存在:', udid);
        return;
    }
    
    const deviceInfo = devices[udid];
    const deviceSystem = deviceInfo.system || {};
    const deviceScript = deviceInfo.script || {};
    
    document.getElementById('info-device-name').textContent = deviceSystem.name || '未知';
    
    document.getElementById('info-device-udid').textContent = udid.substring(0, 16) + '...';
    
    document.getElementById('info-device-version').textContent = deviceSystem.version || '未知';
    
    document.getElementById('info-device-ip').textContent = deviceSystem.ip || '未知';
    
    const batteryLevel = deviceSystem.battery ? Math.round(deviceSystem.battery * 100) + '%' : '未知';
    document.getElementById('info-device-battery').textContent = batteryLevel;
    
    const scriptStatus = deviceScript.running ? '运行中' : '已停止';
    document.getElementById('info-device-script').textContent = scriptStatus;
}

// 查看文件内容
function viewFile(path) {
    if (!isConnected || !currentRemoteDevice) {
        console.error('无法查看文件，连接未建立或设备未选择');
        return;
    }
    
    console.log(`查看文件: ${path}`);
    
    // 显示文件查看器并设置标题
    const fileViewer = document.getElementById('file-viewer');
    if (!fileViewer) return;
    
    // 显示文件查看器
    fileViewer.classList.add('active');
    
    // 设置文件标题
    document.getElementById('file-viewer-title').textContent = `文件: ${path.split('/').pop()}`;
    
    // 显示加载中
    document.getElementById('file-content').textContent = '加载中...';
    
    // 启用下载按钮
    document.getElementById('download-file').disabled = false;
    
    // 保存当前查看的文件路径
    currentViewingFile = path;
    
    // 发送请求获取文件内容
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            devices: [currentRemoteDevice],
            type: "file/get",
            body: {
                path: path
            }
        }
    };
    
    console.log('发送获取文件内容请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
}

// 处理文件内容响应
function handleFileContent(message) {
    console.log('收到文件内容响应:', message);
    
    if (message.error && message.error !== '') {
        console.error('获取文件内容错误:', JSON.stringify(message.error));
        document.getElementById('file-content').textContent = `加载失败: ${JSON.stringify(message.error)}`;
        return;
    }
    
    const content = message.body;
    if (!content) {
        document.getElementById('file-content').textContent = '文件为空';
        return;
    }
    
    try {
        // 解码Base64内容
        const decodedContent = atob(content);
        document.getElementById('file-content').textContent = decodedContent;
    } catch (error) {
        console.error('解码文件内容错误:', error);
        document.getElementById('file-content').textContent = '文件内容无法显示';
    }
}

// 下载文件
function downloadFile(path, fileName) {
    if (!isConnected || !currentRemoteDevice) {
        console.error('无法下载文件，连接未建立或设备未选择');
        return;
    }
    
    console.log(`下载文件: ${path}`);
    
    // 禁用下载按钮，防止重复点击
    const downloadButton = document.getElementById('download-file');
    if (downloadButton) {
        downloadButton.disabled = true;
    }
    
    // 发送请求获取文件内容
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            devices: [currentRemoteDevice],
            type: "file/get",
            body: {
                path: path
            }
        }
    };
    
    console.log('发送获取文件内容请求(下载):', JSON.stringify(command));
    ws.send(JSON.stringify(command));
    
    // 保存当前下载的文件名
    currentDownloadFileName = fileName;
}

// 处理文件下载响应
function handleFileDownload(message) {
    console.log('收到文件下载响应:', message);
    
    // 恢复下载按钮状态
    const downloadButton = document.getElementById('download-file');
    if (downloadButton) {
        downloadButton.disabled = false;
    }
    
    if (message.error && message.error !== '') {
        console.error('下载文件错误:', JSON.stringify(message.error));
        alert(`下载失败: ${JSON.stringify(message.error)}`);
        return;
    }
    
    const content = message.body;
    if (!content) {
        alert('文件为空');
        return;
    }
    
    try {
        // 创建下载链接
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${content}`;
        link.download = currentDownloadFileName || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('下载文件错误:', error);
        alert('下载失败');
    }
}

// 删除文件
function deleteFile(path) {
    if (!isConnected || !currentRemoteDevice) {
        console.error('无法删除文件，连接未建立或设备未选择');
        return;
    }
    
    console.log(`删除文件: ${path}`);
    
    // 发送删除文件请求
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            devices: [currentRemoteDevice],
            type: "file/delete",
            body: {
                path: path
            }
        }
    };
    
    console.log('发送删除文件请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
}

// 处理文件删除响应
function handleFileDelete(message) {
    console.log('收到文件删除响应:', message);
    
    if (message.error && message.error !== '') {
        console.error('删除文件错误:', JSON.stringify(message.error));
        alert(`删除失败: ${JSON.stringify(message.error)}`);
        return;
    }
    
    console.log('文件删除成功');
    
    // 刷新当前目录
    loadFileList(currentBrowsingPath);
}

// 加载文件列表
function loadFileList(path) {
    console.log('加载文件列表:', path);
    
    if (!isConnected || !currentRemoteDevice) {
        console.error('未连接到设备或未选择远程控制设备');
        return;
    }
    
    // 保存当前浏览路径
    currentBrowsingPath = path;
    
    // 更新路径显示
    const pathDisplay = document.getElementById('current-path');
    if (pathDisplay) {
        pathDisplay.textContent = path;
        pathDisplay.value = path;
    }
    
    // 显示加载状态
    const fileListContainer = document.getElementById('file-browser-content');
    if (fileListContainer) {
        // 移除已有的加载提示(如果有)
        const oldIndicators = fileListContainer.querySelectorAll('.loading-indicator');
        oldIndicators.forEach(indicator => indicator.remove());
        
        // 创建新的加载提示
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'loading-indicator';
        loadingIndicator.textContent = '正在加载文件列表...';
        
        // 确保加载提示添加为file-browser-content的直接子元素
        fileListContainer.insertBefore(loadingIndicator, fileListContainer.firstChild);
    }
    
    // 构建并发送请求
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            devices: [currentRemoteDevice],
            type: "file/list",
            body: {
                path: path
            }
        }
    };
    
    console.log('发送文件列表请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
    
    // 日志记录
    logInfo(`正在加载路径: ${path}`);
}

// 处理拖放到文件浏览器的项目（针对当前远程控制设备）
async function handleDroppedItemsForFileBrowser(items) {
    if (!isConnected || !currentRemoteDevice) {
        logError('无法上传文件，未连接或未选择当前远程设备');
        return;
    }

    if (!currentBrowsingPath) {
        logError('无法确定当前目录路径');
        return;
    }

    const entries = [];
    for (let i = 0; i<items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry) {
                entries.push(entry);
            }
        }
    }
    
    if (entries.length === 0) {
        return;
    }
    
    // 处理所有条目，直接上传到当前目录
    for (const entry of entries) {
        try {
            await processEntryForCurrentRemoteDevice(entry, currentBrowsingPath);
        } catch (error) {
            logError(`处理上传项目 ${entry.name} 失败: ${error}`);
            console.error('处理上传项目失败:', error);
        }
    }
}

// 处理文件上传到当前路径（针对当前远程控制设备）
function handleFilesForFileBrowser(files) {
    if (!isConnected || !currentRemoteDevice) {
        logError('无法上传文件，未连接或未选择当前远程设备');
        return;
    }

    if (!currentBrowsingPath) {
        logError('无法确定当前目录路径');
        return;
    }
    
    // 确保当前路径以/结尾
    let targetPath = currentBrowsingPath;
    if (!targetPath.endsWith('/')) {
        targetPath += '/';
    }
    
    // 上传每个文件到当前远程控制设备
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = targetPath + file.name;
        prepareAndUploadFileToCurrentRemoteDevice(file, filePath)
            .catch(error => {
                logError(`上传文件 ${file.name} 失败: ${error}`);
                console.error('上传文件失败:', error);
            });
    }
}

// 处理文件系统条目上传（针对当前远程控制设备）
async function processEntryForCurrentRemoteDevice(entry, basePath) {
    if (entry.isFile) {
        // 获取文件并上传到当前远程控制设备
        try {
            const file = await getFileFromEntryPromise(entry);
            const filePath = basePath + file.name;
            await prepareAndUploadFileToCurrentRemoteDevice(file, filePath);
        } catch (error) {
            logError(`上传文件 ${entry.name} 失败: ${error}`);
            console.error('上传文件失败:', error);
        }
    } else if (entry.isDirectory) {
        // 创建目录在当前远程控制设备上
        try {
            const dirPath = basePath + entry.name + '/';
            await createDirectoryOnCurrentRemoteDevice(dirPath);
            
            // 读取目录内容
            const entries = await readAllDirectoryEntriesPromise(entry);
            for (const childEntry of entries) {
                await processEntryForCurrentRemoteDevice(childEntry, dirPath);
            }
        } catch (error) {
            logError(`处理目录 ${entry.name} 失败: ${error}`);
            console.error('处理目录失败:', error);
        }
    }
}

// 准备并上传文件到当前远程控制设备
function prepareAndUploadFileToCurrentRemoteDevice(file, path) {
    return new Promise(async (resolve, reject) => {
        if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
            reject('WebSocket 未连接');
            return;
        }
        
        if (!currentRemoteDevice) {
            reject('未选择当前远程控制设备');
            return;
        }
        
        // 首先确保文件目录存在
        const lastSlashIndex = path.lastIndexOf('/');
        if (lastSlashIndex > 0) {
            const dirPath = path.substring(0, lastSlashIndex + 1);
            
            try {
                // 先创建目录，然后再上传文件
                await createDirectoryOnCurrentRemoteDevice(dirPath);
                console.log(`确保目录存在: ${dirPath}`);
                
                // 读取并上传文件内容
                readAndUploadFileToCurrentRemoteDevice(file, path, resolve, reject);
            } catch (error) {
                console.log(`创建目录出错 (可能已存在): ${error}`);
                // 即使目录创建失败，也尝试上传文件（因为目录可能已经存在）
                readAndUploadFileToCurrentRemoteDevice(file, path, resolve, reject);
            }
        } else {
            // 没有目录部分，直接上传文件
            readAndUploadFileToCurrentRemoteDevice(file, path, resolve, reject);
        }
    });
}

// 从文件条目获取文件并返回Promise
function getFileFromEntryPromise(entry) {
    return new Promise((resolve) => {
        entry.file(resolve);
    });
}

// 读取目录中的所有条目并返回Promise
function readAllDirectoryEntriesPromise(dirEntry) {
    return new Promise((resolve) => {
        const dirReader = dirEntry.createReader();
        const entries = [];
        
        function readEntries() {
            dirReader.readEntries((results) => {
                if (results.length) {
                    entries.push(...results);
                    readEntries();
                } else {
                    resolve(entries);
                }
            }, () => resolve(entries));
        }
        
        readEntries();
    });
}

// 读取并上传文件内容到当前远程控制设备
function readAndUploadFileToCurrentRemoteDevice(file, path, resolve, reject) {
    // 读取文件内容
    const reader = new FileReader();
    
    reader.onload = function(e) {
        // 获取Base64编码的文件内容
        const base64Data = e.target.result.split(',')[1];
        
        // 上传文件
        uploadFileToCurrentRemoteDevice(path, base64Data)
            .then(() => {
                console.log('文件上传成功');
                logSuccess(`文件 ${file.name} 上传成功`);
                resolve();
            })
            .catch(err => {
                console.error('文件上传失败:', err);
                logError(`文件上传失败: ${err}`);
                reject(err);
            });
    };
    
    reader.onerror = function(error) {
        const errorMsg = `读取文件 ${file.name} 失败`;
        logError(errorMsg);
        reject(errorMsg);
    };
    
    // 以Base64格式读取文件
    reader.readAsDataURL(file);
}

// 在选中的设备上创建目录
function createDirectoryOnSelectedDevices(path) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !ws) {
            console.log('创建目录失败: WebSocket未连接');
            reject('WebSocket 未连接');
            return;
        }
        
        // 获取选中的设备列表并输出调试信息
        const selectedDevicesList = Array.from(selectedDevices);
        console.log('当前选中的设备列表:', selectedDevicesList);
        
        if (selectedDevicesList.length === 0) {
            console.log('创建目录失败: 未选择任何设备');
            reject('未选择任何设备');
            return;
        }
        
        const timestamp = Math.floor(Date.now() / 1000);
        const command = {
            ts: timestamp,
            sign: generateSign(timestamp),
            type: "control/command",
            body: {
                devices: selectedDevicesList,
                type: "file/put",
                body: {
                    path: path,
                    directory: true
                }
            }
        };
        
        console.log('准备发送创建目录命令:', JSON.stringify(command));
        
        try {
            ws.send(JSON.stringify(command));
            
            // 监听目录创建响应
            const messageHandler = function(event) {
                try {
                    const message = JSON.parse(event.data);
                    console.log('收到WebSocket消息:', message);
                    
                    // 添加更详细的条件检查日志
                    if (message.type === 'file/put' && message.body && message.body.directory === true) {
                        console.log('收到目录创建响应');
                        ws.removeEventListener('message', messageHandler);
                        
                        if (message.error && message.error !== '') {
                            console.log('创建目录失败:', JSON.stringify(message.error));
                            reject(JSON.stringify(message.error));
                        } else {
                            console.log('创建目录成功');
                            resolve();
                        }
                    }
                } catch (err) {
                    console.error('处理WebSocket消息出错:', err);
                }
            };
            
            ws.addEventListener('message', messageHandler);
            
            // 设置超时
            setTimeout(() => {
                ws.removeEventListener('message', messageHandler);
                console.log('创建目录超时');
                resolve(); // 即使超时也尝试继续执行，以防服务器已经创建但响应丢失
            }, 5000); // 5秒超时
        } catch (error) {
            console.error('发送创建目录命令失败:', error);
            reject(error.toString());
        }
    });
}

// 处理拖放到文件浏览器的文件项
function handleDroppedItemsForFileBrowser(items) {
    if (!isConnected || !currentRemoteDevice) {
        alert('未连接到设备或未选择设备');
        return;
    }
    
    if (!currentBrowsingPath) {
        alert('请先浏览到目标目录');
        return;
    }
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = '准备上传...';
    }
    
    const entries = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry) {
                entries.push(entry);
            }
        }
    }
    
    if (entries.length === 0) {
        alert('未找到有效文件');
        if (fileBrowserUploadStatus) {
            fileBrowserUploadStatus.textContent = '';
        }
        return;
    }
    
    // 处理拖放的文件和文件夹
    processEntries(entries, currentBrowsingPath);
}

// 处理文件浏览器中选择的文件
function handleFilesForFileBrowser(files) {
    if (!isConnected || !currentRemoteDevice) {
        alert('未连接到设备或未选择设备');
        return;
    }
    
    if (!currentBrowsingPath) {
        alert('请先浏览到目标目录');
        return;
    }
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = '准备上传...';
    }
    
    if (files.length === 0) {
        if (fileBrowserUploadStatus) {
            fileBrowserUploadStatus.textContent = '';
        }
        return;
    }
    
    // 处理选择的文件
    processFiles(files, currentBrowsingPath);
}

// 处理文件系统条目（文件和目录）
function processEntries(entries, basePath) {
    console.log('处理条目数:', entries.length);
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = `处理 ${entries.length} 个项目...`;
    }
    
    let pendingEntries = entries.length;
    
    const processEntry = function(entry, path) {
        console.log('正在处理条目:', entry.name, '路径:', path);
        
        if (entry.isFile) {
            // 处理文件
            entry.file(function(file) {
                processFile(file, path).then(() => {
                    pendingEntries--;
                    if (pendingEntries === 0) {
                        console.log('所有条目处理完成');
                        if (fileBrowserUploadStatus) {
                            fileBrowserUploadStatus.textContent = '所有文件已上传!';
                            setTimeout(() => {
                                fileBrowserUploadStatus.textContent = '';
                            }, 3000);
                        }
                    }
                }).catch(err => {
                    console.error('处理文件失败:', err);
                    pendingEntries--;
                });
            }, function(error) {
                console.error('读取文件出错:', error);
                pendingEntries--;
            });
        } else if (entry.isDirectory) {
            // 处理目录
            let dirPath = path + (path.endsWith('/') ? '' : '/') + entry.name;
            
            // 首先创建目录
            createDirectoryOnCurrentRemoteDevice(dirPath)
                .then(() => {
                    console.log('目录创建成功:', dirPath);
                    
                    // 然后读取目录内容
                    const dirReader = entry.createReader();
                    readEntries(dirReader, dirPath);
                })
                .catch(err => {
                    console.log(`创建目录出错 (可能已存在): ${err}`);
                    // 即使目录创建失败，也尝试上传文件（因为目录可能已经存在）
                    readEntries(dirReader, dirPath);
                });
        }
    };
    
    const readEntries = function(dirReader, dirPath) {
        dirReader.readEntries(function(results) {
            if (results.length) {
                for (let i = 0; i < results.length; i++) {
                    processEntry(results[i], dirPath);
                    pendingEntries++;
                }
                readEntries(dirReader, dirPath); // 继续读取，直到所有条目都被读取
            }
            pendingEntries--;
        }, function(error) {
            console.error('读取目录出错:', error);
            pendingEntries--;
        });
    };
    
    // 处理所有顶层条目
    for (let i = 0; i < entries.length; i++) {
        processEntry(entries[i], basePath);
    }
}

// 处理选择的文件
function processFiles(files, basePath) {
    console.log('处理文件数:', files.length);
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = `处理 ${files.length} 个文件...`;
    }
    
    let completedFiles = 0;
    const totalFiles = files.length;
    
    const processNextFile = function(index) {
        if (index >= totalFiles) {
            console.log('所有文件处理完成');
            if (fileBrowserUploadStatus) {
                fileBrowserUploadStatus.textContent = '所有文件已上传!';
                setTimeout(() => {
                    fileBrowserUploadStatus.textContent = '';
                }, 3000);
            }
            return;
        }
        
        const file = files[index];
        processFile(file, basePath)
            .then(() => {
                completedFiles++;
                if (fileBrowserUploadStatus) {
                    fileBrowserUploadStatus.textContent = `已上传 ${completedFiles}/${totalFiles}`;
                }
                processNextFile(index + 1);
            })
            .catch(err => {
                console.error('处理文件失败:', err);
                completedFiles++;
                processNextFile(index + 1);
            });
    };
    
    // 开始处理第一个文件
    processNextFile(0);
}

// 处理单个文件
function processFile(file, basePath) {
    return new Promise((resolve, reject) => {
        const targetPath = basePath + (basePath.endsWith('/') ? '' : '/') + file.name;
        console.log('处理文件:', file.name, '目标路径:', targetPath);
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const fileData = e.target.result.split(',')[1]; // 获取Base64编码的文件数据
            
            // 上传文件
            uploadFileToCurrentRemoteDevice(targetPath, fileData)
                .then(() => {
                    console.log('文件上传成功:', targetPath);
                    resolve();
                })
                .catch(err => {
                    console.error('文件上传失败:', err);
                    reject(err);
                });
        };
        
        reader.onerror = function(error) {
            console.error('读取文件出错:', error);
            reject(error);
        };
        
        reader.readAsDataURL(file);
    });
}

// 处理文件上传响应（上传到当前远程控制设备）
function handleFilePutForCurrentRemoteDevice(message) {
    console.log('收到当前远程控制设备的文件上传响应:', message);
    
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    
    if (message.error && message.error !== '') {
        console.error('文件上传错误:', JSON.stringify(message.error));
        logError(`文件上传失败: ${JSON.stringify(message.error)}`);
        if (fileBrowserUploadStatus) {
            fileBrowserUploadStatus.textContent = `上传失败: ${JSON.stringify(message.error)}`;
            fileBrowserUploadStatus.classList.add('error');
            
            // 3秒后清除状态
            setTimeout(() => {
                fileBrowserUploadStatus.textContent = '';
                fileBrowserUploadStatus.classList.remove('error');
            }, 3000);
        }
        return;
    }
    
    console.log('文件上传成功');
    logSuccess('文件上传成功');
    
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = '上传成功!';
        fileBrowserUploadStatus.classList.add('success');
        
        // 3秒后清除状态
        setTimeout(() => {
            fileBrowserUploadStatus.textContent = '';
            fileBrowserUploadStatus.classList.remove('success');
        }, 3000);
    }
    
    // 刷新当前浏览的目录
    if (currentBrowsingPath) {
        loadFileList(currentBrowsingPath);
    }
}

// 初始化远程控制事件监听器
function initRemoteControlListeners() {
    console.log('初始化远程控制事件监听器');
    
    // 关闭远程控制窗口按钮
    const closeModal = document.querySelector('#remote-control-modal .modal-header .close');
    if (closeModal) {
        closeModal.addEventListener('click', function() {
            closeRemoteControl();
        });
    }

    const powerKeyBtn = document.getElementById('press-power-key');
    if (powerKeyBtn) {
        powerKeyBtn.addEventListener('click', function() {
            sendKeyCommandToRemoteCurrentDevice('key/press', 'lock');
        });
    }

    const homeKeyBtn = document.getElementById('press-home-key');
    if (homeKeyBtn) {
        homeKeyBtn.addEventListener('click', function() {
            sendKeyCommandToRemoteCurrentDevice('key/press', 'home');
        });
    }
    
    // 开始捕获按钮
    const startCaptureBtn = document.getElementById('start-screen-capture');
    if (startCaptureBtn) {
        startCaptureBtn.addEventListener('click', function() {
            startScreenCapture();
        });
    }
    
    // 停止捕获按钮
    const stopCaptureBtn = document.getElementById('stop-screen-capture');
    if (stopCaptureBtn) {
        stopCaptureBtn.addEventListener('click', function() {
            stopScreenCapture();
        });
    }
    
    // 显示文件浏览器按钮
    const showFileBrowserBtn = document.getElementById('show-file-browser');
    if (showFileBrowserBtn) {
        showFileBrowserBtn.addEventListener('click', function() {
            toggleFileBrowser(true);
        });
    }
    
    console.log('远程控制事件监听器初始化完成');
}

// 切换文件浏览器的显示状态
function toggleFileBrowser(show) {
    console.log('切换文件浏览器显示状态:', show);
    
    const fileBrowser = document.getElementById('file-browser');
    if (!fileBrowser) return;
    
    if (show) {
        fileBrowser.classList.add('active');
        fileBrowserActive = true;
        
        // 加载根目录
        if (!currentBrowsingPath) {
            loadFileList('/lua/scripts/');
        }
    } else {
        fileBrowser.classList.remove('active');
        fileBrowserActive = false;
    }
}

// 处理文件上传响应（上传到选中设备）
function handleFilePutToSelectedDevices(message) {
    console.log('收到文件上传响应:', message);
    
    if (message.error && message.error !== '') {
        logError(`上传失败: ${JSON.stringify(message.error)}`);
    } else {
        if (message.body && message.body.directory) {
            logSuccess('目录创建成功');
        } else {
            logSuccess('文件上传成功');
        }
    }
}

// 处理拖放到文件浏览器的文件项
function handleDroppedItemsForFileBrowser(items) {
    if (!isConnected || !currentRemoteDevice) {
        alert('未连接到设备或未选择设备');
        return;
    }
    
    if (!currentBrowsingPath) {
        alert('请先浏览到目标目录');
        return;
    }
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = '准备上传...';
    }
    
    const entries = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry) {
                entries.push(entry);
            }
        }
    }
    
    if (entries.length === 0) {
        alert('未找到有效文件');
        if (fileBrowserUploadStatus) {
            fileBrowserUploadStatus.textContent = '';
        }
        return;
    }
    
    // 处理拖放的文件和文件夹
    processEntries(entries, currentBrowsingPath);
}

// 处理文件浏览器中选择的文件
function handleFilesForFileBrowser(files) {
    if (!isConnected || !currentRemoteDevice) {
        alert('未连接到设备或未选择设备');
        return;
    }
    
    if (!currentBrowsingPath) {
        alert('请先浏览到目标目录');
        return;
    }
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = '准备上传...';
    }
    
    if (files.length === 0) {
        if (fileBrowserUploadStatus) {
            fileBrowserUploadStatus.textContent = '';
        }
        return;
    }
    
    // 处理选择的文件
    processFiles(files, currentBrowsingPath);
}

// 处理文件系统条目（文件和目录）
function processEntries(entries, basePath) {
    console.log('处理条目数:', entries.length);
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = `处理 ${entries.length} 个项目...`;
    }
    
    let pendingEntries = entries.length;
    
    const processEntry = function(entry, path) {
        console.log('正在处理条目:', entry.name, '路径:', path);
        
        if (entry.isFile) {
            // 处理文件
            entry.file(function(file) {
                processFile(file, path).then(() => {
                    pendingEntries--;
                    if (pendingEntries === 0) {
                        console.log('所有条目处理完成');
                        if (fileBrowserUploadStatus) {
                            fileBrowserUploadStatus.textContent = '所有文件已上传!';
                            setTimeout(() => {
                                fileBrowserUploadStatus.textContent = '';
                            }, 3000);
                        }
                    }
                }).catch(err => {
                    console.error('处理文件失败:', err);
                    pendingEntries--;
                });
            }, function(error) {
                console.error('读取文件出错:', error);
                pendingEntries--;
            });
        } else if (entry.isDirectory) {
            // 处理目录
            let dirPath = path + (path.endsWith('/') ? '' : '/') + entry.name;
            
            // 首先创建目录
            createDirectoryOnCurrentRemoteDevice(dirPath)
                .then(() => {
                    console.log('目录创建成功:', dirPath);
                    
                    // 然后读取目录内容
                    const dirReader = entry.createReader();
                    readEntries(dirReader, dirPath);
                })
                .catch(err => {
                    console.log(`创建目录出错 (可能已存在): ${err}`);
                    // 即使目录创建失败，也尝试上传文件（因为目录可能已经存在）
                    readEntries(dirReader, dirPath);
                });
        }
    };
    
    const readEntries = function(dirReader, dirPath) {
        dirReader.readEntries(function(results) {
            if (results.length) {
                for (let i = 0; i < results.length; i++) {
                    processEntry(results[i], dirPath);
                    pendingEntries++;
                }
                readEntries(dirReader, dirPath); // 继续读取，直到所有条目都被读取
            }
            pendingEntries--;
        }, function(error) {
            console.error('读取目录出错:', error);
            pendingEntries--;
        });
    };
    
    // 处理所有顶层条目
    for (let i = 0; i < entries.length; i++) {
        processEntry(entries[i], basePath);
    }
}

// 处理选择的文件
function processFiles(files, basePath) {
    console.log('处理文件数:', files.length);
    
    // 显示上传状态
    const fileBrowserUploadStatus = document.getElementById('file-browser-upload-status');
    if (fileBrowserUploadStatus) {
        fileBrowserUploadStatus.textContent = `处理 ${files.length} 个文件...`;
    }
    
    let completedFiles = 0;
    const totalFiles = files.length;
    
    const processNextFile = function(index) {
        if (index >= totalFiles) {
            console.log('所有文件处理完成');
            if (fileBrowserUploadStatus) {
                fileBrowserUploadStatus.textContent = '所有文件已上传!';
                setTimeout(() => {
                    fileBrowserUploadStatus.textContent = '';
                }, 3000);
            }
            return;
        }
        
        const file = files[index];
        processFile(file, basePath)
            .then(() => {
                completedFiles++;
                if (fileBrowserUploadStatus) {
                    fileBrowserUploadStatus.textContent = `已上传 ${completedFiles}/${totalFiles}`;
                }
                processNextFile(index + 1);
            })
            .catch(err => {
                console.error('处理文件失败:', err);
                completedFiles++;
                processNextFile(index + 1);
            });
    };
    
    // 开始处理第一个文件
    processNextFile(0);
}

// 处理单个文件
function processFile(file, basePath) {
    return new Promise((resolve, reject) => {
        const targetPath = basePath + (basePath.endsWith('/') ? '' : '/') + file.name;
        console.log('处理文件:', file.name, '目标路径:', targetPath);
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const fileData = e.target.result.split(',')[1]; // 获取Base64编码的文件数据
            
            // 上传文件
            uploadFileToCurrentRemoteDevice(targetPath, fileData)
                .then(() => {
                    console.log('文件上传成功:', targetPath);
                    resolve();
                })
                .catch(err => {
                    console.error('文件上传失败:', err);
                    reject(err);
                });
        };
        
        reader.onerror = function(error) {
            console.error('读取文件出错:', error);
            reject(error);
        };
        
        reader.readAsDataURL(file);
    });
}

// 上传文件到当前远程控制设备
function uploadFileToCurrentRemoteDevice(filePath, fileData) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !ws) {
            reject('WebSocket 未连接');
            return;
        }
        
        if (!currentRemoteDevice) {
            reject('未选择当前远程控制设备');
            return;
        }
        
        const timestamp = Math.floor(Date.now() / 1000);
        const sign = generateSign(timestamp);
        
        const command = {
            ts: timestamp,
            sign: sign,
            type: "control/command",
            body: {
                devices: [currentRemoteDevice], // 注意这里只发送到当前远程控制的设备
                type: "file/put",
                body: {
                    path: filePath,
                    data: fileData
                }
            }
        };
        
        console.log(`发送文件上传命令到当前远程控制设备 ${currentRemoteDevice.substring(0, 8)}...，路径: ${filePath}`);
        
        try {
            ws.send(JSON.stringify(command));
            resolve(); // 我们不再等待响应，因为会通过handleFilePutForCurrentRemoteDevice来处理
        } catch (error) {
            console.error('发送上传命令失败:', error);
            reject(error.toString());
        }
    });
}

// 在当前远程控制设备上创建目录
function createDirectoryOnCurrentRemoteDevice(dirPath) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !ws) {
            console.log('创建目录失败: WebSocket未连接');
            reject('WebSocket 未连接');
            return;
        }
        
        if (!currentRemoteDevice) {
            console.log('创建目录失败: 未选择当前远程控制设备');
            reject('未选择当前远程控制设备');
            return;
        }
        
        const timestamp = Math.floor(Date.now() / 1000);
        const command = {
            ts: timestamp,
            sign: generateSign(timestamp),
            type: "control/command",
            body: {
                devices: [currentRemoteDevice], // 注意这里只发送到当前远程控制的设备
                type: "file/put",
                body: {
                    path: dirPath,
                    directory: true
                }
            }
        };
        
        console.log('准备发送创建目录命令:', JSON.stringify(command));
        
        try {
            ws.send(JSON.stringify(command));
            console.log(`发送创建目录命令到当前远程控制设备 ${currentRemoteDevice.substring(0, 8)}...，路径: ${dirPath}`);
            resolve(); // 我们不再等待响应，因为会通过handleDirectoryCreate来处理
        } catch (error) {
            console.error('发送创建目录命令失败:', error);
            reject(error.toString());
        }
    });
}

// 初始化脚本控制事件监听器
function initScriptControlListeners() {
    // 获取元素
    const runScriptBtn = document.getElementById('run-script-btn');
    const stopScriptBtn = document.getElementById('stop-script-btn');
    const scriptPathInput = document.getElementById('script-path');
    
    // 添加运行脚本按钮事件
    if (runScriptBtn) {
        runScriptBtn.addEventListener('click', function() {
            if (!isConnected) {
                logError('请先连接到服务器');
                return;
            }
            
            if (selectedDevices.size === 0) {
                logError('请先选择至少一个设备');
                return;
            }
            
            const scriptPath = scriptPathInput.value.trim();
            if (!scriptPath) {
                logError('请输入脚本名称');
                return;
            }
            
            // 运行脚本
            runDevicesScript(Array.from(selectedDevices), scriptPath);
        });
    }
    
    // 添加停止脚本按钮事件
    if (stopScriptBtn) {
        stopScriptBtn.addEventListener('click', function() {
            if (!isConnected) {
                logError('请先连接到服务器');
                return;
            }
            
            if (selectedDevices.size === 0) {
                logError('请先选择至少一个设备');
                return;
            }
            
            // 停止脚本
            stopDevicesScript(Array.from(selectedDevices));
        });
    }

    // 添加重启设备按钮事件
    if (restartDeviceBtn) {
        restartDeviceBtn.addEventListener('click', function() {
            if (!isConnected) {
                logError('请先连接到服务器');
                return;
            }
            
            if (selectedDevices.size === 0) {
                logError('请先选择至少一个设备');
                return;
            }
            
            // 重启设备
            restartDevices(Array.from(selectedDevices));
        });
    }

    // 添加注销设备按钮事件
    if (respringDeviceBtn) {
        respringDeviceBtn.addEventListener('click', function() {
            if (!isConnected) {
                logError('请先连接到服务器');
                return;
            }
            
            if (selectedDevices.size === 0) {
                logError('请先选择至少一个设备');
                return;
            }
            
            // 注销设备
            respringDevices(Array.from(selectedDevices));
        });
    }
    
    // 输入框事件 - 更新按钮状态
    if (scriptPathInput) {
        scriptPathInput.addEventListener('input', function() {
            const hasValue = this.value.trim() !== '';
            const hasConnection = isConnected;
            const hasSelectedDevices = selectedDevices.size > 0;
            
            if (runScriptBtn) {
                runScriptBtn.disabled = !hasValue || !hasConnection || !hasSelectedDevices;
            }
            
            if (stopScriptBtn) {
                stopScriptBtn.disabled = !hasConnection || !hasSelectedDevices;
            }
        });
    }
    
    // 连接状态变化时更新按钮状态
    document.addEventListener('connection-state-changed', function() {
        if (scriptPathInput) {
            const event = new Event('input');
            scriptPathInput.dispatchEvent(event);
        }
    });
    
    // 设备选择变化时更新按钮状态
    document.addEventListener('devices-selection-changed', function() {
        if (scriptPathInput) {
            const event = new Event('input');
            scriptPathInput.dispatchEvent(event);
        }
    });
}

// 处理脚本启动响应
function handleScriptRun(message) {
    console.log('收到脚本启动响应:', message);
    
    if (message.error && message.error !== '') {
        logError(`启动脚本失败: ${JSON.stringify(message.error)}`);
    } else {
        const scriptName = message.body && message.body.name ? message.body.name : '未知脚本';
        logSuccess(`脚本 ${scriptName} 启动成功`);
    }
}

// 处理脚本停止响应
function handleScriptStop(message) {
    console.log('收到脚本停止响应:', message);
    
    if (message.error && message.error !== '') {
        logError(`停止脚本失败: ${JSON.stringify(message.error)}`);
    } else {
        logSuccess('脚本已停止');
    }
}

// 处理系统重启响应
function handleSystemRestart(message) {
    console.log('收到系统重启响应:', message);
    
    if (message.error && message.error !== '') {
        logError(`重启系统失败: ${JSON.stringify(message.error)}`);
    } else {
        logSuccess('系统已重启');
    }
}

// 处理系统重启响应
function handleSystemRespring(message) {
    console.log('收到系统重启响应:', message);
    
    if (message.error && message.error !== '') {
        logError(`重启系统失败: ${JSON.stringify(message.error)}`);
    } else {
        logSuccess('系统已重启');
    }
}

function handleDeviceDisconnect(message) {
    console.log('收到设备断开响应:', message);
    
    if (message.error && message.error !== '') {
        logError(`设备断开失败: ${JSON.stringify(message.error)}`);
    } else {
        const disconnectedDeviceId = message.body;
        logSuccess(`设备 ${disconnectedDeviceId} 已断开`);
        
        // 从设备列表中删除断开的设备
        if (disconnectedDeviceId && devices[disconnectedDeviceId]) {
            delete devices[disconnectedDeviceId];
            
            // 如果设备在选中列表中，也移除它
            if (selectedDevices.has(disconnectedDeviceId)) {
                selectedDevices.delete(disconnectedDeviceId);
            }
            
            // 更新UI
            updateDevicesList();
        }
    }
}

// 初始化文件浏览器事件监听器
function initFileBrowserListeners() {
    // 关闭文件浏览器按钮
    const closeFileBrowserBtn = document.getElementById('close-file-browser');
    if (closeFileBrowserBtn) {
        closeFileBrowserBtn.addEventListener('click', function() {
            toggleFileBrowser(false);
        });
    }
    
    // 关闭文件查看器按钮
    const closeFileViewerBtn = document.getElementById('close-file-viewer');
    if (closeFileViewerBtn) {
        closeFileViewerBtn.addEventListener('click', function() {
            const fileViewer = document.getElementById('file-viewer');
            if (fileViewer) {
                fileViewer.classList.remove('active');
            }
        });
    }
    
    // 下载文件按钮
    const downloadFileBtn = document.getElementById('download-file');
    if (downloadFileBtn) {
        downloadFileBtn.addEventListener('click', function() {
            if (currentViewingFile) {
                downloadFile(currentViewingFile, currentViewingFile.split('/').pop());
            }
        });
    }
    
    // 转到路径按钮
    const goPathBtn = document.getElementById('go-path');
    if (goPathBtn) {
        goPathBtn.addEventListener('click', function() {
            const pathInput = document.getElementById('current-path');
            if (pathInput && pathInput.value.trim()) {
                loadFileList(pathInput.value.trim());
            }
        });
    }
    
    // 上级目录按钮
    const goParentBtn = document.getElementById('go-parent');
    if (goParentBtn) {
        goParentBtn.addEventListener('click', function() {
            if (currentBrowsingPath && currentBrowsingPath !== '/') {
                loadFileList(getParentPath(currentBrowsingPath));
            }
        });
    }
    
    // 路径输入框回车键事件
    const pathInput = document.getElementById('current-path');
    if (pathInput) {
        pathInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                loadFileList(pathInput.value.trim());
            }
        });
    }
    
    // 刷新文件列表按钮
    const refreshFilesBtn = document.getElementById('refresh-files');
    if (refreshFilesBtn) {
        refreshFilesBtn.addEventListener('click', function() {
            loadFileList(currentBrowsingPath);
        });
    }
    
    // 新建目录按钮
    const createDirBtn = document.getElementById('create-dir-btn');
    if (createDirBtn) {
        createDirBtn.addEventListener('click', function() {
            createDirectory();
        });
    }
    
    // 初始化文件浏览器拖放上传功能
    initFileBrowserDragDrop();
    
    console.log('文件浏览器事件监听器初始化完成');
}

// 初始化文件浏览器拖放上传功能
function initFileBrowserDragDrop() {
    const fileBrowserDropzone = document.getElementById('file-browser-dropzone');
    const uploadOverlay = document.getElementById('upload-overlay');
    const fileBrowserFileInput = document.getElementById('file-browser-file-input'); 
    const uploadFileBtn = document.getElementById('upload-file-btn');
    
    if (!fileBrowserDropzone || !uploadOverlay || !fileBrowserFileInput) {
        console.error('未找到拖放区域或上传覆盖层或文件输入框', {fileBrowserDropzone, uploadOverlay, fileInput: fileBrowserFileInput});
        return;
    }
    
    // 拖动进入时显示叠加层
    fileBrowserDropzone.addEventListener('dragenter', function(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadOverlay.classList.add('active');
    });
    
    fileBrowserDropzone.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
    });
    
    fileBrowserDropzone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // 只有当离开到父元素外才隐藏叠加层
        const rect = fileBrowserDropzone.getBoundingClientRect();
        if (
            e.clientX < rect.left || 
            e.clientX >= rect.right || 
            e.clientY < rect.top || 
            e.clientY >= rect.bottom
        ) {
            uploadOverlay.classList.remove('active');
        }
    });
    
    fileBrowserDropzone.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadOverlay.classList.remove('active');
        
        if (!isConnected || !currentRemoteDevice) {
            alert('未连接到设备或未选择设备');
            return;
        }
        
        // 获取拖放的文件
        const items = e.dataTransfer.items;
        if (items) {
            handleDroppedItemsForFileBrowser(items);
        } else {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFilesForFileBrowser(files);
            }
        }
    });
    
    // 点击上传覆盖层打开文件选择对话框
    uploadOverlay.addEventListener('click', function(e) {
        console.log('点击了拖放区域');
        if (fileBrowserFileInput) {
            fileBrowserFileInput.click();
        }
    });
    
    // 文件上传按钮点击事件
    if (uploadFileBtn && fileBrowserFileInput) {
        uploadFileBtn.addEventListener('click', function() {
            console.log('点击了上传文件按钮');
            fileBrowserFileInput.click();
        });
        
        fileBrowserFileInput.addEventListener('change', function(e) {
            console.log('选择了文件:', e.target.files.length);
            const files = e.target.files;
            if (files.length > 0) {
                handleFilesForFileBrowser(files);
            }
            // 重置file input，以便能够重复选择相同的文件
            fileBrowserFileInput.value = '';
        });
    } else {
        console.error('未找到上传文件按钮或文件输入框', {uploadFileBtn, fileInput: fileBrowserFileInput});
    }
}

// 创建新目录
function createDirectory() {
    if (!isConnected || !currentRemoteDevice) {
        console.error('无法创建目录，连接未建立或设备未选择');
        return;
    }
    
    const createDirDialog = document.getElementById('create-dir-dialog');
    const newDirNameInput = document.getElementById('new-dir-name');
    
    // 显示创建目录对话框
    if (createDirDialog && newDirNameInput) {
        newDirNameInput.value = '';
        createDirDialog.classList.add('active');
        
        // 聚焦输入框
        setTimeout(() => newDirNameInput.focus(), 100);
        
        // 添加确认创建事件
        const confirmBtn = document.getElementById('confirm-create-dir');
        if (confirmBtn) {
            const confirmHandler = function() {
                const dirName = newDirNameInput.value.trim();
                if (!dirName) {
                    alert('请输入目录名称');
                    return;
                }
                
                // 构建目录路径
                let newDirPath = currentBrowsingPath || '/';
                if (!newDirPath.endsWith('/')) {
                    newDirPath += '/';
                }
                newDirPath += dirName;
                
                // 发送创建目录请求
                createDirectoryRequest(newDirPath);
                
                // 隐藏对话框
                createDirDialog.classList.remove('active');
                
                // 移除事件监听器，防止重复绑定
                confirmBtn.removeEventListener('click', confirmHandler);
            };
            
            // 先移除可能已存在的事件监听器
            confirmBtn.removeEventListener('click', confirmHandler);
            // 添加新的事件监听器
            confirmBtn.addEventListener('click', confirmHandler);
        }
        
        // 添加取消事件
        const cancelBtn = document.getElementById('cancel-create-dir');
        if (cancelBtn) {
            const cancelHandler = function() {
                createDirDialog.classList.remove('active');
                cancelBtn.removeEventListener('click', cancelHandler);
            };
            
            // 先移除可能已存在的事件监听器
            cancelBtn.removeEventListener('click', cancelHandler);
            // 添加新的事件监听器
            cancelBtn.addEventListener('click', cancelHandler);
        }
    }
}

// 发送创建目录请求
function createDirectoryRequest(path) {
    const timestamp = Math.floor(Date.now() / 1000);
    const command = {
        ts: timestamp,
        sign: generateSign(timestamp),
        type: "control/command",
        body: {
            devices: [currentRemoteDevice],
            type: "file/put",
            body: {
                path: path,
                directory: true
            }
        }
    };
    
    console.log('发送创建目录请求:', JSON.stringify(command));
    ws.send(JSON.stringify(command));
    
    // 显示加载中状态
    logInfo(`正在创建目录: ${path}`);
}

// 处理创建目录响应
function handleDirectoryCreate(message) {
    console.log('收到创建目录响应:', message);
    
    if (message.error && message.error !== '') {
        console.error('创建目录错误:', JSON.stringify(message.error));
        alert(`创建目录失败: ${JSON.stringify(message.error)}`);
        return;
    }
    
    console.log('目录创建成功');
    logSuccess('目录创建成功');
    
    // 刷新当前目录
    loadFileList(currentBrowsingPath);
}
