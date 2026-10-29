// Standalone Electron integration check: node tests/asar-regression.cjs
// Kept outside *.test.cjs: plain Node unit jobs need no Electron download.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPackage } = require('@electron/asar');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-asar-'));
  try {
    const payload = path.join(root, 'payload'), source = path.join(root, 'source');
    await fs.mkdir(payload); await fs.mkdir(source);
    await fs.writeFile(path.join(payload, 'file.txt'), 'original archive payload');
    await createPackage(payload, path.join(source, 'tm-patched.asar'));
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/asar-electron.cjs'), root], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000, windowsHide: true
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    process.stdout.write(result.stdout);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected test directory');
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
