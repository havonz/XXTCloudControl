# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | 日本語 | [한국어](README.ko-KR.md) | [Tiếng Việt](README.vi-VN.md) | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | [Français](README.fr-FR.md) | [Deutsch](README.de-DE.md)

XXTouch 1.3.8-20260122000000 以降に対応したクラウド制御サーバー（WebSocket + 静的フロントエンド）および管理パネルです。  
デバイス側のプロトコル実装は、デバイス上の `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua` にあります。  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## リリース

- 公式ダウンロードページ（GitHub Pages）：[https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- 各プラットフォームのリリース：[https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- Release アセットから `XXTCloudControl-<YYYYMMDDHHMM>.zip` をダウンロードし、展開後にお使いの OS に対応するバイナリを実行することを推奨します。


## プロジェクト構成

- `server/` - バックエンドの WebSocket/HTTP サービス（エントリーポイント：`server/main.go`）
- `frontend/` - SolidJS 管理パネル。ソースは `frontend/src/`、ビルド出力は `frontend/dist/` にあります
- `device-client/` - Lua WebSocket クライアントライブラリ
- `XXT 云控设置.lua` - 従来の簡体字中国語版デバイス設定スクリプト（クラウド制御アドレスを書き込みます）
- `device-scripts/settings/` - 11 言語の独立したデバイス設定スクリプト
- `docs/i18n/` - README の完全な多言語翻訳
- `build.sh` - マルチプラットフォームのサーバーとフロントエンドをビルドしてパッケージ化します
- `build/` - ビルド出力ディレクトリ
- `server/data/` - ランタイムデータディレクトリ（既定値は `data_dir=./data`。起動ディレクトリからの相対パスです）

## 主な機能

- WebSocket によるリアルタイム通信とデバイス状態の同期
- フロントエンドとバックエンドの統合デプロイ。サーバーから静的フロントエンドを直接配信できます
- デバイスの一括制御：スクリプト、タッチ、キー、再起動／リスプリング、クリップボード
- 内蔵 TURN を任意で利用できる WebRTC リアルタイムデスクトップ制御
- FormRunner の動的フォームによるデバイスグループとスクリプト設定
- サーバー側ファイルリポジトリ（scripts/files/reports）とデバイス／サーバー間の双方向転送（小さいファイルは WS、大きいファイルは HTTP token）
- WebRTC API など、デバイスのローカル HTTP API に対する `control/http` プロキシ

## クイックスタート

### バイナリをダウンロードして実行（推奨）

1. リリースページを開き、最新の `XXTCloudControl-<YYYYMMDDHHMM>.zip` をダウンロードします：  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. アーカイブを展開してディレクトリに移動し、OS に対応するバイナリを実行します：
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
3. 初回起動時に、現在のディレクトリへ `xxtcloudserver.json` が生成され、ランダムなパスワードが出力されます（表示は一度だけです）。
4. ブラウザで `http://<サーバーアドレス>:46980` を開き、管理パネルにログインします。
5. パスワードを忘れた場合は、同じディレクトリでパスワードを再設定してからサービスを再起動します：
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Docker でのデプロイ

#### クイックスタート（推奨）

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

> ヒント：データディレクトリをマウントしない場合、データと設定は既定でコンテナ内の `/app/data` に生成されます。
> サービスは起動時に、設定ファイルを読み込んでから環境変数による上書きを適用します。環境変数が設定ファイルへ自動的に書き戻されることはありません。
> 利用できる環境変数名は [docker-compose.yml](../../docker-compose.yml) の例を参照してください。

#### docker-compose.yml でデプロイ

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### 本番用ビルドとパッケージ作成（ソースから）

> 必要なツール：`go`、`npm`、`zip`

```bash
bash build.sh
```

各プラットフォームのバイナリとパッケージ化された zip は `build/` に出力されます：
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

展開後のディレクトリ構成は次のとおりです：
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
このディレクトリで OS に対応するバイナリを実行すると、フロントエンドが自動的に配信されます（既定値は `frontend_dir=./frontend`）。

### Docker イメージのビルド

> 必要なツール：buildx を有効にした `docker`

```bash
bash build-docker.sh
```

成果物は `build/` に出力されます：
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### 開発モード

1. バックエンドを起動します：
   ```bash
   cd server
   go run .
   ```
   初回起動時に、現在のディレクトリへ `xxtcloudserver.json` が生成され、ランダムなパスワードが出力されます（表示は一度だけです）。

2. フロントエンド開発サーバーを起動します：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   `http://localhost:3000` を開き、ログインページでサーバーアドレス、ポート（既定値は `46980`）、パスワードを入力します。
   
   > ヒント：開発サーバーは既定で `127.0.0.1:3000` にバインドし、`/api` を `http://127.0.0.1:46980` へプロキシします。バックエンドが別のホストにある場合は、`frontend/vite.config.ts` を調整するかリバースプロキシを使用してください。

> 注意：`server` ディレクトリで `go run .` を実行した場合、`frontend_dir` の既定値は `./frontend` であり、`../frontend/dist` は自動的に参照されません。バックエンドからフロントエンドを配信するには、設定で `frontend_dir` を指定するか、パッケージ済みのディレクトリ構成を使用してください。

### パスワードの変更

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

ソースから実行している場合：
```bash
cd server
go run . -set-password 12345678
```

## よく使うコマンドラインオプション

- `-config <path>`：設定ファイルのパスを指定します（既定では起動ディレクトリの `xxtcloudserver.json` を使用します）
- `-set-password <pwd>`：コントローラーのパスワードを変更します
- `-set-turn-ip <ip>`：TURN の公開 IP アドレスを設定して有効にします
- `-set-turn-port <port>`：TURN の待受ポートを設定して有効にします
- `-v` / `-h`：バージョン情報／ヘルプを表示します

## 設定

既定の設定ファイル：`xxtcloudserver.json`（起動ディレクトリに生成されます）

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

- `passhash` は `hmacSHA256("XXTouch", password)` の結果であり、平文のパスワードではありません。
- `ping_interval` はハートビートの間隔を制御します。サーバーはこの間隔でデバイスへ WebSocket PING フレームを送信し、オンライン状態を確認します。
- `state_interval` は状態の更新間隔を制御します。サーバーはこの間隔でデバイスへ `app/state` リクエストを送信し、最新の状態を取得します。
- `ping_timeout` は、`ping_interval` の周期を基準とした連続無応答回数の上限です。上限を超えると、サーバーはデバイスとの接続を切断します。
- `data_dir` には既定で、`scripts/`、`files/`、`reports/`、グループやスクリプトの設定などの永続データが生成されます。
- 設定内のパスはすべて起動ディレクトリからの相対パスです。`server/` ディレクトリで起動した場合、既定の `data_dir=./data` は `server/data/` に対応します。
- `turnEnabled` の既定値は `true` ですが、内蔵 TURN が実際に起動するのは `turnPublicIP` または `turnPublicAddr` が設定されている場合だけです。

## WebRTC 通信の中継（TURN）設定

外部ネットワークからリアルタイムでデスクトップを操作できるように、サーバーには UDP/TCP 対応の TURN サーバーが内蔵されています。

### TURN アドレスの設定

公開アドレスは次の 2 通りの方法で設定できます：

| フィールド | 形式 | 検証 | 用途 |
|------|------|------|----------|
| `turnPublicIP` | IPv4 アドレスのみ | `net.ParseIP()` で検証 | 固定の公開 IP がある場合 |
| `turnPublicAddr` | IPv4 またはドメイン名 | ドメイン名を DNS で自動解決 | ドメイン名でアクセスする場合 |

> [!IMPORTANT]
> **IPv4 のみ対応**：現在、TURN サーバーは IPv4 アドレスのみをサポートしています。IPv6 アドレス、または AAAA レコードしかないドメイン名を指定すると起動に失敗します。
>
> 両方を設定した場合は `turnPublicIP` が優先されます。どちらか一方を設定すれば内蔵 TURN が有効になります。

設定例：

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

### カスタム ICE サーバー

内蔵 TURN に加えて、外部の STUN/TURN サーバーも設定できます。次のような場合に便利です：

- ローカルで TURN を有効にせず、[Metered](https://www.metered.ca/tools/openrelay/) などの外部 TURN サービスを利用する場合
- ローカル TURN と外部サービスを併用し、接続性を高める場合

> [!WARNING]
> **セキュリティに関する注意**：`customIceServers` の設定（`username` と `credential` を含む）は WebRTC 接続時にデバイスへ送信されるため、**機密情報ではありません**。一時認証情報に対応した TURN サービスを使用するか、公開しても問題のない認証情報を使用してください。

設定例：

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

**組み合わせた場合の動作：**

| ローカル TURN | カスタム ICE サーバー | 結果 |
|-----------|-------------------|------|
| 有効 | なし | ローカル TURN のみを使用 |
| 無効 | あり | カスタム ICE サーバーのみを使用 |
| 有効 | あり | **併用**：ローカル TURN + カスタム ICE サーバー |
| 無効 | なし | ICE サーバーを使わず、WebRTC は直接接続のみを試行 |

### クイック設定コマンド

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> `turnSecretKey` が空の場合は、起動時に一時キーが自動生成されます（再起動すると変わります）。安定した TURN 認証情報が必要な場合は手動で設定してください。

### 管理者向けファイアウォール設定

サーバー管理者は、クラウドのセキュリティグループまたはファイアウォールで次のポートを開放する必要があります：

| ポート範囲 | プロトコル | 用途 |
|----------|------|------|
| `46980`（または任意のポート） | **TCP** | **クラウド制御サービス**（API と WebSocket） |
| `43478`（または任意のポート） | **UDP と TCP** | WebRTC TURN の制御、ハンドシェイク、フォールバック |
| `49152 - 65535` | **UDP** | WebRTC TURN のリアルタイムメディア中継 |

> [!TIP]
> メディア中継では UDP が優先されます。UDP 通信が厳しく制限されている場合は、デスクトップストリームを正常に転送できるように WebRTC が TCP（ポート 43478）へ自動的にフォールバックします。

## TLS/HTTPS 設定（任意）

サーバーは HTTPS/WSS に直接対応しているため、リバースプロキシを使わずに暗号化接続を有効にできます。Nginx や Caddy などのリバースプロキシを経由する構成にも対応しています。

### 1) TLS の設定

`xxtcloudserver.json` に次の値を設定します：

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) ローカルテスト用証明書の生成

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> 自己署名証明書はローカルテスト専用です。本番環境では Let's Encrypt またはその他の認証局が発行した証明書を使用してください。

### 3) リバースプロキシモード

Nginx や Caddy などのリバースプロキシを使用する場合、サーバーは HTTP モードのまま動作し、TLS の終端処理をプロキシに任せられます。この場合、バインドスクリプトは `X-Forwarded-Proto` ヘッダーからプロトコルを自動検出し、正しい `wss://` アドレスを生成します。

Nginx の設定例：

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

## デバイスのバインド方法

1. リポジトリのルートにある従来の簡体字中国語版スクリプト `XXT 云控设置.lua` を実行するか、`device-scripts/settings/` から使用する言語の独立したスクリプトを選び、`ws://<host>:46980/api/ws` を入力します（TLS またはリバースプロキシを使用する場合は `wss://`）。
2. または、自動生成されたバインドスクリプトをダウンロードします：
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   `proto=https` を追加すると、`wss://` アドレスを強制的に生成できます。リバースプロキシを使用する場合は、`X-Forwarded-Proto` から自動的に判定することもできます。
3. または、デバイスのローカル API を手動で呼び出します：
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

クラウド制御を無効にするには、`enable` を `false` に設定します。

`device-scripts/settings/` には、`zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`、`vi-VN`、`es-ES`、`pt-BR`、`ru-RU`、`fr-FR`、`de-DE` の 11 ロケールに対応するスクリプトがあります。各ファイルは単独で実行でき、他の言語ファイルには依存しません。

## WebSocket の規約

- WebSocket アドレス：`ws://<host>:<port>/api/ws`（TLS またはリバースプロキシを使用する場合は `wss://`）
- コントローラーのメッセージには `ts`、`nonce`、`sign` が必要です。タイムスタンプには ±60 秒のずれが許容され、`nonce` は 120 秒以内に再利用できません。

## 認証と署名アルゴリズム（HTTP／WebSocket 共通）

本プロジェクトの認証では固定 token を使わず、有効期間の短い動的署名を使用します。クライアントは各リクエストに、秒単位の現在時刻 `ts`、ランダムな `nonce`、署名 `sign` を含めます。サーバーは許容時間内で署名を検証し、`nonce` の重複も拒否します。

### 1) パスワードと passhash

サーバーの設定ファイル `xxtcloudserver.json` に保存されるのは `passhash` であり、平文のパスワードではありません：

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`。結果は 64 文字の 16 進数文字列です。

### 2) sign の計算方法

コントローラー署名では `passhash` を HMAC key として使用し、正規化した基底文字列に HMAC を適用します：

#### HTTP の基底文字列

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD`：リクエストメソッド（GET/POST/PUT/DELETE…）
- `PATH_AND_QUERY`：`path` + 並べ替えた query（`ts`、`nonce`、`sign` を除外）
- `bodyHash`：
  - 通常のリクエスト body：`SHA-256(bodyBytes)` の 16 進数文字列
  - 空の body または multipart（`multipart/form-data`）は現在対象外：`bodyHash = ""`

#### WebSocket の基底文字列

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type`：メッセージ種別（例：`control/devices`）
- `bodyHash`：`body` の JSON 表現に対する `SHA-256`（16 進数）。body がない場合は空文字列

最終的な署名：

- `sign = HMAC-SHA256(key=passhash, message=base)`。結果は 16 進数文字列です。

> 注意：ここでの `key=passhash` は、**passhash の 16 進数文字列そのもの**を文字列のバイト列として HMAC に渡すことを意味します。16 進数を 32 バイトへデコードしてから使用するのではありません。

### 3) サーバー側の検証規則

- 許容される時刻のずれ：`ts` がサーバーの現在時刻から `±60` 秒以内の場合にのみ検証を続行します。
- `nonce` は `120` 秒以内に再利用できません（再利用はリプレイ攻撃と見なされます）。
- 検証に失敗した場合、HTTP では `401 Unauthorized` を返し、WebSocket のコントローラーメッセージでは接続を直接切断します。

### 4) HTTP API の認証方式

HTTP でのバインドスクリプトのダウンロードを除き、すべての HTTP API には WebSocket と同じアルゴリズムによる署名が必要です：

- 保護対象のパス：すべての `/api/*`
- 例外：
  - `/api/download-bind-script`（要件に従い署名不要のまま維持）
  - `/api/config`（フロントエンドの起動設定）
  - `/api/control/info`（JSON 形式の設定出力）
  - `/api/ws`（WebSocket のアップグレードハンドシェイクでは HTTP 認証を行いませんが、コントローラーメッセージには引き続き署名が必要です）
  - `/api/transfer/download/:token`（一時 token によるダウンロード）
  - `/api/transfer/upload/:token`（一時 token によるアップロード）
  - `OPTIONS` プリフライトリクエスト（CORS）

HTTP リクエストでは、次のいずれかの方法で認証情報を渡せます：

1. **リクエストヘッダー（推奨）**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Query パラメーター（ダウンロード、`window.open`、`img` など、カスタム header を付けにくい場合）**
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

例：

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

### コントローラーの共通メッセージ形式

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### HTTP プロキシ（`control/http`）

コントローラーは WebSocket で `control/http` を送信し、HTTP リクエストをデバイスへ転送できます。デバイス側では `http.request` として実行され、主に WebRTC 関連の API で使用します。

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

> 注：`body` は base64 でエンコードする必要があります。リクエスト先が `/api/webrtc/start` で TURN が有効な場合、サーバーは `iceServers` を自動的に挿入します。

### デバイスの接続

デバイスは `app/state` を送信し、`body.system.udid` に一意の識別子を含めます。
グローバルハードウェアキーボードに対応するデバイスは、次の任意機能も宣言します。このフィールドがない場合、または `true` でない場合、コントローラーはハードウェアキーボードのコマンドを送信しません：

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

コントローラーは `control/command` で `key/global-keyboard` を送信し、デバイスは同じ種別で応答します。`owner` はリアルタイム制御セッションを識別し、デバイスは一致する owner にだけキーボードの切断を許可します：

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

`action` には `status`、`connect`、`disconnect` を指定できます。応答の `body` には `action`、`owner`、`supported`、`ok`、`connected` が含まれ、失敗時には `message` が追加されることがあります。

### デバイスの切断

サーバーからコントローラーへ通知します：
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### デバイス一覧

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

応答：
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### デバイス状態の更新

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
サーバーはすべてのデバイスへ `app/state` リクエストをブロードキャストします。

### リアルタイムログの購読

指定したデバイスのログを購読します：

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

購読を解除します：

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

デバイスがログのプッシュ配信に対応している場合、次のメッセージを送信します：

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### 一括コマンド

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

## よく使うコマンド種別

### ファイル操作

#### ファイルのアップロード
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

#### ディレクトリの作成
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

#### ディレクトリの一覧表示
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

#### ファイルのダウンロード
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

#### ファイルのコピー
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

#### ファイルの移動
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

#### ファイルの削除
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

### デバイス制御

#### デバイスのリスプリング
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

#### デバイスの再起動
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

#### タッチコマンド
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

補足：

- `finger` は任意のフィールドで、指定できる範囲は `0 ~ 29` です。
- `finger` を省略した場合、互換性を保つためデバイスは従来のシングルタッチプロトコルとして処理します。
- マルチタッチは、一定の `finger` 値を持つ複数の `touch/down|touch/move|touch/up` メッセージで表現します。同じ指では、タッチ開始から終了まで同じ `finger` を使用する必要があります。

#### キーコマンド
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

#### スクリーンショット
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

### クリップボード

#### クリップボードの読み取り
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

#### クリップボードへの書き込み
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

### 辞書、キュー、スクリプトの選択

#### 辞書の値を設定
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

#### キューへ追加
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

#### スクリプトの選択
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

### スクリプト制御

#### スクリプトの開始
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

#### スクリプトの停止
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

## セキュリティ

- すべての WebSocket 制御コマンドと、バインドスクリプトのダウンロードを除くすべての HTTP API では、HMAC-SHA256 動的署名の検証が必要です。
- 初回起動時に、一度だけ表示されるランダムパスワードが生成されます。速やかに変更してください。
- 大きいファイルには、一時 HTTP token を使用する `/api/transfer/*` を推奨します。WebSocket は小さいファイルと制御メッセージにのみ適しています。
