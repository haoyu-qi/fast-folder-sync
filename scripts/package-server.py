"""Package a freshly built service without copying runtime data or credentials."""
import argparse
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("binary", type=Path)
parser.add_argument("platform", choices=["Windows", "Linux"])
parser.add_argument("output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
version = (root / "VERSION").read_text(encoding="utf-8").strip()
args.output.mkdir(parents=True, exist_ok=True)
windows = args.platform == "Windows"
binary_name = "fast-folder-sync-service" + (".exe" if windows else "")
launcher = '@echo off\r\npushd "%~dp0"\r\nfast-folder-sync-service.exe run\r\npopd\r\npause\r\n' if windows else '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec ./fast-folder-sync-service run\n'
readme = f"""# Folder Sync 服务端 {version}

## 启动

解压到固定目录，运行 {"start.cmd" if windows else "`chmod +x fast-folder-sync-service start.sh` 后运行 `./start.sh`"}。
浏览器打开 http://127.0.0.1:9000/webgui/ ，创建首个账户与文件库。
在「连接设备」生成令牌，填入桌面端「Folder Sync 私有服务」任务。
跨设备连接时，使用其他电脑可访问的服务端地址。

配置默认保存在 config/，数据库与文件保存在 storage/。升级前停止服务并备份这两个目录；替换程序时保留原配置和数据。
无已有配置时会生成随机认证密钥，首个账户建立后默认关闭公开注册。

## 产品与部署说明

https://github.com/haoyu-qi/fast-folder-sync/blob/v{version}/README.md

管理台与程序一同打包，无需单独安装 Node.js 或 Go。
本安装包不包含账户、令牌、运行数据或示例任务。
"""
target = args.output / f"Folder-Sync-Server-{version}-{args.platform}-x64.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    archive.write(args.binary, binary_name)
    for name, data, executable in [
        ("start.cmd" if windows else "start.sh", launcher, not windows),
        ("README.md", readme, False),
        ("LICENSE", (root / "LICENSE").read_text(encoding="utf-8"), False),
        ("NOTICE.md", (root / "NOTICE.md").read_text(encoding="utf-8"), False),
        ("THIRD_PARTY_NOTICES.txt", (root / "fast-folder-sync-service/web/THIRD_PARTY_NOTICES.txt").read_text(encoding="utf-8"), False),
    ]:
        info = zipfile.ZipInfo(name)
        info.create_system = 3
        info.external_attr = (0o100755 if executable else 0o100644) << 16
        archive.writestr(info, data.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
print(target)
