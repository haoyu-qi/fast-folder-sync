// Independent implementation of the upstream JSON WebSocket protocol. The
// Obsidian runtime is intentionally absent; see docs/desktop.md for compatibility.
const WebSocket = require('ws');
const { randomUUID } = require('node:crypto');
const { fs, path, excluded, safePath, statOrNull, scan, digest, rolling, wireHash, readJson, atomicJson, replaceFromFile, removeFile } = require('./files.cjs');

function serverUrl(base) {
  const url = new URL(base);
  if (!['https:', 'http:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('服务地址应为 http(s)://主机[:端口][/前缀]');
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/$/, '') + '/api/user/sync';
  url.search = new URLSearchParams({ lang: 'zh-cn', client: 'FastFolderSync', clientName: require('node:os').hostname(), clientVersion: '0.2.2', count: '0', pb: '0' }).toString();
  return url;
}
async function syncFns(task, dataDir, log = () => {}, signal) {
  if (task.mode !== 'sync') throw Error('私有同步服务当前使用双向同步模式；单向备份请选择本地目标');
  if (!task.vault || !task.token) throw Error('请填写服务端仓库名和访问令牌');
  const stateFile = path.join(dataDir, 'state', task.id + '.json');
  const old = await readJson(stateFile, { entries: {}, times: {}, dirs: [] });
  let generic = old.generic === true;
  const capabilityURL = serverUrl(task.server);
  capabilityURL.protocol = capabilityURL.protocol === 'wss:' ? 'https:' : 'http:';
  capabilityURL.pathname = capabilityURL.pathname.replace(/\/api\/user\/sync$/, '/api/drive/capabilities'); capabilityURL.search = '';
  try {
    const probeSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
    const response = await fetch(capabilityURL, { signal: probeSignal });
    if (response.ok) { const body = await response.json(); generic = generic || (body.status === true && body.data?.binaryOnly === true && body.data?.fileContentHash === 'sha256'); }
  } catch { signal?.throwIfAborted(); }
  const notePaths = new Set(Object.keys(old.entries).filter(name => old.entries[name].kind === 'Note'));
  const snapshot = await scan(task.source, task.excludes, true, signal, { binaryOnly: generic, strongFiles: generic, notePaths });
  if (generic) log('info', '通用文件服务已识别，使用完整 SHA-256 与二进制传输');
  const pathHashes = new Map();
  for (const name of [...Object.keys(snapshot.files), ...snapshot.dirs, ...Object.keys(old.entries)]) {
    const hash = rolling(name), existing = pathHashes.get(hash);
    if (existing && existing !== name) throw Error('服务端路径哈希发生冲突，无法安全同步: ' + existing + ' / ' + name);
    pathHashes.set(hash, name);
  }
  for (const [name, entry] of Object.entries(snapshot.files)) {
    if (old.entries[name]?.kind && entry.kind !== old.entries[name].kind) throw Error('Markdown 编码或大小改变导致远端资源类型变化，请在独立仓库中重新建立此任务: ' + name);
    if (old.entries[name]?.hash !== undefined && entry.hash !== old.entries[name].hash && entry.contentHash === old.entries[name].contentHash) throw Error('服务端兼容哈希未变化，但完整内容已变化，已停止同步以避免遗漏: ' + name);
  }
  const next = { entries: { ...old.entries }, times: { ...old.times }, dirs: snapshot.dirs, generic };
  // A scanned entry is only a baseline after the server completes reconciliation.
  for (const [name, entry] of Object.entries(snapshot.files)) next.entries[name] = { hash: entry.hash, contentHash: entry.contentHash, kind: entry.kind };
  const historyDir = path.join(dataDir, 'history', task.id);
  const tempDir = path.join(dataDir, 'transfers', randomUUID());
  await fs.mkdir(tempDir, { recursive: true });
  const result = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, files: Object.keys(snapshot.files).length };
  const context = randomUUID(), sessions = new Map(), pending = new Map(), pages = new Map(), endings = new Map();
  const totals = { Note: 0, File: 0, Folder: 0 }, completed = { Note: 0, File: 0, Folder: 0 };
  let ws, timer, settling, finished = false, chain = Promise.resolve();
  let resolveRun, rejectRun;
  const outcome = new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
  function fail(error) { if (!finished) { finished = true; clearTimeout(settling); rejectRun(error instanceof Error ? error : Error(String(error))); } }
  function touch() { clearTimeout(timer); timer = setTimeout(() => fail(Error('同步超时，未提交本轮状态，下轮将重新核对')), 90000); }
  function send(action, data) {
    signal?.throwIfAborted();
    if (finished || ws.readyState !== WebSocket.OPEN) throw Error('服务连接已关闭');
    ws.send(action + '|' + (typeof data === 'string' ? data : JSON.stringify({ vault: task.vault, context, ...data })));
  }
  function checkDone() {
    clearTimeout(settling);
    if (endings.size !== 3 || pending.size || sessions.size || Object.keys(totals).some(t => completed[t] < totals[t])) return;
    if ([...pages.values()].some(p => p.done < p.totalCount)) return;
    settling = setTimeout(() => { if (!finished) { finished = true; resolveRun(); } }, 150);
  }
  function complete(type, pageIndex) {
    completed[type]++;
    // Modern envelopes use 1-based pageIndex; legacy page metadata is 0-based.
    const key = pageIndex === undefined ? [...pages.keys()].reverse().find(k => k.startsWith(type + ':') && pages.get(k).done < pages.get(k).totalCount) : type + ':' + pageIndex;
    const p = pages.get(key);
    if (p) {
      p.done++;
      if (p.done >= p.totalCount && !p.isLast && !p.acked) { p.acked = true; send(type + 'SyncPageAck', { pageIndex: p.pageIndex }); }
    }
    checkDone();
  }
  const allowed = name => !excluded(name, task.excludes);
  async function localMeta(name) {
    const file = await safePath(task.source, name), s = await statOrNull(file);
    if (!s) return null;
    if (!s.isFile()) throw Error('文件与目录冲突: ' + name);
    return { file, s, hash: await digest(file) };
  }
  async function pushNote(data, pageIndex) {
    const local = await localMeta(data.path);
    if (!local) throw Error('待上传文件已消失: ' + data.path);
    const content = await fs.readFile(local.file, 'utf8'), contentHash = rolling(content);
    pending.set('Note:' + data.path, { pageIndex, hash: local.hash, contentHash });
    send('NoteModify', { path: data.path, pathHash: rolling(data.path), content, contentHash, mtime: Math.floor(local.s.mtimeMs), ctime: Math.floor(local.s.birthtimeMs), ...(old.entries[data.path]?.contentHash !== undefined ? { baseHash: old.entries[data.path].contentHash } : { baseHashMissing: true }) });
  }
  async function acceptFile(data, sourceFile, pageIndex, type) {
    const name = data.path, local = await localMeta(name);
    if (local && local.hash !== old.entries[name]?.hash && local.hash !== await digest(sourceFile)) {
      const ext = path.extname(name), conflict = name.slice(0, name.length - ext.length) + '.conflict-local-' + randomUUID().slice(0, 8) + ext;
      await replaceFromFile(task.source, conflict, local.file, { historyDir, side: 'source', expectedHash: null, mtime: local.s.mtimeMs });
      result.conflicts++; log('warning', '已保留本地冲突副本: ' + conflict);
    }
    await replaceFromFile(task.source, name, sourceFile, { historyDir, side: 'source', expectedHash: local?.hash ?? null, mtime: data.mtime });
    const full = await safePath(task.source, name), s = await fs.stat(full);
    const hash = await digest(full);
    next.entries[name] = { hash, contentHash: type === 'File' && generic ? hash : await wireHash(full, s.size, type), kind: type };
    result.downloaded++; log('success', '下载 ' + name); complete(type, pageIndex);
  }
  async function upload(data, pageIndex) {
    const local = await localMeta(data.path);
    if (!local) throw Error('待上传文件已消失: ' + data.path);
    if (!/^[0-9a-f-]{36}$/i.test(data.sessionId) || !Number.isSafeInteger(data.chunkSize) || data.chunkSize < 1 || data.chunkSize > 8 * 1024 * 1024) throw Error('无效的上传分块参数');
    const before = snapshot.files[data.path];
    if (!before || local.hash !== before.hash) throw Error('文件在扫描后被修改: ' + data.path);
    pending.set('File:' + data.path, { hash: local.hash, contentHash: before.contentHash, pageIndex });
    const handle = await fs.open(local.file, 'r');
    try {
      const total = Math.max(1, Math.ceil(local.s.size / data.chunkSize));
      for (let i = 0; i < total; i++) {
        signal?.throwIfAborted();
        const length = Math.min(data.chunkSize, Math.max(0, local.s.size - i * data.chunkSize));
        const frame = Buffer.alloc(42 + length);
        frame.write('00'); frame.write(data.sessionId, 2); frame.writeUInt32BE(i, 38);
        let read = 0;
        while (read < length) {
          const { bytesRead } = await handle.read(frame, 42 + read, length - read, i * data.chunkSize + read);
          if (!bytesRead) throw Error('上传时文件大小变化: ' + data.path); read += bytesRead;
        }
        while (ws.bufferedAmount > 4 * 1024 * 1024) { signal?.throwIfAborted(); if (finished) throw Error('同步已停止'); await new Promise(r => setTimeout(r, 20)); }
        await new Promise((resolve, reject) => ws.send(frame, err => err ? reject(err) : resolve())); touch();
      }
      if (await digest(local.file) !== before.hash) throw Error('上传期间文件内容变化: ' + data.path);
    } finally { await handle.close(); }
  }
  async function downloadMeta(data) {
    if (!/^[0-9a-f-]{36}$/i.test(data.sessionId) || !Number.isSafeInteger(data.totalChunks) || data.totalChunks < 0 || !Number.isSafeInteger(data.chunkSize) || data.chunkSize < 1 || data.chunkSize > 8 * 1024 * 1024 || !Number.isSafeInteger(data.size) || data.size < 0 || (data.totalChunks !== Math.ceil(data.size / data.chunkSize) && !(data.size === 0 && data.totalChunks === 1))) throw Error('无效的下载分块参数');
    if (!allowed(data.path)) throw Error('服务端发送了被排除的下载项');
    const initial = sessions.get('path:' + data.path);
    if (!initial) throw Error('未请求的下载会话');
    const file = path.join(tempDir, data.sessionId);
    const handle = await fs.open(file, 'wx');
    const session = { ...initial, ...data, file, handle, chunks: new Set() };
    sessions.delete('path:' + data.path); sessions.set(data.sessionId, session);
    if (data.totalChunks === 0) await finishDownload(session);
  }
  async function finishDownload(session) {
    await session.handle.close(); session.handle = null;
    const s = await fs.stat(session.file);
    const actual = /^[0-9a-f]{64}$/.test(session.contentHash || '') ? await digest(session.file) : await wireHash(session.file, s.size, 'File');
    if (s.size !== session.size || (session.contentHash !== undefined && actual !== session.contentHash)) throw Error('下载内容校验失败: ' + session.path);
    // wireHash needs the original extension for Markdown, but this path only
    // handles binary File resources, so a temporary UUID is correct here.
    await acceptFile(session, session.file, session.pageIndex, 'File');
    sessions.delete(session.sessionId); checkDone();
  }
  async function binary(frame) {
    if (frame.length < 42 || frame.toString('utf8', 0, 2) !== '00') throw Error('无法识别的服务端二进制帧');
    const id = frame.toString('utf8', 2, 38), index = frame.readUInt32BE(38), session = sessions.get(id);
    if (!session) throw Error('未请求的二进制会话');
    if (index >= session.totalChunks) throw Error('下载分块编号越界');
    if (session.chunks.has(index)) return;
    const length = Math.min(session.chunkSize, Math.max(0, session.size - index * session.chunkSize));
    if (frame.length - 42 !== length) throw Error('下载分块长度不符');
    let wrote = 0;
    while (wrote < length) { const { bytesWritten } = await session.handle.write(frame, 42 + wrote, length - wrote, index * session.chunkSize + wrote); if (!bytesWritten) throw Error('写入下载分块失败'); wrote += bytesWritten; }
    session.chunks.add(index);
    if (session.chunks.size === session.totalChunks) await finishDownload(session);
  }
  const batches = new Map();
  function startType(type, items, deletions, missing = []) {
    const plural = { Note: 'notes', File: 'files', Folder: 'folders' }[type];
    const deleteKey = { Note: 'delNotes', File: 'delFiles', Folder: 'delFolders' }[type];
    const missingKey = { Note: 'missingNotes', File: 'missingFiles', Folder: 'missingFolders' }[type];
    const count = Math.max(1, Math.ceil(Math.max(items.length, deletions.length, missing.length) / 100));
    const list = Array.from({ length: count }, (_, index) => ({ [plural]: items.slice(index * 100, (index + 1) * 100), [deleteKey]: deletions.slice(index * 100, (index + 1) * 100), [missingKey]: missing.slice(index * 100, (index + 1) * 100), lastTime: old.times[type] || 0, batchIndex: index, totalBatches: count }));
    batches.set(type, list); send(type + 'Sync', list[0]);
  }
  async function message(action, envelope) {
    if (typeof envelope !== 'object' || envelope === null || typeof envelope.code !== 'number') throw Error('服务端返回了无效的响应结构');
    if (envelope.code <= 0 || envelope.code >= 300) throw Error('服务端 ' + action + ' 错误 ' + envelope.code + ': ' + String(envelope.message || '请求失败'));
    const data = envelope.data || {};
    const pageIndex = envelope.pageIndex > 0 ? envelope.pageIndex - 1 : undefined;
    if (envelope.vault && envelope.vault !== task.vault) return;
    if (envelope.context && envelope.context !== context && action !== 'Authorization' && action !== 'ClientInfo') return;
    if (action === 'Authorization') {
      send('ClientInfo', { name: require('node:os').hostname(), type: 'FastFolderSync', version: '0.2.2', isDesktop: true, isMobile: false, isWin: process.platform === 'win32', isMacOS: process.platform === 'darwin', isLinux: process.platform === 'linux', protobuf: false, offlineSyncStrategy: 'manualMerge' });
      const notes = [], files = [], delNotes = [], delFiles = [], missingNotes = [], missingFiles = [];
      for (const [name, entry] of Object.entries(snapshot.files)) {
        const item = { path: name, pathHash: rolling(name), contentHash: entry.contentHash, size: entry.size, mtime: Math.floor(entry.mtime), ctime: Math.floor(entry.ctime), ...(old.entries[name]?.contentHash !== undefined ? { baseHash: old.entries[name].contentHash } : { baseHashMissing: true }) };
        (entry.kind === 'Note' ? notes : files).push(item);
      }
      for (const name of Object.keys(old.entries)) if (!snapshot.files[name] && allowed(name)) {
        const note = old.entries[name].kind === 'Note';
        const list = task.propagateDeletes ? (note ? delNotes : delFiles) : (note ? missingNotes : missingFiles);
        list.push({ path: name, pathHash: rolling(name) });
      }
      startType('Folder', snapshot.dirs.map(name => ({ path: name, pathHash: rolling(name) })), []);
      startType('Note', notes, delNotes, missingNotes); startType('File', files, delFiles, missingFiles);
      log('info', '服务端已连接，正在核对文件'); return;
    }
    if (action === 'ClientInfo' || action === 'ShareSyncRefresh') return;
    const type = /^(Note|File|Folder)/.exec(action)?.[1];
    if (!type) return;
    if (action.endsWith('SyncBatchAck')) {
      const list = batches.get(type), index = (data.batchIndex ?? 0) + 1;
      if (list?.[index]) send(type + 'Sync', list[index]); return;
    }
    if (action.endsWith('SyncPage')) {
      const key = type + ':' + data.pageIndex;
      if (!pages.has(key)) pages.set(key, { ...data, done: 0, acked: false });
      if (data.totalCount === 0 && !data.isLast) send(type + 'SyncPageAck', { pageIndex: data.pageIndex });
      return;
    }
    if (action.endsWith('SyncEnd')) {
      endings.set(type, true); totals[type] = (data.needUploadCount || 0) + (data.needModifyCount || 0) + (data.needDeleteCount || 0) + (data.needSyncMtimeCount || 0);
      next.times[type] = data.lastTime || old.times[type] || 0;
      for (const item of data.messages || []) await message(item.action, { code: 200, data: item.data });
      // Current servers hold download pages until the client requests page -1.
      if (totals[type] > completed[type] && !data.messages?.length && ![...pages.keys()].some(key => key.startsWith(type + ':'))) send(type + 'SyncPageAck', { pageIndex: -1 });
      checkDone(); return;
    }
    const name = data.path;
    if (name && !allowed(name)) { if (action === 'FileSyncChunkDownload') throw Error('拒绝被排除的下载项'); complete(type, pageIndex); return; }
    if (name) await safePath(task.source, name);
    if (action === 'NoteSyncNeedPush') return pushNote(data, pageIndex);
    if (action === 'FileUpload') return upload(data, pageIndex);
    if (action === 'NoteModifyAck' || action === 'FileUploadAck') {
      const item = pending.get(type + ':' + name);
      if (!item) throw Error('收到未请求的上传确认');
      next.entries[name] = { hash: item.hash, contentHash: item.contentHash, kind: type }; pending.delete(type + ':' + name);
      result.uploaded++; log('success', '上传 ' + name); complete(type, item.pageIndex); return;
    }
    if (action === 'NoteSyncModify') {
      if (typeof data.content !== 'string' || (data.contentHash !== undefined && rolling(data.content) !== data.contentHash)) throw Error('笔记内容校验失败');
      const temp = path.join(tempDir, randomUUID()); await fs.writeFile(temp, data.content); await acceptFile(data, temp, pageIndex, type); return;
    }
    if (action === 'FileSyncUpdate') {
      if (sessions.has('path:' + name)) throw Error('重复的下载请求');
      sessions.set('path:' + name, { ...data, pageIndex }); send('FileChunkDownload', { path: name, pathHash: rolling(name) }); return;
    }
    if (action === 'FileSyncChunkDownload') return downloadMeta(data);
    if (action.endsWith('SyncDelete')) {
      if (type === 'Folder') { log('info', '保留本地目录: ' + name); }
      else {
        const local = await localMeta(name);
        if (task.propagateDeletes && local && old.entries[name]?.hash === local.hash) { await removeFile(task.source, name, { historyDir, side: 'source', expectedHash: local.hash }); result.deleted++; delete next.entries[name]; }
        else { log('warning', '已保留服务端删除项的本地文件: ' + name); delete next.entries[name]; }
      }
      complete(type, pageIndex); return;
    }
    if (action.endsWith('SyncMtime')) {
      const local = await localMeta(name); if (local && data.mtime > 0 && local.hash === snapshot.files[name]?.hash) await fs.utimes(local.file, new Date(), new Date(data.mtime));
      complete(type, pageIndex); return;
    }
    if (action === 'FolderSyncModify') { await fs.mkdir(await safePath(task.source, name), { recursive: true }); complete(type, pageIndex); return; }
    if (action.endsWith('SyncRename')) {
      if (!allowed(data.oldPath)) throw Error('拒绝重命名被排除的文件');
      // Rename is a guarded copy+delete. Keep the original when deletion is off.
      const local = type === 'Folder' ? null : await localMeta(data.oldPath);
      if (type === 'Folder') { await fs.mkdir(await safePath(task.source, name), { recursive: true }); }
      else if (local) {
        const existing = await localMeta(name);
        if (existing) throw Error('远端重命名与本地文件冲突: ' + name);
        await replaceFromFile(task.source, name, local.file, { historyDir, side: 'source', expectedHash: null, mtime: data.mtime });
        if (task.propagateDeletes) await removeFile(task.source, data.oldPath, { historyDir, side: 'source', expectedHash: local.hash });
        next.entries[name] = { hash: local.hash, contentHash: type === 'File' && generic ? local.hash : await wireHash(await safePath(task.source, name), local.s.size, type), kind: type }; delete next.entries[data.oldPath];
      } else throw Error('重命名源文件缺失，需重新全量同步: ' + data.oldPath);
      complete(type, pageIndex); return;
    }
    if (action.endsWith('Ack')) return;
    throw Error('尚未支持的服务端动作: ' + action);
  }
  const abort = () => fail(Error('同步已暂停；已完成的文件操作会在下轮重新核对'));
  try {
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
    ws = new WebSocket(serverUrl(task.server), { maxPayload: 16 * 1024 * 1024, handshakeTimeout: 15000 });
    ws.on('open', () => { touch(); send('Authorization', task.token); });
    ws.on('message', (buffer, isBinary) => {
      touch();
      chain = chain.then(async () => {
        if (finished) return; signal?.throwIfAborted();
        if (isBinary) return binary(buffer);
        const text = buffer.toString(), separator = text.indexOf('|');
        if (separator < 0) throw Error('无效的服务端消息');
        await message(text.slice(0, separator), JSON.parse(text.slice(separator + 1)));
        checkDone();
      }).catch(fail);
    });
    ws.on('error', () => fail(Error('无法连接同步服务，请检查地址、网络及证书')));
    ws.on('close', () => { if (!finished) fail(Error('服务连接已断开，下轮将重新核对')); });
    touch(); await outcome; await chain;
    signal?.throwIfAborted();
    // Only accept deletion baselines after successful reconciliation.
    if (task.propagateDeletes) for (const name of Object.keys(old.entries)) if (!snapshot.files[name] && allowed(name) && !(await statOrNull(await safePath(task.source, name)))) delete next.entries[name];
    await atomicJson(stateFile, next); return result;
  } finally {
    finished = true; clearTimeout(timer); clearTimeout(settling); signal?.removeEventListener('abort', abort);
    if (ws) ws.terminate(); await chain;
    for (const s of sessions.values()) if (s.handle) await s.handle.close().catch(() => {});
    // This directory was freshly created under app-controlled transfer storage.
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
module.exports = { syncFns, serverUrl };
