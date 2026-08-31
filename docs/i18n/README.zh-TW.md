# XXTCloudControl

[簡體中文](../../README.md) | 繁體中文 | [English](README.en-US.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Tiếng Việt](README.vi-VN.md) | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | [Français](README.fr-FR.md) | [Deutsch](README.de-DE.md)

用於 XXTouch 1.3.8-20260122000000+ 的雲端控制伺服器（WebSocket + 靜態前端）與管理面板。  
裝置端通訊協定的實作原始碼位於 `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua`。  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## 下載與發布

- 官方發布下載頁（GitHub Pages）：[https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- 各平台發布版本列表：[https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- 建議優先下載 Release 中的 `XXTCloudControl-<YYYYMMDDHHMM>.zip`，解壓縮後直接執行對應系統二進位即可。


## 專案結構

- `server/` - 後端 WebSocket/HTTP 服務（入口 `server/main.go`）
- `frontend/` - 管理面板（SolidJS），原始碼在 `frontend/src/`，建置產物在 `frontend/dist/`
- `device-client/` - Lua WebSocket 用戶端程式庫
- `XXT 云控设置.lua` - 原有簡體中文裝置端設定腳本（寫入雲端控制位址）
- `device-scripts/settings/` - 11 種語言的獨立裝置端設定腳本
- `docs/i18n/` - README 的完整多語言譯本
- `build.sh` - 建置並打包多平台伺服器端 + 前端
- `build/` - 建置產物目錄
- `server/data/` - 執行階段資料目錄（預設 `data_dir=./data`，取決於啟動目錄）

## 功能特色

- WebSocket 即時通訊、裝置狀態同步
- 前端面板 + 後端整合部署（伺服器可直接託管靜態前端）
- 裝置批次控制：腳本、觸控、按鍵、重新啟動/重新載入桌面、剪貼簿
- WebRTC 即時桌面控制（可選用內建 TURN 穿透）
- 裝置分組與腳本設定（FormRunner 動態表單）
- 伺服器端檔案庫（scripts/files/reports），以及裝置與伺服器之間的雙向檔案傳輸（小檔案使用 WS，大檔案使用 HTTP Token）
- control/http 代理至裝置本機 HTTP（用於 WebRTC 等裝置 API）

## 快速開始

### 直接下載二進位執行（建議）

1. 開啟發布頁並下載最新 `XXTCloudControl-<YYYYMMDDHHMM>.zip`：  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. 解壓縮後進入目錄，依作業系統執行對應的二進位檔：
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
3. 首次啟動會在目前目錄產生 `xxtcloudserver.json` 並輸出隨機密碼（只顯示一次）。
4. 在瀏覽器中開啟 `http://<服务器地址>:46980`，登入管理面板。
5. 如果忘記密碼，可在同一目錄重置後重新啟動服務：
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Docker 部署

#### 快速啟動（建議）

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

> 提示：如果你不掛載資料目錄，預設會在容器內 `/app/data` 產生資料與設定。
> 服務啟動時會依序讀取：設定檔 → 環境變數覆寫。環境變數不會自動回存至設定檔。
> 環境變數名稱可參考 [docker-compose.yml](../../docker-compose.yml) 範例

#### 使用 docker-compose.yml 一鍵部署

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### 正式環境／打包（從原始碼建置）

> 需求：`go`、`npm`、`zip`

```bash
bash build.sh
```

產物會輸出至 `build/`，包含各平台的二進位檔與封裝後的 zip：
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

解壓縮後目錄結構如下：
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
在該目錄內選擇與作業系統相符的二進位檔執行，即可自動託管前端（預設 `frontend_dir=./frontend`）。

### Docker 映像檔建置

> 需求：`docker`（需啟用 buildx）

```bash
bash build-docker.sh
```

產物會輸出至 `build/`：
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### 開發模式

1. 啟動後端：
   ```bash
   cd server
   go run .
   ```
   首次啟動會在目前目錄產生 `xxtcloudserver.json` 並輸出隨機密碼（只顯示一次）。

2. 啟動前端開發伺服器：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   開啟 `http://localhost:3000`，在登入頁輸入伺服器位址、連接埠（預設為 `46980`）及密碼。
   
   > 提示：開發伺服器預設綁定 `127.0.0.1:3000`，並將 `/api` 代理到 `http://127.0.0.1:46980`。若後端不在本機，請調整 `frontend/vite.config.ts` 或使用反向代理。

> 注意：在 `server` 目錄執行 `go run .` 時，`frontend_dir` 預設為 `./frontend`，不會自動指向 `../frontend/dist`。若要由後端託管前端，請在設定中指定 `frontend_dir`，或使用打包後的目錄結構。

### 修改密碼

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

或在原始碼模式：
```bash
cd server
go run . -set-password 12345678
```

## 常用命令列參數

- `-config <path>`：指定設定檔路徑（預設使用啟動目錄的 `xxtcloudserver.json`）
- `-set-password <pwd>`：修改控制端密碼
- `-set-turn-ip <ip>`：設定 TURN 公用 IP 並啟用
- `-set-turn-port <port>`：設定 TURN 監聽連接埠並啟用
- `-v` / `-h`：檢視版本 / 說明

## 設定說明

預設設定檔：`xxtcloudserver.json`（在啟動目錄產生）

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

- `passhash` 為 `hmacSHA256("XXTouch", password)` 的結果，不是明文密碼。
- `ping_interval` 控制心跳檢查頻率，伺服器會依此間隔向裝置傳送 WebSocket PING 影格，用來確認裝置是否在線上。
- `state_interval` 控制狀態更新頻率，伺服器會依此間隔向裝置傳送 `app/state` 請求，以取得最新的裝置狀態。
- `ping_timeout` 是裝置連續未回應的次數臨界值（以 `ping_interval` 的週期計算）；超過後，伺服器會中斷該裝置的連線。
- `data_dir` 預設產生 `scripts/`、`files/`、`reports/` 以及分組/腳本設定等持久化資料。
- 設定中的路徑均相對啟動目錄；在 `server/` 目錄啟動時，預設 `data_dir=./data` 會落在 `server/data/`。
- `turnEnabled` 預設為 `true`，但僅在設定了 `turnPublicIP` 或 `turnPublicAddr` 時才會實際啟動內建 TURN。

## WebRTC 穿透 (TURN) 設定

為了在外部網路環境中支援即時桌面控制，伺服器內建了支援 UDP/TCP 的 TURN 服務。

### TURN 位址設定

伺服器支援兩種公用網路位址設定方式：

| 欄位 | 格式 | 驗證 | 適用情境 |
|------|------|------|----------|
| `turnPublicIP` | 僅 IPv4 位址 | `net.ParseIP()` 驗證 | 有固定公用 IP |
| `turnPublicAddr` | IPv4 或網域名稱 | 自動以 DNS 解析網域名稱 | 使用網域名稱存取 |

> [!IMPORTANT]
> **僅支援 IPv4**：TURN 伺服器目前僅支援 IPv4 位址。IPv6 位址或僅有 AAAA 記錄的網域名稱會導致啟動失敗。
>
> 如果兩者都設定，`turnPublicIP` 優先。只需設定其中一個即可啟用內建 TURN。

設定範例：

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

### 自訂 ICE 伺服器

除了使用內建 TURN 服務，你還可以設定外部 STUN/TURN 伺服器。這在以下情境很有用：

- 不想在本地啟用 TURN 服務，而是使用第三方 TURN 服務（如 [Metered](https://www.metered.ca/tools/openrelay/)）
- 需要將本地 TURN 與外部服務合併使用，增強穿透能力

> [!WARNING]
> **安全提示**：`customIceServers` 中的設定（包括 `username` 和 `credential`）會在建立 WebRTC 連線時傳送至裝置端，**不屬於機密資訊**。請使用支援暫時性認證資訊的 TURN 服務，或確保這些認證資訊可以公開共用。

設定範例：

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

**合併行為：**

| 本地 TURN | 自訂 ICE Servers | 結果 |
|-----------|-------------------|------|
| 啟用 | 無 | 僅使用本地 TURN |
| 停用 | 有 | 僅使用自訂 ICE Servers |
| 啟用 | 有 | **合併**：本地 TURN + 自訂 ICE Servers |
| 停用 | 無 | 無 ICE 伺服器，WebRTC 僅嘗試直接連線 |

### 快速設定指令

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> `turnSecretKey` 為空時，系統會在啟動時自動產生暫時性金鑰（重新啟動後會變更）。如需固定的 TURN 認證資訊，請手動設定。

### 管理員防火牆設定

伺服器管理員需要在雲端安全群組或防火牆中開放以下連接埠：

| 連接埠範圍 | 通訊協定 | 用途 |
|----------|------|------|
| `46980` (或自訂) | **TCP** | **雲端控制本體服務** (API & WebSocket) |
| `43478` (或自訂) | **UDP & TCP** | WebRTC [TURN] 控制、交握與後備連線 |
| `49152 - 65535` | **UDP** | WebRTC [TURN] 即時媒體串流中繼 |

> [!TIP]
> 媒體中繼會優先使用 UDP。若 UDP 流量受到嚴格限制，WebRTC 會自動改用 TCP（連接埠 43478），以確保桌面串流能正常傳輸。

## TLS/HTTPS 設定（選用）

伺服器支援原生 HTTPS/WSS，無需反向代理即可啟用加密連線，也可搭配 Nginx/Caddy 等反向代理使用。

### 1) 設定 TLS

在 `xxtcloudserver.json` 中設定：

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) 產生本地測試憑證

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> 自簽憑證僅適用於本機測試。正式環境請使用 Let's Encrypt 或其他 CA 簽發的憑證。

### 3) 反向代理模式

如果使用 Nginx/Caddy 等反向代理，伺服器可維持 HTTP 模式，由代理處理 TLS 終止。此時綁定腳本會透過 `X-Forwarded-Proto` 請求標頭自動判斷通訊協定，並產生正確的 `wss://` 位址。

Nginx 設定範例：

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

## 裝置綁定方式

1. 執行根目錄原有的簡體中文腳本 `XXT 云控设置.lua`，或從 `device-scripts/settings/` 選擇對應語言的獨立腳本，填寫 `ws://<host>:46980/api/ws`（TLS 或反向代理情境使用 `wss://`）。
2. 或下載自動產生的綁定腳本：
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   可追加 `proto=https` 強制產生 `wss://` 位址；反向代理情境也可由 `X-Forwarded-Proto` 自動識別。
3. 或手動呼叫裝置的本機介面：
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

關閉雲端控制：將 `enable` 設為 `false`。

`device-scripts/settings/` 提供 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`、`vi-VN`、`es-ES`、`pt-BR`、`ru-RU`、`fr-FR`、`de-DE` 共 11 個 locale 的腳本；每個檔案均可獨立執行，不依賴其他語言檔案。

## WebSocket 約定

- WebSocket 位址：`ws://<host>:<port>/api/ws`（TLS/反向代理情境使用 `wss://`）
- 控制端訊息需包含 `ts`/`nonce`/`sign`，時間戳允許 ±60 秒的誤差，`nonce` 在 120 秒內不可重複。

## 身分驗證與簽章演算法（HTTP/WS 通用）

本專案的身分驗證不使用固定 token，而是使用「短效動態簽章」：用戶端每次請求都會帶上目前的秒級時間戳 `ts`、隨機 `nonce` 與簽章 `sign`；伺服器會在允許的時間範圍內驗證簽章，並檢查 nonce 是否重複。

### 1) 密碼與 passhash

伺服器設定檔 `xxtcloudserver.json` 儲存的是 `passhash`（不是明文密碼）：

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`，結果為 64 個字元的十六進位字串（hex）。

### 2) sign 計算方式

控制簽章使用 `passhash` 作為 HMAC key，對規範化後的基串做 HMAC：

#### HTTP 基串

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD`：請求方法（GET/POST/PUT/DELETE…）
- `PATH_AND_QUERY`：`path` + 排序後的 query（去除 `ts/nonce/sign`）
- `bodyHash`：
- 一般請求內容：`SHA-256(bodyBytes)` 的 hex
  - 空 body 或 multipart（`multipart/form-data`）暫不參與：`bodyHash = ""`

#### WebSocket 基串

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type`：訊息類型（如 `control/devices`）
- `bodyHash`：對 `body` 的 JSON 結果做 `SHA-256`（hex）；沒有 body 則為空字串

最終簽章：

- `sign = HMAC-SHA256(key=passhash, message=base)`，結果為 hex 字串。

> 注意：這裡的 `key=passhash` 指的是 **passhash 的 hex 字串本身**（以該字串的位元組參與 HMAC），不是先將 hex 解碼為 32 位元組再參與計算。

### 3) 伺服器端驗證規則

- 允許的時間漂移：`ts` 在伺服器端目前時間 `±60` 秒內才會繼續驗證。
- `nonce` 在 `120` 秒內不可重複（重複即視為重放攻擊）。
- 驗證失敗傳回 `401 Unauthorized`（HTTP）或直接關閉連線（WebSocket 控制端訊息）。

### 4) HTTP API 身分驗證方案

除 `http` 下載綁定腳本外，所有 HTTP API 都需要帶上簽章（演算法與 WebSocket 相同）：

- 受保護路徑：所有 `/api/*`
- 放行：
  - `/api/download-bind-script`（依需求保留為無需簽章）
  - `/api/config`（前端啟動設定）
  - `/api/control/info`（JSON 版設定輸出）
  - `/api/ws`（WebSocket 升級握手不做 HTTP 身分驗證；控制端訊息仍需簽章）
  - `/api/transfer/download/:token`（暫時性 token 下載）
  - `/api/transfer/upload/:token`（暫時性 token 上傳）
  - `OPTIONS` 預檢請求（CORS）

HTTP 請求可用以下兩種方式帶上簽章（擇一使用）：

1. **請求標頭（建議）**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Query 參數（適用於下載、`window.open`、`img` 等不便加入自訂 header 的情境）**
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

範例：

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

### 控制端通用訊息格式

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### HTTP 代理（control/http）

控制端可透過 WebSocket 傳送 `control/http`，將 HTTP 請求轉發到裝置（裝置側以 `http.request` 執行），常用於 WebRTC 相關介面。

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

> 說明：`body` 需要使用 base64 編碼；當請求為 `/api/webrtc/start` 且 TURN 已啟用時，伺服器會自動加入 `iceServers`。

### 裝置端上線

裝置端傳送 `app/state`，並在 `body.system.udid` 中提供唯一識別碼。
支援全域硬體鍵盤的裝置也會宣告以下選用功能；欄位不存在或不為 `true` 時，控制端不會傳送硬體鍵盤指令：

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

控制端透過 `control/command` 下達 `key/global-keyboard`，裝置端則以相同類型回覆。`owner` 用來識別一次即時控制工作階段；裝置只允許相符的 owner 中斷其鍵盤連線：

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

`action` 支援 `status`、`connect`、`disconnect`。回應 `body` 包含 `action`、`owner`、`supported`、`ok`、`connected`，失敗時可附帶 `message`。

### 裝置中斷連線

伺服器端通知控制端：
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### 裝置列表

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

回應：
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### 重新整理裝置狀態

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
伺服器端會向所有裝置廣播 `app/state` 請求。

### 即時日誌訂閱

訂閱指定裝置的日誌：

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

取消訂閱：

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

裝置端若支援日誌推送，會傳送：

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### 批次指令

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

## 常用指令類型

### 檔案操作

#### 上傳檔案
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

#### 建立目錄
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

#### 列出目錄
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

#### 下載檔案
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

#### 複製檔案
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

#### 移動檔案
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

#### 刪除檔案
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

### 裝置控制

#### 重新載入裝置桌面
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

#### 重新啟動裝置
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

#### 觸控指令
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

說明：

- `finger` 為可選欄位，範圍 `0 ~ 29`。
- 不傳 `finger` 時，裝置端仍會依照舊版單指通訊協定處理，以維持相容性。
- 多點觸控透過多則 `touch/down|touch/move|touch/up` 訊息搭配固定的 `finger` 值表示；同一根手指從按下到抬起都必須使用相同的 `finger`。

#### 按鍵指令
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

#### 螢幕擷取畫面
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

### 剪貼簿

#### 讀取剪貼簿
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

#### 寫入剪貼簿
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

### 字典/佇列/腳本選擇

#### 設定字典值
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

#### 推送佇列
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

#### 選取腳本
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

### 腳本控制

#### 啟動腳本
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

#### 停止腳本
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

## 安全說明

- 所有控制指令（WebSocket）與綁定腳本下載以外的 HTTP API，都必須使用 HMAC-SHA256 動態簽章驗證
- 首次啟動會產生隨機密碼（只顯示一次），建議儘快修改
- 大檔案建議透過 `/api/transfer/*` 使用 HTTP 暫時性 token 傳輸（WebSocket 僅適合小檔案與控制訊息）
