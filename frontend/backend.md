# XXTCloudControl

这是一个用于 XXTouch 1.3.8 以上版本简易的云控制设备的 WebSocket 服务器和前端界面。

## 项目结构

- `main.go` - 后端 WebSocket 服务器，处理设备连接转发控制命令，所有的设备端都会连接到它

## 功能特点

- 基于 WebSocket 的实时通信
- 设备状态监控
- 远程触控命令发送
- 命令序列执行
- 安全的 HMAC-SHA256 签名验证

## 使用方法

1. 提前准备一个 Go 环境，编译  
   ```
   go mod tidy
   go build -o xxtcloudserver main.go  
   ```

2. 启动：  
   ```
   ./xxtcloudserver
   ```

3. 在浏览器中访问前端界面：  
   ```
   http://localhost:46980
   ```

4. 对设备端的 XXT 服务的 /api/config 端口 PUT 如下配置以加入到被控列表  
    ```json
    {
        "cloud": {
            "enable": true,
            "address": "ws://服务器地址:46980/api/ws"
        }
    }
    ```

5. 查看设备列表，选择设备，发送控制命令  

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


### 设备断开连接

```json
{
    "type": "devices/disconnect",
    "body": udid
}
```
当有设备与服务器断开连接时，服务器发送如下消息到控制端  


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
        "devices": [udid1, udid2, ...],
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
            "type": "file|dir"
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
        "devices": [udid1, udid2, ...],
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
        "devices": [udid1, udid2, ...],
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
        "devices": [udid1, udid2, ...],
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
        "devices": [udid1, udid2, ...],
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
        "devices": [udid1, udid2, ...],
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

#### 剪贴板读取

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid1, udid2, ...],
        "type": "pasteboard/read",
    }
}
```

**响应：**
```json
{
    "type": "pasteboard/read",
    "error": "",
    "body": {
        "uti": "public.plain-text", // public.plain-text 或者 public.image
        "data": "UTF8 编码的文本数据，或者 Base64 编码的图像数据"
    }
}
```

#### 剪贴板写入

**请求：**
```json
{
    "ts": 秒级时间戳,
    "sign": sign,
    "type": "control/command",
    "body": {
        "devices": [udid1, udid2, ...],
        "type": "pasteboard/write",
        "body": {
            "uti": "public.plain-text", // public.plain-text 或者 public.jpeg、public.png、public.image
            "data": "UTF8 编码的文本数据，或者 Base64 编码的图像数据"
        }
    }
}
```

**响应：**
```json
{
    "type": "pasteboard/write",
    "error": ""
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
        "devices": [udid1, udid2, ...],
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
        "devices": [udid1, udid2, ...],
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

