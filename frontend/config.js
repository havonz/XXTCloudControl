// XXTCloudControl 前端配置文件
if (!window.XXTConfig) {
    window.XXTConfig = {
        // WebSocket 服务器配置
        websocket: {
            host: window.location.hostname,
            port: 46980,
            
            // 自动重连配置
            autoReconnect: true,
            reconnectInterval: 3000, // 重连间隔（毫秒）
            maxReconnectAttempts: 10 // 最大重连次数
        },
        
        // 前端界面配置
        ui: {
            // 屏幕捕获默认缩放比例
            screenCaptureScale: 30,
            
            // 截图最大等待时间（毫秒）
            maxScreenshotWaitTime: 500,
            
            // FPS 更新间隔（毫秒）
            fpsUpdateInterval: 1000
        }
    };
}
