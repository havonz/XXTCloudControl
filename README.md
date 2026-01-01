# XXTCloudControl

用于 XXTouch 1.3.8+ 的云控服务端（WebSocket + 静态前端）与管理面板。

## 项目结构

- `server/main.go` - 后端 WebSocket/HTTP 服务
- `frontend/` - 管理面板（SolidJS）
- `device-client/` - Lua WebSocket 客户端库
- `XXT 云控设置.lua` - 设备端配置脚本（写入云控地址）
- `build.sh` - 构建并打包多平台服务端 + 前端
- `build/` - 构建产物目录

## 功能特点

- WebSocket 实时通信、设备状态同步
- 前端面板 + 后端一体化部署（服务端可直接托管静态前端）
- 设备批量控制：脚本、触控、按键、重启/注销
- 文件管理：上传/下载/列出/删除/创建目录
- 剪贴板读写、截图
- HMAC-SHA256 签名校验

## 快速开始

### 开发模式

1. 启动后端：
   ```bash
   cd server
   go run .
   ```
   首次启动会在当前目录生成 `xxtcloudserver.json` 并输出随机密码（只显示一次）。

2. 启动前端开发服务器：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   访问 `http://localhost:3000`，在登录页输入服务器地址与端口（默认 `46980`）以及密码。

> 注意：`go run .` 在 `server` 目录启动时，默认 `frontend_dir` 为 `./frontend`，不会自动指向 `../frontend/dist`。若希望后端托管前端，请在配置里设置 `frontend_dir`，或使用打包后的目录结构。

### 生产/打包

```bash
bash build.sh
```

产物输出在 `build/`，解压后目录结构如下：
```
xxtcloudcontrol/
├── xxtcloudserver-<os>-<arch>[.exe]
└── frontend/
```
在该目录内运行服务端即可自动托管前端（默认 `frontend_dir=./frontend`）。

### 修改密码

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

或在源码模式：
```bash
cd server
go run . -set-password 12345678
```

## 配置说明

默认配置文件：`xxtcloudserver.json`（在启动目录生成）

```json
{
  "port": 46980,
  "passhash": "hex-string",
  "ping_interval": 15,
  "ping_timeout": 10,
  "frontend_dir": "./frontend"
}
```

- `passhash` 为 `hmacSHA256("XXTouch", password)` 的结果，不是明文密码。
- `ping_interval` 会触发服务端发送 `app/state` 请求，设备需回应以保持在线。

## 设备绑定方式

1. 运行脚本 `XXT 云控设置.lua`，填写 `ws://<host>:46980/api/ws`。
2. 或下载自动生成的绑定脚本：
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`
3. 或手动调用设备本地接口：
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

关闭云控：将 `enable` 置为 `false`。

## WebSocket 约定

- WebSocket 地址：`ws://<host>:<port>/api/ws`
- 控制端消息需包含 `ts`/`sign`，时间戳允许 ±10 秒漂移。

### 控制端通用消息格式

```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### 设备端上线

设备端发送 `app/state`，并在 `body.system.udid` 中提供唯一标识。

### 设备断开

服务端通知控制端：
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### 设备列表

```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/devices"
}
```

响应：
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### 刷新设备状态

```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
服务端会向所有设备广播 `app/state` 请求。

### 批量命令

```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/commands",
  "body": {
    "devices": ["udid1", "udid2"],
    "commands": [
      { "type": "script/run", "body": { "name": "demo.lua" } },
      { "type": "screen/snapshot", "body": { "format": "png", "scale": 30 } }
    ]
  }
}
```

## 常用命令类型

### 文件操作

#### 上传文件
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "file/put",
    "body": {
      "path": "/scripts/xxx.lua",
      "data": "Base64数据"
    }
  }
}
```

#### 创建目录
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "file/put",
    "body": {
      "path": "/scripts/dir",
      "directory": true
    }
  }
}
```

#### 列出目录
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "file/list",
    "body": {
      "path": "/scripts"
    }
  }
}
```

#### 下载文件
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "file/get",
    "body": {
      "path": "/scripts/xxx.lua"
    }
  }
}
```

#### 拷贝文件
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "file/copy",
    "body": {
      "from": "/scripts/xxx.lua",
      "to": "/scripts/yyy.lua"
    }
  }
}
```

#### 移动文件
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "file/move",
    "body": {
      "from": "/scripts/xxx.lua",
      "to": "/scripts/yyy.lua"
    }
  }
}
```

#### 删除文件
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "file/delete",
    "body": {
      "path": "/scripts/xxx.lua"
    }
  }
}
```

### 设备控制

#### 注销设备
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "system/respring"
  }
}
```

#### 重启设备
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "system/reboot"
  }
}
```

#### 触控命令
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "touch/down|touch/move|touch/up",
    "body": {
      "x": 100,
      "y": 200
    }
  }
}
```

#### 按键命令
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "key/down|key/up",
    "body": {
      "code": "HOMEBUTTON"
    }
  }
}
```

#### 屏幕截图
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "screen/snapshot",
    "body": {
      "format": "png",
      "scale": 30
    }
  }
}
```

### 剪贴板

#### 读取剪贴板
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "pasteboard/read"
  }
}
```

#### 写入剪贴板
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "pasteboard/write",
    "body": {
      "uti": "public.plain-text",
      "data": "UTF8 文本或 Base64 图片"
    }
  }
}
```

### 词典/队列/脚本选择

#### 设置词典值
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "proc-value/put",
    "body": {
      "key": "foo",
      "value": "bar"
    }
  }
}
```

#### 推送队列
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "proc-queue/push",
    "body": {
      "key": "queue",
      "value": "item"
    }
  }
}
```

#### 选择脚本
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "script/selected/put",
    "body": {
      "name": "demo.lua"
    }
  }
}
```

### 脚本控制

#### 启动脚本
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "script/run",
    "body": {
      "name": "脚本名称.lua"
    }
  }
}
```

#### 停止脚本
```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "script/stop"
  }
}
```

## 安全说明

- 所有控制命令都需要使用 HMAC-SHA256 签名验证
- 首次启动会生成随机密码（只显示一次），建议及时修改
- 上传大文件（>1MB）可能导致 WebSocket 断开
