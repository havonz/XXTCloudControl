# XXTCloudControl

用于 XXTouch 1.3.8+ 的云控服务端（WebSocket + 静态前端）与管理面板。  
设备端协议实现源码见 `device-client/open-cloud-control-client.lua`（设备上通常位于 `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua`）。  

## 项目结构

- `server/main.go` - 后端 WebSocket/HTTP 服务
- `frontend/` - 管理面板（SolidJS）
- `device-client/` - Lua WebSocket 客户端库
- `XXT 云控设置.lua` - 设备端配置脚本（写入云控地址）
- `build.sh` - 构建并打包多平台服务端 + 前端
- `build/` - 构建产物目录
- `data/` - 运行时数据目录（默认生成：脚本/文件/报告/分组等）

## 功能特点

- WebSocket 实时通信、设备状态同步
- 前端面板 + 后端一体化部署（服务端可直接托管静态前端）
- 设备批量控制：脚本、触控、按键、重启/注销、剪贴板
- WebRTC 实时桌面控制（可选内置 TURN 穿透）
- 设备分组与脚本配置（FormRunner 动态表单）
- 服务器端文件仓库（scripts/files/reports）+ 设备/服务器双向文件传输（小文件 WS，大文件 HTTP Token）
- control/http 代理到设备本地 HTTP（用于 WebRTC 等设备 API）

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

产物输出在 `build/`，包含各平台二进制与打包的 zip：
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
└── XXTCloudControl-<timestamp>.zip
```

解压后目录结构如下：
```
XXTCloudControl/
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
  "port": 46980, // WebSocket 服务端口
  "passhash": "hex-string", // 密码的 HMAC-SHA256 哈希值
  "ping_interval": 15, // 服务端发送 ping 请求的间隔（秒）
  "ping_timeout": 10, // 当前版本未使用（保留）
  "frontend_dir": "./frontend", // 前端文件目录
  "data_dir": "./data", // 服务端数据目录
  "tlsEnabled": false, // 是否启用 TLS（HTTPS/WSS）
  "tlsCertFile": "./certs/server.crt", // TLS 证书文件路径
  "tlsKeyFile": "./certs/server.key", // TLS 私钥文件路径
  "turnEnabled": true, // 是否启用 TURN 服务器
  "turnPort": 43478,   // TURN 服务器监听端口
  "turnPublicIP": "你的公网IP", // 公网 IP（需验证格式）
  "turnPublicAddr": "turn.example.com", // 公网地址（IP 或域名，无验证）
  "turnRealm": "xxtcloud", // TURN realm
  "turnSecretKey": "你的密钥", // TURN REST 密钥（留空会自动生成）
  "turnCredentialTTL": 86400, // TURN 凭据有效期（秒）
  "turnRelayPortMin": 49152, // TURN 服务器中继端口范围起始
  "turnRelayPortMax": 65535, // TURN 服务器中继端口范围结束
  "customIceServers": [] // 自定义 ICE 服务器列表（见下文）
}
```

- `passhash` 为 `hmacSHA256("XXTouch", password)` 的结果，不是明文密码。
- `ping_interval` 会触发服务端发送 `app/state` 请求，设备需回应以保持在线。
- `data_dir` 默认生成 `scripts/`、`files/`、`reports/` 以及分组/脚本配置等持久化数据。

## WebRTC 穿透 (TURN) 配置

为了支持外网环境下的实时桌面控制，服务端内置了支持 UDP/TCP 的 TURN 服务器。

### TURN 地址配置

服务端支持两种公网地址配置方式：

| 字段 | 格式 | 验证 | 适用场景 |
|------|------|------|----------|
| `turnPublicIP` | 仅 IPv4 地址 | `net.ParseIP()` 验证 | 有固定公网 IP |
| `turnPublicAddr` | IPv4 或域名 | 域名自动 DNS 解析 | 使用域名访问 |

> [!IMPORTANT]
> **仅支持 IPv4**：TURN 服务器目前仅支持 IPv4 地址。IPv6 地址或仅有 AAAA 记录的域名会导致启动失败。
>
> 如果两者都配置，`turnPublicIP` 优先。只需配置其中一个即可启用内置 TURN。

配置示例：

```json
// 方式 1: 使用 IP
{
  "turnEnabled": true,
  "turnPublicIP": "203.0.113.1"
}

