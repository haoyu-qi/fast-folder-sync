# Fast Folder Sync — 通用文件夹桌面版

本分支基于 Obsidian Fast Note Sync 增加了**独立运行的文件夹备份与同步软件**，无需安装 Obsidian。原插件保留在 `src/`，桌面应用位于 `desktop/`，二者独立安装依赖和构建。

- 任意本地文件夹：文档、照片、视频、代码和其他二进制文件。
- 本地目录、移动磁盘、已挂载网络目录之间的单向备份与双向同步。
- 配套 Folder Sync 私有服务端的双向同步适配器，统一二进制传输与完整 SHA-256。
- 多任务、定期自动同步、托盘后台运行、排除规则、冲突副本、本地历史恢复。
- 删除传播默认关闭；覆盖和删除前自动保存历史文件。

```powershell
cd desktop
npm ci
npm start
```

开发环境使用 Node.js 24.14 或更新版本。Windows 便携版可直接运行；macOS、Linux 提供构建配置，尚未在对应系统实测。

详见 [桌面版使用与开发说明](docs/desktop.md)、[验证结果](docs/desktop-validation.md) 和 [上游来源](UPSTREAM.md)。配套服务端已完成本地真实跨端联调，包含两台客户端和大文件完整性验证；未连接用户的生产部署。

原插件说明见 [上游文档](docs/README.upstream.md)。
