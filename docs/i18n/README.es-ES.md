# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Tiếng Việt](README.vi-VN.md) | Español | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | [Français](README.fr-FR.md) | [Deutsch](README.de-DE.md)

Servidor de control en la nube (WebSocket + frontend estático) y panel de administración para XXTouch 1.3.8-20260122000000 y posteriores.  
La implementación del protocolo del dispositivo se encuentra en `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua`.  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="XXTCloudControl screenshot" src="../../site/public/screenshot-001-en.png">
</picture>

## Versiones publicadas

- Página oficial de descargas (GitHub Pages): [https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- Versiones para todas las plataformas: [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- Se recomienda descargar primero `XXTCloudControl-<YYYYMMDDHHMM>.zip` de los archivos de la versión publicada. Extráelo y ejecuta el binario correspondiente a tu sistema operativo.


## Estructura del proyecto

- `server/` - Servicio backend WebSocket/HTTP (punto de entrada: `server/main.go`)
- `frontend/` - Panel de administración SolidJS; código fuente en `frontend/src/` y salida de compilación en `frontend/dist/`
- `device-client/` - Biblioteca de cliente WebSocket Lua
- `XXT 云控设置.lua` - Script original de configuración del dispositivo en chino simplificado (escribe la dirección de control en la nube)
- `device-scripts/settings/` - Scripts independientes de configuración en 11 idiomas
- `docs/i18n/` - Traducciones completas del README
- `build.sh` - Compila y empaqueta el servidor y frontend multiplataforma
- `build/` - Directorio de salida de la compilación
- `server/data/` - Directorio de datos en ejecución (`data_dir=./data` por defecto, relativo al directorio de inicio)

## Funciones

- Comunicación WebSocket en tiempo real y sincronización del estado de los dispositivos
- Despliegue integrado de frontend y backend; el servidor puede alojar directamente el frontend estático
- Control por lotes: scripts, toques, teclas, reinicio/respring y portapapeles
- Control de escritorio WebRTC en tiempo real con travesía NAT mediante un servidor TURN integrado opcional
- Grupos de dispositivos y configuración de scripts mediante formularios dinámicos de FormRunner
- Repositorio de archivos del servidor (scripts/files/reports) y transferencias bidireccionales dispositivo/servidor (WS para archivos pequeños y tokens HTTP para archivos grandes)
- Proxy `control/http` hacia las API HTTP locales del dispositivo, incluidas las API de WebRTC

## Inicio rápido

### Descargar y ejecutar un binario (recomendado)

1. Abre la página de versiones y descarga el `XXTCloudControl-<YYYYMMDDHHMM>.zip` más reciente:  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. Extrae el archivo, entra en el directorio y ejecuta el binario correspondiente a tu sistema operativo:
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
3. En el primer inicio se generará `xxtcloudserver.json` en el directorio actual y se mostrará una contraseña aleatoria una sola vez.
4. Abre `http://<dirección-del-servidor>:46980` en el navegador e inicia sesión en el panel de administración.
5. Si olvidas la contraseña, puedes restablecerla en el mismo directorio y reiniciar el servicio:
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Despliegue con Docker

#### Inicio rápido (recomendado)

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

> Nota: Si no montas un directorio de datos, los datos y la configuración se generarán de forma predeterminada dentro del contenedor, en `/app/data`.
> Al iniciarse, el servicio lee primero el archivo de configuración y después aplica los valores de las variables de entorno. Las variables de entorno no se escriben automáticamente en el archivo de configuración.
> Consulta el ejemplo [docker-compose.yml](../../docker-compose.yml) para ver los nombres de las variables de entorno.

#### Despliegue en un solo paso con docker-compose.yml

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### Compilación y empaquetado para producción desde el código fuente

> Dependencias: `go`, `npm` y `zip`

```bash
bash build.sh
```

Los artefactos se generan en `build/` e incluyen los binarios para cada plataforma y el archivo zip empaquetado:
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

Después de extraerlo, la estructura de directorios es la siguiente:
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
Dentro de ese directorio, ejecuta el binario correspondiente a tu sistema para alojar automáticamente el frontend (de forma predeterminada, `frontend_dir=./frontend`).

### Crear imágenes de Docker

> Dependencia: `docker` con buildx habilitado

```bash
bash build-docker.sh
```

Los artefactos se generan en `build/`:
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### Modo de desarrollo

1. Inicia el backend:
   ```bash
   cd server
   go run .
   ```
   En el primer inicio se generará `xxtcloudserver.json` en el directorio actual y se mostrará una contraseña aleatoria una sola vez.

2. Inicia el servidor de desarrollo del frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Abre `http://localhost:3000` e introduce en la página de inicio de sesión la dirección del servidor, el puerto (de forma predeterminada, `46980`) y la contraseña.
   
   > Nota: El servidor de desarrollo se vincula de forma predeterminada a `127.0.0.1:3000` y reenvía `/api` a `http://127.0.0.1:46980`. Si el backend no se ejecuta en el mismo equipo, ajusta `frontend/vite.config.ts` o utiliza un proxy inverso.

> Atención: Al ejecutar `go run .` desde el directorio `server`, el valor predeterminado de `frontend_dir` es `./frontend` y no apunta automáticamente a `../frontend/dist`. Si quieres que el backend aloje el frontend, configura `frontend_dir` o utiliza la estructura de directorios del paquete compilado.

### Cambiar la contraseña

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

O bien, en el modo de código fuente:
```bash
cd server
go run . -set-password 12345678
```

## Parámetros habituales de la línea de comandos

- `-config <path>`: Especifica la ruta del archivo de configuración (de forma predeterminada, `xxtcloudserver.json` en el directorio de inicio).
- `-set-password <pwd>`: Cambia la contraseña del panel de control.
- `-set-turn-ip <ip>`: Configura la IP pública de TURN y lo habilita.
- `-set-turn-port <port>`: Configura el puerto de escucha de TURN y lo habilita.
- `-v` / `-h`: Muestra la versión o la ayuda.

## Configuración

Archivo de configuración predeterminado: `xxtcloudserver.json` (se genera en el directorio de inicio)

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

- `passhash` es el resultado de `hmacSHA256("XXTouch", password)`, no la contraseña en texto claro.
- `ping_interval` controla la frecuencia de las comprobaciones de actividad. El servidor envía tramas PING de WebSocket a los dispositivos con ese intervalo para comprobar si siguen conectados.
- `state_interval` controla la frecuencia de actualización del estado. El servidor envía solicitudes `app/state` a los dispositivos con ese intervalo para obtener su estado más reciente.
- `ping_timeout` indica cuántas veces consecutivas puede no responder un dispositivo, según el periodo de `ping_interval`, antes de que el servidor cierre su conexión.
- De forma predeterminada, `data_dir` contiene `scripts/`, `files/`, `reports/` y otros datos persistentes, como las configuraciones de grupos y scripts.
- Todas las rutas de la configuración son relativas al directorio de inicio. Si el servicio se inicia desde `server/`, el valor predeterminado `data_dir=./data` corresponde a `server/data/`.
- El valor predeterminado de `turnEnabled` es `true`, pero el servidor TURN integrado solo se inicia cuando se configura `turnPublicIP` o `turnPublicAddr`.

## Configuración de la travesía NAT de WebRTC con TURN

Para permitir el control del escritorio en tiempo real desde redes externas, el servidor incorpora un servidor TURN compatible con UDP y TCP.

### Configurar la dirección de TURN

El servidor permite configurar la dirección pública de dos formas:

| Campo | Formato | Validación | Caso de uso |
|------|------|------|----------|
| `turnPublicIP` | Solo dirección IPv4 | Validación mediante `net.ParseIP()` | IP pública fija |
| `turnPublicAddr` | Dirección IPv4 o dominio | Resolución DNS automática del dominio | Acceso mediante un dominio |

> [!IMPORTANT]
> **Solo se admite IPv4:** Actualmente, el servidor TURN solo admite direcciones IPv4. Una dirección IPv6 o un dominio que solo tenga un registro AAAA impedirá que el servidor se inicie.
>
> Si se configuran ambos valores, `turnPublicIP` tiene prioridad. Basta con configurar uno de ellos para habilitar el servidor TURN integrado.

Ejemplo de configuración:

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

### Servidores ICE personalizados

Además del servicio TURN integrado, también puedes configurar servidores STUN/TURN externos. Esto resulta útil en los siguientes casos:

- No quieres habilitar un servicio TURN local y prefieres utilizar un servicio de terceros, como [Metered](https://www.metered.ca/tools/openrelay/).
- Necesitas combinar el servidor TURN local con servicios externos para mejorar la travesía NAT.

> [!WARNING]
> **Aviso de seguridad:** La configuración de `customIceServers`, incluidos `username` y `credential`, se envía al dispositivo al establecer la conexión WebRTC y **no es información confidencial**. Utiliza un servicio TURN con credenciales temporales o asegúrate de que las credenciales se puedan compartir públicamente.

Ejemplo de configuración:

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

**Comportamiento al combinar servidores:**

| TURN local | Servidores ICE personalizados | Resultado |
|-----------|-------------------|------|
| Habilitado | Ninguno | Solo se utiliza el TURN local |
| Deshabilitado | Sí | Solo se utilizan los servidores ICE personalizados |
| Habilitado | Sí | **Combinación:** TURN local y servidores ICE personalizados |
| Deshabilitado | Ninguno | Sin servidores ICE; WebRTC solo intenta una conexión directa |

### Comandos de configuración rápida

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> Si `turnSecretKey` está vacío, al iniciar se genera automáticamente una clave temporal que cambia después de cada reinicio. Configúrala manualmente si necesitas credenciales TURN estables.

### Configuración del cortafuegos para administradores

El administrador del servidor debe abrir los siguientes puertos en el grupo de seguridad de la nube o en el cortafuegos:

| Intervalo de puertos | Protocolo | Uso |
|----------|------|------|
| `46980` (o personalizado) | **TCP** | **Servicio de control en la nube** (API y WebSocket) |
| `43478` (o personalizado) | **UDP y TCP** | Control, negociación y alternativa de WebRTC [TURN] |
| `49152 - 65535` | **UDP** | Retransmisión del flujo multimedia en tiempo real de WebRTC [TURN] |

> [!TIP]
> La retransmisión multimedia utiliza UDP de forma preferente. Si el tráfico UDP está muy restringido, WebRTC cambia automáticamente a TCP en el puerto 43478 para mantener la transmisión del escritorio.

## Configuración de TLS/HTTPS (opcional)

El servidor admite HTTPS/WSS de forma nativa, por lo que puede habilitar conexiones cifradas sin un proxy inverso. También permite utilizar un proxy inverso como Nginx o Caddy.

### 1) Configurar TLS

Configura lo siguiente en `xxtcloudserver.json`:

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) Generar un certificado local de prueba

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> Los certificados autofirmados solo son adecuados para pruebas locales. En producción, utiliza un certificado emitido por Let's Encrypt u otra autoridad de certificación.

### 3) Modo de proxy inverso

Si utilizas un proxy inverso como Nginx o Caddy, el servidor puede seguir funcionando en modo HTTP mientras el proxy se encarga de la terminación TLS. En este caso, el script de vinculación detecta automáticamente el protocolo mediante la cabecera `X-Forwarded-Proto` y genera la dirección `wss://` correcta.

Ejemplo de configuración de Nginx:

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

## Vincular dispositivos

1. Ejecuta el script original en chino simplificado `XXT 云控设置.lua` del directorio raíz o el script independiente del idioma correspondiente en `device-scripts/settings/`, e introduce `ws://<host>:46980/api/ws`. Utiliza `wss://` si empleas TLS o un proxy inverso.
2. También puedes descargar el script de vinculación generado automáticamente:
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   Puedes añadir `proto=https` para forzar la generación de una dirección `wss://`. Con un proxy inverso, el protocolo también se puede detectar automáticamente mediante `X-Forwarded-Proto`.
3. Como alternativa, llama manualmente a la interfaz local del dispositivo:
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

Para desactivar el control en la nube, establece `enable` en `false`.

`device-scripts/settings/` contiene scripts para 11 configuraciones regionales: `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `vi-VN`, `es-ES`, `pt-BR`, `ru-RU`, `fr-FR` y `de-DE`. Cada archivo se puede ejecutar de forma independiente y no depende de archivos de otros idiomas.

## Convenciones de WebSocket

- Dirección de WebSocket: `ws://<host>:<port>/api/ws` (utiliza `wss://` con TLS o un proxy inverso).
- Los mensajes del controlador deben incluir `ts`, `nonce` y `sign`. Se permite una desviación de ±60 segundos en la marca de tiempo y no se puede repetir un `nonce` durante 120 segundos.

## Autenticación y algoritmo de firma para HTTP y WebSocket

La autenticación no utiliza un token fijo, sino una firma dinámica de corta duración. En cada solicitud, el cliente envía la marca de tiempo actual en segundos como `ts`, un `nonce` aleatorio y la firma `sign`. El servidor valida la firma dentro del intervalo permitido e impide reutilizar el mismo `nonce`.

### 1) Contraseña y passhash

El archivo de configuración del servidor `xxtcloudserver.json` almacena `passhash`, no la contraseña en texto claro:

- `passhash = HMAC-SHA256(key="XXTouch", message=password)`; el resultado es una cadena hexadecimal de 64 caracteres.

### 2) Cálculo de sign

La firma de control utiliza `passhash` como clave HMAC para calcular el HMAC de la cadena base normalizada:

#### Cadena base de HTTP

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD`: Método de la solicitud (GET/POST/PUT/DELETE…).
- `PATH_AND_QUERY`: `path` más la query ordenada, sin `ts`, `nonce` ni `sign`.
- `bodyHash`:
  - Cuerpo normal: resultado hexadecimal de `SHA-256(bodyBytes)`.
  - Un body vacío o multipart (`multipart/form-data`) no se incluye por ahora: `bodyHash = ""`.

#### Cadena base de WebSocket

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type`: Tipo de mensaje, por ejemplo `control/devices`.
- `bodyHash`: Resultado hexadecimal de aplicar `SHA-256` al JSON de `body`; si no hay body, se utiliza una cadena vacía.

Firma final:

- `sign = HMAC-SHA256(key=passhash, message=base)`; el resultado es una cadena hexadecimal.

> Atención: Aquí, `key=passhash` se refiere a **la propia cadena hexadecimal de passhash**, cuyos bytes de cadena intervienen en el HMAC. No debe decodificarse primero como 32 bytes.

### 3) Reglas de validación del servidor

- Desviación temporal permitida: `ts` debe estar dentro de `±60` segundos respecto a la hora actual del servidor.
- Un `nonce` no puede repetirse durante `120` segundos; una repetición se considera un ataque de repetición.
- Si la validación falla, se devuelve `401 Unauthorized` para HTTP o se cierra directamente la conexión si se trata de un mensaje WebSocket del controlador.

### 4) Autenticación de la API HTTP

Salvo la descarga del script de vinculación mediante `http`, todas las API HTTP deben incluir una firma calculada con el mismo algoritmo que WebSocket:

- Rutas protegidas: todas las rutas `/api/*`.
- Excepciones:
  - `/api/download-bind-script` (se mantiene sin firma).
  - `/api/config` (configuración de inicio del frontend).
  - `/api/control/info` (salida de configuración en formato JSON).
  - `/api/ws` (el protocolo de enlace para actualizar a WebSocket no utiliza autenticación HTTP; los mensajes del controlador siguen necesitando firma).
  - `/api/transfer/download/:token` (descarga con token temporal).
  - `/api/transfer/upload/:token` (carga con token temporal).
  - Solicitudes de comprobación previa `OPTIONS` para CORS.

Las solicitudes HTTP pueden incluir la firma de una de estas dos formas:

1. **Cabeceras de solicitud (recomendado)**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Parámetros de query**, para descargas, `window.open`, `img` y otros casos en los que no resulte práctico añadir cabeceras personalizadas
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

Ejemplo:

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

### Formato general de los mensajes del controlador

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/command|control/commands|control/devices|control/refresh",
  "body": {}
}
```

### Proxy HTTP (control/http)

El controlador puede enviar `control/http` mediante WebSocket para reenviar una solicitud HTTP al dispositivo, donde se ejecuta con `http.request`. Se utiliza habitualmente para las interfaces relacionadas con WebRTC.

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

> Nota: `body` debe estar codificado en base64. Cuando la solicitud se dirige a `/api/webrtc/start` y TURN está habilitado, el servidor inserta automáticamente `iceServers`.

### Conexión de un dispositivo

El dispositivo envía `app/state` y proporciona un identificador único en `body.system.udid`.
Los dispositivos compatibles con el teclado físico global también declaran la siguiente capacidad opcional. Si el campo no existe o su valor no es `true`, el controlador no envía comandos de teclado físico:

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

El controlador envía `key/global-keyboard` mediante `control/command` y el dispositivo responde con el mismo tipo. `owner` identifica una sesión de control en tiempo real; el dispositivo solo permite que el owner correspondiente desconecte su teclado:

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

`action` admite `status`, `connect` y `disconnect`. El `body` de la respuesta contiene `action`, `owner`, `supported`, `ok` y `connected`; si se produce un error, también puede incluir `message`.

### Desconexión de un dispositivo

El servidor avisa al controlador:
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### Lista de dispositivos

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

Respuesta:
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### Actualizar el estado de los dispositivos

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
El servidor difunde una solicitud `app/state` a todos los dispositivos.

### Suscripción a registros en tiempo real

Suscribirse al registro de un dispositivo concreto:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

Cancelar la suscripción:

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

Si el dispositivo permite enviar registros, enviará:

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### Comandos por lotes

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

## Tipos de comandos habituales

### Operaciones con archivos

#### Subir un archivo
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

#### Crear un directorio
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

#### Enumerar un directorio
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

#### Descargar un archivo
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

#### Copiar un archivo
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

#### Mover un archivo
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

#### Eliminar un archivo
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

### Control de dispositivos

#### Reiniciar la interfaz del dispositivo
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

#### Reiniciar el dispositivo
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

#### Comandos táctiles
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

Notas:

- `finger` es un campo opcional cuyo intervalo es `0 ~ 29`.
- Si no se envía `finger`, el dispositivo sigue utilizando el protocolo anterior de un solo dedo para mantener la compatibilidad.
- Los gestos multitáctiles se representan mediante varios mensajes `touch/down|touch/move|touch/up` con un valor estable de `finger`. Debe utilizarse el mismo `finger` para un dedo concreto desde que toca la pantalla hasta que se levanta.

#### Comandos de teclas
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

#### Captura de pantalla
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

### Portapapeles

#### Leer el portapapeles
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

#### Escribir en el portapapeles
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

### Diccionario, cola y selección de scripts

#### Establecer un valor del diccionario
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

#### Enviar a la cola
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

#### Seleccionar un script
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

### Control de scripts

#### Iniciar un script
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

#### Detener un script
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

## Seguridad

- Todos los comandos de control WebSocket y todas las API HTTP, excepto la descarga del script de vinculación, requieren validación mediante firma dinámica HMAC-SHA256.
- El primer inicio genera una contraseña aleatoria que se muestra una sola vez. Cámbiala cuanto antes.
- Para archivos grandes, utiliza `/api/transfer/*` con tokens HTTP temporales. WebSocket está pensado únicamente para archivos pequeños y mensajes de control.
