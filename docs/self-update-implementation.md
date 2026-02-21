# XXTCloudControl 自更新实现说明

本文档描述当前仓库中“自更新”功能的实际实现逻辑、状态流转与 Docker 分支行为（与当前代码对齐）。

## 1. 设计目标与边界

1. 目标：
- 用户手动检查更新、下载更新、应用更新。
- 下载可显示进度，并支持手动停止。
- 应用更新后自动切换到新版本进程，失败可回滚。

2. 边界：
- 仅更新运行文件（二进制 + `frontend/` 静态资源）。
- 不更新 Docker 镜像本身；Docker 模式仅改写容器可写层。

## 2. 发布侧依赖（GitHub Release）

当前实现默认从以下入口拉取 manifest：
- `https://github.com/<repo>/releases/latest/download/update-manifest.json`

manifest 结构由 `UpdateManifest` 定义（`server/updater.go`）：
1. `version`
2. `channel`
3. `buildTime`
4. `commit`
5. `publishedAt`
6. `checksumsUrl`
7. `assets[]`（每个资产包含 `os/arch/name/url/latestUrl/sha256`）

说明：
1. 客户端不需要预知“下一版本文件名”，只依赖 latest manifest。
2. 每个平台资产由 manifest 中 `assets` 精确描述。

## 3. 核心组件

### 3.1 UpdaterService（主进程）

文件：`server/updater.go`

职责：
1. 初始化 `data/updater` 目录与状态文件。
2. 提供 `status/check/download/download-cancel/apply` 能力。
3. 执行 manifest 拉取、资产选择、下载、校验、解压。
4. 根据运行环境选择“helper worker 模式”或“Docker 进程内 exec 模式”应用更新。

### 3.2 Update Worker（子进程，仅非 Docker apply）

文件：`server/update_worker.go`

职责：
1. 等待父进程退出后替换二进制与前端目录。
2. 启动新进程。
3. 替换失败或启动失败时回滚。
4. 回写最终状态并清理 job/staging。

### 3.3 Docker 进程替换层

文件：
1. `server/updater.go`（`applyInDocker`）
2. `server/process_exec_unix.go`
3. `server/process_exec_windows.go`

职责：
1. 校验下载得到的目标二进制确实可执行且版本正确。
2. 在当前进程中完成文件替换。
3. Unix 下使用 `syscall.Exec` 原地替换进程镜像，不依赖 helper。

## 4. Update API

路由注册：`server/main.go`
处理器：`server/handlers_update.go`

接口：
1. `GET /api/update/status`
2. `POST /api/update/check`
3. `POST /api/update/download`
4. `POST /api/update/download/cancel`
5. `POST /api/update/apply`

鉴权：
1. `/api/update/*` 走统一 `apiAuthMiddleware`，未登录返回 `401`。

## 5. 配置项与环境变量

配置结构：`server/types.go` 的 `ServerConfig.Update`

JSON 字段：
1. `update.enabled`
2. `update.channel`
3. `update.checkIntervalHours`
4. `update.promptOnNewVersion`
5. `update.ignoredVersions`
6. `update.source.repository`
7. `update.source.manifestUrl`
8. `update.source.requestTimeoutSeconds`
9. `update.source.downloadConnectTimeoutSeconds`

环境变量覆盖（`server/config.go`）：
1. `XXTCC_UPDATE_ENABLED`
2. `XXTCC_UPDATE_CHANNEL`
3. `XXTCC_UPDATE_CHECK_INTERVAL_HOURS`
4. `XXTCC_UPDATE_PROMPT_ON_NEW_VERSION`
5. `XXTCC_UPDATE_IGNORED_VERSIONS`
6. `XXTCC_UPDATE_REPOSITORY`
7. `XXTCC_UPDATE_MANIFEST_URL`
8. `XXTCC_UPDATE_TIMEOUT_SECONDS`（check 超时）
9. `XXTCC_UPDATE_DOWNLOAD_CONNECT_TIMEOUT_SECONDS`（下载连接超时）

