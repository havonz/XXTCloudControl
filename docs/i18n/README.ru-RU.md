# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Tiếng Việt](README.vi-VN.md) | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | Русский | [Français](README.fr-FR.md) | [Deutsch](README.de-DE.md)

Сервер облачного управления (WebSocket + статический frontend) и панель администрирования для XXTouch 1.3.8-20260122000000 и новее.  
Исходный код реализации протокола на стороне устройства находится в `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua`.  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## Выпуски

- Официальная страница загрузки (GitHub Pages): [https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- Выпуски для всех платформ: [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- Рекомендуется сначала скачать `XXTCloudControl-<YYYYMMDDHHMM>.zip` из файлов Release. Распакуйте архив и запустите бинарный файл для своей операционной системы.


## Структура проекта

- `server/` - Серверная служба WebSocket/HTTP (точка входа: `server/main.go`)
- `frontend/` - Панель администрирования SolidJS; исходный код в `frontend/src/`, результат сборки в `frontend/dist/`
- `device-client/` - Клиентская библиотека WebSocket на Lua
- `XXT 云控设置.lua` - Оригинальный скрипт настройки устройства на упрощённом китайском (записывает адрес облачного управления)
- `device-scripts/settings/` - Автономные скрипты настройки устройств на 11 языках
- `docs/i18n/` - Полные переводы README
- `build.sh` - Собирает и упаковывает сервер и frontend для разных платформ
- `build/` - Каталог результатов сборки
- `server/data/` - Каталог данных времени выполнения (`data_dir=./data` по умолчанию, относительно каталога запуска)

## Возможности

- Обмен данными WebSocket в реальном времени и синхронизация состояния устройств
- Единое развёртывание frontend и backend; сервер может напрямую размещать статический frontend
- Массовое управление устройствами: скрипты, касания, клавиши, перезагрузка/respring и буфер обмена
- Управление рабочим столом WebRTC в реальном времени с необязательным встроенным TURN для прохождения NAT
- Группы устройств и настройка скриптов через динамические формы FormRunner
- Файловое хранилище на сервере (scripts/files/reports) и двусторонняя передача файлов между устройством и сервером (WS для небольших файлов, HTTP-токены для больших)
- Прокси `control/http` к локальным HTTP API устройства, включая API WebRTC

## Быстрый старт

### Скачать и запустить бинарный файл (рекомендуется)

1. Откройте страницу выпусков и скачайте последний `XXTCloudControl-<YYYYMMDDHHMM>.zip`:  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. Распакуйте архив, перейдите в каталог и запустите бинарный файл для своей операционной системы:
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
3. При первом запуске в текущем каталоге будет создан `xxtcloudserver.json`, а в консоли появится случайный пароль (он отображается только один раз).
4. Откройте в браузере `http://<服务器地址>:46980` и войдите в панель администрирования.
5. Если вы забыли пароль, сбросьте его в том же каталоге и перезапустите службу:
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Развёртывание с Docker

#### Быстрый запуск (рекомендуется)

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

> Примечание: если не подключить каталог данных, данные и конфигурация будут созданы внутри контейнера в `/app/data`.
> При запуске служба сначала читает файл конфигурации, а затем применяет значения переменных окружения. Переменные окружения не записываются обратно в файл конфигурации.
> Список переменных окружения приведён в примере [docker-compose.yml](../../docker-compose.yml).

#### Развёртывание с помощью docker-compose.yml

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### Сборка и упаковка для эксплуатации (из исходного кода)

> Требования: `go`, `npm`, `zip`

```bash
bash build.sh
```

Результаты сохраняются в `build/`: бинарные файлы для разных платформ и упакованный zip-архив.
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

После распаковки каталог имеет следующую структуру:
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
Запустите в этом каталоге бинарный файл для своей операционной системы — он автоматически разместит frontend (по умолчанию `frontend_dir=./frontend`).

### Сборка образов Docker

> Требования: `docker` с включённым buildx

```bash
bash build-docker.sh
```

Результаты сохраняются в `build/`:
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### Режим разработки

1. Запустите backend:
   ```bash
   cd server
   go run .
   ```
   При первом запуске в текущем каталоге будет создан `xxtcloudserver.json`, а в консоли появится случайный пароль (он отображается только один раз).

2. Запустите сервер разработки frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Откройте `http://localhost:3000` и на странице входа укажите адрес сервера, порт (по умолчанию `46980`) и пароль.
   
   > Примечание: по умолчанию сервер разработки слушает `127.0.0.1:3000` и проксирует `/api` на `http://127.0.0.1:46980`. Если backend работает не на этом компьютере, измените `frontend/vite.config.ts` или используйте обратный прокси.

> Внимание: при запуске `go run .` из каталога `server` значение `frontend_dir` по умолчанию равно `./frontend` и не перенаправляется автоматически на `../frontend/dist`. Чтобы backend размещал frontend, задайте `frontend_dir` в конфигурации или используйте структуру каталогов готового пакета.

### Изменение пароля

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

При запуске из исходного кода:
```bash
cd server
go run . -set-password 12345678
```

## Основные параметры командной строки

- `-config <path>` — путь к файлу конфигурации (по умолчанию используется `xxtcloudserver.json` из каталога запуска)
- `-set-password <pwd>` — изменить пароль панели управления
- `-set-turn-ip <ip>` — задать общедоступный IP-адрес TURN и включить TURN
- `-set-turn-port <port>` — задать порт прослушивания TURN и включить TURN
- `-v` / `-h` — показать версию или справку

## Конфигурация

Файл конфигурации по умолчанию: `xxtcloudserver.json` (создаётся в каталоге запуска)

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

- `passhash` — это результат `hmacSHA256("XXTouch", password)`, а не пароль в открытом виде.
- `ping_interval` задаёт частоту проверки соединения: с этим интервалом сервер отправляет устройству кадр WebSocket PING, чтобы проверить его доступность.
- `state_interval` задаёт частоту обновления состояния: с этим интервалом сервер отправляет устройству запрос `app/state`, чтобы получить актуальное состояние.
- `ping_timeout` задаёт допустимое количество последовательных пропусков ответа от устройства (в циклах `ping_interval`). После превышения порога сервер разрывает соединение с устройством.
- В `data_dir` по умолчанию создаются `scripts/`, `files/`, `reports/`, а также постоянные данные групп и конфигураций скриптов.
- Все пути в конфигурации задаются относительно каталога запуска. При запуске из `server/` значение `data_dir=./data` указывает на `server/data/`.
- По умолчанию `turnEnabled` имеет значение `true`, однако встроенный TURN запускается только после настройки `turnPublicIP` или `turnPublicAddr`.

## Настройка прохождения NAT для WebRTC (TURN)

Для управления рабочим столом в реальном времени через внешнюю сеть сервер содержит встроенную службу TURN с поддержкой UDP и TCP.

### Настройка общедоступного адреса TURN

Сервер поддерживает два способа настройки общедоступного адреса:

| Поле | Формат | Проверка | Назначение |
|------|------|------|----------|
| `turnPublicIP` | Только IPv4 | Проверка через `net.ParseIP()` | Фиксированный общедоступный IP-адрес |
| `turnPublicAddr` | IPv4 или домен | Автоматическое разрешение домена через DNS | Доступ по доменному имени |

> [!IMPORTANT]
> **Поддерживается только IPv4**: сейчас сервер TURN работает только с адресами IPv4. Адрес IPv6 или домен только с записью AAAA приведёт к ошибке запуска.
>
> Если заданы оба значения, приоритет имеет `turnPublicIP`. Для включения встроенного TURN достаточно настроить одно из них.

Пример конфигурации:

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

### Пользовательские ICE-серверы

Помимо встроенного TURN можно настроить внешние серверы STUN/TURN. Это полезно в следующих случаях:

- требуется использовать сторонний TURN (например, [Metered](https://www.metered.ca/tools/openrelay/)) вместо локальной службы TURN;
- требуется совместить локальный TURN с внешней службой, чтобы повысить надёжность прохождения NAT.

> [!WARNING]
> **Безопасность**: параметры `customIceServers`, включая `username` и `credential`, передаются устройству при установке WebRTC-соединения и **не являются секретными**. Используйте службу TURN с временными учётными данными либо убедитесь, что эти данные можно безопасно раскрывать.

Пример конфигурации:

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

**Правила объединения:**

| Локальный TURN | Пользовательские ICE-серверы | Результат |
|-----------|-------------------|------|
| Включён | Нет | Только локальный TURN |
| Выключен | Есть | Только пользовательские ICE-серверы |
| Включён | Есть | **Объединение**: локальный TURN + пользовательские ICE-серверы |
| Выключен | Нет | Без ICE-сервера; WebRTC пытается установить только прямое соединение |

### Команды быстрой настройки

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> Если `turnSecretKey` пуст, при запуске автоматически создаётся временный ключ, который меняется после перезапуска. Для постоянных учётных данных TURN задайте ключ вручную.

### Настройка межсетевого экрана

Администратор сервера должен открыть следующие порты в облачной группе безопасности или межсетевом экране:

| Диапазон портов | Протокол | Назначение |
|----------|------|------|
| `46980` (или пользовательский) | **TCP** | **Основная служба облачного управления** (API и WebSocket) |
| `43478` (или пользовательский) | **UDP и TCP** | Управление WebRTC [TURN], рукопожатие и резервное соединение |
| `49152 - 65535` | **UDP** | Ретрансляция медиапотока WebRTC [TURN] в реальном времени |

> [!TIP]
> Для ретрансляции медиа предпочтителен UDP. Если трафик UDP строго ограничен, WebRTC автоматически переключается на TCP (порт 43478), чтобы сохранить передачу потока рабочего стола.

## Настройка TLS/HTTPS (необязательно)

Сервер поддерживает HTTPS/WSS без обратного прокси и может самостоятельно обслуживать зашифрованные соединения. Также поддерживается работа через обратный прокси, например Nginx или Caddy.

### 1) Настройте TLS

Задайте следующие значения в `xxtcloudserver.json`:

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) Создайте локальный тестовый сертификат

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> Самоподписанный сертификат подходит только для локального тестирования. В рабочей среде используйте сертификат Let's Encrypt или другого центра сертификации.

### 3) Режим обратного прокси

При использовании Nginx/Caddy или другого обратного прокси сервер может работать по HTTP, а прокси будет завершать TLS. Скрипт привязки автоматически определит протокол по заголовку `X-Forwarded-Proto` и создаст правильный адрес `wss://`.

Пример конфигурации Nginx:

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

## Привязка устройства

1. Запустите исходный скрипт на упрощённом китайском `XXT 云控设置.lua` из корневого каталога либо выберите автономный скрипт нужного языка в `device-scripts/settings/` и укажите `ws://<host>:46980/api/ws` (для TLS или обратного прокси используйте `wss://`).
2. Либо скачайте автоматически созданный скрипт привязки:
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   Добавьте `proto=https`, чтобы принудительно создать адрес `wss://`. При работе через обратный прокси протокол также может автоматически определяться по `X-Forwarded-Proto`.
3. Либо вызовите локальный API устройства вручную:
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

Чтобы отключить облачное управление, задайте `enable` значение `false`.

В `device-scripts/settings/` находятся скрипты для 11 locale: `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `vi-VN`, `es-ES`, `pt-BR`, `ru-RU`, `fr-FR` и `de-DE`. Каждый файл запускается автономно и не зависит от файлов других языков.

## Правила WebSocket

- Адрес WebSocket: `ws://<host>:<port>/api/ws` (для TLS или обратного прокси используйте `wss://`)
- Сообщение стороны управления должно содержать `ts`, `nonce` и `sign`. Допустимое отклонение метки времени — ±60 секунд; повторное использование `nonce` запрещено в течение 120 секунд.

## Аутентификация и подпись (общие для HTTP/WS)

Проект использует не постоянный token, а динамическую подпись с коротким сроком действия. С каждым запросом клиент передаёт текущую метку времени в секундах `ts`, случайное значение `nonce` и подпись `sign`; сервер проверяет подпись в допустимом временном окне и не допускает повторного использования nonce.

### 1) Пароль и passhash

В файле конфигурации сервера `xxtcloudserver.json` хранится `passhash`, а не пароль в открытом виде:

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`; результат — шестнадцатеричная строка из 64 символов (hex).

### 2) Вычисление sign

Для подписи управляющих запросов `passhash` используется как HMAC key, а HMAC вычисляется по нормализованной базовой строке:

#### Базовая строка HTTP

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD` — метод запроса (GET/POST/PUT/DELETE…)
- `PATH_AND_QUERY` — `path` + отсортированный query без `ts/nonce/sign`
- `bodyHash`:
  - обычное тело запроса: hex от `SHA-256(bodyBytes)`
  - пустой body или multipart (`multipart/form-data`) пока не участвует в вычислении: `bodyHash = ""`

#### Базовая строка WebSocket

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type` — тип сообщения (например, `control/devices`)
- `bodyHash` — `SHA-256` от JSON-представления `body` (hex); если body отсутствует, используется пустая строка

Итоговая подпись:

- `sign = HMAC-SHA256(key=passhash, message=base)`; результат — строка hex.

> Внимание: `key=passhash` означает **саму строку hex из passhash** (её байты используются в HMAC), а не 32 байта, полученные после декодирования hex.

### 3) Правила проверки на сервере

- Допустимое отклонение времени: проверка продолжается, только если `ts` отличается от текущего времени сервера не более чем на `±60` секунд.
- `nonce` нельзя использовать повторно в течение `120` секунд (повтор считается атакой повторного воспроизведения).
- При ошибке проверки сервер возвращает `401 Unauthorized` (HTTP) или немедленно закрывает соединение (управляющее сообщение WebSocket).

### 4) Аутентификация HTTP API

Все HTTP API, кроме загрузки скрипта привязки по HTTP (`http`), требуют подписи по тому же алгоритму, что и WebSocket:

- Защищённые пути: все `/api/*`
- Исключения:
  - `/api/download-bind-script` (по требованиям доступен без подписи)
  - `/api/config` (начальная конфигурация frontend)
  - `/api/control/info` (конфигурация в формате JSON)
  - `/api/ws` (HTTP-аутентификация не применяется к рукопожатию обновления WebSocket, но управляющие сообщения по-прежнему требуют подписи)
  - `/api/transfer/download/:token` (загрузка по временному токену)
  - `/api/transfer/upload/:token` (отправка по временному токену)
  - предварительные запросы `OPTIONS` (CORS)

Подпись HTTP-запроса можно передать одним из двух способов:

1. **Заголовки запроса (рекомендуется)**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Параметры query** (для загрузки, `window.open`, `img` и других случаев, когда неудобно добавлять пользовательский заголовок)
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

Пример:

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

### Общий формат управляющих сообщений

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### HTTP-прокси (control/http)

Сторона управления может отправить `control/http` по WebSocket, чтобы перенаправить HTTP-запрос на устройство, где он выполняется через `http.request`. Это применяется, например, для API WebRTC.

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

> Примечание: `body` должен быть закодирован в base64. Если запрашивается `/api/webrtc/start` и TURN включён, сервер автоматически добавляет `iceServers`.

### Подключение устройства

Устройство отправляет `app/state` и передаёт уникальный идентификатор в `body.system.udid`.
Устройство с поддержкой глобальной аппаратной клавиатуры также объявляет следующие необязательные возможности. Если поле отсутствует или имеет значение не `true`, сторона управления не отправляет команды аппаратной клавиатуры:

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

Сторона управления отправляет `key/global-keyboard` через `control/command`, а устройство отвечает сообщением того же типа. `owner` идентифицирует сеанс управления в реальном времени; устройство разрешает отключить клавиатуру только при совпадении значения owner:

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

`action` поддерживает `status`, `connect` и `disconnect`. Ответ `body` содержит `action`, `owner`, `supported`, `ok`, `connected`, а при ошибке может также содержать `message`.

### Отключение устройства

Сервер уведомляет сторону управления:
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### Список устройств

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

Ответ:
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### Обновление состояния устройств

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
Сервер отправляет запрос `app/state` всем устройствам.

### Подписка на журнал в реальном времени

Подписка на журнал выбранного устройства:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

Отмена подписки:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

Если устройство поддерживает отправку журнала, оно передаёт:

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### Массовые команды

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

## Основные типы команд

### Операции с файлами

#### Отправка файла
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

#### Создание каталога
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

#### Список каталога
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

#### Загрузка файла
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

#### Копирование файла
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

#### Перемещение файла
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

#### Удаление файла
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

### Управление устройством

#### Respring устройства
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

#### Перезагрузка устройства
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

#### Команды касания
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

Описание:

- `finger` — необязательное поле с диапазоном `0 ~ 29`.
- Если не передавать `finger`, устройство продолжит обработку по прежнему протоколу одиночного касания для обратной совместимости.
- Мультитач задаётся несколькими сообщениями `touch/down|touch/move|touch/up` с постоянным значением `finger`. Для одного пальца необходимо использовать одно и то же значение `finger` от нажатия до отпускания.

#### Команды клавиш
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

#### Снимок экрана
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

### Буфер обмена

#### Чтение буфера обмена
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

#### Запись в буфер обмена
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

### Выбор словаря, очереди и скрипта

#### Запись значения в словарь
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

#### Добавление в очередь
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

#### Выбор скрипта
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

### Управление скриптами

#### Запуск скрипта
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

#### Остановка скрипта
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

## Безопасность

- Все управляющие команды WebSocket и все HTTP API, кроме загрузки скрипта привязки, требуют проверки динамической подписи HMAC-SHA256.
- При первом запуске создаётся случайный пароль, который отображается только один раз; рекомендуется сразу его изменить.
- Большие файлы рекомендуется передавать по HTTP через временный токен `/api/transfer/*` (WebSocket подходит только для небольших файлов и управляющих сообщений).
