const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fs, scan, digest, readJson, replaceFromFile, removeFile } = require('../../lib/files.cjs');
const { syncLocal } = require('../../lib/local-sync.cjs');

(async () => {
  assert.ok(process.versions.electron, 'This check must use the Electron runtime');
  const root = process.argv[2], source = path.join(root, 'source'), target = path.join(root, 'target'), data = path.join(root, 'data');
  const archive = path.join(source, 'tm-patched.asar');
  // Confirm this fixture exercises Electron's ASAR interception.
  assert.ok((await require('node:fs/promises').lstat(archive)).isDirectory());
  const original = await require('original-fs').promises.readFile(archive);
  const expected = createHash('sha256').update(original).digest('hex');
  assert.equal(await digest(archive), expected);
  await fs.mkdir(target);
  await fs.mkdir(path.join(source, 'real-directory.asar'));
  await fs.writeFile(path.join(source, 'real-directory.asar', 'nested.txt'), 'real directory');
  const snapshot = await scan(source, [], true, undefined, { binaryOnly: true, strongFiles: true });
  assert.equal(snapshot.files['tm-patched.asar'].contentHash, expected);
  assert.equal(snapshot.files['tm-patched.asar'].size, original.length);
  assert.ok(snapshot.files['real-directory.asar/nested.txt']);
  assert.ok(!snapshot.files['tm-patched.asar/file.txt']);
  const task = { id: 'asar', source, target, mode: 'backup', excludes: [], propagateDeletes: true };
  await syncLocal(task, data);
  const destination = path.join(target, 'tm-patched.asar');
  assert.deepEqual(await fs.readFile(destination), original);
  assert.equal((await syncLocal(task, data)).uploaded, 0);
  await fs.appendFile(path.join(root, 'payload', 'file.txt'), ' updated');
  // A byte change in an ASAR must be copied as a whole file, with history.
  await fs.appendFile(archive, Buffer.from('extra bytes'));
  await syncLocal(task, data);
  assert.deepEqual(await fs.readFile(destination), await fs.readFile(archive));
  const historyDir = path.join(data, 'history', task.id);
  const metadata = (await fs.readdir(historyDir)).find(name => name.endsWith('.json'));
  const saved = await readJson(path.join(historyDir, metadata));
  assert.deepEqual(await fs.readFile(path.join(historyDir, saved.id + '.bin')), original);
  await replaceFromFile(target, 'tm-patched.asar', path.join(historyDir, saved.id + '.bin'), { historyDir, side: 'target' });
  assert.deepEqual(await fs.readFile(destination), original);
  await removeFile(target, 'tm-patched.asar', { historyDir, side: 'target', expectedHash: expected });
  assert.equal(await fs.lstat(destination).catch(() => null), null);
  assert.notEqual(process.noAsar, true, 'Application ASAR loading must remain enabled');
  console.log('Electron ASAR regression passed: raw hashes, scan, real .asar directories, backup, no-op, overwrite history, restore and deletion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
