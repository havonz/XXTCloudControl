# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | Tiếng Việt | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | [Français](README.fr-FR.md) | [Deutsch](README.de-DE.md)

Dịch vụ máy chủ điều khiển đám mây (WebSocket + frontend tĩnh) và bảng quản trị dành cho XXTouch 1.3.8-20260122000000 trở lên.  
Mã nguồn triển khai giao thức phía thiết bị nằm tại `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua` trên thiết bị.  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## Bản phát hành

- Trang tải xuống chính thức (GitHub Pages): [https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- Danh sách bản phát hành cho mọi nền tảng: [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- Nên ưu tiên tải `XXTCloudControl-<YYYYMMDDHHMM>.zip` trong phần tài sản của Release. Giải nén rồi chạy tệp nhị phân phù hợp với hệ điều hành.


## Cấu trúc dự án

- `server/` - Dịch vụ WebSocket/HTTP backend (điểm vào: `server/main.go`)
- `frontend/` - Bảng quản trị SolidJS; mã nguồn ở `frontend/src/`, sản phẩm build ở `frontend/dist/`
- `device-client/` - Thư viện máy khách WebSocket Lua
- `XXT 云控设置.lua` - Script thiết lập thiết bị bằng tiếng Trung giản thể (ghi địa chỉ điều khiển đám mây)
- `device-scripts/settings/` - Script thiết lập thiết bị độc lập bằng 11 ngôn ngữ
- `docs/i18n/` - Các bản dịch đầy đủ của README
- `build.sh` - Build và đóng gói server cùng frontend đa nền tảng
- `build/` - Thư mục sản phẩm build
- `server/data/` - Thư mục dữ liệu runtime (`data_dir=./data` mặc định, tính từ thư mục khởi động)

## Tính năng

- Giao tiếp WebSocket thời gian thực và đồng bộ trạng thái thiết bị
- Triển khai frontend và backend tích hợp; server có thể trực tiếp phục vụ frontend tĩnh
- Điều khiển hàng loạt thiết bị: script, cảm ứng, phím, khởi động lại/respring và clipboard
- Điều khiển desktop WebRTC thời gian thực với tùy chọn xuyên NAT TURN tích hợp
- Nhóm thiết bị và cấu hình script qua biểu mẫu động FormRunner
- Kho tệp phía server (scripts/files/reports) cùng truyền tệp hai chiều giữa thiết bị/server (WS cho tệp nhỏ, HTTP token cho tệp lớn)
- Proxy `control/http` tới API HTTP cục bộ của thiết bị, bao gồm API WebRTC

## Bắt đầu nhanh

### Tải xuống và chạy tệp nhị phân (khuyến nghị)

1. Mở trang phát hành và tải bản `XXTCloudControl-<YYYYMMDDHHMM>.zip` mới nhất:  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. Giải nén, vào thư mục rồi chạy tệp nhị phân tương ứng với hệ điều hành:
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
3. Trong lần khởi động đầu tiên, máy chủ sẽ tạo `xxtcloudserver.json` trong thư mục hiện tại và hiển thị một mật khẩu ngẫu nhiên (chỉ hiển thị một lần).
4. Mở `http://<địa-chỉ-máy-chủ>:46980` trong trình duyệt để đăng nhập vào bảng quản lý.
5. Nếu quên mật khẩu, bạn có thể đặt lại mật khẩu trong cùng thư mục rồi khởi động lại dịch vụ:
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Triển khai bằng Docker

#### Khởi động nhanh (khuyến nghị)

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

> Gợi ý: Nếu không gắn thư mục dữ liệu, dữ liệu và cấu hình sẽ được tạo mặc định tại `/app/data` bên trong container.
> Khi khởi động, dịch vụ sẽ đọc tệp cấu hình trước rồi áp dụng các giá trị ghi đè từ biến môi trường. Biến môi trường không được tự động ghi ngược vào tệp cấu hình.
> Xem ví dụ [docker-compose.yml](../../docker-compose.yml) để biết tên các biến môi trường.

#### Triển khai bằng docker-compose.yml

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### Xây dựng và đóng gói bản phát hành (từ mã nguồn)

> Phụ thuộc: `go`, `npm`, `zip`

```bash
bash build.sh
```

Các tệp đầu ra được lưu trong `build/`, bao gồm tệp nhị phân cho từng nền tảng và gói zip:
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

Cấu trúc thư mục sau khi giải nén như sau:
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
Chạy tệp nhị phân phù hợp với hệ điều hành ngay trong thư mục này để máy chủ tự động phục vụ frontend (`frontend_dir=./frontend` theo mặc định).

### Xây dựng image Docker

> Phụ thuộc: `docker` với buildx đã được bật

```bash
bash build-docker.sh
```

Các tệp đầu ra được lưu trong `build/`:
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### Chế độ phát triển

1. Khởi động backend:
   ```bash
   cd server
   go run .
   ```
   Trong lần khởi động đầu tiên, máy chủ sẽ tạo `xxtcloudserver.json` trong thư mục hiện tại và hiển thị một mật khẩu ngẫu nhiên (chỉ hiển thị một lần).

2. Khởi động máy chủ phát triển frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Mở `http://localhost:3000`, rồi nhập địa chỉ máy chủ, cổng (`46980` theo mặc định) và mật khẩu trên trang đăng nhập.
   
   > Gợi ý: Máy chủ phát triển mặc định lắng nghe tại `127.0.0.1:3000` và chuyển tiếp `/api` đến `http://127.0.0.1:46980`. Nếu backend không chạy trên máy cục bộ, hãy điều chỉnh `frontend/vite.config.ts` hoặc sử dụng reverse proxy.

> Lưu ý: Khi chạy `go run .` trong thư mục `server`, `frontend_dir` mặc định là `./frontend` và không tự động trỏ đến `../frontend/dist`. Để backend phục vụ frontend, hãy đặt `frontend_dir` trong cấu hình hoặc sử dụng cấu trúc thư mục đã đóng gói.

### Đổi mật khẩu

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

Hoặc khi chạy từ mã nguồn:
```bash
cd server
go run . -set-password 12345678
```

## Các tùy chọn dòng lệnh thường dùng

- `-config <path>`: Chỉ định đường dẫn tệp cấu hình (mặc định dùng `xxtcloudserver.json` trong thư mục khởi động)
- `-set-password <pwd>`: Đổi mật khẩu của bộ điều khiển
- `-set-turn-ip <ip>`: Đặt địa chỉ IP công khai cho TURN và bật TURN
- `-set-turn-port <port>`: Đặt cổng lắng nghe của TURN và bật TURN
- `-v` / `-h`: Xem phiên bản / trợ giúp

## Cấu hình

Tệp cấu hình mặc định: `xxtcloudserver.json` (được tạo trong thư mục khởi động)

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

- `passhash` là kết quả của `hmacSHA256("XXTouch", password)`, không phải mật khẩu dạng văn bản thuần.
- `ping_interval` quy định tần suất heartbeat. Máy chủ gửi khung WebSocket PING đến thiết bị theo chu kỳ này để kiểm tra trạng thái trực tuyến.
- `state_interval` quy định tần suất làm mới trạng thái. Máy chủ gửi yêu cầu `app/state` đến thiết bị theo chu kỳ này để lấy trạng thái mới nhất.
- `ping_timeout` là ngưỡng số lần thiết bị liên tiếp không phản hồi, tính theo chu kỳ `ping_interval`. Máy chủ sẽ ngắt kết nối thiết bị khi vượt quá ngưỡng.
- Theo mặc định, `data_dir` chứa dữ liệu lưu bền như `scripts/`, `files/`, `reports/`, dữ liệu nhóm và cấu hình script.
- Mọi đường dẫn trong cấu hình đều tương đối so với thư mục khởi động. Khi khởi động trong thư mục `server/`, giá trị mặc định `data_dir=./data` tương ứng với `server/data/`.
- `turnEnabled` mặc định là `true`, nhưng máy chủ TURN tích hợp chỉ thực sự khởi động khi đã cấu hình `turnPublicIP` hoặc `turnPublicAddr`.

## Cấu hình truyền xuyên WebRTC (TURN)

Để hỗ trợ điều khiển màn hình theo thời gian thực qua mạng bên ngoài, máy chủ tích hợp sẵn TURN hỗ trợ cả UDP và TCP.

### Cấu hình địa chỉ TURN

Máy chủ hỗ trợ hai cách cấu hình địa chỉ công khai:

| Trường | Định dạng | Kiểm tra | Trường hợp sử dụng |
|------|------|------|----------|
| `turnPublicIP` | Chỉ địa chỉ IPv4 | Kiểm tra bằng `net.ParseIP()` | Có địa chỉ IP công khai cố định |
| `turnPublicAddr` | IPv4 hoặc tên miền | Tên miền được tự động phân giải qua DNS | Truy cập bằng tên miền |

> [!IMPORTANT]
> **Chỉ hỗ trợ IPv4**: Máy chủ TURN hiện chỉ hỗ trợ địa chỉ IPv4. Địa chỉ IPv6 hoặc tên miền chỉ có bản ghi AAAA sẽ khiến quá trình khởi động thất bại.
>
> Nếu cấu hình cả hai, `turnPublicIP` được ưu tiên. Chỉ cần cấu hình một trong hai để bật TURN tích hợp.

Ví dụ cấu hình:

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

### Máy chủ ICE tùy chỉnh

Ngoài TURN tích hợp, bạn có thể cấu hình máy chủ STUN/TURN bên ngoài. Tùy chọn này hữu ích khi:

- Bạn muốn dùng dịch vụ TURN của bên thứ ba, chẳng hạn như [Metered](https://www.metered.ca/tools/openrelay/), thay vì bật TURN cục bộ
- Bạn muốn kết hợp TURN cục bộ với dịch vụ bên ngoài để tăng khả năng kết nối

> [!WARNING]
> **Lưu ý bảo mật**: Cấu hình trong `customIceServers`, bao gồm `username` và `credential`, sẽ được gửi đến thiết bị khi thiết lập kết nối WebRTC và **không phải thông tin bí mật**. Hãy dùng dịch vụ TURN hỗ trợ thông tin xác thực tạm thời hoặc bảo đảm thông tin xác thực có thể được chia sẻ công khai.

Ví dụ cấu hình:

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

**Cách hoạt động khi kết hợp:**

| TURN cục bộ | Máy chủ ICE tùy chỉnh | Kết quả |
|-----------|-------------------|------|
| Bật | Không có | Chỉ dùng TURN cục bộ |
| Tắt | Có | Chỉ dùng máy chủ ICE tùy chỉnh |
| Bật | Có | **Kết hợp**: TURN cục bộ + máy chủ ICE tùy chỉnh |
| Tắt | Không có | Không dùng máy chủ ICE; WebRTC chỉ thử kết nối trực tiếp |

### Lệnh thiết lập nhanh

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> Khi `turnSecretKey` để trống, một khóa tạm thời sẽ được tự động tạo lúc khởi động và thay đổi sau mỗi lần khởi động lại. Hãy cấu hình thủ công nếu cần thông tin xác thực TURN ổn định.

### Cấu hình tường lửa dành cho quản trị viên

Quản trị viên máy chủ cần mở các cổng sau trong nhóm bảo mật đám mây hoặc tường lửa:

| Dải cổng | Giao thức | Mục đích |
|----------|------|------|
| `46980` (hoặc cổng tùy chỉnh) | **TCP** | **Dịch vụ điều khiển đám mây** (API và WebSocket) |
| `43478` (hoặc cổng tùy chỉnh) | **UDP và TCP** | Điều khiển, bắt tay và dự phòng WebRTC TURN |
| `49152 - 65535` | **UDP** | Chuyển tiếp luồng phương tiện WebRTC TURN theo thời gian thực |

> [!TIP]
> Chuyển tiếp phương tiện ưu tiên UDP. Khi lưu lượng UDP bị hạn chế nghiêm ngặt, WebRTC tự động chuyển sang TCP (cổng 43478) để luồng màn hình vẫn được truyền bình thường.

## Cấu hình TLS/HTTPS (tùy chọn)

Máy chủ hỗ trợ trực tiếp HTTPS/WSS, vì vậy có thể bật kết nối mã hóa mà không cần reverse proxy. Máy chủ cũng tương thích với cách triển khai qua reverse proxy như Nginx hoặc Caddy.

### 1) Cấu hình TLS

Đặt các giá trị sau trong `xxtcloudserver.json`:

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) Tạo chứng chỉ kiểm thử cục bộ

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> Chứng chỉ tự ký chỉ phù hợp để kiểm thử cục bộ. Trong môi trường production, hãy dùng chứng chỉ do Let's Encrypt hoặc một CA khác cấp.

### 3) Chế độ reverse proxy

Khi dùng reverse proxy như Nginx hoặc Caddy, máy chủ có thể tiếp tục chạy ở chế độ HTTP còn proxy xử lý việc kết thúc TLS. Khi đó, script liên kết sẽ tự động phát hiện giao thức qua header `X-Forwarded-Proto` và tạo đúng địa chỉ `wss://`.

Ví dụ cấu hình Nginx:

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

## Cách liên kết thiết bị

1. Chạy script tiếng Trung giản thể `XXT 云控设置.lua` có sẵn ở thư mục gốc, hoặc chọn script độc lập theo ngôn ngữ trong `device-scripts/settings/`, rồi nhập `ws://<host>:46980/api/ws` (dùng `wss://` khi có TLS hoặc reverse proxy).
2. Hoặc tải script liên kết được tạo tự động:
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   Có thể thêm `proto=https` để buộc tạo địa chỉ `wss://`; khi dùng reverse proxy, giao thức cũng có thể được tự động nhận diện từ `X-Forwarded-Proto`.
3. Hoặc gọi thủ công API cục bộ của thiết bị:
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

Để tắt điều khiển đám mây, đặt `enable` thành `false`.

`device-scripts/settings/` cung cấp script cho 11 locale: `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `vi-VN`, `es-ES`, `pt-BR`, `ru-RU`, `fr-FR` và `de-DE`. Mỗi tệp có thể chạy độc lập và không phụ thuộc vào tệp ngôn ngữ khác.

## Quy ước WebSocket

- Địa chỉ WebSocket: `ws://<host>:<port>/api/ws` (dùng `wss://` khi có TLS hoặc reverse proxy)
- Tin nhắn từ bộ điều khiển phải chứa `ts`, `nonce` và `sign`. Timestamp được phép lệch ±60 giây và `nonce` không được lặp lại trong vòng 120 giây.

## Thuật toán xác thực và ký (dùng chung cho HTTP/WebSocket)

Quá trình xác thực không dùng token cố định mà dùng chữ ký động có hiệu lực ngắn. Mỗi yêu cầu của client mang timestamp hiện tại theo giây trong `ts`, một `nonce` ngẫu nhiên và chữ ký `sign`. Máy chủ kiểm tra chữ ký trong khoảng thời gian cho phép và từ chối `nonce` trùng lặp.

### 1) Mật khẩu và passhash

Tệp cấu hình máy chủ `xxtcloudserver.json` lưu `passhash`, không lưu mật khẩu dạng văn bản thuần:

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`, cho kết quả là chuỗi thập lục phân dài 64 ký tự.

### 2) Cách tính sign

Chữ ký điều khiển dùng `passhash` làm HMAC key và áp dụng HMAC cho chuỗi cơ sở đã chuẩn hóa:

#### Chuỗi cơ sở HTTP

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD`: Phương thức yêu cầu (GET/POST/PUT/DELETE…)
- `PATH_AND_QUERY`: `path` + query đã sắp xếp (loại bỏ `ts`, `nonce`, `sign`)
- `bodyHash`：
  - Body thông thường: chuỗi thập lục phân của `SHA-256(bodyBytes)`
  - Body rỗng hoặc multipart (`multipart/form-data`) hiện chưa được tính: `bodyHash = ""`

#### Chuỗi cơ sở WebSocket

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type`: Loại tin nhắn (ví dụ `control/devices`)
- `bodyHash`: Chuỗi thập lục phân của `SHA-256` áp dụng lên dạng JSON của `body`; nếu không có body thì dùng chuỗi rỗng

Chữ ký cuối cùng:

- `sign = HMAC-SHA256(key=passhash, message=base)`, cho kết quả là một chuỗi thập lục phân.

> Lưu ý: `key=passhash` ở đây là **chính chuỗi thập lục phân của passhash**, được đưa vào HMAC dưới dạng các byte của chuỗi. Không giải mã chuỗi thập lục phân thành 32 byte trước khi tính.

### 3) Quy tắc kiểm tra phía máy chủ

- Độ lệch thời gian cho phép: Chỉ tiếp tục kiểm tra khi `ts` nằm trong khoảng `±60` giây so với thời gian hiện tại của máy chủ.
- `nonce` không được lặp lại trong `120` giây; giá trị lặp được xem là một lần phát lại.
- Khi kiểm tra thất bại, HTTP trả về `401 Unauthorized`; đối với tin nhắn điều khiển WebSocket, kết nối sẽ bị đóng ngay.

### 4) Xác thực HTTP API

Ngoại trừ việc tải script liên kết qua HTTP, mọi HTTP API đều phải mang chữ ký theo cùng thuật toán với WebSocket:

- Đường dẫn được bảo vệ: tất cả `/api/*`
- Ngoại lệ:
  - `/api/download-bind-script` (được giữ không cần chữ ký theo yêu cầu)
  - `/api/config` (cấu hình khởi động frontend)
  - `/api/control/info` (xuất cấu hình dạng JSON)
  - `/api/ws` (bắt tay nâng cấp WebSocket không dùng xác thực HTTP; tin nhắn điều khiển vẫn cần chữ ký)
  - `/api/transfer/download/:token` (tải xuống bằng token tạm thời)
  - `/api/transfer/upload/:token` (tải lên bằng token tạm thời)
  - Yêu cầu preflight `OPTIONS` (CORS)

Yêu cầu HTTP có thể gửi thông tin xác thực theo một trong hai cách:

1. **Header của yêu cầu (khuyến nghị)**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Tham số query (dành cho tải xuống, `window.open`, `img` và các trường hợp khó thêm header tùy chỉnh)**
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

Ví dụ:

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

### Định dạng tin nhắn chung của bộ điều khiển

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### Proxy HTTP (`control/http`)

Bộ điều khiển có thể gửi `control/http` qua WebSocket để chuyển tiếp yêu cầu HTTP đến thiết bị, nơi yêu cầu được thực thi bằng `http.request`. Cách này thường được dùng cho các API liên quan đến WebRTC.

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

> Lưu ý: `body` phải được mã hóa base64. Khi yêu cầu đến `/api/webrtc/start` và TURN đang bật, máy chủ sẽ tự động chèn `iceServers`.

### Thiết bị kết nối

Thiết bị gửi `app/state` và cung cấp mã định danh duy nhất trong `body.system.udid`.
Thiết bị hỗ trợ bàn phím phần cứng toàn cục cũng khai báo khả năng tùy chọn sau. Nếu trường này không tồn tại hoặc không phải `true`, bộ điều khiển sẽ không gửi lệnh bàn phím phần cứng:

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

Bộ điều khiển gửi `key/global-keyboard` qua `control/command`, và thiết bị phản hồi bằng cùng loại tin nhắn. `owner` xác định một phiên điều khiển thời gian thực; thiết bị chỉ cho phép owner tương ứng ngắt kết nối bàn phím:

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

`action` hỗ trợ `status`, `connect` và `disconnect`. `body` của phản hồi chứa `action`, `owner`, `supported`, `ok` và `connected`; khi thất bại có thể kèm theo `message`.

### Thiết bị ngắt kết nối

Máy chủ thông báo cho bộ điều khiển:
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### Danh sách thiết bị

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

Phản hồi:
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### Làm mới trạng thái thiết bị

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
Máy chủ phát yêu cầu `app/state` đến tất cả thiết bị.

### Đăng ký log theo thời gian thực

Đăng ký nhận log từ thiết bị được chỉ định:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

Hủy đăng ký:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

Nếu thiết bị hỗ trợ đẩy log, thiết bị sẽ gửi:

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### Lệnh hàng loạt

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

## Các loại lệnh thường dùng

### Thao tác tệp

#### Tải tệp lên
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

#### Tạo thư mục
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

#### Liệt kê thư mục
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

#### Tải tệp xuống
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

#### Sao chép tệp
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

#### Di chuyển tệp
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

#### Xóa tệp
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

### Điều khiển thiết bị

#### Respring thiết bị
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

#### Khởi động lại thiết bị
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

#### Lệnh cảm ứng
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

Lưu ý:

- `finger` là trường tùy chọn, có giá trị từ `0 ~ 29`.
- Khi không gửi `finger`, thiết bị vẫn xử lý theo giao thức một ngón tay cũ để duy trì khả năng tương thích.
- Cảm ứng đa điểm được biểu diễn bằng nhiều tin nhắn `touch/down|touch/move|touch/up` với giá trị `finger` ổn định. Cùng một ngón tay phải dùng cùng một giá trị `finger` từ lúc chạm xuống đến lúc nhấc lên.

#### Lệnh phím
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

#### Chụp màn hình
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

### Bảng nhớ tạm

#### Đọc bảng nhớ tạm
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

#### Ghi vào bảng nhớ tạm
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

### Từ điển, hàng đợi và lựa chọn script

#### Đặt giá trị từ điển
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

#### Đẩy vào hàng đợi
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

#### Chọn script
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

### Điều khiển script

#### Chạy script
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

#### Dừng script
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

## Bảo mật

- Mọi lệnh điều khiển WebSocket và HTTP API ngoại trừ tải script liên kết đều cần xác thực chữ ký động HMAC-SHA256.
- Lần khởi động đầu tiên tạo mật khẩu ngẫu nhiên và chỉ hiển thị một lần. Hãy đổi mật khẩu sớm.
- Với tệp lớn, dùng `/api/transfer/*` cùng HTTP token tạm thời. WebSocket chỉ dành cho tệp nhỏ và tin nhắn điều khiển.
