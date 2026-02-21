# XXTCloudControl 自更新实现说明

本文档描述当前仓库中“自更新”功能的完整实现逻辑、状态流转和关键安全机制。

## 1. 设计目标与边界

1. 目标：
- 用户主动检查更新。
- 用户确认后下载更新包并应用更新。
- 更新后自动重启服务进程。
- 更新失败可回滚到备份版本。

2. 边界：
- 只更新运行文件（二进制 + `frontend/` 静态资源）。
- 不更新 Docker 镜像层本身（仅更新容器可写层文件）。

## 2. 发布侧依赖（GitHub Release）

当前发布流程在 release 中提供机器可读元数据：

1. `update-manifest.json`
- 包含当前 release 版本信息。
- 包含各平台资产名称、下载链接、sha256。

2. `checksums.txt`
- 所有发布资产的 sha256。

3. `latest.txt`
- 最新版本的快捷元信息（含 latest manifest/checksums 入口）。

当前实现默认读取：
- `https://github.com/<repo>/releases/latest/download/update-manifest.json`

也可通过配置覆盖 manifest URL。

### 2.1 固定入口与版本化资产的关系

1. 资产文件名可以是版本化命名（例如带版本号），不需要固定文件名。
2. 客户端只需要固定访问 latest 入口的 `update-manifest.json`。
3. manifest 内会给出“当前最新版本”对应资产名、下载 URL、sha256。
4. 发布新版本后，GitHub 的 `releases/latest/download/...` 会自动指向新 release，因此客户端无需预知“下一个版本号”。

结论：
1. 版本化资产链接用于精确追溯某个版本。
2. latest 固定链接用于稳定发现“当前最新版本”。

## 3. 运行时核心组件

### 3.1 UpdaterService（主进程）

文件：`server/updater.go`

职责：
1. 初始化更新目录与状态文件。
2. 对外提供状态查询、检查更新、下载更新、应用更新。
3. 下载校验、解压、平台资产选择、版本比较。
4. 生成 worker 作业并拉起内部 helper。

### 3.2 Update Worker（子进程）

文件：`server/update_worker.go`

职责：
1. 在主进程退出窗口中执行文件替换。
2. 处理二进制/前端目录备份与回滚。
3. 启动新版本进程。
4. 更新最终状态并清理 staging/job 文件。

### 3.3 Update API

文件：`server/handlers_update.go`，路由注册在 `server/main.go`

接口：
1. `GET /api/update/status`
2. `POST /api/update/check`
3. `POST /api/update/download`
4. `POST /api/update/apply`

### 3.4 前端入口

文件：`frontend/src/App.tsx`、`frontend/src/App.module.css`

入口形态：
1. 点击标题栏版本号弹出“更新管理”菜单。
2. 菜单按钮对应 check/download/apply。
3. 应用更新后前端轮询 `/api/control/info` 感知版本切换。

## 4. 配置项与环境变量

配置结构定义：`server/types.go` 中 `ServerConfig.Update`。

JSON 字段：
1. `update.enabled`
2. `update.channel`
3. `update.checkIntervalHours`
4. `update.promptOnNewVersion`
5. `update.ignoredVersions`
6. `update.source.repository`
7. `update.source.manifestUrl`
8. `update.source.requestTimeoutSeconds`

环境变量覆盖（`server/config.go`）：
1. `XXTCC_UPDATE_ENABLED`
2. `XXTCC_UPDATE_CHANNEL`
3. `XXTCC_UPDATE_CHECK_INTERVAL_HOURS`
4. `XXTCC_UPDATE_PROMPT_ON_NEW_VERSION`
5. `XXTCC_UPDATE_IGNORED_VERSIONS`
6. `XXTCC_UPDATE_REPOSITORY`
7. `XXTCC_UPDATE_MANIFEST_URL`
8. `XXTCC_UPDATE_TIMEOUT_SECONDS`

## 5. 鉴权与安全机制

### 5.1 接口鉴权

`/api/update/*` 走统一 API 鉴权中间件，未加入免鉴权白名单。

结论：
1. 未登录或签名错误请求会被服务端返回 `401 unauthorized`。
2. 前端也做了二次限制：未鉴权时禁用更新操作按钮，并提示重新登录。

### 5.2 数据与文件安全

1. 下载后必须做 SHA256 校验（若 manifest 提供 `sha256`）。
2. ZIP 解压使用路径校验，阻止 Zip Slip（路径穿越）。
3. worker 拒绝更新包中的符号链接（symlink）。
4. macOS 在下载完成后对 staging 执行：
- `xattr -dr com.apple.quarantine <staging-path>`
- 失败则终止更新。

## 6. 状态机与持久化

状态文件：`<dataDir>/updater/state.json`

