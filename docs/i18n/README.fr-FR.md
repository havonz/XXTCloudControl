# XXTCloudControl

[简体中文](../../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Tiếng Việt](README.vi-VN.md) | [Español](README.es-ES.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru-RU.md) | Français | [Deutsch](README.de-DE.md)

Serveur de contrôle dans le cloud (WebSocket + frontend statique) et panneau d’administration pour XXTouch 1.3.8-20260122000000 et versions ultérieures.  
L’implémentation du protocole côté appareil se trouve à l’adresse `/var/mobile/Media/1ferver/bin/open-cloud-control-client.lua`.  

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../site/public/screenshot-001-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="../../site/public/screenshot-001-en.png">
  <img alt="Capture d’écran de XXTCloudControl" src="../../site/public/screenshot-001-en.png">
</picture>

## Versions publiées

- Page officielle de téléchargement (GitHub Pages) : [https://xxtccc-releases.xxtouch.app/](https://xxtccc-releases.xxtouch.app/)
- Versions pour toutes les plateformes : [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
- Nous recommandons de télécharger d’abord `XXTCloudControl-<YYYYMMDDHHMM>.zip` parmi les fichiers de la version publiée. Extrayez-le, puis exécutez le binaire correspondant à votre système d’exploitation.


## Structure du projet

- `server/` - Service backend WebSocket/HTTP (point d’entrée : `server/main.go`)
- `frontend/` - Panneau d’administration SolidJS ; source dans `frontend/src/` et sortie de compilation dans `frontend/dist/`
- `device-client/` - Bibliothèque cliente WebSocket Lua
- `XXT 云控设置.lua` - Script original de configuration de l’appareil en chinois simplifié (écrit l’adresse du contrôle dans le cloud)
- `device-scripts/settings/` - Scripts autonomes de configuration dans 11 langues
- `docs/i18n/` - Traductions complètes du README
- `build.sh` - Compile et empaquette le serveur et le frontend multiplateformes
- `build/` - Répertoire de sortie de compilation
- `server/data/` - Répertoire de données d’exécution (`data_dir=./data` par défaut, relatif au répertoire de lancement)

## Fonctionnalités

- Communication WebSocket en temps réel et synchronisation de l’état des appareils
- Déploiement intégré du frontend et du backend ; le serveur peut héberger directement le frontend statique
- Contrôle groupé des appareils : scripts, commandes tactiles, touches, redémarrage/respring et presse-papiers
- Contrôle du bureau WebRTC en temps réel avec traversée NAT via un serveur TURN intégré facultatif
- Groupes d’appareils et configuration des scripts avec les formulaires dynamiques FormRunner
- Dépôt de fichiers côté serveur (scripts/files/reports) et transferts bidirectionnels appareil/serveur (WS pour les petits fichiers, tokens HTTP pour les gros fichiers)
- Proxy `control/http` vers les API HTTP locales de l’appareil, y compris les API WebRTC

## Démarrage rapide

### Télécharger et exécuter un binaire (recommandé)

1. Ouvrez la page des versions et téléchargez le dernier `XXTCloudControl-<YYYYMMDDHHMM>.zip` :  
   [https://github.com/havonz/XXTCloudControl/releases](https://github.com/havonz/XXTCloudControl/releases)
2. Extrayez l’archive, accédez au répertoire et exécutez le binaire correspondant à votre système d’exploitation :
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
3. Au premier démarrage, `xxtcloudserver.json` est créé dans le répertoire courant et un mot de passe aléatoire s’affiche une seule fois.
4. Ouvrez `http://<adresse-du-serveur>:46980` dans un navigateur et connectez-vous au panneau d’administration.
5. Si vous oubliez le mot de passe, vous pouvez le réinitialiser dans le même répertoire, puis redémarrer le service :
   ```bash
   # macOS (Apple Silicon 示例)
   ./xxtcloudserver-darwin-arm64 -set-password 12345678

   # Linux (amd64 示例)
   ./xxtcloudserver-linux-amd64 -set-password 12345678

   # Windows (PowerShell)
   .\xxtcloudserver-windows-amd64.exe -set-password 12345678
   ```

### Déploiement avec Docker

#### Démarrage rapide (recommandé)

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

> Remarque : si vous ne montez aucun répertoire de données, les données et la configuration sont créées par défaut dans le conteneur, sous `/app/data`.
> Au démarrage, le service lit d’abord le fichier de configuration, puis applique les valeurs des variables d’environnement. Celles-ci ne sont pas réécrites automatiquement dans le fichier de configuration.
> Consultez l’exemple [docker-compose.yml](../../docker-compose.yml) pour connaître le nom des variables d’environnement.

#### Déploiement en une étape avec docker-compose.yml

[docker-compose.yml](../../docker-compose.yml)

```bash
mkdir -p XXTCloudControl && cd XXTCloudControl
curl -L -o docker-compose.yml https://raw.githubusercontent.com/havonz/XXTCloudControl/main/docker-compose.yml
docker compose up -d
```

### Compilation et empaquetage de production à partir des sources

> Dépendances : `go`, `npm` et `zip`

```bash
bash build.sh
```

Les artefacts sont générés dans `build/` et comprennent les binaires de chaque plateforme ainsi que l’archive zip :
```
build/
├── xxtcloudserver-<os>-<arch>[.exe]
├── ...
└── XXTCloudControl-<YYYYMMDDHHMM>.zip
```

Après extraction, l’arborescence est la suivante :
```
XXTCloudControl/
├── frontend/
├── xxtcloudserver-darwin-arm64
├── xxtcloudserver-linux-amd64
└── xxtcloudserver-windows-amd64.exe
```
Dans ce répertoire, exécutez le binaire correspondant à votre système pour héberger automatiquement le frontend (`frontend_dir=./frontend` par défaut).

### Création des images Docker

> Dépendance : `docker` avec buildx activé

```bash
bash build-docker.sh
```

Les artefacts sont générés dans `build/` :
```
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-amd64.tar
XXTCloudControl-docker-<YYYYMMDDHHMM>-linux-arm64.tar
```

### Mode de développement

1. Démarrez le backend :
   ```bash
   cd server
   go run .
   ```
   Au premier démarrage, `xxtcloudserver.json` est créé dans le répertoire courant et un mot de passe aléatoire s’affiche une seule fois.

2. Démarrez le serveur de développement du frontend :
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Ouvrez `http://localhost:3000`, puis saisissez sur la page de connexion l’adresse du serveur, le port (`46980` par défaut) et le mot de passe.
   
   > Remarque : le serveur de développement écoute par défaut sur `127.0.0.1:3000` et transmet `/api` à `http://127.0.0.1:46980`. Si le backend ne s’exécute pas sur la même machine, adaptez `frontend/vite.config.ts` ou utilisez un proxy inverse.

> Attention : lorsque `go run .` est lancé depuis le répertoire `server`, `frontend_dir` vaut par défaut `./frontend` et ne pointe pas automatiquement vers `../frontend/dist`. Si vous souhaitez que le backend héberge le frontend, définissez `frontend_dir` dans la configuration ou utilisez l’arborescence du paquet compilé.

### Modifier le mot de passe

```bash
./xxtcloudserver-<os>-<arch> -set-password 12345678
```

Ou en mode source :
```bash
cd server
go run . -set-password 12345678
```

## Paramètres de ligne de commande courants

- `-config <path>` : indique le chemin du fichier de configuration (`xxtcloudserver.json` dans le répertoire de démarrage par défaut)
- `-set-password <pwd>` : modifie le mot de passe du panneau de contrôle
- `-set-turn-ip <ip>` : définit l’IP publique de TURN et l’active
- `-set-turn-port <port>` : définit le port d’écoute de TURN et l’active
- `-v` / `-h` : affiche la version ou l’aide

## Configuration

Fichier de configuration par défaut : `xxtcloudserver.json` (généré dans le répertoire de démarrage)

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

- `passhash` est le résultat de `hmacSHA256("XXTouch", password)`, et non le mot de passe en clair.
- `ping_interval` contrôle la fréquence des vérifications d’activité. Le serveur envoie à cet intervalle des trames PING WebSocket aux appareils afin de vérifier leur état de connexion.
- `state_interval` contrôle la fréquence d’actualisation de l’état. Le serveur envoie à cet intervalle des requêtes `app/state` aux appareils afin d’obtenir leur dernier état.
- `ping_timeout` indique le nombre maximal d’absences de réponse consécutives d’un appareil, selon la période `ping_interval`. Au-delà, le serveur ferme la connexion avec cet appareil.
- Par défaut, `data_dir` contient `scripts/`, `files/`, `reports/` et d’autres données persistantes, notamment les configurations de groupes et de scripts.
- Tous les chemins de la configuration sont relatifs au répertoire de démarrage. Si le service est lancé depuis `server/`, la valeur par défaut `data_dir=./data` correspond à `server/data/`.
- `turnEnabled` vaut `true` par défaut, mais le serveur TURN intégré ne démarre réellement que si `turnPublicIP` ou `turnPublicAddr` est configuré.

## Configuration de la traversée NAT WebRTC avec TURN

Pour permettre le contrôle du bureau en temps réel depuis un réseau externe, le serveur intègre un serveur TURN compatible UDP et TCP.

### Configuration de l’adresse TURN

Le serveur permet de configurer l’adresse publique de deux manières :

| Champ | Format | Validation | Cas d’utilisation |
|------|------|------|----------|
| `turnPublicIP` | Adresse IPv4 uniquement | Validation avec `net.ParseIP()` | IP publique fixe |
| `turnPublicAddr` | Adresse IPv4 ou nom de domaine | Résolution DNS automatique du domaine | Accès par un nom de domaine |

> [!IMPORTANT]
> **IPv4 uniquement :** le serveur TURN ne prend actuellement en charge que les adresses IPv4. Une adresse IPv6 ou un domaine ne disposant que d’un enregistrement AAAA empêche le démarrage.
>
> Si les deux valeurs sont configurées, `turnPublicIP` est prioritaire. Il suffit d’en définir une pour activer le serveur TURN intégré.

Exemple de configuration :

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

### Serveurs ICE personnalisés

En plus du service TURN intégré, vous pouvez configurer des serveurs STUN/TURN externes. Cela s’avère utile dans les cas suivants :

- Vous ne souhaitez pas activer de service TURN local et préférez utiliser un service tiers, tel que [Metered](https://www.metered.ca/tools/openrelay/).
- Vous devez combiner le serveur TURN local avec des services externes afin d’améliorer la traversée NAT.

> [!WARNING]
> **Avertissement de sécurité :** la configuration de `customIceServers`, notamment `username` et `credential`, est envoyée à l’appareil lors de la connexion WebRTC et **ne constitue pas une information confidentielle**. Utilisez un service TURN prenant en charge des identifiants temporaires ou assurez-vous que ces identifiants peuvent être divulgués publiquement.

Exemple de configuration :

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

**Comportement de la combinaison :**

| TURN local | Serveurs ICE personnalisés | Résultat |
|-----------|-------------------|------|
| Activé | Aucun | Utilisation du TURN local uniquement |
| Désactivé | Présents | Utilisation des serveurs ICE personnalisés uniquement |
| Activé | Présents | **Combinaison :** TURN local et serveurs ICE personnalisés |
| Désactivé | Aucun | Aucun serveur ICE ; WebRTC tente uniquement une connexion directe |

### Commandes de configuration rapide

```bash
# 设置公网 IP 并启用
./xxtcloudserver -set-turn-ip 1.2.3.4

# (可选) 设置监听端口 (默认 43478)
./xxtcloudserver -set-turn-port 3478
```

> [!TIP]
> Si `turnSecretKey` est vide, une clé temporaire est générée automatiquement au démarrage et change après chaque redémarrage. Configurez-la manuellement si vous avez besoin d’identifiants TURN stables.

### Configuration du pare-feu par l’administrateur

L’administrateur du serveur doit ouvrir les ports suivants dans le groupe de sécurité cloud ou le pare-feu :

| Plage de ports | Protocole | Utilisation |
|----------|------|------|
| `46980` (ou personnalisé) | **TCP** | **Service de contrôle dans le cloud** (API et WebSocket) |
| `43478` (ou personnalisé) | **UDP et TCP** | Contrôle, négociation et repli WebRTC [TURN] |
| `49152 - 65535` | **UDP** | Relais du flux multimédia WebRTC [TURN] en temps réel |

> [!TIP]
> Le relais multimédia utilise UDP en priorité. Si le trafic UDP est fortement restreint, WebRTC se replie automatiquement sur TCP, port 43478, afin de maintenir la transmission du bureau.

## Configuration TLS/HTTPS (facultative)

Le serveur prend en charge HTTPS/WSS nativement et peut donc activer des connexions chiffrées sans proxy inverse. Il reste également compatible avec un proxy inverse tel que Nginx ou Caddy.

### 1) Configurer TLS

Définissez les valeurs suivantes dans `xxtcloudserver.json` :

```json
{
  "tlsEnabled": true,
  "tlsCertFile": "./certs/server.crt",
  "tlsKeyFile": "./certs/server.key"
}
```

### 2) Générer un certificat de test local

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> [!WARNING]
> Les certificats autosignés conviennent uniquement aux tests locaux. En production, utilisez un certificat émis par Let’s Encrypt ou une autre autorité de certification.

### 3) Mode proxy inverse

Si vous utilisez un proxy inverse tel que Nginx ou Caddy, le serveur peut continuer à fonctionner en mode HTTP tandis que le proxy assure la terminaison TLS. Le script de liaison détecte alors automatiquement le protocole à partir de l’en-tête `X-Forwarded-Proto` et génère l’adresse `wss://` correcte.

Exemple de configuration Nginx :

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

## Lier des appareils

1. Exécutez le script d’origine en chinois simplifié `XXT 云控设置.lua` situé à la racine, ou le script autonome de la langue souhaitée dans `device-scripts/settings/`, puis saisissez `ws://<host>:46980/api/ws`. Utilisez `wss://` avec TLS ou un proxy inverse.
2. Vous pouvez également télécharger le script de liaison généré automatiquement :
   `http://<host>:46980/api/download-bind-script?host=<host>&port=46980`  
   Ajoutez `proto=https` pour forcer la génération d’une adresse `wss://`. Avec un proxy inverse, le protocole peut également être détecté automatiquement grâce à `X-Forwarded-Proto`.
3. Vous pouvez aussi appeler manuellement l’interface locale de l’appareil :
   ```http
   PUT http://127.0.0.1:46952/api/config

   {
     "cloud": {
       "enable": true,
       "address": "ws://<host>:46980/api/ws"
     }
   }
   ```

Pour désactiver le contrôle dans le cloud, définissez `enable` sur `false`.

`device-scripts/settings/` fournit des scripts pour 11 paramètres régionaux : `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `vi-VN`, `es-ES`, `pt-BR`, `ru-RU`, `fr-FR` et `de-DE`. Chaque fichier peut être exécuté indépendamment et ne dépend d’aucun fichier d’une autre langue.

## Conventions WebSocket

- Adresse WebSocket : `ws://<host>:<port>/api/ws` (utilisez `wss://` avec TLS ou un proxy inverse)
- Les messages du contrôleur doivent contenir `ts`, `nonce` et `sign`. Une dérive de ±60 secondes est admise pour l’horodatage et un même `nonce` ne peut pas être réutilisé pendant 120 secondes.

## Authentification et algorithme de signature pour HTTP et WebSocket

L’authentification n’utilise pas de token fixe, mais une signature dynamique à courte durée de validité. À chaque requête, le client envoie l’horodatage courant en secondes sous la forme `ts`, un `nonce` aléatoire et la signature `sign`. Le serveur vérifie la signature dans la fenêtre temporelle autorisée et empêche la réutilisation d’un même `nonce`.

### 1) Mot de passe et passhash

Le fichier de configuration du serveur `xxtcloudserver.json` enregistre `passhash`, et non le mot de passe en clair :

- `passhash = HMAC-SHA256(key="XXTouch", message=password)` ; le résultat est une chaîne hexadécimale de 64 caractères.

### 2) Calcul de sign

La signature de contrôle utilise `passhash` comme clé HMAC pour calculer le HMAC de la chaîne de base normalisée :

#### Chaîne de base HTTP

```
base = ts "\n" nonce "\n" METHOD "\n" PATH_AND_QUERY "\n" bodyHash
```

- `METHOD` : méthode de la requête (GET/POST/PUT/DELETE…)
- `PATH_AND_QUERY` : `path` suivi de la query triée, sans `ts`, `nonce` ni `sign`
- `bodyHash` :
  - Corps de requête normal : résultat hexadécimal de `SHA-256(bodyBytes)`
  - Un body vide ou multipart (`multipart/form-data`) n’est pas pris en compte pour le moment : `bodyHash = ""`

#### Chaîne de base WebSocket

```
base = ts "\n" nonce "\n" type "\n" bodyHash
```

- `type` : type de message, par exemple `control/devices`
- `bodyHash` : résultat hexadécimal de `SHA-256` appliqué au JSON de `body` ; chaîne vide en l’absence de body

Signature finale :

- `sign = HMAC-SHA256(key=passhash, message=base)` ; le résultat est une chaîne hexadécimale.

> Attention : `key=passhash` désigne ici **la chaîne hexadécimale de passhash elle-même**, dont les octets de chaîne participent au HMAC. Elle ne doit pas être préalablement décodée en 32 octets.

### 3) Règles de validation du serveur

- Dérive temporelle autorisée : `ts` doit se trouver dans une plage de `±60` secondes autour de l’heure actuelle du serveur.
- Un même `nonce` ne peut pas être réutilisé pendant `120` secondes ; toute répétition est considérée comme une attaque par rejeu.
- En cas d’échec de la validation, le serveur renvoie `401 Unauthorized` pour HTTP ou ferme directement la connexion pour un message WebSocket du contrôleur.

### 4) Authentification de l’API HTTP

À l’exception du téléchargement du script de liaison via `http`, toutes les API HTTP doivent inclure une signature calculée avec le même algorithme que WebSocket :

- Chemins protégés : tous les chemins `/api/*`
- Exceptions :
  - `/api/download-bind-script` (reste accessible sans signature)
  - `/api/config` (configuration de démarrage du frontend)
  - `/api/control/info` (sortie de la configuration au format JSON)
  - `/api/ws` (la négociation de mise à niveau WebSocket n’utilise pas l’authentification HTTP ; les messages du contrôleur doivent toujours être signés)
  - `/api/transfer/download/:token` (téléchargement avec un token temporaire)
  - `/api/transfer/upload/:token` (envoi avec un token temporaire)
  - Requêtes préliminaires `OPTIONS` pour CORS

Les requêtes HTTP peuvent transmettre la signature de l’une des deux façons suivantes :

1. **En-têtes de requête (recommandé)**
   - `X-XXT-TS: <ts>`
   - `X-XXT-Nonce: <nonce>`
   - `X-XXT-Sign: <sign>`

2. **Paramètres de query**, pour les téléchargements, `window.open`, `img` et les autres cas où il n’est pas pratique d’ajouter des en-têtes personnalisés
   - `?ts=<ts>&nonce=<nonce>&sign=<sign>`

Exemple :

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

### Format général des messages du contrôleur

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

Le contrôleur peut envoyer `control/http` via WebSocket afin de transmettre une requête HTTP à l’appareil, où elle est exécutée avec `http.request`. Cette méthode est souvent utilisée pour les interfaces liées à WebRTC.

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

> Remarque : `body` doit être encodé en base64. Lorsque la requête vise `/api/webrtc/start` et que TURN est activé, le serveur injecte automatiquement `iceServers`.

### Connexion d’un appareil

L’appareil envoie `app/state` et fournit un identifiant unique dans `body.system.udid`.
Les appareils prenant en charge le clavier matériel global déclarent également la capacité facultative suivante. Si le champ est absent ou ne vaut pas `true`, le contrôleur n’envoie aucune commande de clavier matériel :

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

Le contrôleur envoie `key/global-keyboard` via `control/command` et l’appareil répond avec le même type. `owner` identifie une session de contrôle en temps réel ; l’appareil n’autorise que le propriétaire (`owner`) correspondant à déconnecter son clavier :

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

`action` accepte `status`, `connect` et `disconnect`. Le `body` de la réponse contient `action`, `owner`, `supported`, `ok` et `connected` ; en cas d’échec, il peut également contenir `message`.

### Déconnexion d’un appareil

Le serveur avertit le contrôleur :
```json
{
  "type": "device/disconnect",
  "body": "udid"
}
```

### Liste des appareils

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/devices"
}
```

Réponse :
```json
{
  "type": "control/devices",
  "body": {
    "udid1": {},
    "udid2": {}
  }
}
```

### Actualiser l’état des appareils

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/refresh"
}
```
Le serveur diffuse une requête `app/state` à tous les appareils.

### Abonnement aux journaux en temps réel

S’abonner au journal d’un appareil donné :

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/subscribe",
  "body": { "devices": ["udid1"] }
}
```

Annuler l’abonnement :

```json
{
  "ts": 1700000000,
  "nonce": "<nonce>",
  "sign": "hex-sign",
  "type": "control/log/unsubscribe",
  "body": { "devices": ["udid1"] }
}
```

Si l’appareil prend en charge l’envoi des journaux, il transmet :

```json
{
  "type": "system/log/push",
  "udid": "udid1",
  "body": { "chunk": "log line..." }
}
```

### Commandes groupées

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

## Types de commandes courants

### Opérations sur les fichiers

#### Envoyer un fichier
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

#### Créer un répertoire
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

#### Lister un répertoire
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

#### Télécharger un fichier
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

#### Copier un fichier
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

#### Déplacer un fichier
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

#### Supprimer un fichier
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

### Contrôle des appareils

#### Redémarrer l’interface de l’appareil
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

#### Redémarrer l’appareil
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

#### Commandes tactiles
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

Remarques :

- `finger` est un champ facultatif dont la plage de valeurs est `0 ~ 29`.
- Si `finger` n’est pas transmis, l’appareil continue à utiliser l’ancien protocole à un seul doigt afin de préserver la compatibilité.
- Les gestes multipoints sont représentés par plusieurs messages `touch/down|touch/move|touch/up` associés à une valeur `finger` stable. Pour un même doigt, le même `finger` doit être utilisé depuis le contact avec l’écran jusqu’à son relâchement.

#### Commandes de touches
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

#### Capture d’écran
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

### Presse-papiers

#### Lire le presse-papiers
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

#### Écrire dans le presse-papiers
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

### Dictionnaire, file d’attente et sélection de script

#### Définir une valeur de dictionnaire
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

#### Envoyer dans la file d’attente
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

#### Sélectionner un script
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

### Contrôle des scripts

#### Démarrer un script
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

#### Arrêter un script
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

## Sécurité

- Toutes les commandes de contrôle WebSocket et toutes les API HTTP, à l’exception du téléchargement du script de liaison, nécessitent une validation par signature dynamique HMAC-SHA256.
- Le premier démarrage génère un mot de passe aléatoire qui n’est affiché qu’une fois. Modifiez-le rapidement.
- Pour les gros fichiers, utilisez `/api/transfer/*` avec des tokens HTTP temporaires. WebSocket est réservé aux petits fichiers et aux messages de contrôle.
