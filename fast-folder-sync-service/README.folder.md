# Folder Sync 服务端 0.2.0

这是基于 `haierkeys/fast-note-sync-service` 改造的通用文件夹备份与同步服务端。控制台改为文件库、文件浏览、备份任务、连接设备、同步记录、回收站和存储位置；采用暖白、灰褐、陶土色与衬线标题的 Claude 风格。

原有数据库结构和同步协议继续兼容。旧文本资源在新界面中显示为普通文件；管理台没有在线笔记编辑或 Obsidian 授权入口。

## Windows 运行

1. 解压 Windows 服务端包，在一个用于保存服务配置和数据的目录中运行 `start.cmd`。
2. 浏览器打开 `http://127.0.0.1:9000/webgui/`，创建首个账户。
3. 新建文件库，在「连接设备」中生成设备配置。
4. 桌面客户端选择「Folder Sync 私有服务」，填写服务地址、文件库名和设备令牌，再选择本地文件夹。

没有现成配置时，程序会生成随机认证密钥。上游逻辑会在首个账户建立后关闭公开注册；增加账户或重新开放注册需要在服务配置中处理。

默认 HTTP 端口为 9000。可以使用 `fast-folder-sync-service.exe run -p 127.0.0.1:9000` 只监听本机；原有 `-p` 参数未生效的问题也已修复。跨设备使用时填写服务端可访问的地址，反向代理可通过 `server.ext-api-url` 配置 API 地址。

## Linux 运行

```sh
chmod +x fast-folder-sync-service start.sh
./start.sh
```

Linux amd64 交付物已交叉编译，当前环境没有 Linux / Docker 运行时，未在 Linux 上实际启动。生产部署前请在目标机器验证配置和数据目录权限。

## Docker 从源码构建

```sh
docker compose -f compose.folder.yaml up -d --build
```

构建会先编译可编辑的前端，再编译 Go 服务端。配置和数据分别保存在两个命名卷中。Docker 配方已提供，当前环境未实际运行 Docker 构建。

## 备份

先在「存储位置」添加本地磁盘、S3、OSS、R2、MinIO 或 WebDAV 配置，再建立备份任务。界面会验证连接后保存。存储类型受服务配置的启用开关限制。

本地存储默认启用，HTTP 静态文件直出默认关闭。本地保存目录是服务端 `storage.local-fs.save-path` 下的路径前缀，默认根目录为 `storage/uploads`。客户端源目录、服务端文件存储和备份目标是不同的位置。

- **全量归档**：生成一份完整备份。
- **增量归档**：沿用上游的增量备份机制。
- **镜像同步**：使备份目标跟随源内容，创建前应确认这一行为。

Cron 使用服务端时区，界面默认为每天 00:30。备份执行记录显示实际文件数量和状态。回收站恢复的是软删除文件，备份归档仍由存储位置保留和管理。

## 适配内容

新增 `/api/drive/capabilities` 公共能力描述，以及仅允许真实 WebGUI 登录会话访问的文件管理接口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/drive/spaces` | 文件库列表，统一文件数量与存储用量 |
| `POST /api/drive/spaces` | 创建或修改文件库 |
| `GET /api/drive/entries` | 统一文件列表、搜索、分页和回收站 |
| `GET /api/drive/content` | 带认证的文件下载，含旧文本资源 |
| `POST /api/drive/upload` | 流式上传，完整 SHA-256；单次 HTTP 请求上限 512 MiB |
| `DELETE /api/drive/entry` | 移入回收站 |
| `PUT /api/drive/entry/restore` | 恢复软删除文件 |
| `POST /api/drive/entry/rename` | 重命名或调整相对路径 |

页面访问和设备令牌使用原有用户、令牌与权限系统。普通设备令牌不能伪装成管理台登录会话访问这些接口。已有 REST / WebSocket 路由保留，便于旧客户端继续同步。

配套的桌面客户端 0.2.0 会识别能力接口，将新文件统一作为二进制传输，内容摘要使用完整 SHA-256；已有旧文本资源继续兼容。服务端会验证采用 SHA-256 的 WebSocket 上传内容及大小。原有 32 位路径摘要仍保留兼容，发生路径冲突时拒绝覆盖。

文件库改名后，需要同步更新桌面端对应任务。管理台提供通用文件操作、设备令牌和备份配置；不包含旧界面的在线内容编辑、Git 同步设置、管理员用户管理和完整系统配置编辑器，这些底层 API 仍保留。OIDC 登录入口和基础公开文件读取页已适配；高级 Stytch 授权页面尚未重建。

## 开发

```sh
cd web
npm ci
npm test
npm run check
npm run build
cd ..
CGO_ENABLED=0 go test ./internal/routers/api_router ./internal/routers/websocket_router ./internal/middleware ./internal/service ./pkg/util ./pkg/storage/local_fs
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o fast-folder-sync-service .
```

需要 Node.js 24 与 Go 1.26 或更新版本。前端源码位于 `web/`，构建输出位于 `frontend/`，由 Go 程序嵌入。`npm run preview` 提供 `127.0.0.1:4173` 本地静态页面，并代理 API 到 `FFS_PROXY_TARGET`（默认 `http://127.0.0.1:9000`）；需先启动 Go 服务。

验证记录见 [VALIDATION.folder.md](VALIDATION.folder.md)。本地预览和联调使用独立测试目录，没有修改用户已有部署，也没有向远端仓库推送代码。
