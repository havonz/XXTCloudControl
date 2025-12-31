# Repository Guidelines

## 项目结构与模块组织
- `server/` 是 Go 服务端，入口在 `server/main.go`，运行时会生成 `xxtcloudserver.json`。
- `frontend/` 为 SolidJS 管理面板，源码在 `frontend/src/`，样式以 `*.module.css` 管理。
- `device-client/` 提供 Lua WebSocket 客户端库。
- `XXT 云控设置.lua` 是设备侧配置脚本（配置已集成至管理面板扫码下载）。
- `build.sh` 负责多平台打包，产物输出到 `build/`。

## 构建、测试与开发命令
- `cd server && go run .` 启动后端（首次启动会生成配置并输出随机密码）。
- `cd frontend && npm install && npm run dev` 启动前端开发服务器（默认端口 `3000`）。
- `cd frontend && npm run build` 构建前端；`npm run serve` 预览构建产物。
- `bash build.sh` 生成可分发目录 `build/xxtcloudcontrol/`。
- `go test ./...` 运行 Go 测试（目前暂无专用测试用例）。
- `./xxtcloudserver-<os>-<arch> -set-password <pwd>` 修改服务端密码。

## 编码风格与命名约定
- Go 代码使用 `gofmt`，保持显式错误处理与清晰的函数边界。
- 前端使用 TypeScript/TSX，2 空格缩进，单引号与分号一致；组件文件名使用 PascalCase（如 `DeviceList.tsx`）。
- CSS Modules 类名使用 camelCase（如 `headerTop`），全局样式仅放在 `frontend/src/index.css`。

## 测试指南
- 当前未配置独立测试框架或覆盖率门槛；新增测试时优先使用 Go 标准测试（`*_test.go`）并确保 `go test ./...` 通过。
- 若引入前端测试工具，请补充 `package.json` 脚本并同步更新本指南。

## 提交与 PR 规范
- 提交信息遵循约定式前缀：`feat:`, `fix:`, `style:`, `chore:`，后接简短动词短语。
- PR 需说明改动动机与影响范围；涉及 UI 变更请附截图；关联的 issue 请在描述中链接。

## 安全与配置提示
- `xxtcloudserver.json` 与 `server/xxtcloudserver.json` 不应提交版本库（已在 `.gitignore`）。
- 密码以 HMAC-SHA256 结果存储，避免在日志、截图或文档中暴露明文。

## 什么是**平铺脚本**
「平铺脚本」是一种按文件夹组织的脚本单元，通常包含资源与脚本文件，例如：

 ```
 脚本路径/
 ├── res/
 │   ├── 1.png
 │   └── 2.png
 └── lua/
     ├── a.lua
     ├── b.lua
     └── scripts/
         ├── c.lua
         └── main.lua
 ```