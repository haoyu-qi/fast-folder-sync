const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { rolling } = require('../lib/files.cjs');
const { filePathKeys, remoteFilePathKeys } = require('../lib/path-keys.cjs');

test('disambiguates real reported paths and retains existing legacy and saved keys', () => {
  const a = '同步/work/go-build/5a/5a7aa464a559d484fdf9c9f3b2b9fc6f4722935a59e2dbda9d23470e1b8c9cec-a';
  const b = '灵境/lingjing-desktop/target/release/deps/indexmap-1d341a9dcad03b31.d';
  assert.equal(rolling(a), rolling(b));
  const keys = filePathKeys([a, b, 'ordinary.txt'], {}, new Map());
  assert.notEqual(keys.get(a), keys.get(b));
  assert.match(keys.get(a), /^[0-9a-f]{64}$/); assert.match(keys.get(b), /^[0-9a-f]{64}$/);
  assert.equal(keys.get('ordinary.txt'), rolling('ordinary.txt'));
  const existing = filePathKeys([a, b], {}, new Map([[a, rolling(a)]]));
  assert.equal(existing.get(a), rolling(a)); assert.match(existing.get(b), /^[0-9a-f]{64}$/);
  assert.equal(filePathKeys([b], { [b]: { kind: 'File', pathHash: keys.get(b) } }, new Map()).get(b), keys.get(b));
  // A new device with only the second path must consider the remote-only owner.
  assert.notEqual(filePathKeys([b], {}, new Map([[a, rolling(a)]])).get(b), rolling(a));
  assert.throws(() => filePathKeys([], {}, new Map([['Aa', '2112'], ['BB', '2112']])), /路径标识冲突/);
});

test('reads paged metadata with WS-only auth, including deleted keys, without requesting file bytes', { timeout: 10000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const requests = [], progress = [];
  server.on('connection', socket => socket.on('message', buffer => {
    const text = buffer.toString(), at = text.indexOf('|'), action = text.slice(0, at);
    requests.push(action);
    const send = (action, data, extra) => socket.send(action + '|' + JSON.stringify({ code: 200, data, ...extra }));
    if (action === 'Authorization') { assert.equal(text.slice(at + 1), 'ws-only-token'); send(action, {}); return; }
    const body = JSON.parse(text.slice(at + 1));
    if (action === 'FileSync') { assert.deepEqual(body.files, []); send('FileSyncEnd', { needModifyCount: 2, needDeleteCount: 1 }); return; }
    assert.equal(action, 'FileSyncPageAck');
    const page = body.pageIndex + 1;
    send('FileSyncPage', { pageIndex: page, totalCount: page ? 1 : 2, isLast: page === 1 });
    if (page === 0) { send('FileSyncUpdate', { path: 'Aa', pathHash: '2112' }, { pageIndex: 1 }); send('FileSyncUpdate', { path: 'BB', pathHash: 'sha-bb' }, { pageIndex: 1 }); }
    else send('FileSyncDelete', { path: 'deleted.txt', pathHash: 'deleted-key' }, { pageIndex: 2 });
  }));
  const keys = await remoteFilePathKeys({ vault: 'work', token: 'ws-only-token' }, `ws://127.0.0.1:${server.address().port}`, undefined, event => progress.push(event));
  assert.deepEqual([...keys], [['Aa', '2112'], ['BB', 'sha-bb'], ['deleted.txt', 'deleted-key']]);
  assert.deepEqual(requests, ['Authorization', 'FileSync', 'FileSyncPageAck', 'FileSyncPageAck']);
  assert.equal(progress.at(-1).checked, 3);
});

test('metadata discovery aborts promptly without sending an upload or download request', { timeout: 10000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const controller = new AbortController();
  server.on('connection', socket => socket.once('message', () => controller.abort()));
  await assert.rejects(remoteFilePathKeys({ vault: 'work', token: 'test' }, `ws://127.0.0.1:${server.address().port}`, controller.signal), /暂停/);
});
