const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { fs, path, scan, safePath, excluded, readJson, wireHash, rolling, replaceFromFile } = require('../lib/files.cjs');
const { syncLocal } = require('../lib/local-sync.cjs');

async function fixture(t, mode = 'backup', propagateDeletes = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'target'), data = path.join(root, 'data');
  await fs.mkdir(source); await fs.mkdir(target);
  const task = { id: 'test', source, target, mode, propagateDeletes, excludes: [] };
  return { root, source, target, data, task, run: signal => syncLocal(task, data, undefined, signal) };
}
test('backs up arbitrary binary, Unicode paths, hidden files, empty files and empty folders; no-op second round', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.source, '资料'));
  await fs.mkdir(path.join(f.source, '空目录'));
  const content = Buffer.from([0, 255, 1, 13, 10, 128, 42]);
  await fs.writeFile(path.join(f.source, '资料', '数据.bin'), content);
  await fs.writeFile(path.join(f.source, '.settings'), 'hidden');
  await fs.writeFile(path.join(f.source, 'empty'), '');
  const first = await f.run(); assert.equal(first.uploaded, 3);
  assert.deepEqual(await fs.readFile(path.join(f.target, '资料', '数据.bin')), content);
  assert.equal((await fs.stat(path.join(f.target, '空目录'))).isDirectory(), true);
  assert.equal((await f.run()).uploaded, 0);
});
test('backs up overwritten and removed target bytes and can restore from history', async t => {
  const f = await fixture(t, 'backup', true);
  await fs.writeFile(path.join(f.source, 'report.docx'), 'version 1'); await f.run();
  await fs.writeFile(path.join(f.source, 'report.docx'), 'version 2'); await f.run();
  const folder = path.join(f.data, 'history', 'test');
  const names = (await fs.readdir(folder)).filter(n => n.endsWith('.json'));
  assert.equal(names.length, 1);
  const entry = await readJson(path.join(folder, names[0]));
  assert.equal(await fs.readFile(path.join(folder, entry.id + '.bin'), 'utf8'), 'version 1');
  await fs.unlink(path.join(f.source, 'report.docx')); assert.equal((await f.run()).deleted, 1);
  assert.equal(await fs.stat(path.join(f.target, 'report.docx')).catch(() => null), null);
  await replaceFromFile(f.target, entry.path, path.join(folder, entry.id + '.bin'), { historyDir: folder, side: 'target', expectedHash: null });
  assert.equal(await fs.readFile(path.join(f.target, entry.path), 'utf8'), 'version 1');
});
test('default backup retains deleted source files in target and preserves target-only files', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.source, 'a'), 'one'); await f.run();
  await fs.unlink(path.join(f.source, 'a')); await fs.writeFile(path.join(f.target, 'extra'), 'keep'); await f.run();
  assert.equal(await fs.readFile(path.join(f.target, 'a'), 'utf8'), 'one');
  assert.equal(await fs.readFile(path.join(f.target, 'extra'), 'utf8'), 'keep');
});
test('two-way modifications and concurrent conflicts retain both versions without conflict storms', async t => {
  const f = await fixture(t, 'sync'); await fs.writeFile(path.join(f.source, 'a.txt'), 'base'); await f.run();
  await fs.writeFile(path.join(f.target, 'a.txt'), 'target edit'); assert.equal((await f.run()).downloaded, 1);
  assert.equal(await fs.readFile(path.join(f.source, 'a.txt'), 'utf8'), 'target edit');
  await fs.writeFile(path.join(f.source, 'a.txt'), 'source conflict'); await fs.writeFile(path.join(f.target, 'a.txt'), 'target conflict');
  assert.equal((await f.run()).conflicts, 1);
  assert.equal(await fs.readFile(path.join(f.target, 'a.txt'), 'utf8'), 'source conflict');
  const conflict = (await fs.readdir(f.source)).find(n => n.includes('.conflict-'));
  assert.equal(await fs.readFile(path.join(f.source, conflict), 'utf8'), 'target conflict');
  assert.equal((await f.run()).conflicts, 0);
  assert.equal(await fs.readFile(path.join(f.target, conflict), 'utf8'), 'target conflict');
  assert.equal((await f.run()).uploaded, 0);
});
test('delete vs edit retains the edit; unchanged peer propagates explicit deletion both directions', async t => {
  const f = await fixture(t, 'sync', true);
  await fs.writeFile(path.join(f.source, 'a'), 'base'); await f.run();
  await fs.unlink(path.join(f.source, 'a')); await fs.writeFile(path.join(f.target, 'a'), 'edited');
  await f.run(); assert.equal(await fs.readFile(path.join(f.source, 'a'), 'utf8'), 'edited');
  await fs.unlink(path.join(f.target, 'a')); assert.equal((await f.run()).deleted, 1);
  assert.equal(await fs.stat(path.join(f.source, 'a')).catch(() => null), null);
  await fs.writeFile(path.join(f.source, 'b'), 'base'); await f.run(); await fs.unlink(path.join(f.source, 'b'));
  assert.equal((await f.run()).deleted, 1);
  assert.equal(await fs.stat(path.join(f.target, 'b')).catch(() => null), null);
});
test('new exclusion rules never turn previously synced files into deletion intents', async t => {
  const f = await fixture(t, 'sync', true);
  await fs.writeFile(path.join(f.source, 'private.txt'), 'keep'); await f.run();
  f.task.excludes = ['*.txt']; await f.run();
  assert.equal(await fs.readFile(path.join(f.target, 'private.txt'), 'utf8'), 'keep');
  assert.ok(excluded('deep/node_modules/a.js'));
  assert.ok(excluded('cache/sub/a', ['cache/**']));
});
test('missing root, nested target, and corrupted state fail before mutating target files', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.source, 'a'), 'base'); await f.run();
  await fs.rename(f.source, f.source + '-offline');
  await assert.rejects(f.run(), /ENOENT/); assert.equal(await fs.readFile(path.join(f.target, 'a'), 'utf8'), 'base');
  await fs.rename(f.source + '-offline', f.source);
  const original = f.task.target; f.task.target = path.join(f.source, 'nested'); await fs.mkdir(f.task.target);
  await assert.rejects(f.run(), /嵌套/); f.task.target = original;
  await fs.writeFile(path.join(f.data, 'state', 'test.json'), '{corrupted');
  await assert.rejects(f.run(), /无法读取状态/);
});
test('aborted run never commits a new baseline', async t => {
  const f = await fixture(t); const controller = new AbortController(); controller.abort();
  await fs.writeFile(path.join(f.source, 'a'), 'base');
  await assert.rejects(f.run(controller.signal));
  assert.equal(await fs.stat(path.join(f.data, 'state', 'test.json')).catch(() => null), null);
});
test('path traversal, Windows aliases, and symlink escapes are blocked', async t => {
  const f = await fixture(t);
  for (const name of ['../outside', '/absolute', 'a\\b', 'C:/windows', 'a/../b', 'nul.txt', 'trailing.', 'a//b']) await assert.rejects(safePath(f.source, name));
  try { await fs.symlink(f.target, path.join(f.source, 'escape'), 'junction'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.diagnostic('junction not permitted in this environment'); return; } throw e; }
  await assert.rejects(safePath(f.source, 'escape/secret'), /符号链接/);
  assert.equal(Object.keys((await scan(f.source)).files).length, 0);
});
test('wire hashes match upstream UTF-16 string hashing and byte hashing', async t => {
  const f = await fixture(t);
  assert.equal(rolling('abc'), '96354'); assert.equal(rolling(Buffer.from('abc')), '96354');
  const file = path.join(f.source, 'a.md'); await fs.writeFile(file, '中文');
  assert.equal(await wireHash(file, 6), String(((20013 * 31) + 25991) | 0));
});
