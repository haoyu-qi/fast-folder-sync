const WebSocket = require('ws');
const { randomUUID, createHash } = require('node:crypto');
const { relativeName, rolling } = require('./files.cjs');

// Path hashes are opaque strings in the server's protocol. Keep existing keys;
// use a full digest to disambiguate new files sharing a legacy 32-bit key.
function filePathKeys(names, previous, remote) {
  const keys = new Map(), owners = new Map(), buckets = new Map();
  function bucket(name) {
    const hash = rolling(name);
    if (!buckets.has(hash)) buckets.set(hash, new Set());
    buckets.get(hash).add(name);
  }
  function reserve(name, hash) {
    relativeName(name);
    if (typeof hash !== 'string' || !hash || hash.length > 1024) throw Error('服务端文件路径标识无效: ' + name);
    if (keys.has(name) && keys.get(name) !== hash) throw Error('服务端同一路径存在多个文件标识，请先检查重复记录: ' + name);
    if (owners.has(hash) && owners.get(hash) !== name) throw Error('服务端已有文件的路径标识冲突: ' + owners.get(hash) + ' / ' + name);
    keys.set(name, hash); owners.set(hash, name); bucket(name);
  }
  for (const [name, hash] of remote) reserve(name, hash);
  const allNames = new Set([...names, ...Object.keys(previous).filter(name => previous[name].kind !== 'Note')]);
  for (const name of allNames) bucket(name);
  for (const name of allNames) {
    if (keys.has(name)) continue;
    const legacy = rolling(name), saved = previous[name]?.pathHash;
    let hash = saved || (buckets.get(legacy).size === 1 && !owners.has(legacy) ? legacy : createHash('sha256').update(name, 'utf8').digest('hex'));
    if (owners.has(hash) && owners.get(hash) !== name) hash = createHash('sha256').update(name, 'utf8').digest('hex');
    reserve(name, hash);
  }
  return keys;
}

// Read metadata through the existing read-only WS sync flow. Device tokens
// intentionally have WS-only scope; no extra HTTP permission is requested.
function remoteFilePathKeys(task, url, signal, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const context = randomUUID(), keys = new Map(), pages = new Map();
    let ws, timer, done = false, authorized = false, end, received = 0, requested = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); ws?.terminate(); };
    const fail = error => { if (done) return; done = true; cleanup(); reject(error); };
    const abort = () => fail(Error('同步已暂停'));
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => fail(Error('读取服务端文件索引超时，请检查连接后重试')), 90000); };
    function send(action, data) {
      signal?.throwIfAborted();
      ws.send(action + '|' + (typeof data === 'string' ? data : JSON.stringify({ vault: task.vault, context, ...data })));
    }
    function check() {
      if (!end || received < end.total || [...pages.values()].some(page => page.received < page.totalCount)) return;
      done = true; cleanup(); resolve(keys);
    }
    function message(action, envelope) {
      if (envelope?.vault && envelope.vault !== task.vault) return;
      if (envelope?.context && envelope.context !== context && action !== 'Authorization' && action !== 'ClientInfo') return;
      if (!envelope || typeof envelope.code !== 'number' || envelope.code <= 0 || envelope.code >= 300) throw Error('读取服务端文件索引失败: ' + String(envelope?.message || action));
      const data = envelope.data || {};
      if (action === 'Authorization') {
        if (authorized) throw Error('服务端重复授权响应');
        authorized = true;
        send('FileSync', { files: [], delFiles: [], missingFiles: [], lastTime: 0, batchIndex: 0, totalBatches: 1 });
        return;
      }
      if (action === 'ClientInfo' || action === 'ShareSyncRefresh') return;
      if (!authorized) throw Error('服务端文件索引未授权');
      if (action === 'FileSyncEnd') {
        if ((data.needUploadCount || 0) !== 0) throw Error('读取文件索引时收到了意外上传请求');
        const total = (data.needModifyCount || 0) + (data.needDeleteCount || 0) + (data.needSyncMtimeCount || 0);
        if (!Number.isSafeInteger(total) || total < 0) throw Error('服务端文件索引数量无效');
        end = { total };
        for (const item of data.messages || []) message(item.action, { code: 200, data: item.data });
        if (received < total && !data.messages?.length && !pages.size && !requested) { requested = true; send('FileSyncPageAck', { pageIndex: -1 }); }
      } else if (action === 'FileSyncPage') {
        if (!Number.isInteger(data.pageIndex) || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0) throw Error('服务端文件索引分页无效');
        if (pages.has(data.pageIndex)) throw Error('服务端重复文件索引分页');
        pages.set(data.pageIndex, { ...data, received: 0 });
        if (!data.totalCount && !data.isLast) send('FileSyncPageAck', { pageIndex: data.pageIndex });
      } else if (['FileSyncUpdate', 'FileSyncDelete', 'FileSyncMtime'].includes(action)) {
        relativeName(data.path);
        if (typeof data.pathHash !== 'string' || !data.pathHash || data.pathHash.length > 1024) throw Error('服务端文件路径标识无效: ' + data.path);
        if (keys.has(data.path) && keys.get(data.path) !== data.pathHash) throw Error('服务端同一路径存在多个文件标识: ' + data.path);
        keys.set(data.path, data.pathHash); received++;
        const index = envelope.pageIndex > 0 ? envelope.pageIndex - 1 : [...pages.keys()].reverse().find(key => pages.get(key).received < pages.get(key).totalCount);
        const page = pages.get(index);
        if (page && ++page.received >= page.totalCount && !page.isLast) send('FileSyncPageAck', { pageIndex: page.pageIndex });
        onProgress({ stage: 'index', checked: keys.size, path: data.path });
      } else if (action.startsWith('File') && action !== 'FileSyncBatchAck') {
        throw Error('读取服务端文件索引时收到意外消息: ' + action);
      }
      check();
    }
    try {
      signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
      ws = new WebSocket(url, { maxPayload: 16 * 1024 * 1024, handshakeTimeout: 15000 });
      ws.on('open', () => { touch(); send('Authorization', task.token); });
      ws.on('message', (buffer, binary) => {
        if (done) return;
        try {
          touch(); signal?.throwIfAborted();
          if (binary) throw Error('读取文件索引时收到意外二进制数据');
          const text = buffer.toString(), at = text.indexOf('|');
          if (at < 0) throw Error('服务端文件索引消息无效');
          message(text.slice(0, at), JSON.parse(text.slice(at + 1)));
        } catch (error) { fail(error); }
      });
      ws.on('error', () => fail(Error('无法连接同步服务读取文件索引，请检查地址、网络及证书')));
      ws.on('close', () => { if (!done) fail(Error('读取服务端文件索引时连接断开')); });
      touch();
    } catch (error) { fail(error); }
  });
}
module.exports = { filePathKeys, remoteFilePathKeys };
