# Folder Sync 服务端

产品版本 **0.2.2**。为桌面客户端提供私有文件同步、网页文件管理和计划备份，网页端与客户端采用统一的蓝紫毛玻璃界面。

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

### Docker 从源码部署

在仓库根目录执行：

```sh
git checkout v0.2.2
cd fast-folder-sync-service
docker compose -f compose.folder.yaml up -d --build
```

需要 Docker 与 Docker Compose，首次构建需要联网。构建会生成网页资源并嵌入 Go 程序，无需在宿主机安装 Node.js 或 Go。配置卷为 `folder-sync-config`，数据卷为 `folder-sync-storage`，时区为 `Asia/Shanghai`。

### Windows / Linux 安装包

从 [0.2.2 发布页](https://github.com/haoyu-qi/fast-folder-sync/releases/tag/v0.2.2)下载对应服务端 ZIP，解压到固定目录。

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

完整产品与部署流程见[仓库 README](../README.md)，源码构建和接口说明见[服务端开发说明](../docs/SERVER-DEVELOPMENT.md)，本版本验证见[0.2.2 验证记录](../docs/VALIDATION-0.2.2.md)。服务内核保留上游 3.6.1，与产品版本分别管理。
