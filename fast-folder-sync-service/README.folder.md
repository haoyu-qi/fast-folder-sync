# Folder Sync 服务端

产品版本 **0.3.0**。为桌面客户端提供私有文件同步、网页文件管理和计划备份，网页端与客户端采用统一的蓝紫毛玻璃界面。

## 产品说明

管理台提供「概览」「文件浏览」「备份任务」「连接设备」「同步记录」「回收站」「存储位置」「设置」。概览显示文件数量、存储用量、自动备份与文件库；浏览器可上传、下载、搜索和重命名文件，也可恢复软删除文件。

![网页服务端管理台](../docs/images/server.jpg)

桌面端通过设备令牌连接文件库，支持多台电脑双向同步。所有新文件统一以二进制传输，使用完整 SHA-256 校验；已有文本资源及旧同步接口继续兼容。文件库改名后，需要更新桌面端对应任务的文件库名称。

服务端可向本地磁盘、S3、OSS、R2、MinIO 和 WebDAV 备份。先在「存储位置」添加并验证目标，再建立「备份任务」；具体类型需在服务配置中启用。

| 备份方式 | 用途 |
| --- | --- |
| 全量归档 | 生成完整备份 |
| 增量归档 | 按增量机制保存变更 |
| 镜像同步 | 让目标跟随源内容 |

备份计划使用服务端时区。回收站恢复服务端软删除的文件，备份归档由所选存储位置保存。客户端源目录、服务端文件存储和备份目标分别管理。

## 部署说明

### Docker 部署包与 Compose

部署包附带 Compose、环境变量示例、Dockerfile 和干净源码，解压后无需安装 Go 或 Node.js。需要 Docker Compose v2，默认拉取预构建 linux/amd64 镜像，无需编译。镜像地址为 `ghcr.io/haoyu-qi/fast-folder-sync-service:0.3.0`。发布页另提供可 `docker load` 导入的镜像压缩包与校验文件，步骤见下方 Docker 部署说明。部署 ZIP 不含预设账户或运行数据。

在解压目录执行：

```sh
cp .env.example .env
docker compose config
docker compose pull
docker compose up -d --wait --wait-timeout 180
```

Windows PowerShell 使用 `Copy-Item .env.example .env`。源码仓库也可进入 `deploy/docker/` 执行相同命令。配置和数据保存在 Compose 文件旁的 `config/`、`storage/`，时区默认 `Asia/Shanghai`；端口、监听地址和时区可在 `.env` 调整。配置含健康检查、日志轮转与自动重启。

详细参数、目录、备份、恢复和升级见 [Docker 部署说明](../deploy/docker/README.md)，完整 Compose 见 [compose.yaml](../deploy/docker/compose.yaml)。原 `compose.folder.yaml` 命名卷配方继续保留；已有用户沿用原配置，不要直接切换到新的空绑定目录。

### Windows / Linux 安装包

从 [0.3.0 发布页](https://github.com/haoyu-qi/fast-folder-sync/releases/tag/v0.3.0)下载对应服务端 ZIP，解压到固定目录。

Windows 运行 `start.cmd`，或在 PowerShell 执行：

```powershell
.\fast-folder-sync-service.exe run
```

Linux 在解压目录执行：

```sh
chmod +x fast-folder-sync-service start.sh
./start.sh
```

原生程序需要长期后台运行时，请使用操作系统的服务管理器托管。默认监听端口为 9000。只允许本机访问时，可用 `run -p 127.0.0.1:9000` 启动；跨设备同步应使用其他电脑能访问的监听地址与端口。

### 首次配置

1. 打开 `http://127.0.0.1:9000/webgui/`，创建首个账户。
2. 新建文件库，在「连接设备」中生成设备配置。
3. 桌面端新建任务，选择本地文件夹与「Folder Sync 私有服务」。
4. 填入服务根地址、相同文件库名称与设备令牌，保存并同步。其他电脑连接同一文件库即可同步。

首次启动且没有已有配置时，会生成 `config/config.yaml` 和随机认证密钥。首个账户建立后默认关闭公开注册；增加账户或重新开放注册需在服务配置中处理。跨设备连接时，将 `127.0.0.1` 换为服务端可访问地址；桌面端填写根地址，不附加 `/webgui/`。

### 数据、网络与升级

默认数据库在 `storage/database/db.sqlite3`，上传文件在 `storage/uploads/`。本地备份保存目录位于 `storage.local-fs.save-path` 所配置的根目录下；默认启用本地存储，默认关闭 HTTP 静态文件直出。

反向代理需要转发 HTTP API 和 `/api/user/sync` 的 WebSocket 连接。对外地址通过 `server.ext-api-url` 配置。浏览器单次上传请求上限为 512 MiB，反向代理的请求上限应与实际需求匹配。

升级前停止服务并备份配置、数据库和文件存储。原生部署只替换程序及启动脚本，保留 `config/` 与 `storage/`；Docker 更新源码后重建，保留原命名卷，不使用 `down -v`。

完整产品与部署流程见[仓库 README](../README.md)，源码构建和接口说明见[服务端开发说明](../docs/SERVER-DEVELOPMENT.md)，本版本说明见[0.3.0 发布说明](../docs/RELEASE-0.3.0.md)。服务内核保留上游 3.6.1，与产品版本分别管理。
