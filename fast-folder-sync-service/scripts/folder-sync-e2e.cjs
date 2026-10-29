// Runs only against a caller-supplied local test deployment. It creates an
// isolated account and libraries, and never accepts production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const base = process.env.FFS_TEST_SERVER || 'http://127.0.0.1:19000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Use a local test server');
const work = path.resolve(process.env.FFS_E2E_WORK || '../../work/service-e2e');
const client = path.resolve(process.env.FFS_CLIENT_ROOT || '../fast-folder-sync/desktop');
const { syncFns } = require(path.join(client, 'lib/fns-sync.cjs'));
const { rolling } = require(path.join(client, 'lib/files.cjs'));
let loginToken;
const hash = data => createHash('sha256').update(data).digest('hex');
async function api(route, method = 'GET', body, query = {}, token = loginToken) {
  const target = new URL('/api' + route, base);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
  const headers = { 'x-client': 'WebGui' }; if (token) headers.token = token;
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch(target, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!result.status) throw Error(route + ': ' + JSON.stringify(result));
  return result.data;
}
async function upload(vault, name, bytes) {
  const form = new FormData(); form.set('vault', vault); form.set('path', name); form.set('file', new Blob([bytes]), path.basename(name)); form.set('mtime', String(Date.now()));
  return api('/drive/upload', 'POST', form);
}
async function download(vault, entry) {
  const url = new URL('/api/drive/content', base); url.search = new URLSearchParams({ vault, path: entry.path, kind: entry.kind, pathHash: entry.pathHash });
  const response = await fetch(url, { headers: { token: loginToken, 'x-client': 'WebGui' } });
  assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer());
}
(async () => {
  await fs.mkdir(work, { recursive: true });
  let ready = false;
  for (let i = 0; i < 40; i++) { try { const response = await fetch(base + '/api/health'); if (response.ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 500)); }
  if (!ready) throw Error('Local test server did not become ready');
  const credentials = process.env.FFS_E2E_USER_FILE ? JSON.parse(await fs.readFile(process.env.FFS_E2E_USER_FILE, 'utf8')) : { username: 'demo_' + randomUUID().slice(0, 8), email: 'local-' + randomUUID().slice(0, 8) + '@example.com', password: randomUUID() + '-Aa1!' };
  let user = process.env.FFS_E2E_USER_FILE ? await api('/user/login', 'POST', { credentials: credentials.email, password: credentials.password }) : await api('/user/register', 'POST', { ...credentials, confirmPassword: credentials.password });
  if (!user.token) user = await api('/user/login', 'POST', { credentials: credentials.email, password: credentials.password });
  loginToken = user.token; assert.ok(loginToken);
  await fs.writeFile(path.join(work, 'browser-user.json'), JSON.stringify({ ...credentials, user }, null, 2));
  const report = { assertions: [], startedAt: new Date().toISOString() };
  async function check(name, fn) { await fn(); report.assertions.push(name); console.log('PASS', name); }
  const library = process.env.FFS_TEST_LIBRARY || '工作资料'; report.fixtureLibrary = library;
  await check('authenticated generic file-library creation', async () => { const existing = await api('/drive/spaces'); for (const vault of [library, '家庭相册', '项目归档']) if (!existing.some(s => s.name === vault)) await api('/drive/spaces', 'POST', { vault }); });
  const fixtures = new Map([
    ['文档/项目说明.md', Buffer.from('# Project\n文件同步验证。\n')],
    ['文档/年度计划.txt', Buffer.from('Keep your files in one place.\n')],
    ['素材/原始数据.bin', Buffer.from([0, 255, 128, 1, 0, 13, 10])],
    ['素材/UTF16.md', Buffer.from([255, 254, 65, 0, 66, 0])],
    ['空文件', Buffer.alloc(0)]
    ,['配置/settings.json', Buffer.from('{"status":false,"code":500,"name":"real file"}')]
  ]);
  await check('streaming HTTP upload uses full SHA-256 for arbitrary files and empty files', async () => {
    for (const [name, bytes] of fixtures) { const entry = await upload(library, name, bytes); assert.equal(entry.contentHash, hash(bytes)); }
  });
  await check('legacy text resources appear as generic files without exposing their content in the list', async () => {
    await api('/note', 'POST', { vault: library, path: '文档/使用说明.md', content: '兼容已有文本文件。', contentHash: rolling('兼容已有文本文件。'), ctime: Date.now(), mtime: Date.now() });
    const data = await api('/drive/entries', 'GET', undefined, { vault: library, pageSize: 30 });
    assert.equal(data.pager.totalRows, fixtures.size + 1); assert.equal(data.list.find(x => x.path === '文档/使用说明.md').kind, 'text');
    assert.ok(!('content' in data.list[0]));
  });
  await check('authenticated byte-exact HTTP downloads', async () => {
    const data = await api('/drive/entries', 'GET', undefined, { vault: library, pageSize: 30 });
    for (const [name, bytes] of fixtures) assert.deepEqual(await download(library, data.list.find(x => x.path === name)), bytes);
  });
  const issued = await api('/token', 'POST', { clientType: 'FastFolderSync', protocol: 'ws', client: 'FastFolderSync', function: '*', expiredDays: 30, vaults: library });
  const sourceA = path.join(work, 'device-a'), sourceB = path.join(work, 'device-b'), dataA = path.join(work, 'state-a'), dataB = path.join(work, 'state-b');
  await fs.mkdir(sourceA); await fs.mkdir(sourceB);
  await fs.writeFile(path.join(sourceA, 'desktop.txt'), 'Desktop version 1');
  const large = Buffer.alloc(26 * 1024 * 1024, 2); await fs.writeFile(path.join(sourceA, 'large.bin'), large);
  const makeTask = source => ({ id: randomUUID(), backend: 'fns', mode: 'sync', source, server: base, vault: library, token: issued.token, excludes: [], propagateDeletes: false });
  const taskA = makeTask(sourceA), taskB = makeTask(sourceB);
  await check('real WebSocket desktop upload/download against the modified Go service', async () => {
    report.deviceA = await syncFns(taskA, dataA);
    report.deviceB = await syncFns(taskB, dataB);
    assert.equal(await fs.readFile(path.join(sourceB, 'desktop.txt'), 'utf8'), 'Desktop version 1');
    for (const [name, bytes] of fixtures) assert.deepEqual(await fs.readFile(path.join(sourceB, name)), bytes);
    assert.equal(await fs.readFile(path.join(sourceB, '文档/使用说明.md'), 'utf8'), '兼容已有文本文件。');
  });
  await check('large-file edits outside legacy sample regions synchronize with full SHA-256', async () => {
    large[7 * 1024 * 1024] = 77; await fs.writeFile(path.join(sourceA, 'large.bin'), large);
    await syncFns(taskA, dataA); await syncFns(taskB, dataB);
    assert.equal(hash(await fs.readFile(path.join(sourceB, 'large.bin'))), hash(large));
  });
  await check('colliding file paths retain separate bytes and stable keys across two devices and deletion', async () => {
    const names = ['同步/work/go-build/5a/5a7aa464a559d484fdf9c9f3b2b9fc6f4722935a59e2dbda9d23470e1b8c9cec-a', '灵境/lingjing-desktop/target/release/deps/indexmap-1d341a9dcad03b31.d'];
    assert.equal(rolling(names[0]), rolling(names[1]));
    await upload(library, 'Aa', Buffer.from('existing legacy bytes'));
    const payloads = new Map([[names[0], Buffer.from('Go cache bytes')], [names[1], Buffer.from('Rust cache bytes')], ['BB', Buffer.from('new colliding bytes')]]);
    for (const [name, bytes] of payloads) { await fs.mkdir(path.dirname(path.join(sourceA, name)), { recursive: true }); await fs.writeFile(path.join(sourceA, name), bytes); }
    await syncFns(taskA, dataA); await syncFns(taskB, dataB);
    let entries = (await api('/drive/entries', 'GET', undefined, { vault: library, pageSize: 100 })).list;
    for (const [name, bytes] of payloads) {
      const matches = entries.filter(entry => entry.path === name); assert.equal(matches.length, 1, name);
      assert.match(matches[0].pathHash, /^[0-9a-f]{64}$/);
      assert.deepEqual(await download(library, matches[0]), bytes);
      assert.deepEqual(await fs.readFile(path.join(sourceB, name)), bytes);
    }
    assert.equal(entries.find(entry => entry.path === 'Aa').pathHash, rolling('Aa'));
    assert.equal(await fs.readFile(path.join(sourceB, 'Aa'), 'utf8'), 'existing legacy bytes');
    const stable = new Map(entries.map(entry => [entry.path, entry.pathHash]));
    const unchanged = await syncFns(taskA, dataA); assert.equal(unchanged.uploaded, 0); assert.equal(unchanged.downloaded, 0);
    await fs.writeFile(path.join(sourceA, names[1]), 'updated Rust bytes');
    await syncFns(taskA, dataA); await syncFns(taskB, dataB);
    assert.equal(await fs.readFile(path.join(sourceB, names[1]), 'utf8'), 'updated Rust bytes');
    await fs.unlink(path.join(sourceA, names[0]));
    await syncFns({ ...taskA, propagateDeletes: true }, dataA); await syncFns({ ...taskB, propagateDeletes: true }, dataB);
    assert.equal(await fs.stat(path.join(sourceB, names[0])).catch(() => null), null);
    assert.equal(await fs.readFile(path.join(sourceB, names[1]), 'utf8'), 'updated Rust bytes');
    entries = (await api('/drive/entries', 'GET', undefined, { vault: library, pageSize: 100 })).list;
    assert.equal(entries.find(entry => entry.path === names[1]).pathHash, stable.get(names[1]));
  });
  await check('browser deletion and restoration preserve file bytes', async () => {
    const entry = (await api('/drive/entries', 'GET', undefined, { vault: library, keyword: '原始数据' })).list[0];
    await api('/drive/entry', 'DELETE', undefined, { vault: library, path: entry.path, pathHash: entry.pathHash, kind: entry.kind });
    const deleted = await api('/drive/entries', 'GET', undefined, { vault: library, isRecycle: true }); assert.ok(deleted.list.some(x => x.path === entry.path));
    await api('/drive/entry/restore', 'PUT', { vault: library, path: entry.path, pathHash: entry.pathHash }, { kind: entry.kind });
    assert.deepEqual(await download(library, entry), fixtures.get(entry.path));
  });
  await check('console endpoints reject anonymous access and device-token header spoofing', async () => {
    for (const headers of [{}, { token: issued.token, 'x-client': 'WebGui' }]) {
      const result = await fetch(base + '/api/drive/spaces', { headers }).then(r => r.json()); assert.equal(result.status, false);
    }
  });
  await check('local backup task executes and produces an actual archive', async () => {
    const storage = new FormData(); for (const [key, value] of Object.entries({ type: 'localfs', customPath: 'folder-backups', accessUrlPrefix: base, isEnabled: '1' })) storage.set(key, value);
    await api('/storage/validate', 'POST', storage); const target = await api('/storage', 'POST', storage);
    const config = await api('/backup/config', 'POST', { vault: library, type: 'full', storageIds: JSON.stringify([target.id]), isEnabled: true, cronStrategy: 'custom', cronExpression: '0 0 1 1 *', retentionDays: 30, includeVaultName: true, passwordMode: 0 });
    await api('/backup/execute', 'POST', { id: config.id });
    let history;
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 500)); const result = await api('/backup/historys', 'GET', undefined, { configId: config.id }); history = result.list?.[0]; if (history?.status === 2 || history?.status === 3) break; }
    assert.equal(history?.status, 2, history?.message); assert.ok(history.fileCount >= fixtures.size); assert.ok(history.fileSize > 0); report.backup = { fileCount: history.fileCount, fileSize: history.fileSize, status: history.status };
  });
  report.finishedAt = new Date().toISOString(); report.passed = report.assertions.length;
  await fs.writeFile(path.join(work, 'report.json'), JSON.stringify(report, null, 2)); console.log('Passed', report.passed, 'integration checks');
})().catch(async error => { await fs.mkdir(work, { recursive: true }); await fs.writeFile(path.join(work, 'error.json'), JSON.stringify({ error: error.message, stack: error.stack }, null, 2)); console.error(error.message); process.exitCode = 1; });
