# 上游来源与改造范围

上游项目：https://github.com/haierkeys/obsidian-fast-note-sync

本地导入的源码快照提交：`1bfb406966d612a61831462bf381bbcd1c73f334`（master）。由于环境的 GitHub Git 传输失败，使用 GitHub 连接器按此固定提交导入了全部 105 个文本文件，保留原许可证；5 个宣传图片/GIF 未纳入该快照。这里的初始 Git 提交是本地源码快照，不是上游 Git 历史。

新增的桌面实现位于 `desktop/`，采用 Electron、原生 Node.js 文件系统与独立的同步引擎。原有 Obsidian 插件源代码未改写；根目录增加桌面命令和说明。

服务端对接依据：

- 上游插件的 `docs/websocket_sync_protocol.md`、`src/lib/sync/websocket_manager.ts`、`operator.ts`、`operator_file.ts`。
- https://github.com/haierkeys/fast-note-sync-service 的 WebSocket 文件、笔记、目录同步和下载分页实现；实际查阅的固定提交见验证说明。

没有修改远端 GitHub 仓库，没有发布 Release，也没有连接或修改用户的实际同步仓库。
