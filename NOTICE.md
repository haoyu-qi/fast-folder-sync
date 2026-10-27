# 上游来源与改造说明

本项目基于以下 Apache-2.0 开源项目。保留原许可证、源码中的版权声明及上游文档，感谢原作者和贡献者。

| 项目 | 固定来源提交 |
| --- | --- |
| [haierkeys/obsidian-fast-note-sync](https://github.com/haierkeys/obsidian-fast-note-sync) | `1bfb406966d612a61831462bf381bbcd1c73f334` |
| [haierkeys/fast-note-sync-service](https://github.com/haierkeys/fast-note-sync-service) | `7a6c78792c631f999c8a5f725bba5dd7235d6688` |

改造内容：独立桌面客户端、通用文件夹备份与双向同步、完整 SHA-256 传输、通用文件管理接口、管理台前端重建及存储路径修复。新管理台没有笔记编辑或 Obsidian 授权入口，原有同步协议和数据库结构保留兼容。

客户端以固定提交导入了 105 个文本文件，5 个上游宣传图片/GIF 未导入；服务端从官方 CNB 镜像取得并核对提交。此仓库以整理后的完整源码建立初始提交，不包含上游 Git 历史。客户端的原始导入详情见 `fast-folder-sync/UPSTREAM.md`。

Phosphor 图标采用 MIT 许可，声明位于 `fast-folder-sync-service/web/THIRD_PARTY_NOTICES.txt`。其他依赖按各自许可证分发。
