# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | English | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Tiếng Việt](README.vi-VN.md) | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | [Français](README.fr-FR.md) | [Deutsch](README.de-DE.md)

Cloud-control server (WebSocket + static frontend) and management panel for XXTouch 1.3.8-20260122000000 and later.  
The device-side protocol implementation is located at `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua` on the device.  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## Releases

- Official download page (GitHub Pages): [https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- Releases for all platforms: [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- We recommend downloading `XXTCloudControl-<YYYYMMDDHHMM>.zip` from the Release assets first. Extract it, then run the binary for your operating system.


## Project structure

- `server/` - Backend WebSocket/HTTP service (entry point: `server/main.go`)
- `frontend/` - SolidJS management panel; source is in `frontend/src/` and build output is in `frontend/dist/`
- `device-client/` - Lua WebSocket client library
- `XXT 云控设置.lua` - Original Simplified Chinese device setup script (writes the cloud-control address)
- `device-scripts/settings/` - Standalone device setup scripts in 11 languages
- `docs/i18n/` - Complete README translations
- `build.sh` - Builds and packages the multi-platform server and frontend
- `build/` - Build output directory
- `server/data/` - Runtime data directory (`data_dir=./data` by default, relative to the startup directory)

## Features

- Real-time WebSocket communication and device-state synchronization
- Integrated frontend and backend deployment; the server can host the static frontend directly
- Batch device control: scripts, touch, keys, reboot/respring, and clipboard
- Real-time WebRTC desktop control with optional built-in TURN traversal
- Device groups and script configuration through FormRunner dynamic forms
- Server-side file repository (scripts/files/reports) and bidirectional device/server transfers (WS for small files and HTTP tokens for large files)
- `control/http` proxy to the device's local HTTP APIs, including WebRTC APIs

## Quick start

### Download and run a binary (recommended)

1. Open the releases page and download the latest `XXTCloudControl-<YYYYMMDDHHMM>.zip`:  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. Extract the archive, enter the directory, and run the binary for your operating system:
   ```bash
   # macOS (Apple Silicon 示例)
   chmod +x ./xxtcloudserver-darwin-arm64
   ./xxtcloudserver-darwin-arm64

   # Linux (amd64 示例)
   chmod +x ./xxtcloudserver-linux-amd64
   ./xxtcloudserver-linux-amd64

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe
   ```
3. On first startup, the server creates `xxtcloudserver.json` in the current directory and prints a random password (shown only once).
4. Open `http://<server-address>:46980` in a browser and sign in to the management panel.
5. If you forget the password, reset it from the same directory and restart the service:
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Docker deployment

#### Quick start (recommended)

```bash
docker pull havonz/xxtcloudcontrol
docker run --rm \
  -v "$PWD/xxtcc-data:/app/data" \
  havonz/xxtcloudcontrol \
  -config /app/data/xxtcloudserver.json -set-password 12345678
docker run -d --name xxtcloudcontrol \
  -p 46980:46980 \
  -p 43478:43478/tcp -p 43478:43478/udp \
  -v "$PWD/xxtcc-data:/app/data" \
  -e XXTCC_CONFIG=/app/data/xxtcloudserver.json \
  -e XXTCC_TURN_PUBLIC_IP="" \
  -e XXTCC_TURN_PUBLIC_ADDR="" \
  havonz/xxtcloudcontrol
```

> Tip: If you do not mount a data directory, data and configuration are created in `/app/data` inside the container by default.
> At startup, the service reads the configuration file first, then applies environment-variable overrides. Environment variables are not written back to the configuration file automatically.
> See the [docker-compose.yml](../../docker-compose.yml) example for the available environment-variable names.

#### Deploy with docker-compose.yml

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### Production build and packaging (from source)

> Dependencies: `go`, `npm`, and `zip`

```bash
bash build.sh
```

Artifacts are written to `build/`, including binaries for each platform and the packaged zip archive:
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

The extracted directory has the following structure:
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
Run the binary for your operating system from this directory to host the frontend automatically (`frontend_dir=./frontend` by default).

### Build Docker images

> Dependency: `docker` with buildx enabled

```bash
bash build-docker.sh
```

Artifacts are written to `build/`:
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### Development mode

1. Start the backend:
   ```bash
   cd server
   go run .
   ```
   On first startup, the server creates `xxtcloudserver.json` in the current directory and prints a random password (shown only once).

2. Start the frontend development server:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:3000`, then enter the server address, port (`46980` by default), and password on the sign-in page.
   
   > Tip: The development server binds to `127.0.0.1:3000` by default and proxies `/api` to `http://127.0.0.1:46980`. If the backend runs on another host, adjust `frontend/vite.config.ts` or use a reverse proxy.

> Note: When `go run .` is started from the `server` directory, `frontend_dir` defaults to `./frontend` and does not automatically point to `../frontend/dist`. To let the backend host the frontend, set `frontend_dir` in the configuration or use the packaged directory structure.

### Change the password

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

Or, when running from source:
```bash
cd server
go run . -set-password 12345678
```

## Common command-line options

- `-config <path>`: Specify the configuration-file path (defaults to `xxtcloudserver.json` in the startup directory)
- `-set-password <pwd>`: Change the controller password
- `-set-turn-ip <ip>`: Set the public TURN IP address and enable TURN
- `-set-turn-port <port>`: Set the TURN listening port and enable TURN
- `-v` / `-h`: Show version information / help

## Configuration

Default configuration file: `xxtcloudserver.json` (created in the startup directory)

```json
{
  "port": 46980, // WebSocket 服务端口
  "passhash": "hex-string", // 密码的 HMAC-SHA256 哈希值
  "ping_interval": 15, // 服务端发送 WebSocket PING 心跳的间隔（秒）
  "ping_timeout": 10, // 设备连续未响应次数阈值，超过则断开连接
  "state_interval": 45, // 服务端请求设备状态 (app/state) 的间隔（秒）
  "frontend_dir": "./frontend", // 前端文件目录
  "data_dir": "./data", // 服务端数据目录
  "tlsEnabled": false, // 是否启用 TLS（HTTPS/WSS）
  "tlsCertFile": "./certs/server.crt", // TLS 证书文件路径
  "tlsKeyFile": "./certs/server.key", // TLS 私钥文件路径
  "turnEnabled": true, // 是否启用 TURN 服务器
  "turnPort": 43478,   // TURN 服务器监听端口（默认 43478）
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

- `passhash` is the result of `hmacSHA256("XXTouch", password)`, not the plaintext password.
- `ping_interval` controls heartbeat frequency. At this interval, the server sends WebSocket PING frames to devices to detect whether they are online.
- `state_interval` controls state-refresh frequency. At this interval, the server sends an `app/state` request to each device to retrieve its latest state.
- `ping_timeout` is the maximum number of consecutive missed responses, measured in `ping_interval` cycles. The server disconnects the device after the threshold is exceeded.
- By default, `data_dir` contains persistent data such as `scripts/`, `files/`, `reports/`, group data, and script configurations.
- All paths in the configuration are relative to the startup directory. When the server is started from `server/`, the default `data_dir=./data` resolves to `server/data/`.
- `turnEnabled` defaults to `true`, but the built-in TURN server starts only when either `turnPublicIP` or `turnPublicAddr` is configured.

## WebRTC traversal (TURN) configuration

To support real-time desktop control over external networks, the server includes a built-in TURN server with UDP and TCP support.

### TURN address configuration

The server supports two ways to configure the public address:

| Field | Format | Validation | Use case |
|------|------|------|----------|
| `turnPublicIP` | IPv4 address only | Validated with `net.ParseIP()` | A fixed public IP is available |
| `turnPublicAddr` | IPv4 address or domain name | Domain names are resolved through DNS automatically | Access through a domain name |

> [!IMPORTANT]
> **IPv4 only**: The TURN server currently supports IPv4 addresses only. An IPv6 address or a domain with only an AAAA record causes startup to fail.
>
> If both values are configured, `turnPublicIP` takes precedence. Configure either value to enable the built-in TURN server.

Example:

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

### Custom ICE servers

In addition to the built-in TURN service, you can configure external STUN/TURN servers. This is useful when:

- You want to use a third-party TURN service, such as [Metered](https://www.metered.ca/tools/openrelay/), without enabling TURN locally
- You want to combine the local TURN server with an external service to improve traversal reliability

> [!WARNING]
> **Security note**: The `customIceServers` configuration, including `username` and `credential`, is sent to the device during a WebRTC connection and **is not confidential**. Use a TURN service that supports temporary credentials, or make sure the credentials are safe to share publicly.

Example:

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

**Combination behavior:**

| Local TURN | Custom ICE servers | Result |
|-----------|-------------------|------|
| Enabled | None | Use local TURN only |
| Disabled | Configured | Use custom ICE servers only |
| Enabled | Configured | **Combined**: local TURN + custom ICE servers |
| Disabled | None | No ICE servers; WebRTC attempts a direct connection only |

### Quick setup commands

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> If `turnSecretKey` is empty, a temporary key is generated at startup and changes after a restart. Configure it manually if stable TURN credentials are required.

### Firewall configuration for administrators

Server administrators must open the following ports in the cloud security group or firewall:

| Port range | Protocol | Purpose |
|----------|------|------|
| `46980` (or custom) | **TCP** | **Cloud-control service** (API and WebSocket) |
| `43478` (or custom) | **UDP and TCP** | WebRTC TURN control, handshakes, and fallback |
| `49152 - 65535` | **UDP** | WebRTC TURN real-time media relay |

> [!TIP]
> Media relay prefers UDP. If UDP traffic is heavily restricted, WebRTC automatically falls back to TCP on port 43478 so that the desktop stream can still be transmitted.

## TLS/HTTPS configuration (optional)

The server supports HTTPS/WSS directly, so encrypted connections can be enabled without a reverse proxy. It also supports deployment behind a reverse proxy such as Nginx or Caddy.

### 1) Configure TLS

Set the following values in `xxtcloudserver.json`:

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) Generate a local test certificate

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> Self-signed certificates are suitable for local testing only. In production, use a certificate issued by Let's Encrypt or another certificate authority.

### 3) Reverse-proxy mode

When using a reverse proxy such as Nginx or Caddy, the server can remain in HTTP mode while the proxy terminates TLS. The binding script detects the protocol from the `X-Forwarded-Proto` header and generates the correct `wss://` address.

Nginx example:

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

## Device binding

1. Run the original Simplified Chinese script `XXT 云控设置.lua` from the repository root, or choose the standalone script for your language from `device-scripts/settings/`. Enter `ws://<host>:46980/api/ws` (use `wss://` with TLS or a reverse proxy).
2. Alternatively, download an automatically generated binding script:
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   Append `proto=https` to force a `wss://` address. Behind a reverse proxy, the protocol can also be detected automatically from `X-Forwarded-Proto`.
3. Or call the device's local API manually:
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

To disable cloud control, set `enable` to `false`.

`device-scripts/settings/` provides scripts for 11 locales: `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `vi-VN`, `es-ES`, `pt-BR`, `ru-RU`, `fr-FR`, and `de-DE`. Each file runs independently and does not depend on another language file.

## WebSocket conventions

- WebSocket address: `ws://<host>:<port>/api/ws` (use `wss://` with TLS or a reverse proxy)
- Controller messages must include `ts`, `nonce`, and `sign`. The timestamp may differ by up to ±60 seconds, and a `nonce` must not be reused within 120 seconds.

## Authentication and signing algorithm (HTTP and WebSocket)

Authentication does not use a fixed token. Instead, it uses short-lived dynamic signatures: each client request includes the current Unix timestamp in seconds as `ts`, a random `nonce`, and a `sign` signature. The server verifies the signature within the allowed time window and rejects reused nonces.

### 1) Password and passhash

The server configuration file `xxtcloudserver.json` stores `passhash`, not the plaintext password:

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`, producing a 64-character hexadecimal string.

### 2) Computing sign

The controller signature uses `passhash` as the HMAC key and signs a normalized base string:

#### HTTP base string

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD`: Request method (GET/POST/PUT/DELETE…)
- `PATH_AND_QUERY`: `path` followed by the sorted query string, excluding `ts`, `nonce`, and `sign`
- `bodyHash`：
  - Regular request body: hexadecimal `SHA-256(bodyBytes)`
  - An empty body or multipart body (`multipart/form-data`) is currently omitted: `bodyHash = ""`

#### WebSocket base string

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type`: Message type, such as `control/devices`
- `bodyHash`: Hexadecimal `SHA-256` of the JSON representation of `body`; an absent body produces an empty string

Final signature:

- `sign = HMAC-SHA256(key=passhash, message=base)`, producing a hexadecimal string.

> Note: Here, `key=passhash` means the **hexadecimal passhash string itself**, passed to HMAC as string bytes. Do not decode the hexadecimal value into 32 bytes first.

### 3) Server validation rules

- Allowed clock skew: `ts` must be within `±60` seconds of the server's current time.
- A `nonce` must not be reused within `120` seconds; reuse is treated as a replay.
- A validation failure returns `401 Unauthorized` for HTTP or closes the connection for a WebSocket controller message.

### 4) HTTP API authentication

Except for the HTTP binding-script download, all HTTP APIs require a signature using the same algorithm as WebSocket messages:

- Protected paths: all `/api/*` paths
- Exemptions:
  - `/api/download-bind-script` (kept unsigned as required)
  - `/api/config` (frontend startup configuration)
  - `/api/control/info` (JSON configuration output)
  - `/api/ws` (the WebSocket upgrade handshake does not use HTTP authentication; controller messages still require signatures)
  - `/api/transfer/download/:token` (temporary-token download)
  - `/api/transfer/upload/:token` (temporary-token upload)
  - `OPTIONS` preflight requests (CORS)

An HTTP request may supply authentication in either of two ways:

1. **Request headers (recommended)**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Query parameters (for downloads, `window.open`, `img`, and other cases where custom headers are inconvenient)**
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

Example:

```bash
# 查询分组（header 方式）
curl -sS \
  -H "X-XXT-TS: 1700000000" \
  -H "X-XXT-Nonce: <nonce>" \
  -H "X-XXT-Sign: <hex-sign>" \
  http://127.0.0.1:46980/api/groups

# 下载服务器文件（query 方式）
curl -L -o out.bin \
  "http://127.0.0.1:46980/api/server-files/download/scripts/demo.lua?ts=1700000000&nonce=<nonce>&sign=<hex-sign>"
```

### Common controller message format

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### HTTP proxy (`control/http`)

The controller can send `control/http` over WebSocket to forward an HTTP request to a device, where it is executed with `http.request`. This is commonly used for WebRTC APIs.

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

> Note: `body` must be base64-encoded. When the request targets `/api/webrtc/start` and TURN is enabled, the server injects `iceServers` automatically.

### Device connection

The device sends `app/state` and supplies its unique identifier in `body.system.udid`.
Devices that support a global hardware keyboard also declare the following optional capability. If the field is absent or not `true`, the controller does not send hardware-keyboard commands:

```json
{
  "type": "app/state",
  "body": {
    "cloudControl": {
      "protocolVersion": 2,
      "features": {
        "globalHardwareKeyboard": true
      }
    },
    "system": {
      "udid": "udid1"
    }
  }
}
```

The controller sends `key/global-keyboard` through `control/command`, and the device replies with the same type. `owner` identifies a real-time control session; a device allows only the matching owner to disconnect its keyboard:

```json
{
  "devices": ["udid1"],
  "type": "key/global-keyboard",
  "body": {
    "action": "status",
    "owner": "controller-session-id"
  }
}
```

`action` supports `status`, `connect`, and `disconnect`. The response `body` includes `action`, `owner`, `supported`, `ok`, and `connected`, with an optional `message` on failure.

### Device disconnection

The server notifies the controller:
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### Device list

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

Response:
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### Refresh device state

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
The server broadcasts an `app/state` request to all devices.

### Real-time log subscription

Subscribe to logs from a specific device:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

Unsubscribe:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

If the device supports log streaming, it sends:

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### Batch commands

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

## Common command types

### File operations

#### Upload a file
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Create a directory
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### List a directory
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Download a file
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Copy a file
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Move a file
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Delete a file
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

### Device control

#### Respring a device
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "system/respring"
  }
}
```

#### Reboot a device
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "system/reboot"
  }
}
```

#### Touch commands
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "touch/down|touch/move|touch/up",
    "body": {
      "x": 100,
      "y": 200,
      "finger": 28
    }
  }
}
```

Notes:

- `finger` is optional and accepts values from `0` through `29`.
- If `finger` is omitted, the device continues to use the legacy single-touch protocol for compatibility.
- Multi-touch uses multiple `touch/down`, `touch/move`, and `touch/up` messages with stable `finger` values. The same finger must use the same `finger` value from touch-down through touch-up.

#### Key commands
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Take a screenshot
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

### Clipboard

#### Read the clipboard
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1"],
    "type": "pasteboard/read"
  }
}
```

#### Write to the clipboard
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

### Dictionary, queue, and script selection

#### Set a dictionary value
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Push to a queue
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Select a script
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

### Script control

#### Start a script
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
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

#### Stop a script
```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command",
  "body": {
    "devices": ["udid1", "udid2"],
    "type": "script/stop"
  }
}
```

## Security

- All WebSocket control commands and all HTTP APIs except the binding-script download require HMAC-SHA256 dynamic-signature validation.
- First startup generates a random password that is displayed once. Change it promptly.
- For large files, use `/api/transfer/*` with temporary HTTP tokens. WebSocket is intended only for small files and control messages.
