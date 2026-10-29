"""Package committed service sources; never include local runtime credentials."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "artifacts/docker"
output.mkdir(parents=True, exist_ok=True)
version = (root / "VERSION").read_text(encoding="utf-8").strip()
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
files = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", "-z", "HEAD", "fast-folder-sync-service"], cwd=root).decode().split("\0")
target = output / f"Folder-Sync-Server-{version}-Docker.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for filename in filter(None, files):
        relative = filename.removeprefix("fast-folder-sync-service/")
        if any(part in {"node_modules", "storage", "build", ".git", "artifacts"} for part in Path(relative).parts):
            continue
        if Path(relative).name in {".env", ".env.local"}:
            continue
        data = subprocess.check_output(["git", "show", f"HEAD:{filename}"], cwd=root)
        archive.writestr("source/" + relative, data)
    for name in ["compose.yaml", ".env.example", "README.md"]:
        text = (root / "deploy/docker" / name).read_text(encoding="utf-8")
        if name == "compose.yaml":
            text = text.replace("../../fast-folder-sync-service", "./source")
        archive.writestr(name, text.encode("utf-8"))
    for name in ["LICENSE", "NOTICE.md"]:
        archive.write(root / name, name)
    archive.writestr("BUILD-INFO.json", json.dumps({"productVersion": version, "sourceCommit": commit, "type": "source-build", "offlineImageIncluded": False}, indent=2) + "\n")
digest = hashlib.sha256(target.read_bytes()).hexdigest()
checksum = output / f"Folder-Sync-Server-{version}-Docker-SHA256SUMS.txt"
checksum.write_text(f"{digest}  {target.name}\n", encoding="utf-8")
print(target)
print(checksum)
