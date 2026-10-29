const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const os = require('node:os');
const { fs, path } = require('../lib/files.cjs');
const { parse, bind } = require('../service-config.js');

test('complete configuration preserves proxy prefix and rejects malformed or credential-bearing URLs', () => {
  assert.deepEqual(parse(JSON.stringify({ server: 'https://sync.test/private/', vault: ' 工作 ', token: ' secret ' })), { server: 'https://sync.test/private', vault: '工作', token: 'secret' });
  for (const text of ['secret', 'null', '[]', '{}', '{"server":"https://sync.test","vault":"a"}', ...['file:///tmp', 'https://user:pass@sync.test', 'https://sync.test/?token=x', 'https://sync.test/#x'].map(server => JSON.stringify({ server, vault: 'a', token: 'x' }))]) assert.throws(() => parse(text));
});

test('saved connection creates an independent task, encrypts its token and prevents sending it to another server', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-connection-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of ['data', 'first', 'second', 'third']) await fs.mkdir(path.join(dir, name));
  const main = path.resolve(__dirname, '../main.cjs'), nativeRequire = createRequire(main);
  const context = vm.createContext({ require: name => name === 'electron' ? {
    app: { requestSingleInstanceLock: () => false, quit() {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('sealed:' + value) }
  } : nativeRequire(name), module: { exports: {} }, process, Buffer, URL, __dirname: path.dirname(main) });
  vm.runInContext(await fs.readFile(main, 'utf8') + '\nmodule.exports = { saveTask, snapshot, init(dir) { dataDir = dir; } };', context);
  const api = context.module.exports;
  api.init(path.join(dir, 'data'));
  const original = { name: '工作', source: path.join(dir, 'first'), backend: 'fns', mode: 'sync', server: 'https://sync.test/private', vault: '工作', token: 'private-token', interval: 30, enabled: false };
  const first = await api.saveTask(original);
  const second = await api.saveTask({ ...original, name: '照片', source: path.join(dir, 'second'), vault: '照片', token: '', connectionTaskId: first.id });
  assert.equal(second.hasToken, true); assert.equal(second.vault, '照片');
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'data/tasks.json'), 'utf8'));
  assert.equal(disk.length, 2); assert.equal(disk[1].encryptedToken, Buffer.from('sealed:private-token').toString('base64'));
  assert.ok(!JSON.stringify(api.snapshot()).includes('private-token'));
  assert.ok(!('connectionTaskId' in disk[1]));
  await assert.rejects(api.saveTask({ ...original, source: path.join(dir, 'third'), vault: '其它', token: '', connectionTaskId: first.id, server: 'https://other.test' }), /服务地址不一致/);
  await assert.rejects(api.saveTask({ ...original, source: path.join(dir, 'third'), vault: '其它', token: '', connectionTaskId: 'missing' }), /不可用/);
  await assert.rejects(api.saveTask({ ...original, source: path.join(dir, 'third'), token: '', connectionTaskId: first.id }), /只能绑定一个/);
  // Each task owns its encrypted credential; removing the original is safe.
  assert.equal(second.hasToken, true);
});

test('form reuses the recent server while keeping a new vault blank and allows manual import', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', classList: { toggle() {} }, addEventListener(type, fn) { this[type] = fn; }, replaceChildren(...options) { this.options = options; this.value = options[0].value; } });
    return elements.get(id);
  };
  global.document = { getElementById: element };
  global.Option = function (label, value) { return { label, value }; };
  const tasks = [{ id: 'one', backend: 'fns', name: '工作', server: 'https://sync.test', hasToken: true }];
  let editing = null, form;
  form = bind({ getTasks: () => tasks, getEditing: () => editing, updateBackend: () => form.update() });
  form.reset(null); form.update();
  assert.equal(element('server').value, tasks[0].server);
  assert.equal(element('vault').value, '');
  assert.equal(element('token').required, false); assert.equal(element('server').disabled, true);
  assert.equal(form.connectionTaskId(), 'one');
  element('connection-config').value = JSON.stringify({ server: 'https://new.test', vault: '新库', token: 'new-secret' });
  element('import-config').click();
  assert.equal(form.connectionTaskId(), ''); assert.equal(element('server').disabled, false);
  assert.equal(element('token').value, 'new-secret'); assert.equal(element('connection-config').value, '');
  editing = tasks[0]; form.reset(editing); form.update();
  assert.equal(form.connectionTaskId(), ''); assert.equal(element('token').required, false);
  delete global.document; delete global.Option;
});