// 方式 2: 使用域名
{
  "turnEnabled": true,
  "turnPublicAddr": "turn.example.com"
}
```

### 自定义 ICE 服务器

除了使用内置 TURN 服务，你还可以配置外部 STUN/TURN 服务器。这在以下场景很有用：

- 不想在本地启用 TURN 服务，而是使用第三方 TURN 服务（如 [Metered](https://www.metered.ca/tools/openrelay/)）
- 需要将本地 TURN 与外部服务合并使用，增强穿透能力

> [!WARNING]
> **安全提示**：`customIceServers` 中的配置（包括 `username` 和 `credential`）会在 WebRTC 连接时发送给设备端，**不是保密信息**。请使用支持临时凭据的 TURN 服务，或确保凭据可公开共享。

配置示例：

```json
{
  "turnEnabled": false,
  "customIceServers": [
    {
      "urls": ["stun:stun.relay.metered.ca:80"]
    },
    {
      "urls": ["turn:global.relay.metered.ca:80"],
      "username": "your-username",
      "credential": "your-credential"
    },
    {
      "urls": ["turn:global.relay.metered.ca:80?transport=tcp"],
      "username": "your-username",
      "credential": "your-credential"
    },
    {
      "urls": ["turn:global.relay.metered.ca:443"],
      "username": "your-username",
      "credential": "your-credential"
    },
    {
      "urls": ["turns:global.relay.metered.ca:443?transport=tcp"],
      "username": "your-username",
      "credential": "your-credential"
    }
  ]
}
```

**合并行为：**

| 本地 TURN | 自定义 ICE Servers | 结果 |
|-----------|-------------------|------|
| 启用 | 无 | 仅使用本地 TURN |
| 禁用 | 有 | 仅使用自定义 ICE Servers |
| 启用 | 有 | **合并**：本地 TURN + 自定义 ICE Servers |
| 禁用 | 无 | 无 ICE 服务器，WebRTC 仅尝试直连 |

### 快捷设置命令

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> `turnSecretKey` 为空时会在启动时自动生成临时密钥（重启会变化），如需稳定的 TURN 凭据请手动配置。

### 管理员防火墙配置

服务器管理员需要在云安全组/防火墙中开放以下端口：

| 端口范围 | 协议 | 用途 |
|----------|------|------|
| `46980` (或自定义) | **TCP** | **云控本体服务** (API & WebSocket) |
| `43478` (或自定义) | **UDP & TCP** | WebRTC [TURN] 控制、握手与回退 |
| `49152 - 65535` | **UDP** | WebRTC [TURN] 实时媒体流中继 |

> [!TIP]
> 媒体中继优先使用 UDP。在 UDP 流量被严格限制的情况下，WebRTC 会自动回退到 TCP (端口 43478) 以确保桌面流能够正常传输。

## TLS/HTTPS 配置 (可选)

服务端支持原生 HTTPS/WSS，无需反向代理即可启用加密连接。同时也兼容通过 Nginx/Caddy 等反向代理的方式。

### 1) 配置 TLS

在 `xxtcloudserver.json` 中设置：

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) 生成本地测试证书

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> 自签名证书仅适用于本地测试。生产环境请使用 Let's Encrypt 或其他 CA 签发的证书。

### 3) 反向代理模式

如果使用 Nginx/Caddy 等反向代理，服务端可保持 HTTP 模式运行，由代理处理 TLS 终止。此时绑定脚本会通过 `X-Forwarded-Proto` 请求头自动检测协议并生成正确的 `wss://` 地址。

