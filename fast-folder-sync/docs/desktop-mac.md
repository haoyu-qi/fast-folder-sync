# Fast Folder Sync · Mac 客户端

产品版本 **0.3.0**。Mac 专属界面位于 `desktop/mac/`，在 macOS 自动加载，与其他平台共用同步引擎、任务配置和历史恢复。

## 安装

从 [0.3.0 发布页](https://github.com/haoyu-qi/fast-folder-sync/releases/tag/v0.3.0)下载：Apple Silicon（M 系列）选择 arm64，Intel Mac 选择 x64。需要 macOS 13 或更新版本。

打开 DMG 或解压 ZIP，将 `Fast Folder Sync.app` 拖入「应用程序」。首次启动为空白工作空间，自行选择源文件夹和目标位置。安装包不含账户、令牌或示例任务。

本版本由 macOS runner 构建，使用本地 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证。首次打开请按系统允许打开流程操作；下载完整性可用同版 `SHA256SUMS.txt` 核对。CI 界面验证不代替所有 Mac 机型的人工验收。

## 界面与操作

提供原生 under-window vibrancy、系统红黄绿窗口按钮、可拖动顶部区域和随系统切换的浅深主题。界面有「文件夹任务」「同步记录」「历史版本」三个页面，可按名称或路径搜索任务，按自动同步和需要关注筛选。

本地路径可双击，或聚焦后按 Enter / 空格打开。关闭主窗口后继续在菜单栏后台同步，完全退出使用应用菜单或菜单栏图标中的「退出」。

| 快捷键 | 操作 |
| --- | --- |
| ⌘N | 新建任务 |
| ⌘F | 搜索任务 |
| ⌘1 / ⌘2 / ⌘3 | 切换任务 / 记录 / 历史 |
| ⌘W | 关闭窗口，保留后台任务 |
| ⌘Q | 完全退出 |

## 在 Mac 上构建

需要 Node.js 24 或更新版本。在 `fast-folder-sync/desktop/` 执行：

```sh
npm ci
npm run check
npm run check:mac
npm test
npm run dist:mac
```

输出在 `release/mac-glass/`，包含 arm64 / x64 的 DMG 和 ZIP。只构建一种架构并使用本地签名：

```sh
npx electron-builder --config electron-builder.mac.cjs --mac dmg zip --arm64 --publish never -c.mac.identity=-
```

Intel 将 `--arm64` 换为 `--x64`。ad-hoc 签名不等于 Developer ID 签名或公证，正式签名分发需要自己的证书和公证配置。

产品标签通过 `.github/workflows/release.yml` 构建并发布配套版本；另有手动 `.github/workflows/macos-client.yml` 可单独构建测试产物。0.2.1 的 Mac 预览标签 `v0.2.1-macos` 保留原样，0.3.0 使用统一产品标签。

## 验证与资源

本版本发布与验证范围见 [0.3.0 说明](../../docs/RELEASE-0.3.0.md)。仓库 README 的 Mac 配图来自 Windows 上运行的实际 Mac renderer，用于展示布局，不能代表 Mac 原生材质。

Windows 可执行 `npm run start:mac-preview` 预览布局。隔离验证需传入 `--mac-preview --smoke-test`，并用 `FFS_TEST_DATA`、`FFS_SMOKE_SOURCE`、`FFS_SMOKE_TARGET` 指定测试目录。

应用标识沿用原项目，精选 Lucide 图标许可见 `desktop/mac/lucide-LICENSE`；菜单栏图标提供 1× / 2× 模板位图。
