const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isUtf8 } = require('node:buffer');

const DEFAULT_EXCLUDES = ['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '.fast-folder-sync', '*.ffs-tmp'];
function excluded(name, patterns = []) {
  const parts = name.split('/');
  return [...DEFAULT_EXCLUDES, ...patterns].some(p => {
    p = p.trim().replaceAll('\\', '/').replace(/\/$/, '');
    if (!p) return false;
    if (!p.includes('/')) return parts.some(part => path.matchesGlob(part, p));
    return path.matchesGlob(name, p) || path.matchesGlob(name, p + '/**');
  });
}
function relativeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.includes(':') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..')) {
    throw Error('不安全的相对路径: ' + String(name));
  }
  // Reject Windows aliases on every OS so tasks remain portable.
  if (name.split('/').some(p => /[. ]$|[<>"|?*]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('不支持的文件名: ' + name);
  return name;
}
async function safePath(root, name) {
  relativeName(name);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('根目录无效或为符号链接: ' + root);
  let current = root;
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const s = await statOrNull(current);
    if (s?.isSymbolicLink()) throw Error('拒绝访问符号链接: ' + name);
    if (s && i < parts.length - 1 && !s.isDirectory()) throw Error('路径被文件占用: ' + name);
  }
  return current;
}
async function statOrNull(file) {
  try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function digest(file, signal) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(file, { signal })) hash.update(block);
  return hash.digest('hex');
}
function rolling(value) {
  let hash = 0;
  if (typeof value === 'string') { for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0; }
  else { for (const byte of value) hash = ((hash << 5) - hash + byte) | 0; }
  return String(hash);
}
async function wireHash(file, size, kind) {
  if (kind === 'Note' || (!kind && file.endsWith('.md'))) return rolling(await fs.readFile(file, 'utf8'));
  if (size <= 10 * 1024 * 1024) return rolling(await fs.readFile(file));
  const slice = 5 * 1024 * 1024;
  const buffer = Buffer.alloc(slice * 3);
  const handle = await fs.open(file, 'r');
  try {
    for (const [index, offset] of [0, Math.floor(size / 2) - Math.floor(slice / 2), size - slice].entries()) {
      let done = 0;
      while (done < slice) {
        const { bytesRead } = await handle.read(buffer, index * slice + done, slice - done, offset + done);
        if (!bytesRead) throw Error('读取文件时大小发生变化');
        done += bytesRead;
      }
    }
  } finally { await handle.close(); }
  return rolling(buffer);
}
async function scan(root, patterns = [], protocol = false, signal, options = {}) {
  const files = Object.create(null), dirs = [];
  const s = await fs.lstat(root);
  if (!s.isDirectory() || s.isSymbolicLink()) throw Error('文件夹不存在或为链接: ' + root);
  async function visit(prefix) {
    for (const entry of await fs.readdir(prefix ? await safePath(root, prefix) : root, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (excluded(name, patterns) || entry.isSymbolicLink()) continue;
      relativeName(name);
      if (entry.isDirectory()) { dirs.push(name); await visit(name); }
      else if (entry.isFile()) {
        const full = await safePath(root, name);
        const before = await fs.stat(full);
        const hash = await digest(full, signal);
        // Markdown is a note only when it is valid UTF-8 and fits comfortably
        // inside a text frame. Every other file uses lossless binary transport.
        const noteAllowed = !options.binaryOnly || options.notePaths?.has(name);
        const kind = protocol && noteAllowed && name.endsWith('.md') && before.size <= 8 * 1024 * 1024 && isUtf8(await fs.readFile(full)) ? 'Note' : 'File';
        const contentHash = protocol ? (kind === 'File' && options.strongFiles ? hash : await wireHash(full, before.size, kind)) : undefined;
        const after = await fs.stat(full);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('文件正在修改，将在下轮重试: ' + name);
        files[name] = { hash, size: after.size, mtime: after.mtimeMs, ctime: after.birthtimeMs, ...(protocol ? { contentHash, kind } : {}) };
      }
    }
  }
  await visit('');
  return { files, dirs };
}
async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.ffs-tmp';
  try { await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw Error('无法读取状态文件 ' + path.basename(file) + ': ' + e.message); }
}
async function archive(root, name, historyDir, side, reason) {
  const full = await safePath(root, name), s = await statOrNull(full);
  if (!s) return;
  if (!s.isFile()) throw Error('文件与目录冲突: ' + name);
  const id = randomUUID();
  await fs.mkdir(historyDir, { recursive: true });
  await fs.copyFile(full, path.join(historyDir, id + '.bin'));
  const item = { id, path: name, side, reason, time: new Date().toISOString(), size: s.size, hash: await digest(path.join(historyDir, id + '.bin')) };
  await atomicJson(path.join(historyDir, id + '.json'), item);
  return item;
}
async function replaceFromFile(root, name, sourceFile, { historyDir, side, expectedHash, contentHash, mtime, reason = '覆盖前备份' }) {
  const full = await safePath(root, name), s = await statOrNull(full);
  if (s && !s.isFile()) throw Error('文件与目录冲突: ' + name);
  const existingHash = s ? await digest(full) : null;
  if (expectedHash !== undefined && existingHash !== expectedHash) throw Error('文件在同步中被修改，将在下轮重试: ' + name);
  if (s) await archive(root, name, historyDir, side, reason);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const temp = full + '.' + randomUUID() + '.ffs-tmp';
  try {
    await fs.copyFile(sourceFile, temp);
    if (contentHash && await digest(temp) !== contentHash) throw Error('复制期间源文件发生变化: ' + name);
    // Recheck immediately before replacing the live file.
    const latest = await statOrNull(full);
    if ((latest ? await digest(full) : null) !== existingHash) throw Error('写入前检测到文件改动: ' + name);
    if (mtime > 0) await fs.utimes(temp, new Date(), new Date(mtime));
    await fs.rename(temp, full);
  } finally { await fs.rm(temp, { force: true }); }
}
async function removeFile(root, name, options) {
  const full = await safePath(root, name), s = await statOrNull(full);
  if (!s) return;
  if (!s.isFile()) throw Error('拒绝递归删除目录: ' + name);
  const initialHash = await digest(full);
  if (options.expectedHash !== undefined && initialHash !== options.expectedHash) throw Error('删除前检测到文件改动: ' + name);
  const saved = await archive(root, name, options.historyDir, options.side, '删除前备份');
  if (saved.hash !== initialHash || await digest(full) !== initialHash) throw Error('备份后检测到文件改动: ' + name);
  await fs.unlink(full);
}
function overlaps(a, b) {
  const aa = path.resolve(a), bb = path.resolve(b);
  const rel = path.relative(aa, bb);
  return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
async function validateRoots(source, target) {
  const a = await fs.realpath(source), b = await fs.realpath(target);
  if (overlaps(a, b) || overlaps(b, a)) throw Error('源文件夹与目标文件夹不能相同或互相嵌套');
  for (const root of [source, target]) { const s = await fs.lstat(root); if (!s.isDirectory() || s.isSymbolicLink()) throw Error('请选择真实文件夹，不能使用符号链接'); }
}
module.exports = { fs, path, DEFAULT_EXCLUDES, excluded, relativeName, safePath, statOrNull, digest, rolling, wireHash, scan, atomicJson, readJson, archive, replaceFromFile, removeFile, overlaps, validateRoots };
