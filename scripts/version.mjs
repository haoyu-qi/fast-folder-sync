import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionPath = path.join(root, 'VERSION');
const current = fs.readFileSync(versionPath, 'utf8').trim();
const valid = value => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value);
const packagePaths = ['fast-folder-sync/desktop', 'fast-folder-sync-service/web'];
const markers = [
  ['README.md', /当前版本：\*\*([^*]+)\*\*/g],
  ['fast-folder-sync-service/compose.folder.yaml', /image: fast-folder-sync-service:([^\s]+)/g],
  ['fast-folder-sync/desktop/index.html', /Fast Folder Sync · v([^<\s]+)/g],
  ['fast-folder-sync/desktop/mac/index.html', /<span>v([^<\s]+)<\/span>/g],
  ['fast-folder-sync/desktop/lib/fns-sync.cjs', /clientVersion: '([^']+)'/g],
  ['fast-folder-sync/desktop/lib/fns-sync.cjs', /type: 'FastFolderSync', version: '([^']+)'/g],
  ['fast-folder-sync-service/web/src/api.js', /'x-client-version': '([^']+)'/g],
  ['fast-folder-sync-service/internal/routers/api_router/handler_drive.go', /"product": "Fast Folder Sync", "version": "([^"]+)"/g],
];

function check() {
  if (!valid(current)) throw Error('Invalid VERSION: ' + current);
  for (const folder of packagePaths) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, folder, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, folder, 'package-lock.json'), 'utf8'));
    if ([pkg.version, lock.version, lock.packages[''].version].some(v => v !== current)) throw Error('Version mismatch: ' + folder);
  }
  for (const [file, pattern] of markers) {
    const matches = [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(pattern)];
    if (!matches.length || matches.some(match => match[1] !== current)) throw Error('Version marker mismatch: ' + file);
  }
  console.log('Version verified:', current, '(desktop, console, locks and protocol markers)');
}

try {
  const [command = 'check', target] = process.argv.slice(2);
  if (!['check', 'set'].includes(command)) throw Error('Usage: node scripts/version.mjs check | set <version>');
  check();
  if (command === 'set') {
    if (!valid(target || '')) throw Error('Provide a version such as 0.2.1 or 0.3.0-beta.1');
    const updates = new Map([[versionPath, target + '\n']]);
    for (const folder of packagePaths) {
      for (const filename of ['package.json', 'package-lock.json']) {
        const file = path.join(root, folder, filename);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.version = target;
        if (filename === 'package-lock.json') data.packages[''].version = target;
        updates.set(file, JSON.stringify(data, null, 2) + '\n');
      }
    }
    for (const [file] of markers) {
      const absolute = path.join(root, file);
      updates.set(absolute, fs.readFileSync(absolute, 'utf8').replaceAll(current, target));
    }
    for (const [file, content] of updates) fs.writeFileSync(file, content);
    console.log('Version set to', target, '— rebuild desktop/server assets, update CHANGELOG, then commit and tag.');
  }
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
