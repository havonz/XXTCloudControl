# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | [日本語](README.ja-JP.md) | 한국어 | [Tiếng Việt](README.vi-VN.md) | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | [Français](README.fr-FR.md) | [Deutsch](README.de-DE.md)

XXTouch 1.3.8-20260122000000 이상을 위한 클라우드 제어 서버(WebSocket + 정적 프런트엔드)와 관리 패널입니다.  
기기 측 프로토콜 구현 소스는 `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua`에 있습니다.  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## 릴리스

- 공식 다운로드 페이지(GitHub Pages): [https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- 모든 플랫폼의 릴리스: [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- Release 자산에서 `XXTCloudControl-<YYYYMMDDHHMM>.zip`을 우선 다운로드한 뒤 압축을 풀고 운영 체제에 맞는 바이너리를 실행하는 것을 권장합니다.


## 프로젝트 구조

- `server/` - 백엔드 WebSocket/HTTP 서비스(진입점: `server/main.go`)
- `frontend/` - SolidJS 관리 패널. 소스는 `frontend/src/`, 빌드 결과물은 `frontend/dist/`에 있습니다
- `device-client/` - Lua WebSocket 클라이언트 라이브러리
- `XXT 云控设置.lua` - 기존 중국어 간체 기기 설정 스크립트(클라우드 제어 주소 기록)
- `device-scripts/settings/` - 11개 언어의 독립 실행형 기기 설정 스크립트
- `docs/i18n/` - README 전체 번역본
- `build.sh` - 다중 플랫폼 서버와 프런트엔드를 빌드하고 패키징합니다
- `build/` - 빌드 결과물 디렉터리
- `server/data/` - 런타임 데이터 디렉터리(기본값 `data_dir=./data`, 시작 디렉터리 기준 상대 경로)

## 주요 기능

- 실시간 WebSocket 통신 및 기기 상태 동기화
- 프런트엔드와 백엔드 통합 배포. 서버에서 정적 프런트엔드를 직접 호스팅할 수 있습니다
- 기기 일괄 제어: 스크립트, 터치, 키, 재부팅/리스프링, 클립보드
- 선택적으로 내장 TURN을 사용하는 WebRTC 실시간 데스크톱 제어
- FormRunner 동적 폼을 통한 기기 그룹 및 스크립트 설정
- 서버 측 파일 저장소(scripts/files/reports)와 기기/서버 간 양방향 파일 전송(작은 파일은 WS, 큰 파일은 HTTP token)
- WebRTC 등의 기기 API를 위해 로컬 HTTP로 요청을 전달하는 `control/http` 프록시

## 빠른 시작

### 바이너리 다운로드 및 실행(권장)

1. 릴리스 페이지를 열고 최신 `XXTCloudControl-<YYYYMMDDHHMM>.zip`을 다운로드합니다.  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. 압축을 풀고 해당 디렉터리로 이동한 다음 운영 체제에 맞는 바이너리를 실행합니다.
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
3. 처음 시작하면 현재 디렉터리에 `xxtcloudserver.json`이 생성되고 임의의 비밀번호가 출력됩니다(한 번만 표시).
4. 브라우저에서 `http://<服务器地址>:46980`에 접속하여 관리 패널에 로그인합니다.
5. 비밀번호를 잊은 경우 같은 디렉터리에서 비밀번호를 재설정한 뒤 서비스를 다시 시작합니다.
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Docker 배포

#### 빠른 시작(권장)

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

> 참고: 데이터 디렉터리를 마운트하지 않으면 컨테이너 내부의 `/app/data`에 데이터와 설정이 생성됩니다.
> 서비스는 설정 파일을 먼저 읽고 환경 변수로 값을 덮어씁니다. 환경 변수 값은 설정 파일에 자동으로 기록되지 않습니다.
> 환경 변수 이름은 [docker-compose.yml](../../docker-compose.yml) 예제를 참고하십시오.

#### docker-compose.yml로 한 번에 배포

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### 프로덕션 빌드 및 패키징(소스 빌드)

> 요구 사항: `go`, `npm`, `zip`

```bash
bash build.sh
```

`build/`에 각 플랫폼용 바이너리와 패키징된 zip 파일이 생성됩니다.
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

압축을 풀면 디렉터리 구조는 다음과 같습니다.
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
이 디렉터리에서 운영 체제에 맞는 바이너리를 실행하면 프런트엔드가 자동으로 호스팅됩니다(기본값 `frontend_dir=./frontend`).

### Docker 이미지 빌드

> 요구 사항: `docker`(buildx 활성화 필요)

```bash
bash build-docker.sh
```

결과물은 `build/`에 생성됩니다.
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### 개발 모드

1. 백엔드를 시작합니다.
   ```bash
   cd server
   go run .
   ```
   처음 시작하면 현재 디렉터리에 `xxtcloudserver.json`이 생성되고 임의의 비밀번호가 출력됩니다(한 번만 표시).

2. 프런트엔드 개발 서버를 시작합니다.
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   `http://localhost:3000`에 접속한 뒤 로그인 페이지에서 서버 주소, 포트(기본값 `46980`), 비밀번호를 입력합니다.
   
   > 참고: 개발 서버는 기본적으로 `127.0.0.1:3000`에 바인딩되고 `/api` 요청을 `http://127.0.0.1:46980`으로 프록시합니다. 백엔드가 로컬 컴퓨터에 없다면 `frontend/vite.config.ts`를 조정하거나 역방향 프록시를 사용하십시오.

> 주의: `server` 디렉터리에서 `go run .`을 실행하면 `frontend_dir`의 기본값은 `./frontend`이며 `../frontend/dist`를 자동으로 가리키지 않습니다. 백엔드에서 프런트엔드를 호스팅하려면 설정의 `frontend_dir`을 지정하거나 패키징된 디렉터리 구조를 사용하십시오.

### 비밀번호 변경

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

소스 모드에서는 다음 명령을 사용합니다.
```bash
cd server
go run . -set-password 12345678
```

## 자주 사용하는 명령줄 옵션

- `-config <path>`: 설정 파일 경로를 지정합니다(기본값은 시작 디렉터리의 `xxtcloudserver.json`).
- `-set-password <pwd>`: 제어 측 비밀번호를 변경합니다.
- `-set-turn-ip <ip>`: TURN 공인 IP를 설정하고 활성화합니다.
- `-set-turn-port <port>`: TURN 수신 포트를 설정하고 활성화합니다.
- `-v` / `-h`: 버전 또는 도움말을 표시합니다.

## 설정

기본 설정 파일: `xxtcloudserver.json`(시작 디렉터리에 생성)

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

- `passhash`는 `hmacSHA256("XXTouch", password)`의 결과이며 평문 비밀번호가 아닙니다.
- `ping_interval`은 하트비트 확인 주기입니다. 서버가 이 간격마다 기기에 WebSocket PING 프레임을 보내 온라인 상태를 확인합니다.
- `state_interval`은 상태 새로 고침 주기입니다. 서버가 이 간격마다 기기에 `app/state` 요청을 보내 최신 상태를 가져옵니다.
- `ping_timeout`은 기기가 연속으로 응답하지 않아도 허용되는 횟수입니다(`ping_interval` 주기 기준). 이 값을 초과하면 서버가 해당 기기의 연결을 끊습니다.
- `data_dir`에는 기본적으로 `scripts/`, `files/`, `reports/`와 그룹 및 스크립트 설정 등의 영구 데이터가 생성됩니다.
- 설정의 경로는 모두 시작 디렉터리를 기준으로 합니다. `server/` 디렉터리에서 시작하면 기본값 `data_dir=./data`는 `server/data/`를 가리킵니다.
- `turnEnabled`의 기본값은 `true`이지만, `turnPublicIP` 또는 `turnPublicAddr`를 설정해야 내장 TURN이 실제로 시작됩니다.

## WebRTC NAT 통과(TURN) 설정

외부 네트워크에서도 실시간 데스크톱 제어를 사용할 수 있도록 서버에는 UDP/TCP를 지원하는 TURN 서버가 내장되어 있습니다.

### TURN 공개 주소 설정

서버는 다음 두 가지 공개 주소 설정 방식을 지원합니다.

| 필드 | 형식 | 검증 | 사용 사례 |
|------|------|------|----------|
| `turnPublicIP` | IPv4 주소만 | `net.ParseIP()`로 검증 | 고정 공인 IP 사용 |
| `turnPublicAddr` | IPv4 또는 도메인 | 도메인을 DNS로 자동 조회 | 도메인으로 접속 |

> [!IMPORTANT]
> **IPv4만 지원**: 현재 TURN 서버는 IPv4 주소만 지원합니다. IPv6 주소 또는 AAAA 레코드만 있는 도메인을 사용하면 시작에 실패합니다.
>
> 두 값을 모두 설정하면 `turnPublicIP`가 우선합니다. 둘 중 하나만 설정해도 내장 TURN이 활성화됩니다.

설정 예:

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

### 사용자 지정 ICE 서버

내장 TURN 외에도 외부 STUN/TURN 서버를 설정할 수 있습니다. 다음과 같은 경우에 유용합니다.

- 로컬 TURN 서비스를 사용하지 않고 타사 TURN 서비스(예: [Metered](https://www.metered.ca/tools/openrelay/))를 사용하려는 경우
- 로컬 TURN과 외부 서비스를 함께 사용하여 NAT 통과 기능을 강화하려는 경우

> [!WARNING]
> **보안 안내**: `customIceServers`의 설정(`username`, `credential` 포함)은 WebRTC 연결 시 기기로 전송되므로 **기밀 정보가 아닙니다**. 임시 자격 증명을 지원하는 TURN 서비스를 사용하거나 자격 증명을 공개해도 안전한지 확인하십시오.

설정 예:

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

**병합 동작:**

| 로컬 TURN | 사용자 지정 ICE Servers | 결과 |
|-----------|-------------------|------|
| 활성화 | 없음 | 로컬 TURN만 사용 |
| 비활성화 | 있음 | 사용자 지정 ICE Servers만 사용 |
| 활성화 | 있음 | **병합**: 로컬 TURN + 사용자 지정 ICE Servers |
| 비활성화 | 없음 | ICE 서버 없이 WebRTC 직접 연결만 시도 |

### 빠른 설정 명령

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> `turnSecretKey`가 비어 있으면 시작 시 임시 키를 자동으로 생성하며 재시작할 때마다 바뀝니다. 고정된 TURN 자격 증명이 필요하면 직접 설정하십시오.

### 관리자 방화벽 설정

서버 관리자는 클라우드 보안 그룹 또는 방화벽에서 다음 포트를 열어야 합니다.

| 포트 범위 | 프로토콜 | 용도 |
|----------|------|------|
| `46980` (또는 사용자 지정) | **TCP** | **클라우드 제어 서비스** (API 및 WebSocket) |
| `43478` (또는 사용자 지정) | **UDP 및 TCP** | WebRTC [TURN] 제어, 핸드셰이크 및 폴백 |
| `49152 - 65535` | **UDP** | WebRTC [TURN] 실시간 미디어 스트림 릴레이 |

> [!TIP]
> 미디어 릴레이는 UDP를 우선 사용합니다. UDP 트래픽이 엄격하게 제한된 환경에서는 데스크톱 스트림을 안정적으로 전송하기 위해 WebRTC가 자동으로 TCP(포트 43478)로 전환합니다.

## TLS/HTTPS 설정(선택 사항)

서버는 역방향 프록시 없이도 암호화 연결을 사용할 수 있는 네이티브 HTTPS/WSS를 지원하며, Nginx/Caddy 같은 역방향 프록시와 함께 사용할 수도 있습니다.

### 1) TLS 설정

`xxtcloudserver.json`에 다음 값을 설정합니다.

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) 로컬 테스트 인증서 생성

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> 자체 서명 인증서는 로컬 테스트에만 사용하십시오. 프로덕션 환경에서는 Let's Encrypt 또는 다른 CA가 서명한 인증서를 사용하십시오.

### 3) 역방향 프록시 모드

Nginx/Caddy 같은 역방향 프록시를 사용하면 서버는 HTTP 모드로 실행되고 프록시가 TLS 종료를 처리합니다. 이때 바인딩 스크립트는 `X-Forwarded-Proto` 요청 헤더로 프로토콜을 자동 감지하여 올바른 `wss://` 주소를 생성합니다.

Nginx 설정 예:

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

## 기기 바인딩 방법

1. 루트 디렉터리의 기존 중국어 간체 스크립트 `XXT 云控设置.lua`를 실행하거나 `device-scripts/settings/`에서 해당 언어의 독립 실행형 스크립트를 선택하고 `ws://<host>:46980/api/ws`를 입력합니다(TLS 또는 역방향 프록시 환경에서는 `wss://` 사용).
2. 또는 자동 생성된 바인딩 스크립트를 다운로드합니다.
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   `proto=https`를 추가하면 `wss://` 주소를 강제로 생성할 수 있습니다. 역방향 프록시 환경에서는 `X-Forwarded-Proto`로 프로토콜을 자동 감지할 수도 있습니다.
3. 또는 기기의 로컬 API를 직접 호출합니다.
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

클라우드 제어를 끄려면 `enable`을 `false`로 설정합니다.

`device-scripts/settings/`에는 `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `vi-VN`, `es-ES`, `pt-BR`, `ru-RU`, `fr-FR`, `de-DE` 등 11개 locale용 스크립트가 있습니다. 각 파일은 다른 언어 파일에 의존하지 않고 독립적으로 실행할 수 있습니다.

## WebSocket 규칙

- WebSocket 주소: `ws://<host>:<port>/api/ws`(TLS/역방향 프록시 환경에서는 `wss://` 사용)
- 제어 측 메시지에는 `ts`/`nonce`/`sign`이 포함되어야 합니다. 타임스탬프는 ±60초 오차를 허용하며 `nonce`는 120초 동안 재사용할 수 없습니다.

## 인증 및 서명 알고리즘(HTTP/WS 공통)

이 프로젝트는 고정 token 대신 수명이 짧은 동적 서명을 사용합니다. 클라이언트는 요청마다 현재 초 단위 타임스탬프 `ts`, 임의의 `nonce`, 서명 `sign`을 보내며, 서버는 허용된 시간 범위에서 서명을 검증하고 nonce 재사용을 차단합니다.

### 1) 비밀번호와 passhash

서버 설정 파일 `xxtcloudserver.json`에는 평문 비밀번호가 아닌 `passhash`가 저장됩니다.

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`이며 결과는 64자리 16진수 문자열(hex)입니다.

### 2) sign 계산 방법

제어 서명은 `passhash`를 HMAC key로 사용하여 정규화한 기준 문자열을 HMAC 처리합니다.

#### HTTP 기준 문자열

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD`: 요청 메서드(GET/POST/PUT/DELETE…)
- `PATH_AND_QUERY`: `path` + 정렬된 query(`ts/nonce/sign` 제외)
- `bodyHash`:
  - 일반 요청 본문: `SHA-256(bodyBytes)`의 hex
  - 빈 body 또는 multipart(`multipart/form-data`)는 현재 해시에 포함하지 않음: `bodyHash = ""`

#### WebSocket 기준 문자열

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type`: 메시지 유형(예: `control/devices`)
- `bodyHash`: `body`의 JSON 결과를 `SHA-256`으로 계산한 값(hex). body가 없으면 빈 문자열

최종 서명:

- `sign = HMAC-SHA256(key=passhash, message=base)`이며 결과는 hex 문자열입니다.

> 주의: 여기서 `key=passhash`는 **passhash의 hex 문자열 자체**를 뜻합니다. 즉, hex를 32바이트로 디코딩하지 않고 해당 문자열의 바이트를 그대로 HMAC에 사용합니다.

### 3) 서버 검증 규칙

- 시간 오차: `ts`가 서버의 현재 시간에서 `±60`초 이내일 때만 검증을 계속합니다.
- `nonce`는 `120`초 동안 재사용할 수 없습니다(재사용하면 재전송 공격으로 간주).
- 검증에 실패하면 `401 Unauthorized`(HTTP)를 반환하거나 연결을 즉시 닫습니다(WebSocket 제어 측 메시지).

### 4) HTTP API 인증 방식

`http` 바인딩 스크립트 다운로드를 제외한 모든 HTTP API에는 WebSocket과 같은 알고리즘으로 만든 서명이 필요합니다.

- 보호 경로: 모든 `/api/*`
- 예외:
  - `/api/download-bind-script`(요구 사항에 따라 서명 없이 허용)
  - `/api/config`(프런트엔드 시작 설정)
  - `/api/control/info`(JSON 형식 설정 출력)
  - `/api/ws`(WebSocket 업그레이드 핸드셰이크에는 HTTP 인증을 적용하지 않지만 제어 측 메시지에는 서명이 필요)
  - `/api/transfer/download/:token`(임시 token 다운로드)
  - `/api/transfer/upload/:token`(임시 token 업로드)
  - `OPTIONS` 프리플라이트 요청(CORS)

HTTP 요청에는 다음 두 방법 중 하나로 서명을 전달할 수 있습니다.

1. **요청 헤더(권장)**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Query 매개변수**(다운로드, `window.open`, `img`처럼 사용자 지정 header를 추가하기 어려운 경우)
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

예:

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

### 제어 측 공통 메시지 형식

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### HTTP 프록시(control/http)

제어 측은 WebSocket으로 `control/http`를 보내 HTTP 요청을 기기에 전달할 수 있습니다. 기기는 `http.request`로 요청을 실행하며, 주로 WebRTC 관련 API에 사용합니다.

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

> 설명: `body`는 base64로 인코딩해야 합니다. 요청이 `/api/webrtc/start`이고 TURN이 활성화되어 있으면 서버가 `iceServers`를 자동으로 삽입합니다.

### 기기 연결

기기는 `app/state`를 보내고 `body.system.udid`에 고유 식별자를 제공합니다.
전역 하드웨어 키보드를 지원하는 기기는 다음 선택 기능도 선언합니다. 필드가 없거나 `true`가 아니면 제어 측에서 하드웨어 키보드 명령을 보내지 않습니다.

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

제어 측은 `control/command`로 `key/global-keyboard`를 보내고 기기는 같은 유형으로 응답합니다. `owner`는 실시간 제어 세션 하나를 식별하며, 기기는 owner가 일치할 때만 해당 키보드 연결을 끊도록 허용합니다.

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

`action`은 `status`, `connect`, `disconnect`를 지원합니다. 응답 `body`에는 `action`, `owner`, `supported`, `ok`, `connected`가 포함되며 실패 시 `message`를 추가할 수 있습니다.

### 기기 연결 해제

서버가 제어 측에 다음 메시지를 보냅니다.
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### 기기 목록

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

응답:
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### 기기 상태 새로 고침

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
서버가 모든 기기에 `app/state` 요청을 브로드캐스트합니다.

### 실시간 로그 구독

지정한 기기의 로그 구독:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

구독 취소:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

기기가 로그 푸시를 지원하면 다음 메시지를 보냅니다.

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### 일괄 명령

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

## 자주 사용하는 명령 유형

### 파일 작업

#### 파일 업로드
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

#### 디렉터리 생성
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

#### 디렉터리 목록
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

#### 파일 다운로드
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

#### 파일 복사
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

#### 파일 이동
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

#### 파일 삭제
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

### 기기 제어

#### 기기 리스프링
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

#### 기기 재부팅
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

#### 터치 명령
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

설명:

- `finger`는 선택 필드이며 범위는 `0 ~ 29`입니다.
- `finger`를 보내지 않으면 기기는 이전 단일 터치 프로토콜로 처리하여 하위 호환성을 유지합니다.
- 멀티터치는 여러 `touch/down|touch/move|touch/up` 메시지와 고정된 `finger` 값을 조합해 표현합니다. 같은 손가락은 누를 때부터 뗄 때까지 동일한 `finger` 값을 사용해야 합니다.

#### 키 명령
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

#### 스크린샷
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

### 클립보드

#### 클립보드 읽기
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

#### 클립보드 쓰기
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

### 사전/대기열/스크립트 선택

#### 사전 값 설정
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

#### 대기열에 추가
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

#### 스크립트 선택
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

### 스크립트 제어

#### 스크립트 시작
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

#### 스크립트 중지
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

## 보안 안내

- 모든 제어 명령(WebSocket)과 바인딩 스크립트 다운로드를 제외한 HTTP API에는 HMAC-SHA256 동적 서명 검증이 필요합니다.
- 처음 시작할 때 임의의 비밀번호가 생성되어 한 번만 표시되므로 즉시 변경하는 것이 좋습니다.
- 큰 파일은 `/api/transfer/*`의 임시 token을 사용해 HTTP로 전송하는 것이 좋습니다(WebSocket은 작은 파일과 제어 메시지에만 적합).
