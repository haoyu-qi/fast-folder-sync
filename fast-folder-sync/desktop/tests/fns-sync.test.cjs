const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { fs, path, rolling, readJson } = require('../lib/files.cjs');
const { syncFns, serverUrl } = require('../lib/fns-sync.cjs');

async function setup(t, handler) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-protocol-'));
  const source = path.join(root, 'source'), data = path.join(root, 'data'); await fs.mkdir(source);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { for (const c of server.clients) c.terminate(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  server.on('connection', socket => {
    const send = (action, data, extra = {}) => socket.send(action + '|' + JSON.stringify({ code: 200, data, ...extra }));
    socket.on('message', (buffer, binary) => {
      if (binary) return handler({ socket, buffer, binary, send });
      const text = buffer.toString(), at = text.indexOf('|'), action = text.slice(0, at), body = text.slice(at + 1);
      if (action === 'Authorization') { assert.equal(body, 'test-token'); send('Authorization', { version: 'test' }); return; }
      if (action === 'ClientInfo') { assert.equal(JSON.parse(body).protobuf, false); return; }
      handler({ socket, action, body: JSON.parse(body), send });
    });
  });
  const task = { id: randomUUID(), backend: 'fns', mode: 'sync', source, server: `http://127.0.0.1:${server.address().port}`, token: 'test-token', vault: 'GeneralFiles', excludes: [], propagateDeletes: false };
  return { source, data, task, run: signal => syncFns(task, data, undefined, signal) };
}
test('uses the JSON wire format and streams binary uploads including empty files', { timeout: 10000 }, async t => {
  const uploaded = new Map(), noteBodies = [], sessions = new Map();
  const f = await setup(t, ({ action, body, send, buffer, binary }) => {
    if (binary) {
      assert.equal(buffer.toString('utf8', 0, 2), '00');
      const id = buffer.toString('utf8', 2, 38), index = buffer.readUInt32BE(38), s = sessions.get(id);
      s.chunks[index] = buffer.subarray(42);
      if (s.chunks.filter(Boolean).length === Math.max(1, Math.ceil(s.size / 3))) { uploaded.set(s.path, Buffer.concat(s.chunks)); send('FileUploadAck', { path: s.path, lastTime: 100 }); }
      return;
    }
    if (action === 'FolderSync') send('FolderSyncEnd', { lastTime: 100 });
    if (action === 'NoteSync') {
      for (const file of body.notes) send('NoteSyncNeedPush', { path: file.path });
      send('NoteSyncEnd', { lastTime: 100, needUploadCount: body.notes.length });
    }
    if (action === 'NoteModify') { noteBodies.push(body); send('NoteModifyAck', { path: body.path }); }
    if (action === 'FileSync') {
      for (const file of body.files) { const id = randomUUID(); sessions.set(id, { ...file, chunks: [] }); send('FileUpload', { ...file, sessionId: id, chunkSize: 3 }); }
      send('FileSyncEnd', { lastTime: 100, needUploadCount: body.files.length });
    }
  });
  const bytes = Buffer.from([0, 255, 128, 1, 2, 0, 255]);
  await fs.writeFile(path.join(f.source, '数据.bin'), bytes); await fs.writeFile(path.join(f.source, 'empty'), ''); await fs.writeFile(path.join(f.source, 'a.md'), '中文 note');
  const encodedMarkdown = Buffer.from([255, 254, 65, 0, 66, 0]); await fs.writeFile(path.join(f.source, 'utf16.md'), encodedMarkdown);
  const result = await f.run(); assert.equal(result.uploaded, 4);
  assert.deepEqual(uploaded.get('数据.bin'), bytes); assert.equal(uploaded.get('empty').length, 0);
  assert.deepEqual(uploaded.get('utf16.md'), encodedMarkdown);
  assert.equal(noteBodies[0].contentHash, rolling('中文 note'));
  assert.ok(Number.isSafeInteger(noteBodies[0].mtime));
  assert.equal((await readJson(path.join(f.data, 'state', f.task.id + '.json'))).times.File, 100);
});
test('downloads out-of-order binary chunks, verifies content, and retains concurrent local edits', { timeout: 10000 }, async t => {
  const bytes = Buffer.from([0, 255, 12, 42, 66, 128, 1]), id = randomUUID();
  const f = await setup(t, ({ action, body, send, socket }) => {
    if (action === 'FolderSync') send('FolderSyncEnd', { lastTime: 200 });
    if (action === 'NoteSync') send('NoteSyncEnd', { lastTime: 200 });
    if (action === 'FileSync') { send('FileSyncUpdate', { path: 'image.bin', contentHash: rolling(bytes), size: bytes.length, mtime: Date.now() }); send('FileSyncEnd', { lastTime: 200, needModifyCount: 1 }); }
    if (action === 'FileChunkDownload') {
      send('FileSyncChunkDownload', { path: body.path, contentHash: rolling(bytes), size: bytes.length, sessionId: id, totalChunks: 3, chunkSize: 3, mtime: Date.now() });
      for (const index of [2, 0, 0, 1]) { const chunk = bytes.subarray(index * 3, (index + 1) * 3), frame = Buffer.alloc(42 + chunk.length); frame.write('00'); frame.write(id, 2); frame.writeUInt32BE(index, 38); chunk.copy(frame, 42); socket.send(frame); }
    }
  });
  await fs.writeFile(path.join(f.source, 'image.bin'), 'local edit');
  const result = await f.run(); assert.equal(result.downloaded, 1); assert.equal(result.conflicts, 1);
  assert.deepEqual(await fs.readFile(path.join(f.source, 'image.bin')), bytes);
  const conflict = (await fs.readdir(f.source)).find(n => n.includes('.conflict-local-'));
  assert.equal(await fs.readFile(path.join(f.source, conflict), 'utf8'), 'local edit');
});
test('batch ACKs and download page ACKs drive the next page without early completion', { timeout: 10000 }, async t => {
  let fileBatches = 0, pageAck = false;
  const f = await setup(t, ({ action, body, send }) => {
    if (action === 'FolderSync') send('FolderSyncEnd', { lastTime: 1 });
    if (action === 'FileSync') {
      fileBatches++;
      if (body.batchIndex + 1 < body.totalBatches) send('FileSyncBatchAck', { batchIndex: body.batchIndex });
      else send('FileSyncEnd', { lastTime: 1 });
    }
    if (action === 'NoteSync') {
      send('NoteSyncEnd', { lastTime: 2, needModifyCount: 2 });
    }
    if (action === 'NoteSyncPageAck') {
      if (body.pageIndex === -1) {
        send('NoteSyncPage', { pageIndex: 0, totalCount: 1, isLast: false });
        send('NoteSyncModify', { path: 'first.md', content: 'first', contentHash: rolling('first') }, { pageIndex: 1 }); return;
      }
      assert.equal(body.pageIndex, 0); pageAck = true;
      send('NoteSyncPage', { pageIndex: 1, totalCount: 1, isLast: true });
      send('NoteSyncModify', { path: 'second.md', content: 'second', contentHash: rolling('second') }, { pageIndex: 2 });
    }
  });
  await Promise.all(Array.from({ length: 105 }, (_, i) => fs.writeFile(path.join(f.source, i + '.bin'), String(i))));
  assert.equal((await f.run()).downloaded, 2); assert.equal(fileBatches, 2); assert.ok(pageAck);
  assert.equal(await fs.readFile(path.join(f.source, 'second.md'), 'utf8'), 'second');
});
test('rejects malicious remote paths and never writes or commits a baseline', { timeout: 10000 }, async t => {
  const f = await setup(t, ({ action, send }) => { if (action === 'NoteSync') send('NoteSyncModify', { path: '../escape.md', content: 'attack' }); });
  await assert.rejects(f.run(), /不安全/);
  assert.equal(await fs.stat(path.join(f.source, '..', 'escape.md')).catch(() => null), null);
  assert.equal(await fs.stat(path.join(f.data, 'state', f.task.id + '.json')).catch(() => null), null);
});
test('auth errors surface immediately without exposing the token or committing state', { timeout: 10000 }, async t => {
  const f = await setup(t, ({ action, send }) => { if (action === 'NoteSync') send('NoteSync', {}, { code: 530, message: 'conflict' }); });
  await assert.rejects(f.run(), /530.*conflict/);
  assert.equal(await fs.stat(path.join(f.data, 'state', f.task.id + '.json')).catch(() => null), null);
});
test('abort closes an idle server connection without committing state', { timeout: 10000 }, async t => {
  const controller = new AbortController();
  const f = await setup(t, ({ action }) => { if (action === 'NoteSync') controller.abort(); });
  await assert.rejects(f.run(controller.signal), /暂停/);
});
test('server URL preserves reverse proxy prefix and forbids credentials and query fragments', () => {
  assert.equal(serverUrl('https://example.com/sync/').pathname, '/sync/api/user/sync');
  for (const url of ['file:///tmp', 'http://user:pass@example.com', 'https://example.com?token=secret']) assert.throws(() => serverUrl(url));
});
test('remembered generic-server capability keeps Markdown binary when the discovery probe is unavailable', { timeout: 10000 }, async t => {
  const id = randomUUID(), payload = Buffer.from('binary Markdown');
  const f = await setup(t, ({ action, body, send, binary, buffer }) => {
    if (action === 'FolderSync') send('FolderSyncEnd', { lastTime: 3 });
    if (action === 'NoteSync') { assert.equal(body.notes.length, 0); send('NoteSyncEnd', { lastTime: 3 }); }
    if (action === 'FileSync') {
      assert.equal(body.files.length, 1); assert.equal(body.files[0].contentHash.length, 64);
      send('FileUpload', { path: 'readme.md', sessionId: id, chunkSize: 1024 });
      send('FileSyncEnd', { lastTime: 3, needUploadCount: 1 });
    }
    if (binary) { assert.deepEqual(buffer.subarray(42), payload); send('FileUploadAck', { path: 'readme.md' }); }
  });
  await fs.mkdir(path.join(f.data, 'state'), { recursive: true });
  await fs.writeFile(path.join(f.data, 'state', f.task.id + '.json'), JSON.stringify({ entries: {}, times: {}, dirs: [], generic: true }));
  await fs.writeFile(path.join(f.source, 'readme.md'), payload);
  assert.equal((await f.run()).uploaded, 1);
  assert.equal((await readJson(path.join(f.data, 'state', f.task.id + '.json'))).generic, true);
});
test('detects upstream path-hash collisions before connecting', { timeout: 10000 }, async t => {
  const f = await setup(t, () => { throw Error('should not connect'); });
  await fs.writeFile(path.join(f.source, 'Aa'), 'one'); await fs.writeFile(path.join(f.source, 'BB'), 'two');
  assert.equal(rolling('Aa'), rolling('BB'));
  await assert.rejects(f.run(), /路径哈希发生冲突/);
});
test('refuses to silently skip a real edit when the upstream content hash collides', { timeout: 10000 }, async t => {
  const f = await setup(t, () => { throw Error('should not connect'); });
  await fs.writeFile(path.join(f.source, 'note.md'), 'BB');
  await fs.mkdir(path.join(f.data, 'state'), { recursive: true });
  await fs.writeFile(path.join(f.data, 'state', f.task.id + '.json'), JSON.stringify({ entries: { 'note.md': { hash: 'old-sha256', contentHash: rolling('Aa'), kind: 'Note' } }, times: {}, dirs: [] }));
  await assert.rejects(f.run(), /完整内容已变化/);
});