## 6. 超时模型（当前实现）

1. `check`：由 `context.WithTimeout(..., getUpdateCheckTimeout())` 控制，默认 60 秒（连接 + 获取内容都受该 context 限制）。
2. `download`：
- HTTP 客户端不设置整体 `Client.Timeout`。
- 仅在 Dial 和 TLS Handshake 使用连接超时（默认 60 秒）。
- 下载正文读取不设总超时，可长时间持续，直到完成或手动取消。

## 7. 状态与持久化

状态文件：`<dataDir>/updater/state.json`

阶段：
1. `idle`
2. `checking`
3. `update_available`
4. `downloading`
5. `downloaded`
6. `applying`
7. `failed`

关键字段：
1. `latestVersion` / `latestAsset`
2. `downloadTotalBytes` / `downloadedBytes`
3. `downloadedVersion` / `downloadedAsset` / `downloadedFile`
4. `stagingDir` / `sourceBinary` / `sourceFrontendDir`
5. `appliedVersion`
6. `lastError`

启动恢复：
1. 若上次 `stage=applying` 且 `downloadedVersion == 当前Version`，收敛为 `idle` 并清错误。
2. 若 `stagingDir` 已不存在，清理 `sourceBinary/sourceFrontendDir`。
3. 仅在 `stage=downloading` 时保留进度值；其余状态会清零进度字段。

## 8. 详细流程

### 8.1 检查更新（check）

1. 解析 manifest URL（`manifestUrl` 优先，否则 `repository` 的 latest 入口）。
2. 拉取并解析 `update-manifest.json`。
3. 按当前 `GOOS/GOARCH` 选择资产。
4. 比较 `manifest.version` 与当前 `Version`。
5. 若新版本且未忽略，设置 `hasUpdate=true`、`stage=update_available`；否则回到 `idle`。

### 8.2 下载更新（download）

1. 若本地还没有 `latestVersion/latestAsset`，先隐式执行一次 check。
2. `stage` 切到 `downloading`，创建后台下载任务（goroutine）。
3. 下载 zip 到 `updater/cache`，持续更新 `downloadedBytes/downloadTotalBytes`。
4. 校验 SHA256（manifest 提供时）。
5. 解压到 `updater/staging/<version-timestamp>`。
6. 校验包中必须有当前平台二进制和 `frontend/`。
7. macOS 清理 quarantine。
8. 成功后置 `stage=downloaded` 并写入 source 路径字段。

说明：
1. 下载任务与 HTTP 请求解耦，刷新页面/重新登录不会自动中断下载。
2. 停止下载只能通过 `POST /api/update/download/cancel`。

### 8.3 停止下载（download cancel）

1. 仅当 `stage=downloading` 且存在活动 cancel 函数时可执行。
2. 调用后下载 context 被取消，状态进入 `failed`，`lastError=download canceled`。

### 8.4 应用更新（apply）- 非 Docker

1. 仅允许 `stage=downloaded`。
2. 生成 worker job（源/目标/备份/重启参数）。
3. 复制当前程序为 helper 到 `updater/worker/update-helper-*`。
4. 启动 helper：`<helper> -update-worker <jobPath>`。
5. 主进程约 1.2 秒后 `os.Exit(0)`，由 helper 完成替换与拉起新版。

### 8.5 应用更新（apply）- Docker

运行时判断（`isDockerRuntime`）命中任一条件即视为 Docker：
1. 环境变量 `XXTCC_RUNTIME=docker`
2. 存在 `/.dockerenv`
3. `/proc/1/cgroup` 包含 `docker/containerd/kubepods`