主要状态：
1. `idle`
2. `checking`
3. `update_available`
4. `downloading`
5. `downloaded`
6. `applying`
7. `failed`

关键字段：
1. `latestVersion`
2. `latestAsset`
3. `downloadedVersion`
4. `downloadedFile`
5. `stagingDir`
6. `sourceBinary`
7. `sourceFrontendDir`
8. `appliedVersion`
9. `lastError`

启动恢复逻辑：
1. 若上次停在 `applying` 且 `downloadedVersion == 当前Version`，会收敛为 `idle`。
2. 若 `stagingDir` 已不存在，会清理对应 source 路径字段。

## 7. 详细流程

### 7.1 检查更新（check）

1. 解析 manifest URL（优先 `update.source.manifestUrl`，否则仓库 latest 固定入口）。
2. 拉取并解析 `update-manifest.json`。
3. 按当前 `GOOS/GOARCH` 选择资产。
4. 比较 `manifest.version` 与当前 `Version`。
5. 若版本更高且未被忽略，置 `hasUpdate=true` 与 `stage=update_available`。

### 7.2 下载更新（download）

1. 若尚无最新版本信息，先隐式执行 check。
2. 从资产 `url`（回退 `latestUrl`）下载到 `cache`。
3. 做 sha256 校验。
4. 解压到 `staging`（含 Zip Slip 防护）。
5. 校验包内容存在目标平台二进制与 `frontend/`。
6. macOS 清理 quarantine。
7. 更新状态为 `downloaded`，写入 source 路径。

### 7.3 应用更新（apply）

1. 仅允许在 `stage=downloaded` 时执行。
2. 生成 worker job 文件（含源/目标路径、备份路径、重启参数）。
3. 复制当前可执行文件为 helper（`worker/update-helper-*`）。
4. 启动 helper：`<helper> -update-worker <jobPath>`。
5. 主进程延迟约 1.2 秒后退出，释放文件句柄与端口。

### 7.4 Worker 替换与重启

1. 最多重试 200 次文件替换（每次间隔 300ms）。
2. 等待父进程退出后再拉起新进程（等待上限 30 秒）：
- Linux/macOS：使用 `Signal(0)` 检测并严格等待退出。
- Windows：使用 `OpenProcess + WaitForSingleObject(0)` 检测并严格等待退出。
3. 替换流程：
- `targetBinary -> backupBinary`
- `sourceBinary -> targetBinary`
- `targetFrontendDir -> backupFrontendDir`
- `sourceFrontendDir -> targetFrontendDir`
4. 启动失败则回滚备份。
5. 成功后状态置 `idle`、`appliedVersion=targetVersion`，清理 staging/job。

## 8. 前端交互逻辑

### 8.1 菜单入口

1. 点击标题栏版本号，打开更新菜单。
2. 菜单展示当前版本、最新版本、状态、错误信息。

### 8.2 用户操作

1. 检测更新：调用 `POST /api/update/check`。
2. 下载更新：调用 `POST /api/update/download`。
3. 应用更新：调用 `POST /api/update/apply`。

### 8.3 更新后感知

1. apply 后前端每秒轮询 `/api/control/info`。
2. 当检测到版本号变化即提示“更新完成”并刷新本地版本缓存。

## 9. 磁盘目录结构

以 `data_dir` 为根：

1. `updater/state.json`
2. `updater/cache/`（下载的 zip）
3. `updater/staging/`（解压内容）
4. `updater/worker/`（helper 与 job 文件）

运行目录中的目标文件会生成备份：
1. 二进制备份：`<binary>.bak`
2. 前端目录备份：`<frontendDir>.bak`

## 10. 版本比较规则

当前实现支持：
1. 时间戳版本（例如 `v202602210930`）按数值比较。
2. semver-like（例如 `v1.2.0`）比较 major/minor/patch。
3. 预发布标识（`-beta`）低于同版本正式版。
4. `dev/unknown` 视为低版本。

## 11. 当前实现限制与后续建议

1. `checkIntervalHours` 当前仅配置落地，尚未实现后台定时任务调度。
2. 下载暂不支持断点续传。
3. worker helper 二进制当前未自动清理，可增加定期清理策略。
4. channel 字段已存在，当前检查逻辑未做多通道过滤策略扩展。
5. `promptOnNewVersion` 当前仅配置落地，尚未接入服务端/前端提示策略。
6. Docker 容器内更新只作用于容器可写层；容器重建后会回到镜像内容。

## 12. 相关代码文件索引

1. `server/updater.go`
2. `server/update_worker.go`
3. `server/handlers_update.go`
4. `server/main.go`
5. `server/types.go`
6. `server/config.go`
7. `server/handlers_api.go`
8. `frontend/src/App.tsx`
9. `frontend/src/App.module.css`
10. `.github/workflows/release.yml`
