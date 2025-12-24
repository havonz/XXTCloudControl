# XXTCloudControl

这是一个使用 SolidJS 构建的 WebSocket 客户端应用，可以连接到您的后端服务。

## 功能特性

- 🚀 基于 SolidJS 的现代响应式 UI
- 🔌 WebSocket 实时通信
- 🔄 自动重连机制
- 📱 响应式设计
- 🎨 现代化的用户界面

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置后端服务地址

在 `src/App.tsx` 文件中，找到以下行并修改为您的后端服务地址：

```typescript
// 请将 'ws://localhost:8080' 替换为您的后端服务地址
wsService = new WebSocketService('ws://localhost:8080');
```

### 3. 启动开发服务器

```bash
npm run dev
```

应用将在 http://localhost:3000 上运行。

### 4. 构建生产版本

```bash
npm run build
```

## WebSocket 服务功能

### 连接管理
- 自动连接到指定的 WebSocket 服务器
- 连接状态实时显示（连接中/已连接/已断开）
- 自动重连机制（最多重试 5 次）

### 消息处理
- 发送文本消息到服务器
- 接收并显示来自服务器的消息
- 消息历史记录显示

### 错误处理
- 连接失败时的错误提示
- 网络断开时的自动重连
- 用户友好的状态指示器

## 项目结构

```
src/
├── App.tsx                 # 主应用组件
├── App.module.css         # 应用样式
├── index.tsx              # 应用入口
├── index.css              # 全局样式
└── services/
    └── WebSocketService.ts # WebSocket 服务类
```

## WebSocket 服务 API

### 基本用法

```typescript
import { WebSocketService } from './services/WebSocketService';

// 创建 WebSocket 服务实例
const wsService = new WebSocketService('ws://your-backend-url');

// 监听连接状态变化
wsService.onStatusChange((status) => {
  console.log('连接状态:', status);
});

// 监听接收到的消息
wsService.onMessage((message) => {
  console.log('收到消息:', message);
});

// 连接到服务器
wsService.connect();

// 发送消息
wsService.send('Hello Server!');

// 断开连接
wsService.disconnect();
```

## 自定义配置

### 修改重连设置

在 `WebSocketService.ts` 中可以修改以下参数：

```typescript
private maxReconnectAttempts = 5;     // 最大重连次数
private reconnectInterval = 3000;     // 重连间隔（毫秒）
```

### 修改服务器端口

在 `vite.config.ts` 中可以修改开发服务器端口：

```typescript
server: {
  port: 3000, // 修改为您想要的端口
}
```

## 技术栈

- **SolidJS** - 现代响应式前端框架
- **TypeScript** - 类型安全的 JavaScript
- **Vite** - 快速的构建工具
- **CSS Modules** - 模块化样式

## 浏览器支持

支持所有现代浏览器，包括：
- Chrome 88+
- Firefox 87+
- Safari 14+
- Edge 88+

## 许可证

MIT License