流程：
1. `apply` 将状态切到 `applying` 后，异步进入 `applyInDocker`。
2. 先校验下载二进制：
- 文件存在且不是目录
- Unix 下必要时补可执行权限
- 执行 `<binary> -v`（8 秒超时）探测版本
- 必须与 `downloadedVersion` 一致，且严格高于当前 `Version`
3. 执行与 worker 共用的替换逻辑（见 8.6）。
4. Unix 下调用 `syscall.Exec` 直接替换当前进程为新二进制。
5. 若替换失败且属于权限/只读文件系统错误，返回明确错误提示：应更新镜像并重建容器。
6. 若 `exec` 失败，执行回滚并置 `failed`。

### 8.6 文件替换与回滚细节（worker 与 Docker 共用）

核心替换函数：`applyUpdateReplacement`（`server/update_worker.go`）

顺序：
1. 复制 `sourceBinary` 到 `targetBinary.new`
2. `targetBinary -> backupBinary`
3. `targetBinary.new -> targetBinary`
4. 复制 `sourceFrontendDir` 到 `targetFrontendDir.new`
5. 复制 `targetFrontendDir -> backupFrontendDir`，再删除旧目录
6. `targetFrontendDir.new -> targetFrontendDir`

跨设备处理：
1. `moveFileWithFallback` / `moveDirWithFallback` 先尝试 `os.Rename`。
2. 若报 `cross-device link`，自动回退为 `copy + remove`，避免 Docker overlay 场景下 rename 失败。

回滚：
1. 新进程启动/exec 失败时，恢复 `backupBinary` 和 `backupFrontendDir`。

## 9. 前端交互与轮询

文件：`frontend/src/App.tsx`、`frontend/src/App.module.css`

1. 入口：点击标题栏版本号打开“更新管理”弹窗。
2. 按钮：
- `检测更新`（独立按钮）
- 主按钮三态合一：
  - 未下载：`下载更新`（点击后短暂显示 `准备下载...`）
  - 下载中：`停止下载`
  - 已下载：`应用更新`
3. 下载进度：显示 bytes/百分比；未知总大小时显示已下载 bytes 与不定进度条。
4. 状态轮询：
- 仅当“已登录 + 弹窗可见”时，每 1 秒轮询 `/api/update/status`
- 弹窗关闭立即停止轮询
- 内置 in-flight 保护，避免重叠请求
5. apply 后重连感知：
- 前端每 1 秒请求 `/api/control/info`（最多约 120 秒）
- 发现版本变化后提示“更新完成”并刷新缓存版本

## 10. 安全机制

1. 更新接口受统一鉴权保护。
2. 下载包做 SHA256 校验（若 manifest 提供）。
3. ZIP 解压做路径校验，防 Zip Slip。
4. 拒绝更新包中的 symlink。
5. macOS 清理 quarantine 失败即中止。

## 11. Docker 行为说明（当前实现）

1. Docker 自更新只修改“当前容器”的可写层，不会修改镜像。
2. 同一容器内重启通常可保留更新结果；重建容器会回到镜像文件。
3. 若容器文件系统无写权限，apply 会失败并提示改为拉新镜像更新。
4. `unless-stopped` 场景下，Docker 路由使用 `exec` 原地替换，进程不以“退出再拉起”的方式更新。

## 12. 已知限制

1. `checkIntervalHours` 当前仅配置落地，未做后台定时检查调度。
2. 下载不支持断点续传。
3. worker helper 文件目前未做专项清理策略。
4. `channel` 字段当前未做多通道过滤逻辑。
5. `promptOnNewVersion` 目前仅配置落地，未形成额外提示策略。
6. 进程重启后不会自动恢复“未完成下载任务”。

## 13. 相关代码索引

1. `server/updater.go`
2. `server/update_worker.go`
3. `server/process_exec_unix.go`
4. `server/process_exec_windows.go`
5. `server/handlers_update.go`
6. `server/main.go`
7. `server/types.go`
8. `server/config.go`
9. `frontend/src/App.tsx`
10. `frontend/src/App.module.css`
11. `.github/workflows/release.yml`
