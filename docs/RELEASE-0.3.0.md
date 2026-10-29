# Fast Folder Sync 0.3.0

本版本增加 Agent 记忆同步和服务连接复用，同时包含文件扫描进度、ASAR 文件处理及远端路径标识修复。原有文件夹任务、用户数据目录和服务端同步协议保持兼容。

## Agent 记忆同步

在原客户端侧栏进入「Agent 记忆同步」，创建共享项目，关联本机目录和 Agent，预览并选择要同步的记忆来源。支持 Codex、Claude Code、ZCode 和 WorkBuddy。可通过专用私有服务文件库或已挂载共享目录同步多台电脑；经验记忆可配置 OpenAI 兼容模型整理，规则保留原文。

WorkBuddy 适配本地 MEMORY.md、个人规则及已关联项目的本地记忆，生成可撤销的 CODEBUDDY.md 入口；不访问其云端记忆、聊天记录或内部数据库。新增规则后应在 WorkBuddy 新会话中验证读取效果。[使用和兼容说明](https://github.com/haoyu-qi/fast-folder-sync/blob/v0.3.0/docs/AGENT-SYNC.md)。

## 新增文件夹更方便

网页端「连接设备」可以复制完整配置，在客户端一次粘贴导入。后续任务可复用已加密保存的服务地址和令牌，只需指定本地目录和独立文件库。默认仅授权所选文件库；可信设备可以选择「全部文件库（含今后新建）」。单库令牌不会自动扩大权限。

## 下载与升级

- Windows 客户端：运行 `Fast-Folder-Sync-0.3.0-Windows-x64.exe`。
- macOS：按 Apple Silicon / Intel 下载 arm64 / x64 的 DMG 或 ZIP。使用 ad-hoc 签名，未做 Apple 公证。
- Windows/Linux 服务端：下载对应 `Folder-Sync-Server-0.3.0-*.zip`，保留原 config 和 storage 后替换程序。
- Docker：使用配套部署 ZIP 和 `ghcr.io/haoyu-qi/fast-folder-sync-service:0.3.0`，也可加载单独提供的离线镜像。

客户端和服务端均需更新，才能使用完整配置复制及新授权选项。升级前备份已有配置与存储；客户端保留应用数据目录。下载后对照 `SHA256SUMS.txt` 校验。包内不含本机运行数据和账户配置。

## 验证范围

发布工作流执行版本、桌面与网页测试、Go 核心测试，并在 Windows / macOS 上验证界面和文件恢复，验证 Windows/Linux 服务端及 Docker 持久化。Agent 测试使用隔离的虚拟设备与假记忆；没有替代四种真实 Agent 在实体设备上的完整试用。WorkBuddy 云端自动记忆不在同步范围内。
