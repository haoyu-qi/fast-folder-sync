# 服务端开发与验证

需要 Node.js 24 与 Go 1.26。前端源码在 `fast-folder-sync-service/web/`，构建输出在 `frontend/`，由 Go 服务嵌入；更新界面后必须先构建前端，再构建服务端。

```sh
cd fast-folder-sync-service/web
npm ci
npm run check
npm test
npm run build
cd ..
go test ./internal/routers/api_router ./internal/routers/websocket_router ./internal/middleware ./internal/service ./pkg/util ./pkg/storage/local_fs
go build -trimpath -o fast-folder-sync-service .
./fast-folder-sync-service run
```

Windows 将输出名改为 `fast-folder-sync-service.exe`，用 `./fast-folder-sync-service.exe run` 启动。管理台地址为 `http://127.0.0.1:9000/webgui/`。

管理台预览：启动 Go 服务后，在 `web/` 执行 `npm run preview`，访问 `http://127.0.0.1:4173`。通过 `FFS_PROXY_TARGET` 指定本地 API 地址，默认 `http://127.0.0.1:9000`。

## 文件管理接口

`GET /api/drive/capabilities` 公开产品版本和通用文件能力。以下文件管理接口仅接受真实 WebGUI 登录会话，设备令牌不能代替管理台会话。

| 接口 | 用途 |
| --- | --- |
| `GET /api/drive/spaces` | 文件库列表、文件数量与用量 |
| `POST /api/drive/spaces` | 创建或修改文件库 |
| `GET /api/drive/entries` | 文件列表、搜索、分页与回收站 |
| `GET /api/drive/content` | 带认证下载，兼容旧文本资源 |
| `POST /api/drive/upload` | 流式上传与完整 SHA-256，单次请求上限 512 MiB |
| `DELETE /api/drive/entry` | 移入回收站 |
| `PUT /api/drive/entry/restore` | 恢复软删除文件 |
| `POST /api/drive/entry/rename` | 重命名或调整相对路径 |

配套桌面端从 0.2.0 起将所有新文件统一以二进制传输，使用完整 SHA-256。旧文本资源继续兼容；路径摘要保留原协议的 32 位格式，检测到冲突时拒绝覆盖。

新管理台提供文件、备份、存储、设备和账户操作。旧管理员用户编辑器、Git 设置与高级 Stytch 页面尚未重建，底层 API 保留。OIDC 入口和基本公开文件读取页已适配。

## 发布

根目录 `VERSION` 管理产品版本，使用 `npm run version:check` 检查。标签 `v<产品版本>` 触发 `.github/workflows/release.yml`，检查通过后构建 Windows 客户端、Mac 两种架构和 Windows / Linux 服务端，生成校验清单并发布配套 Release。已有标签不移动、不覆盖。

`scripts/server-smoke.mjs <程序路径>` 使用独立临时目录验证真实服务启动、产品版本及嵌入的网页界面。`scripts/package-server.py <程序路径> Windows|Linux <输出目录>` 仅打包程序、启动脚本、使用说明和许可，不携带运行账户或配置。

原始功能联调记录见 [服务端验证记录](../fast-folder-sync-service/VALIDATION.folder.md)。界面与本版本验证记录见 [0.2.2 验证](VALIDATION-0.2.2.md)。