Nginx 配置示例：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://127.0.0.1:46980;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /api/ws {
        proxy_pass http://127.0.0.1:46980;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

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

## 鉴权与签名算法（HTTP/WS 通用）

本项目的鉴权不使用固定 token，而是使用「短时效动态签名」：客户端每次请求携带当前秒级时间戳 `ts` 与签名 `sign`，服务端在允许的时间窗口内校验签名正确性。

### 1) 密码与 passhash

服务端配置文件 `xxtcloudserver.json` 中保存的是 `passhash`（不是明文密码）：

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`，结果为 64 位十六进制字符串（hex）。

### 2) sign 计算方式

控制签名使用 `passhash` 作为 HMAC key，对时间戳字符串做二次 HMAC：

- `sign = HMAC-SHA256(key=passhash, message=str(ts))`，结果为 hex 字符串。

> 注意：这里的 `key=passhash` 指的是 **passhash 的 hex 字符串本身**（按字符串字节参与 HMAC），不是把 hex 解码为 32 字节后再参与计算。

### 3) 服务端校验规则

- 允许的时间漂移：`ts` 在服务端当前时间 `±10` 秒内才会继续校验。
- 校验失败返回 `401 Unauthorized`（HTTP）或直接关闭连接（WebSocket 控制端消息）。

### 4) HTTP API 鉴权方案

除 `http` 下载绑定脚本外，所有 HTTP API 都需要携带签名（与 WebSocket 相同的算法）：

- 受保护路径：所有 `/api/*`
- 放行：
  - `/api/download-bind-script`（按你的要求保留无需签名）
  - `/api/config`（前端启动配置）
  - `/api/ws`（WebSocket 升级握手不做 HTTP 鉴权；控制端消息仍需签名）
  - `/api/transfer/download/:token`（临时 token 下载）
  - `/api/transfer/upload/:token`（临时 token 上传）
  - `OPTIONS` 预检请求（CORS）

HTTP 请求可用两种携带方式（二选一）：

1. **请求头（推荐）**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Sign: <sign>`

2. **Query 参数（适用于下载/`window.open`/`img` 等无法方便加自定义 header 的场景）**
   - `?ts=<ts>&sign=<sign>`

示例：

```bash
# 查询分组（header 方式）
curl -sS \
  -H "X-XXT-TS: 1700000000" \
  -H "X-XXT-Sign: <hex-sign>" \
  http://127.0.0.1:46980/api/groups

# 下载服务器文件（query 方式）
curl -L -o out.bin \
  "http://127.0.0.1:46980/api/server-files/download/scripts/demo.lua?ts=1700000000&sign=<hex-sign>"
```

### 控制端通用消息格式

```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### HTTP 代理（control/http）

控制端可通过 WebSocket 发送 `control/http`，将 HTTP 请求转发到设备（设备侧以 `http.request` 执行），常用于 WebRTC 相关接口。

```json
{
  "ts": 1700000000,
  "sign": "hex-sign",
  "type": "control/http",
  "body": {
    "devices": ["udid1"],
    "requestId": "uuid",
    "method": "POST",
    "path": "/api/webrtc/start",
    "query": {},
    "headers": { "Content-Type": "application/json" },
    "body": "base64-json",
    "port": 46952
  }
}
```

> 说明：`body` 需要 base64 编码；当请求为 `/api/webrtc/start` 且 TURN 已启用时，服务端会自动注入 `iceServers`。

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

#### 选中脚本
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
      "name": "脚本名称.lua" // 这里的 name 如果为 "" 表示启动设备端已经选中的脚本
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

- 所有控制命令（WebSocket）与除绑定脚本下载外的 HTTP API 都需要使用 HMAC-SHA256 动态签名验证
- 首次启动会生成随机密码（只显示一次），建议及时修改
- 大文件建议使用 `/api/transfer/*` 走 HTTP 临时 token（WebSocket 仅适合小文件/控制消息）
