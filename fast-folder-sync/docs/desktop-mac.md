# Fast Folder Sync · Mac 毛玻璃客户端

Mac 专属界面位于 `desktop/mac/`，通过 `process.platform === 'darwin'` 自动加载，与 Windows 界面各自维护，共用原有同步引擎、配置存储和受限 IPC。产品版本保持 0.2.1。

## 使用交付包

Apple Silicon（M 系列）选择 `macOS-arm64-unsigned.zip`，Intel Mac 选择 `macOS-x64-unsigned.zip`。需要 macOS 13 或更新版本。解压后把 `Fast Folder Sync.app` 拖入「应用程序」，再打开应用。首次启动为空白工作空间，由你选择源文件夹和目标位置。

此次交付为未签名测试包。若 macOS 提示开发者无法验证，请按系统提供的允许打开流程处理；也可使用下面的源码构建流程，在 Mac 上生成本地签名包。不要将这些测试包视为已签名、公证的正式发行版。

## 界面与操作

- 系统原生 `under-window` vibrancy、隐藏标题栏、原生红黄绿窗口按钮、可拖动顶部区域。
- 冰蓝与淡紫的透明面板、保留绿色应用标识；浅色和深色随系统切换。
- 文件夹任务、同步记录、历史版本三个页面；按名称或路径搜索任务，按自动同步和需要关注筛选。
- 新建和编辑任务、本地或私有服务切换、手动同步、自动任务暂停与启用、历史恢复。
- 本地路径支持双击或聚焦后按 Enter / 空格打开文件夹。
- 菜单栏使用适配深浅背景的单色模板图标。关闭主窗口后继续同步，从菜单栏或 Dock 再次打开，完全退出使用应用菜单或菜单栏图标中的「退出」。

| 快捷键 | 操作 |
| --- | --- |
| ⌘N | 新建任务 |
| ⌘F | 搜索任务 |
| ⌘1 / ⌘2 / ⌘3 | 任务 / 记录 / 历史 |
| ⌘W | 关闭窗口，保留后台任务 |
| ⌘Q | 完全退出 |

## 在 Mac 上构建

需要 Node.js 24 或更新版本。进入 `fast-folder-sync/desktop`：

```sh
npm ci
npm run check
npm run check:mac
npm test
npm run dist:mac
```

输出位于 `release/mac-glass/`，分别提供 arm64（Apple Silicon）和 x64（Intel）的 DMG 与 ZIP。只需一种架构时：

```sh
npx electron-builder --config electron-builder.mac.cjs --mac dmg zip --arm64 --publish never
# Intel：将 --arm64 改为 --x64
```

没有 Developer ID 证书时，可以增加 `-c.mac.identity=-` 生成本地 ad-hoc 签名。它不等于 Apple Developer ID 签名或公证。正式分发需要在 macOS 配置自己的 Developer ID 证书与公证凭据。

仓库附带可手动运行的 `.github/workflows/macos-client.yml`：在 Mac runner 验证原生界面与文件恢复，并分别构建两种架构的 DMG / ZIP，产物以 Actions artifact 保存。构建采用本地 ad-hoc 签名，不包含 Developer ID 签名或 Apple 公证。

Mac 预览版使用独立标签 `v0.2.1-macos` 发布，不移动 Windows 的 `v0.2.1` 标签。Release 说明与附件记录本次实际交付的构建方式及验证边界。

## 当前交付与验证边界

当前主机为 Windows，使用官方 Electron Packager 20.3.0 和 Electron 45.0.0 为 darwin arm64 / x64 生成 `.app` 测试包，不包含 Developer ID 签名和 Apple 公证。原生 DMG 构建、macOS 的窗口材质、菜单栏行为、系统权限和真机启动仍需在 Mac 上确认。

已完成：20 项同步引擎测试；Mac 专属 renderer 的真实备份、覆盖归档和历史恢复；搜索、状态筛选、自动任务启停、编辑限制、页面导航、历史列表、本地与远程表单、键盘初始焦点、菜单命令 IPC；浅深主题和 960 × 700 最小窗口检查。截图来自 Windows 上运行的实际 Mac renderer，不能作为 Mac 原生材质的实测证据。

Windows 本地预览：`npm run start:mac-preview`。隔离自动验证同时传入 `--mac-preview --smoke-test` 和 `FFS_TEST_DATA`、`FFS_SMOKE_SOURCE`、`FFS_SMOKE_TARGET` 测试目录。不要指向日常文件夹。

## 资源说明

应用标识沿用原项目。界面使用 Lucide 1.8.0 图标的精选子集，许可见 `desktop/mac/lucide-LICENSE`。菜单栏模板同时提供 1× 与 2× 位图。
