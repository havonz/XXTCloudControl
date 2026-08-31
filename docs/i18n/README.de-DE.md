# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Tiếng Việt](README.vi-VN.md) | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | [Français](README.fr-FR.md) | Deutsch

Cloud-Control-Server (WebSocket + statisches Frontend) und Administrationsoberfläche für XXTouch 1.3.8-20260122000000 und höher.  
Die geräteseitige Protokollimplementierung befindet sich auf dem Gerät unter `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua`.  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## Veröffentlichungen

- Offizielle Download-Seite (GitHub Pages): [https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- Veröffentlichungen für alle Plattformen: [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- Wir empfehlen, zuerst `XXTCloudControl-<YYYYMMDDHHMM>.zip` aus den Release-Dateien herunterzuladen. Entpacken Sie es und starten Sie anschließend die für Ihr Betriebssystem passende Binärdatei.


## Projektstruktur

- `server/` - WebSocket/HTTP-Backenddienst (Einstiegspunkt: `server/main.go`)
- `frontend/` - SolidJS-Administrationsoberfläche; Quellcode in `frontend/src/`, Build-Ausgabe in `frontend/dist/`
- `device-client/` - Lua-WebSocket-Clientbibliothek
- `XXT 云控设置.lua` - Originales Geräteeinrichtungsskript auf vereinfachtem Chinesisch (schreibt die Cloud-Control-Adresse)
- `device-scripts/settings/` - Eigenständige Einrichtungsskripte für Geräte in 11 Sprachen
- `docs/i18n/` - Vollständige README-Übersetzungen
- `build.sh` - Erstellt und paketiert den plattformübergreifenden Server und das Frontend
- `build/` - Verzeichnis der Build-Ausgabe
- `server/data/` - Laufzeitdatenverzeichnis (`data_dir=./data` standardmäßig, relativ zum Startverzeichnis)

## Funktionen

- WebSocket-Kommunikation in Echtzeit und Synchronisierung des Gerätestatus
- Integrierte Bereitstellung von Frontend und Backend; der Server kann das statische Frontend direkt hosten
- Stapelsteuerung von Geräten: Skripte, Berührungen, Tasten, Neustart/Respring und Zwischenablage
- WebRTC-Desktopsteuerung in Echtzeit mit optionaler integrierter TURN-NAT-Traversal
- Gerätegruppen und Skriptkonfiguration über dynamische Formulare von FormRunner
- Serverseitiges Dateirepository (scripts/files/reports) und bidirektionale Übertragung zwischen Gerät und Server (WS für kleine Dateien, HTTP-Tokens für große Dateien)
- `control/http`-Proxy für die lokalen HTTP-APIs des Geräts, einschließlich WebRTC-APIs

## Schnellstart

### Binärdatei herunterladen und ausführen (empfohlen)

1. Öffnen Sie die Veröffentlichungsseite und laden Sie die neueste `XXTCloudControl-<YYYYMMDDHHMM>.zip` herunter:  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. Entpacken Sie das Archiv, wechseln Sie in das Verzeichnis und starten Sie die Binärdatei für Ihr Betriebssystem:
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
3. Beim ersten Start wird im aktuellen Verzeichnis `xxtcloudserver.json` erstellt und ein zufälliges Passwort ausgegeben. Dieses wird nur einmal angezeigt.
4. Öffnen Sie `http://<Serveradresse>:46980` im Browser und melden Sie sich an der Administrationsoberfläche an.
5. Falls Sie das Passwort vergessen haben, können Sie es im selben Verzeichnis zurücksetzen und den Dienst anschließend neu starten:
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Bereitstellung mit Docker

#### Schnellstart (empfohlen)

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

> Hinweis: Wenn kein Datenverzeichnis eingebunden wird, werden Daten und Konfiguration standardmäßig im Container unter `/app/data` angelegt.
> Beim Start liest der Dienst zuerst die Konfigurationsdatei und überschreibt deren Werte anschließend mit Umgebungsvariablen. Umgebungsvariablen werden nicht automatisch in die Konfigurationsdatei zurückgeschrieben.
> Die Namen der Umgebungsvariablen finden Sie im Beispiel [docker-compose.yml](../../docker-compose.yml).

#### Bereitstellung mit docker-compose.yml

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### Produktions-Build und Paketierung aus dem Quellcode

> Voraussetzungen: `go`, `npm` und `zip`

```bash
bash build.sh
```

Die Ergebnisse werden unter `build/` abgelegt und umfassen die Binärdateien für alle Plattformen sowie das gepackte ZIP-Archiv:
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

Nach dem Entpacken sieht die Verzeichnisstruktur wie folgt aus:
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
Starten Sie in diesem Verzeichnis die zu Ihrem Betriebssystem passende Binärdatei. Das Frontend wird dann automatisch bereitgestellt (standardmäßig `frontend_dir=./frontend`).

### Docker-Images erstellen

> Voraussetzung: `docker` mit aktiviertem buildx

```bash
bash build-docker.sh
```

Die Ergebnisse werden unter `build/` abgelegt:
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### Entwicklungsmodus

1. Backend starten:
   ```bash
   cd server
   go run .
   ```
   Beim ersten Start wird im aktuellen Verzeichnis `xxtcloudserver.json` erstellt und ein zufälliges Passwort ausgegeben. Dieses wird nur einmal angezeigt.

2. Frontend-Entwicklungsserver starten:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Öffnen Sie `http://localhost:3000` und geben Sie auf der Anmeldeseite Serveradresse, Port (standardmäßig `46980`) und Passwort ein.
   
   > Hinweis: Der Entwicklungsserver bindet standardmäßig an `127.0.0.1:3000` und leitet `/api` an `http://127.0.0.1:46980` weiter. Wenn das Backend nicht auf demselben Rechner läuft, passen Sie `frontend/vite.config.ts` an oder verwenden Sie einen Reverse-Proxy.

> Achtung: Wenn `go run .` im Verzeichnis `server` gestartet wird, lautet `frontend_dir` standardmäßig `./frontend` und verweist nicht automatisch auf `../frontend/dist`. Soll das Backend das Frontend bereitstellen, setzen Sie `frontend_dir` in der Konfiguration oder verwenden Sie die Struktur des fertigen Pakets.

### Passwort ändern

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

Oder im Quellcodemodus:
```bash
cd server
go run . -set-password 12345678
```

## Häufig verwendete Befehlszeilenparameter

- `-config <path>`: Pfad zur Konfigurationsdatei festlegen (standardmäßig `xxtcloudserver.json` im Startverzeichnis)
- `-set-password <pwd>`: Passwort der Steuerungsoberfläche ändern
- `-set-turn-ip <ip>`: Öffentliche TURN-IP festlegen und TURN aktivieren
- `-set-turn-port <port>`: TURN-Listen-Port festlegen und TURN aktivieren
- `-v` / `-h`: Version bzw. Hilfe anzeigen

## Konfiguration

Standardkonfigurationsdatei: `xxtcloudserver.json` (wird im Startverzeichnis erzeugt)

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

- `passhash` ist das Ergebnis von `hmacSHA256("XXTouch", password)` und nicht das Klartextpasswort.
- `ping_interval` steuert die Häufigkeit der Heartbeat-Prüfung. Der Server sendet in diesem Abstand WebSocket-PING-Frames an die Geräte, um deren Onlinestatus zu prüfen.
- `state_interval` steuert die Aktualisierung des Gerätestatus. Der Server sendet in diesem Abstand `app/state`-Anfragen an die Geräte, um den neuesten Status abzurufen.
- `ping_timeout` ist die Anzahl aufeinanderfolgender ausbleibender Antworten, die auf Grundlage des Intervalls `ping_interval` toleriert wird. Bei Überschreitung trennt der Server die Verbindung zum Gerät.
- Unter `data_dir` werden standardmäßig `scripts/`, `files/`, `reports/` sowie persistente Gruppen- und Skriptkonfigurationen angelegt.
- Alle Pfade in der Konfiguration sind relativ zum Startverzeichnis. Wird der Dienst im Verzeichnis `server/` gestartet, liegt das standardmäßige `data_dir=./data` unter `server/data/`.
- `turnEnabled` ist standardmäßig `true`; der integrierte TURN-Server startet jedoch erst, wenn `turnPublicIP` oder `turnPublicAddr` konfiguriert ist.

## WebRTC-NAT-Traversal mit TURN

Für die Desktopsteuerung in Echtzeit über externe Netze enthält der Server einen integrierten TURN-Server mit Unterstützung für UDP und TCP.

### TURN-Adresse konfigurieren

Der Server unterstützt zwei Arten, eine öffentliche Adresse zu konfigurieren:

| Feld | Format | Validierung | Einsatzbereich |
|------|------|------|----------|
| `turnPublicIP` | Nur IPv4-Adresse | Validierung mit `net.ParseIP()` | Feste öffentliche IP-Adresse |
| `turnPublicAddr` | IPv4-Adresse oder Domain | Automatische DNS-Auflösung der Domain | Zugriff über eine Domain |

> [!IMPORTANT]
> **Nur IPv4 unterstützt:** Der TURN-Server unterstützt derzeit ausschließlich IPv4-Adressen. Eine IPv6-Adresse oder eine Domain, für die nur ein AAAA-Eintrag vorhanden ist, führt zu einem Startfehler.
>
> Wenn beide Werte konfiguriert sind, hat `turnPublicIP` Vorrang. Für die Aktivierung des integrierten TURN-Servers genügt einer der beiden Werte.

Konfigurationsbeispiel:

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

### Benutzerdefinierte ICE-Server

Zusätzlich zum integrierten TURN-Dienst können externe STUN-/TURN-Server konfiguriert werden. Das ist in folgenden Fällen sinnvoll:

- Sie möchten lokal keinen TURN-Dienst aktivieren, sondern einen TURN-Dienst eines Drittanbieters verwenden, etwa [Metered](https://www.metered.ca/tools/openrelay/).
- Sie möchten den lokalen TURN-Server mit einem externen Dienst kombinieren, um die NAT-Traversal zu verbessern.

> [!WARNING]
> **Sicherheitshinweis:** Die Einträge in `customIceServers`, einschließlich `username` und `credential`, werden beim Aufbau der WebRTC-Verbindung an das Gerät gesendet und sind **keine vertraulichen Informationen**. Verwenden Sie einen TURN-Dienst mit temporären Zugangsdaten oder stellen Sie sicher, dass die Zugangsdaten öffentlich weitergegeben werden dürfen.

Konfigurationsbeispiel:

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

**Kombinationsverhalten:**

| Lokaler TURN-Server | Benutzerdefinierte ICE-Server | Ergebnis |
|-----------|-------------------|------|
| Aktiviert | Keine | Nur lokaler TURN-Server |
| Deaktiviert | Vorhanden | Nur benutzerdefinierte ICE-Server |
| Aktiviert | Vorhanden | **Kombiniert:** lokaler TURN-Server und benutzerdefinierte ICE-Server |
| Deaktiviert | Keine | Keine ICE-Server; WebRTC versucht nur eine direkte Verbindung |

### Befehle zur Schnellkonfiguration

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> Wenn `turnSecretKey` leer ist, wird beim Start automatisch ein temporärer Schlüssel erzeugt, der sich nach einem Neustart ändert. Konfigurieren Sie den Schlüssel manuell, wenn dauerhaft gültige TURN-Zugangsdaten benötigt werden.

### Firewall-Konfiguration für Administratoren

Serveradministratoren müssen die folgenden Ports in der Cloud-Sicherheitsgruppe bzw. Firewall freigeben:

| Portbereich | Protokoll | Zweck |
|----------|------|------|
| `46980` (oder benutzerdefiniert) | **TCP** | **Cloud-Control-Dienst** (API und WebSocket) |
| `43478` (oder benutzerdefiniert) | **UDP und TCP** | WebRTC-[TURN]-Steuerung, Handshake und Fallback |
| `49152 - 65535` | **UDP** | Weiterleitung des WebRTC-[TURN]-Medienstroms in Echtzeit |

> [!TIP]
> Für die Medienweiterleitung wird bevorzugt UDP verwendet. Wenn UDP-Datenverkehr stark eingeschränkt ist, wechselt WebRTC automatisch zu TCP auf Port 43478, damit der Desktopstream weiterhin übertragen werden kann.

## TLS-/HTTPS-Konfiguration (optional)

Der Server unterstützt HTTPS/WSS nativ und kann verschlüsselte Verbindungen ohne Reverse-Proxy bereitstellen. Alternativ kann weiterhin ein Reverse-Proxy wie Nginx oder Caddy verwendet werden.

### 1) TLS konfigurieren

Legen Sie in `xxtcloudserver.json` Folgendes fest:

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) Lokales Testzertifikat erzeugen

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> Selbst signierte Zertifikate eignen sich nur für lokale Tests. Verwenden Sie in Produktionsumgebungen ein Zertifikat von Let's Encrypt oder einer anderen Zertifizierungsstelle.

### 3) Betrieb hinter einem Reverse-Proxy

Bei Verwendung eines Reverse-Proxys wie Nginx oder Caddy kann der Server weiterhin im HTTP-Modus laufen, während der Proxy die TLS-Terminierung übernimmt. Das Bindungsskript erkennt das Protokoll dann automatisch anhand des Headers `X-Forwarded-Proto` und erzeugt die korrekte Adresse mit `wss://`.

Nginx-Konfigurationsbeispiel:

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

## Geräte verbinden

1. Führen Sie das vorhandene vereinfachte chinesische Skript `XXT 云控设置.lua` im Stammverzeichnis oder das eigenständige Skript für die gewünschte Sprache unter `device-scripts/settings/` aus und tragen Sie `ws://<host>:46980/api/ws` ein. Verwenden Sie bei TLS oder einem Reverse-Proxy `wss://`.
2. Alternativ können Sie das automatisch erzeugte Bindungsskript herunterladen:
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   Mit `proto=https` kann die Erzeugung einer Adresse mit `wss://` erzwungen werden. Hinter einem Reverse-Proxy kann das Protokoll auch automatisch über `X-Forwarded-Proto` erkannt werden.
3. Alternativ können Sie die lokale Geräteschnittstelle manuell aufrufen:
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

Setzen Sie `enable` auf `false`, um die Cloud-Steuerung zu deaktivieren.

Unter `device-scripts/settings/` stehen Skripte für insgesamt 11 Locales bereit: `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `vi-VN`, `es-ES`, `pt-BR`, `ru-RU`, `fr-FR` und `de-DE`. Jede Datei kann eigenständig ausgeführt werden und ist nicht von anderen Sprachdateien abhängig.

## WebSocket-Konventionen

- WebSocket-Adresse: `ws://<host>:<port>/api/ws` (bei TLS oder einem Reverse-Proxy `wss://` verwenden)
- Nachrichten der Steuerungsseite müssen `ts`, `nonce` und `sign` enthalten. Für den Zeitstempel gilt eine Toleranz von ±60 Sekunden; ein `nonce` darf innerhalb von 120 Sekunden nicht erneut verwendet werden.

## Authentifizierung und Signaturalgorithmus für HTTP und WebSocket

Die Authentifizierung verwendet kein festes token, sondern eine kurzzeitig gültige dynamische Signatur. Der Client sendet bei jeder Anfrage den aktuellen Unix-Zeitstempel in Sekunden als `ts`, einen zufälligen `nonce` und die Signatur `sign`. Der Server prüft die Signatur innerhalb des zulässigen Zeitfensters und verhindert die Wiederverwendung eines `nonce`.

### 1) Passwort und passhash

In der Serverkonfiguration `xxtcloudserver.json` wird `passhash` und nicht das Klartextpasswort gespeichert:

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`; das Ergebnis ist eine 64-stellige hexadezimale Zeichenfolge.

### 2) Berechnung von sign

Die Steuersignatur verwendet `passhash` als HMAC-Schlüssel und berechnet den HMAC der normalisierten Basiszeichenfolge:

#### HTTP-Basiszeichenfolge

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD`: Anfragemethode (GET/POST/PUT/DELETE …)
- `PATH_AND_QUERY`: `path` plus sortierter query ohne `ts`, `nonce` und `sign`
- `bodyHash`:
  - Normaler Anfrageinhalt: hexadezimales Ergebnis von `SHA-256(bodyBytes)`
  - Ein leerer body oder multipart (`multipart/form-data`) wird derzeit nicht berücksichtigt: `bodyHash = ""`

#### WebSocket-Basiszeichenfolge

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type`: Nachrichtentyp, zum Beispiel `control/devices`
- `bodyHash`: hexadezimales Ergebnis von `SHA-256` über die JSON-Darstellung von `body`; ohne body eine leere Zeichenfolge

Endgültige Signatur:

- `sign = HMAC-SHA256(key=passhash, message=base)`; das Ergebnis ist eine hexadezimale Zeichenfolge.

> Achtung: `key=passhash` bezeichnet hier **die hexadezimale Zeichenfolge von passhash selbst**, die als Zeichenfolgenbytes in den HMAC eingeht. Die Zeichenfolge wird nicht zuerst in 32 Bytes dekodiert.

### 3) Validierungsregeln des Servers

- Zulässige Zeitabweichung: `ts` muss innerhalb von `±60` Sekunden zur aktuellen Serverzeit liegen.
- Ein `nonce` darf innerhalb von `120` Sekunden nicht erneut verwendet werden; eine Wiederholung gilt als Replay-Angriff.
- Bei fehlgeschlagener Prüfung wird für HTTP `401 Unauthorized` zurückgegeben bzw. bei einer WebSocket-Nachricht der Steuerungsseite die Verbindung direkt geschlossen.

### 4) Authentifizierung der HTTP-API

Mit Ausnahme des über `http` heruntergeladenen Bindungsskripts benötigen alle HTTP-APIs eine Signatur nach demselben Verfahren wie WebSocket:

- Geschützte Pfade: alle Pfade unter `/api/*`
- Ausnahmen:
  - `/api/download-bind-script` (weiterhin ohne Signatur)
  - `/api/config` (Startkonfiguration des Frontends)
  - `/api/control/info` (Konfigurationsausgabe im JSON-Format)
  - `/api/ws` (der WebSocket-Upgrade-Handshake verwendet keine HTTP-Authentifizierung; Nachrichten der Steuerungsseite benötigen weiterhin eine Signatur)
  - `/api/transfer/download/:token` (Download mit temporärem token)
  - `/api/transfer/upload/:token` (Upload mit temporärem token)
  - `OPTIONS`-Preflight-Anfragen für CORS

Die Signatur kann bei HTTP-Anfragen auf eine von zwei Arten übermittelt werden:

1. **Anfrageheader (empfohlen)**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Query-Parameter** für Downloads, `window.open`, `img` und andere Fälle, in denen benutzerdefinierte Anfrageheader nicht ohne Weiteres gesetzt werden können
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

Beispiel:

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

### Allgemeines Nachrichtenformat der Steuerungsseite

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### HTTP-Proxy (control/http)

Die Steuerungsseite kann `control/http` über WebSocket senden, um eine HTTP-Anfrage an das Gerät weiterzuleiten. Auf dem Gerät wird sie mit `http.request` ausgeführt. Dies wird häufig für WebRTC-bezogene Schnittstellen verwendet.

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

> Hinweis: `body` muss base64-kodiert sein. Wenn die Anfrage an `/api/webrtc/start` gerichtet und TURN aktiviert ist, fügt der Server automatisch `iceServers` ein.

### Gerät meldet sich an

Das Gerät sendet `app/state` und stellt in `body.system.udid` eine eindeutige Kennung bereit.
Geräte mit Unterstützung für eine globale Hardwaretastatur geben zusätzlich die folgende optionale Fähigkeit an. Fehlt das Feld oder ist es nicht `true`, sendet die Steuerungsseite keine Hardwaretastaturbefehle:

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

Die Steuerungsseite sendet `key/global-keyboard` über `control/command`; das Gerät antwortet mit demselben Typ. `owner` kennzeichnet eine Echtzeit-Steuerungssitzung. Das Gerät erlaubt nur dem passenden owner, die Tastaturverbindung zu trennen:

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

`action` unterstützt `status`, `connect` und `disconnect`. Der `body` der Antwort enthält `action`, `owner`, `supported`, `ok` und `connected`; bei einem Fehler kann zusätzlich `message` enthalten sein.

### Gerät getrennt

Der Server benachrichtigt die Steuerungsseite:
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### Geräteliste

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

Antwort:
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### Gerätestatus aktualisieren

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
Der Server sendet eine `app/state`-Anfrage an alle Geräte.

### Echtzeitprotokolle abonnieren

Protokoll eines bestimmten Geräts abonnieren:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

Abonnement beenden:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

Wenn das Gerät die Übertragung von Protokollen unterstützt, sendet es:

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### Stapelbefehle

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

## Häufig verwendete Befehlstypen

### Dateioperationen

#### Datei hochladen
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

#### Verzeichnis erstellen
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

#### Verzeichnis auflisten
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

#### Datei herunterladen
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

#### Datei kopieren
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

#### Datei verschieben
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

#### Datei löschen
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

### Gerätesteuerung

#### Geräteoberfläche neu starten
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

#### Gerät neu starten
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

#### Berührungsbefehle
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

Hinweise:

- `finger` ist ein optionales Feld mit einem Wertebereich von `0 ~ 29`.
- Wenn `finger` nicht übermittelt wird, verwendet das Gerät zur Abwärtskompatibilität weiterhin das alte Protokoll für einen einzelnen Finger.
- Mehrfingereingaben werden durch mehrere Nachrichten vom Typ `touch/down|touch/move|touch/up` mit einem stabilen `finger`-Wert dargestellt. Für denselben Finger muss vom Aufsetzen bis zum Abheben derselbe `finger` verwendet werden.

#### Tastenbefehle
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

#### Bildschirmfoto
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

### Zwischenablage

#### Zwischenablage lesen
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

#### In die Zwischenablage schreiben
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

### Wörterbuch, Warteschlange und Skriptauswahl

#### Wörterbuchwert festlegen
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

#### In die Warteschlange übertragen
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

#### Skript auswählen
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

### Skriptsteuerung

#### Skript starten
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

#### Skript stoppen
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

## Sicherheit

- Alle WebSocket-Steuerbefehle und alle HTTP-APIs außer dem Download des Bindungsskripts erfordern eine Prüfung durch eine dynamische HMAC-SHA256-Signatur.
- Beim ersten Start wird ein zufälliges Passwort erzeugt und nur einmal angezeigt. Ändern Sie es umgehend.
- Verwenden Sie für große Dateien `/api/transfer/*` mit temporären HTTP-Tokens. WebSocket ist nur für kleine Dateien und Steuerungsnachrichten vorgesehen.
