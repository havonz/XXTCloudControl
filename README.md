# XXTCloudControl

这是一个用于 XXTouch 云控制设备的 WebSocket 服务器和前端界面。

## 项目结构

- `main.py` - WebSocket 服务器，处理设备连接和控制命令
- `frontend/` - 前端文件目录
  - `index.html` - 前端界面
  - `styles.css` - 样式表
  - `app.js` - JavaScript 功能实现
- `XXT 云控设置.lua` - XXT 云控设置脚本

## 功能特点

- 基于 WebSocket 的实时通信
- 设备状态监控
- 远程触控命令发送
- 命令序列执行
- 安全的 HMAC-SHA256 签名验证

## 使用方法

1. 启动后端 WebSocket 服务器：
   ```
   python main.py
   ```

2. 启动前端 HTTP 服务器：
   ```
   python -m http.server --directory frontend 8080
   ```

3. 在浏览器中访问前端界面：
   ```
   http://localhost:8080
   ```

4. 输入控制密码（默认为 "12345678"）并连接服务器（WebSocket 端口为 46980）

5. 对设备端的 XXT 服务的 /api/config 端口 PUT 如下配置以加入到被控列表
    ```json
    {
        "cloud": {
            "enable": true,
            "address": "ws://服务器地址:46980"
        }
    }
    ```

6. 查看设备列表，选择设备，发送控制命令

## API文档

### 设备端加入设备列表

设备端发送如下消息可加入设备列表：
```json
{
    "type": "app/state",
    "body": {
        "system": {
            "udid": "设备唯一标识",
            // 其他系统信息
        }
    }
}
```
非控制端消息都会认为是设备消息，全部转发到控制端

### 控制端通用消息格式

所有发送到服务器的命令使用以下JSON格式：
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid1, udid2, ...],
        "type": "命令类型",
        "body": {
            // 命令参数
        }
    }
}
```

### 文件操作API

#### 上传文件

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid1, udid2, ...],
        "type": "file/put",
        "body": {
            "path": "/scripts/xxx.lua",
            "data": "Base64格式数据"
        }
    }
}
```

**响应：**
```json
{
    "type": "file/put",
    "error": ""  // 为空表示没有错误
}
```

#### 创建目录

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid1, udid2, ...],
        "type": "file/put",
        "body": {
            "path": "/scripts/dir",
            "directory": true
        }
    }
}
```

**响应：**
```json
{
    "type": "file/put",
    "error": "",  // 为空表示没有错误
    "body": {
        "directory": true
    }
}
```

#### 列出文件目录

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "file/list",
        "body": {
            "path": "/scripts"
        }
    }
}
```

**响应：**
```json
{
    "type": "file/list",
    "error": "",
    "body": [
        {
            "name": "文件名",
            "type": "file|directory"
        },
        // 更多文件...
    ]
}
```

#### 删除文件

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "file/delete",
        "body": {
            "path": "/scripts/xxx.lua"
        }
    }
}
```

**响应：**
```json
{
    "type": "file/delete",
    "error": ""  // 为空表示没有错误
}
```

### 设备控制API

#### 注销设备

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "system/respring"
    }
}
```

#### 重启设备

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "system/reboot"
    }
}
```

#### 触控命令

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "touch/tap|touch/down|touch/move|touch/up",
        "body": {
            "x": x坐标,
            "y": y坐标
        }
    }
}
```

#### 按键命令

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "key/down|key/up",
        "body": {
            "code": "按键代码"
        }
    }
}
```

#### 屏幕截图

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid1, udid2, ...],
        "type": "screen/snapshot",
        "body": {
            "format": "png",
            "scale": 30 // 100 是原始大小
        }
    }
}
```

**响应：**
```json
{
  "type": "screen/snapshot",
  "error": "",
  "body": "Base64格式数据"
}
```

### 脚本控制API

#### 启动脚本

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "script/run",
        "body": {
            "name": "脚本名称.lua"
        }
    }
}
```

**响应：**
```json
{
    "type": "script/run",
    "error": ""  // 为空表示没有错误
}
```

#### 停止脚本

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid],
        "type": "script/stop"
    }
}
```

**响应：**
```json
{
    "type": "script/stop",
    "error": ""  // 为空表示没有错误
}
```

## 安全说明

- 所有控制命令都需要使用 HMAC-SHA256 签名验证
- 默认控制密码为 "12345678"，建议在生产环境中修改为更强的密码
- 签名算法：
  - passhash = hmacSHA256("XXTouch", password)
  - sign = hmacSHA256(passhash, 秒级时间戳转换成字符串)

## 注意事项

- 前端使用 CryptoJS 库实现 HMAC-SHA256 签名
- 实际应用中，建议使用 HTTPS 和 WSS 协议以确保通信安全
- 上传大文件时（>1MB）可能会导致WebSocket连接断开
