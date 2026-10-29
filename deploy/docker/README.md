# Folder Sync Docker 部署包

需要 Docker Engine / Docker Desktop 和 Docker Compose v2。包内附带干净源码，首次部署需联网下载 Node、Go、Alpine 镜像和构建依赖；这是源码构建部署包，不含离线镜像，宿主机无需安装 Node.js、Go 或数据库。

## 目录与启动

部署 ZIP 包含 `compose.yaml`、`.env.example`、本说明、源码提交记录 `BUILD-INFO.json`、许可及 `source/` 服务端源码。首次启动后会在旁边生成 `config/` 和 `storage/`。

解压到固定目录，在该目录执行：

```sh
cp .env.example .env
docker compose config
docker compose up -d --build --wait --wait-timeout 180
```

Windows PowerShell 将第一条换为 `Copy-Item .env.example .env`。首次构建可能需要数分钟，等待时间参数只计算容器启动后的健康等待。在源码仓库中也可直接进入 `deploy/docker/` 执行以上命令；仓库配置从 `../../fast-folder-sync-service` 构建，ZIP 中自动改为 `./source`。

打开 `http://127.0.0.1:9000/webgui/`，其他电脑访问 `http://主机IP:9000/webgui/`。创建首个账户与文件库，再到「连接设备」签发令牌；桌面端填写服务根地址、文件库名和令牌。首个账户建立后默认关闭公开注册。

## Compose 配置

| `.env` 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FFS_BIND_IP` | `0.0.0.0` | 接受其他设备连接；仅本机访问时改为 `127.0.0.1` |
| `FFS_PORT` | `9000` | 主机端口，容器内保持 9000 |
| `TZ` | `Asia/Shanghai` | 备份计划使用的服务端时区 |
| `FFS_VERSION` | `0.2.2` | 本地镜像标签；修改它不会下载新版源码 |

修改端口或时区后执行 `docker compose up -d --wait --wait-timeout 180`。已配置自动重启、健康检查、30 秒停止等待和日志轮转。本包不指定 `platform`，按 Docker 主机架构构建；实际验证架构以 CI 记录为准。

## 持久化、备份与恢复

| 主机目录 | 容器目录 | 内容 |
| --- | --- | --- |
| `./config` | `/app/config` | 服务配置与认证密钥 |
| `./storage` | `/app/storage` | SQLite 数据库、文件与本地备份 |

路径以 Compose 文件所在目录为基准。首次启动且无已有配置时生成 `config/config.yaml` 与随机认证密钥；默认数据库为 `storage/database/db.sqlite3`，文件在 `storage/uploads/`。挂载目录需允许 Docker 写入，Linux 上新建目录可能归 root 所有。

备份前用 `docker compose stop` 停服，再完整复制 `config/`、`storage/` 与 `.env`，之后用 `docker compose start` 恢复运行，避免复制仍在写入的 SQLite 数据库。Linux / NAS 也可在停服后执行：

```sh
sudo tar -czf "../folder-sync-backup-$(date +%Y%m%d-%H%M%S).tar.gz" config storage
```

恢复时停服，将备份还原到对应目录并核对权限，再启动并检查网页。外部数据库或云存储需另行备份；只复制上传文件不能恢复账户和元数据。

## 日常操作与升级

```sh
docker compose ps
docker compose logs --tail=100 -f
docker compose restart folder-sync
docker compose down
```

`down` 移除容器与网络，主机绑定的配置和数据目录保留。重新启动使用 `docker compose up -d --wait --wait-timeout 180`。

升级前停服并备份数据和 `.env`。将新版包的 `source/`、Compose 文件及说明替换到原部署目录，保留原 `config/`、`storage/`，对照新版 `.env.example` 核对原 `.env`；执行 `docker compose up -d --build --wait --wait-timeout 180`。检查日志、登录与文件库后再恢复客户端同步。镜像从本地源码构建，不能通过 `docker compose pull` 升级。

已有 `compose.folder.yaml` 命名卷部署继续使用原配置和原卷。本包的绑定目录不会自动读取命名卷；迁移时先停服、导出原配置与数据，再导入对应目录，不能直接切换到空目录启动。

## 网络与排障

- 端口冲突时修改 `FFS_PORT`，其他设备也使用对应端口。
- 健康检查失败时查看日志，检查目录权限与配置。容器内监听地址应为 `:9000`，不要只监听容器内的 `127.0.0.1`。
- 反向代理需支持 HTTP 和 `/api/user/sync` 的 WebSocket 升级。对外 API 地址可配置 `server.ext-api-url`，HTTPS 由实际代理配置。
- 浏览器单次上传请求上限为 512 MiB，代理的请求上限和超时需匹配。
- 云存储先在服务配置启用类型，再到网页「存储位置」验证并保存，最后创建备份任务。
