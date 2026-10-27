const { fs, path, scan, safePath, digest, atomicJson, readJson, replaceFromFile, removeFile, validateRoots } = require('./files.cjs');

async function syncLocal(task, dataDir, log = () => {}, signal) {
  await validateRoots(task.source, task.target);
  const historyDir = path.join(dataDir, 'history', task.id);
  const stateFile = path.join(dataDir, 'state', task.id + '.json');
  const previous = await readJson(stateFile, { entries: {}, dirs: [] });
  const left = await scan(task.source, task.excludes, false, signal);
  const right = await scan(task.target, task.excludes, false, signal);
  const next = { entries: {}, dirs: [], time: new Date().toISOString() };
  const result = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, files: Object.keys(left.files).length };
  const names = new Set([...Object.keys(left.files), ...Object.keys(right.files), ...Object.keys(previous.entries)]);
  const roots = { source: task.source, target: task.target };
  async function copy(name, from, to, value, old) {
    signal?.throwIfAborted();
    const src = await safePath(roots[from], name);
    if (await digest(src) !== value.hash) throw Error('源文件已变化: ' + name);
    await replaceFromFile(roots[to], name, src, { historyDir, side: to, expectedHash: old?.hash ?? null, contentHash: value.hash, mtime: value.mtime });
    if (await digest(await safePath(roots[to], name)) !== value.hash) throw Error('复制校验失败: ' + name);
    result[from === 'source' ? 'uploaded' : 'downloaded']++;
    log('success', (from === 'source' ? '备份 / 上传 ' : '下载 ') + name);
  }
  async function conflict(name, a, b) {
    // Preserve both versions, then use the source as canonical. The conflict file
    // is synchronized normally in the following round, so both devices retain it.
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    const conflictName = stem + '.conflict-' + b.hash.slice(0, 12) + ext;
    const existing = left.files[conflictName];
    if (existing?.hash !== b.hash) {
      if (existing) throw Error('冲突副本名称已占用: ' + conflictName);
      const sourceFile = await safePath(task.target, name);
      if (await digest(sourceFile) !== b.hash) throw Error('冲突文件已变化: ' + name);
      await replaceFromFile(task.source, conflictName, sourceFile, { historyDir, side: 'source', expectedHash: null, contentHash: b.hash, mtime: b.mtime });
    }
    await copy(name, 'source', 'target', a, b);
    result.conflicts++;
    log('warning', '两端同时修改，已保留目标副本: ' + conflictName);
  }
  for (const name of names) {
    signal?.throwIfAborted();
    // Excluded paths from earlier configurations must never become delete intents.
    if (require('./files.cjs').excluded(name, task.excludes)) continue;
    let a = left.files[name], b = right.files[name];
    const old = previous.entries[name] || {};
    const ah = a?.hash ?? null, bh = b?.hash ?? null;
    if (ah === bh) { if (a) next.entries[name] = { source: ah, target: bh }; continue; }
    if (task.mode === 'backup') {
      if (a) { await copy(name, 'source', 'target', a, b); b = a; }
      else if (b && task.propagateDeletes && old.source && old.target === bh) {
        await removeFile(task.target, name, { historyDir, side: 'target', expectedHash: bh }); b = null; result.deleted++;
      }
    } else {
      const changedA = ah !== (old.source ?? null), changedB = bh !== (old.target ?? null);
      if (a && b) {
        if (changedA && changedB) await conflict(name, a, b);
        else if (changedB) { await copy(name, 'target', 'source', b, a); a = b; }
        else { await copy(name, 'source', 'target', a, b); b = a; }
        if (changedA && changedB) b = a;
      } else if (a) {
        if (task.propagateDeletes && old.target && !changedA) {
          await removeFile(task.source, name, { historyDir, side: 'source', expectedHash: ah }); a = null; result.deleted++;
        } else { await copy(name, 'source', 'target', a, null); b = a; }
      } else if (b) {
        if (task.propagateDeletes && old.source && !changedB) {
          await removeFile(task.target, name, { historyDir, side: 'target', expectedHash: bh }); b = null; result.deleted++;
        } else { await copy(name, 'target', 'source', b, null); a = b; }
      }
    }
    if (a || b) next.entries[name] = { source: a?.hash ?? null, target: b?.hash ?? null };
  }
  // Keep empty folders. Deletions are deliberately file-level; directories are
  // never removed recursively, including when their contents are excluded.
  const dirs = task.mode === 'backup' ? left.dirs : [...new Set([...left.dirs, ...right.dirs])];
  for (const name of dirs) {
    signal?.throwIfAborted();
    for (const root of task.mode === 'backup' ? [task.target] : [task.source, task.target]) await fs.mkdir(await safePath(root, name), { recursive: true });
  }
  next.dirs = dirs;
  signal?.throwIfAborted();
  await atomicJson(stateFile, next);
  return result;
}
module.exports = { syncLocal };
