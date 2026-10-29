# 版本管理

## 当前基线

- 产品版本：`0.3.0`，根目录 `VERSION` 是唯一版本来源。
- `main` 保存已完成检查的代码；日常开发使用 `feature/描述`、修复使用 `fix/描述`。
- `v0.2.0` 对应首个完整源码提交 `c7ed1a39aff150a6fbbd334b1b349245cf550f60`，与已交付应用代码一致。
- 发布标签固定指向当时的提交，不移动或覆盖已有标签；修复后发布新版本。
- 同一产品版本的平台预览包可以使用独立平台标签，例如 Mac 的 `v0.2.1-macos`，同时保留既有 Windows `v0.2.1` 标签；Release 需标为预览并说明签名和验证状态。
- 桌面原插件及 Go 内核保留原有独立版本，不跟随产品版本强行改号。

## 日常修改

```sh
git switch main
git pull --ff-only
git switch -c feature/folder-feature
# 修改、验证
npm run version:check
git add <明确的文件路径>
git commit -m "feat: describe user-visible behavior"
git push -u origin feature/folder-feature
```

通过 Pull Request 合并到 `main`，避免强制推送。提交标题使用 `feat:`、`fix:`、`docs:`、`chore:` 等前缀。

## 准备发布

```sh
npm run version:set -- 0.2.2
npm run version:check
npm run desktop:check
npm run desktop:test
npm run web:check
npm run web:test
npm run web:build
```

版本工具会检查并同步桌面包、管理台包、两份依赖锁文件和协议版本标记。重新构建管理台后必须重新构建 Go 服务，再构建桌面发行包；仅修改版本文件不会自动重建二进制。更新 `CHANGELOG.md`，把本次变动从「尚未发布」移到新的版本标题，按目标平台完成验证。

服务端核心检查：

```sh
cd fast-folder-sync-service
go test ./internal/routers/api_router ./internal/routers/websocket_router ./internal/middleware ./internal/service ./pkg/util ./pkg/storage/local_fs
```

检查完成后提交所有预期变更，推送并确认 GitHub Actions 通过，再建立带说明的版本标签：

```sh
git tag -a v0.2.2 -m "Folder Sync 0.2.2"
git push origin main
git push origin v0.2.2
```

产品标签 `v<版本>` 会触发 `.github/workflows/release.yml`，检查通过后原生构建 Windows 客户端、Mac 两种架构和 Windows / Linux 服务端，生成 SHA-256 清单，再发布完整配套 Release。先合并检查通过的代码，再推送标签；普通源码提交不会自动发布。已有标签及历史 Release 保留原样。

## 查看与回退

```sh
git log --oneline --decorate -10
git tag --list
git show v0.2.0:fast-folder-sync/desktop/package.json
git revert <需要撤回的提交>
```

`v0.2.0` 是引入版本管理之前的基线提交，因此该标签中还没有根目录 `VERSION`；查看其版本使用 `git show v0.2.0:fast-folder-sync/desktop/package.json`。后续版本标签包含 `VERSION`。使用 `git revert` 保留历史；查看旧版可建立临时分支。程序回退与运行数据恢复是不同的操作，升级已有服务前先备份配置、数据库和文件存储。

## 本地内容与 GitHub 内容

源码、说明、构建配方和验证脚本进入 Git。`artifacts/` 保存发行包；`work/` 保存工具链、缓存和测试资料；`.local/` 保存迁移记录与旧工程副本。这三个目录均在 `.gitignore` 中，不会上传。运行时 `config/`、`storage/` 也被忽略，源代码内的配置模板仍保留。

GitHub 同步由明确的提交和 `git push` 完成；文件夹内的更改不会自动生成提交。
