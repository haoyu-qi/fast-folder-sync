const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { fs, path } = require('../lib/files.cjs');
const { AgentService } = require('../lib/agent-service.cjs');
const { hash, START, END, stripManaged, ruleWarnings } = require('../lib/agent-adapters.cjs');
const { summarize, endpoint } = require('../lib/agent-summary.cjs');

async function put(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function device(name) {
    const home = path.join(root, name, 'home'), data = path.join(root, name, 'app');
    await fs.mkdir(home, { recursive: true });
    const service = await new AgentService(data, { home, seal: s => Buffer.from(s).toString('base64'), unseal: s => Buffer.from(s, 'base64').toString(), ...options }).init();
    return { service, home, data };
  }
  return { root, device };
}
async function project(service, name = '网站') { await service.project({ name }); return service.projects().find(p => p.name === name).id; }
async function importAll(service, scope) {
  const candidates = await service.discover(); await service.select({ sources: candidates.map(c => ({ id: c.id, scope: c.scope || scope })) });
  await service.import(); return service.store.entries().filter(e => e.type === 'memory');
}

test('discovers three native memory formats, imports selected sources, skips credentials, no-op reimport', async t => {
  const f = await fixture(t), { service: s, home } = await f.device('a'), id = await project(s);
  await put(path.join(home, '.codex/memories/MEMORY.md'), '发布前检查 staging');
  await put(path.join(home, '.claude/projects/path-a/memory/MEMORY.md'), '偏好使用 pnpm');
  await put(path.join(home, '.zcode/cli/memories/projects/path-a/memory/fact.md'), '回归测试在周五进行');
  await put(path.join(home, '.codex/AGENTS.md'), '禁止自动提交');
  await put(path.join(home, '.claude/projects/path-a/memory/secret.md'), 'api_key=super-secret-private-key');
  await put(path.join(home, '.codex/auth.json'), '{"access_token":"not-collected"}');
  const entries = await importAll(s, id);
  assert.equal(entries.length, 4); assert.deepEqual(new Set(entries.map(e => e.value.source.agent)), new Set(['codex', 'claude', 'zcode']));
  const count = s.store.events.size; await s.import(); assert.equal(s.store.events.size, count);
  assert.match((await s.state()).issues.join('\n'), /疑似凭据/);
  assert.ok(!JSON.stringify([...s.store.events.values()]).includes('super-secret'));
});

test('two isolated computers sync projects and memories, render all tools, map paths, preserve rules and avoid loops', async t => {
  const f = await fixture(t), a = await f.device('a'), b = await f.device('b'), id = await project(a.service);
  const shared = path.join(f.root, 'shared'), pa = path.join(f.root, 'project-a'), pb = path.join(f.root, 'project-b');
  await fs.mkdir(shared); await fs.mkdir(pa); await fs.mkdir(pb);
  await put(path.join(pa, 'AGENTS.md'), '禁止修改未关联文件\n');
  await a.service.bind({ id, folder: pa, agents: ['codex', 'claude', 'zcode'] });
  await put(path.join(a.home, '.claude/projects/hash-a/memory/memo.md'), '构建目录是 ' + pa + '\n不要跳过验证');
  await importAll(a.service, id);
  await a.service.connection({ backend: 'local', target: shared }); await b.service.connection({ backend: 'local', target: shared });
  await a.service.cycle(); await b.service.cycle();
  assert.equal(b.service.projects()[0].id, id);
  await b.service.bind({ id, folder: pb, agents: ['codex', 'claude', 'zcode'] }); await b.service.publish();
  const entry = b.service.store.entries().find(e => e.type === 'memory' && e.value.kind === 'memory');
  const topic = await fs.readFile(path.join(pb, '.agent-sync/topics', entry.entity + '.md'), 'utf8');
  assert.ok(topic.includes(await fs.realpath(pb))); assert.ok(!topic.includes(pa));
  for (const name of ['AGENTS.md', 'CLAUDE.md']) assert.match(await fs.readFile(path.join(pb, name), 'utf8'), /agent-sync:start/);
  assert.equal(stripManaged(await fs.readFile(path.join(pa, 'AGENTS.md'), 'utf8')).trim(), '禁止修改未关联文件');
  await a.service.cycle(); await b.service.cycle();
  const before = b.service.store.events.size; await importAll(b.service, id); assert.equal(b.service.store.events.size, before);
  assert.equal(b.service.config.sync.uploaded, 0); assert.equal(b.service.config.sync.downloaded, 0);
  assert.equal(b.service.config.delivery[id].phase, 'success');
  await b.service.disconnect({ id });
  assert.ok(!(await fs.readFile(path.join(pb, 'AGENTS.md'), 'utf8')).includes(START));
  assert.deepEqual(await fs.readdir(path.join(pb, '.agent-sync/topics')), []);
});

test('concurrent edits retain both branches, deletion dominates stale updates, explicit restore converges', async t => {
  const f = await fixture(t), a = await f.device('a'), b = await f.device('b'), id = await project(a.service);
  const shared = path.join(f.root, 'shared'); await fs.mkdir(shared);
  await put(path.join(a.home, '.codex/memories/MEMORY.md'), '原始经验');
  const [entry] = await importAll(a.service, id);
  for (const d of [a, b]) await d.service.connection({ backend: 'local', target: shared });
  await a.service.cycle(); await b.service.cycle();
  await a.service.edit({ entity: entry.entity, text: '电脑 A 修改' }); await b.service.edit({ entity: entry.entity, text: '电脑 B 修改' });
  await a.service.cycle(); await b.service.cycle(); await a.service.cycle();
  assert.equal(a.service.store.get(entry.entity).conflict, true);
  assert.deepEqual(new Set(a.service.store.heads(entry.entity).map(h => h.value.text)), new Set(['电脑 A 修改', '电脑 B 修改']));
  await a.service.edit({ entity: entry.entity, deleted: true });
  await b.service.edit({ entity: entry.entity, text: '离线的旧设备修改' });
  await a.service.cycle(); await b.service.cycle(); await a.service.cycle();
  assert.equal(a.service.store.get(entry.entity).deleted, true);
  await a.service.import(); assert.equal(a.service.store.get(entry.entity).deleted, true);
  await a.service.restore({ entity: entry.entity, revision: entry.id });
  await a.service.cycle(); await b.service.cycle();
  assert.equal(b.service.store.get(entry.entity).deleted, false);
  assert.equal(b.service.store.get(entry.entity).conflict, false);
  assert.equal(b.service.store.get(entry.entity).value.text, '原始经验');
});

test('model failure preserves original and sync; summaries protect constraints and never compress rules', async t => {
  const f = await fixture(t, { fetcher: async () => { throw Error('secret must not appear'); } });
  const { service: s, home } = await f.device('a'), id = await project(s);
  await put(path.join(home, '.codex/memories/MEMORY.md'), '不要删除生产数据\n使用测试环境');
  await importAll(s, id);
  await s.model({ base: 'https://example.com/v1', model: 'my-model', key: 'private-model-token' });
  await s.cycle(); const entry = s.store.entries().find(e => e.type === 'memory');
  assert.equal(entry.value.text, '不要删除生产数据\n使用测试环境'); assert.equal(entry.value.summary, undefined);
  assert.match((await s.state()).issues.join(''), /服务不可用/);
  assert.ok(!JSON.stringify(await s.state()).includes('private-model-token'));
  let invoked = false;
  const rule = await summarize({ kind: 'rule', text: '禁止修改' }, {}, async () => { invoked = true; });
  assert.equal(invoked, false); assert.equal(rule.text, '禁止修改');
  const result = await summarize(entry.value, { base: 'http://127.0.0.1:1234/v1', model: 'local' }, async (_url, request) => {
    assert.equal(JSON.parse(request.body).messages[1].content, entry.value.text);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '使用测试环境' } }] }) };
  });
  assert.match(result.text, /不要删除生产数据/); assert.equal(result.sourceHash, hash(entry.value.text));
  assert.throws(() => endpoint('http://example.com/v1'), /HTTPS/);
});

test('project isolation, personal rules, disable and deletion remove generated files; rollback preserves original user text', async t => {
  const f = await fixture(t), { service: s, home } = await f.device('a'), a = await project(s, 'A'), b = await project(s, 'B');
  const pa = path.join(f.root, 'project-A'), pb = path.join(f.root, 'project-B'); await fs.mkdir(pa); await fs.mkdir(pb);
  await put(path.join(pa, 'AGENTS.md'), '我的原始规则\n');
  for (const [id, folder] of [[a, pa], [b, pb]]) await s.bind({ id, folder, agents: ['codex', 'zcode'] });
  await put(path.join(home, '.codex/AGENTS.md'), '禁止自动提交');
  await put(path.join(home, '.codex/memories/MEMORY.md'), '仅项目 A 使用 staging');
  await importAll(s, a); await s.publish();
  assert.ok(!(await fs.readFile(path.join(pb, '.agent-sync/INDEX.md'), 'utf8')).includes('MEMORY.md'));
  assert.match(await fs.readFile(path.join(pb, '.agent-sync/RULES.md'), 'utf8'), /禁止自动提交/);
  const e = s.store.entries().find(e => e.type === 'memory' && e.value.kind === 'memory');
  await s.edit({ entity: e.entity, enabled: false });
  assert.equal(await fs.stat(path.join(pa, '.agent-sync/topics', e.entity + '.md')).catch(() => null), null);
  await s.disconnect({ id: a });
  assert.equal(await fs.readFile(path.join(pa, 'AGENTS.md'), 'utf8'), '我的原始规则\n');
});

test('append-only versions detect corruption, malformed managed blocks do not overwrite user rules', async t => {
  const f = await fixture(t), { service: s } = await f.device('a'), id = await project(s), p = path.join(f.root, 'project'); await fs.mkdir(p);
  await s.bind({ id, folder: p, agents: ['codex'] });
  await put(path.join(p, 'AGENTS.md'), '原有内容\n' + START + '\n没有结束'); await s.publish();
  assert.equal(s.config.delivery[id].phase, 'error'); assert.equal(await fs.readFile(path.join(p, 'AGENTS.md'), 'utf8'), '原有内容\n' + START + '\n没有结束');
  assert.throws(() => stripManaged(START + END + END), /损坏/);
  await put(path.join(s.store.root, 'broken.json.gz'), 'not gzip'); await s.store.load();
  assert.equal(s.store.errors.length, 1); await assert.rejects(s.publish(), /损坏/);
});

test('sequential source edits after automatic summaries do not create false conflicts', async t => {
  const f = await fixture(t, { fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '摘要' } }] }) }) });
  const { service: s, home } = await f.device('a'), id = await project(s), file = path.join(home, '.codex/memories/MEMORY.md');
  await put(file, '经验原文'); await importAll(s, id); await s.model({ base: 'https://example.com/v1', model: 'model' }); await s.cycle();
  await put(file, '新经验原文'); await s.cycle();
  const e = s.store.entries().find(e => e.type === 'memory'); assert.equal(e.conflict, false); assert.equal(e.value.text, '新经验原文'); assert.ok(e.value.summary);
});

test('directly opposed rules are held for review; disabling one clears the warning', async t => {
  const f = await fixture(t), { service: s } = await f.device('a');
  const value = text => ({ kind: 'rule', text, title: '规则', source: { agent: 'manual' } });
  const a = await s.store.append({ entity: hash('a'), scope: 'personal', value: value('禁止自动提交') });
  const b = await s.store.append({ entity: hash('b'), scope: 'personal', value: value('必须自动提交') });
  assert.equal(Object.keys(ruleWarnings(s.store.entries())).length, 2);
  await s.edit({ entity: b.entity, enabled: false }); assert.deepEqual(ruleWarnings(s.store.entries()), {});
  assert.equal(s.store.get(a.entity).enabled, true);
});

test('identical first imports while both computers are offline deduplicate without a false conflict', async t => {
  const f = await fixture(t), a = await f.device('a'), b = await f.device('b'), shared = path.join(f.root, 'shared'); await fs.mkdir(shared);
  for (const d of [a, b]) {
    await put(path.join(d.home, '.codex/AGENTS.md'), '请用中文回复'); await importAll(d.service);
    await d.service.connection({ backend: 'local', target: shared });
  }
  await a.service.cycle(); await b.service.cycle(); await a.service.cycle();
  const entries = a.service.store.entries(); assert.equal(entries.length, 1); assert.equal(entries[0].conflict, false); assert.equal(entries[0].heads.length, 2);
  assert.equal((await fs.readdir(shared)).filter(n => n.endsWith('.json.gz')).length, 2);
});

test('offline transport failure retains local memory and does not expose credentials in public state or shared files', async t => {
  const f = await fixture(t, { transport: async () => { throw Error('super-private-device-token'); } });
  const { service: s, home } = await f.device('a');
  await put(path.join(home, '.codex/AGENTS.md'), '请用中文回复'); await importAll(s);
  await s.connection({ backend: 'fns', server: 'https://example.com', vault: 'agent-memory', token: 'super-private-device-token' });
  await s.model({ base: 'https://example.com/v1', model: 'test', key: 'super-private-model-key' });
  await s.cycle(); const state = await s.state();
  assert.equal(state.entries.length, 1); assert.equal(state.sync.phase, 'error');
  assert.equal(state.connection.hasToken, true); assert.equal(state.model.hasKey, true);
  const text = JSON.stringify(state) + JSON.stringify([...s.store.events.values()]);
  assert.ok(!text.includes('super-private-device-token')); assert.ok(!text.includes('super-private-model-key'));
  assert.ok(!JSON.stringify(state.connection).includes('encryptedToken'));
});


test('WorkBuddy selects local memory and Markdown/MDC rules, keeps cloud caches private, and delivers across devices', async t => {
  const f = await fixture(t), a = await f.device('a'), b = await f.device('b');
  const id = await project(a.service), pa = path.join(a.home, 'project'), pb = path.join(b.home, 'project');
  await fs.mkdir(pa); await fs.mkdir(pb);
  await put(path.join(a.home, '.workbuddy/MEMORY.md'), '个人偏好用中文沟通');
  await put(path.join(a.home, '.workbuddy/user-42/MEMORY.md'), '个人偏好紧凑报告');
  await put(path.join(a.home, '.workbuddy/rules/report.mdc'), '禁止编造报告数字');
  await put(path.join(a.home, '.workbuddy/memory/cloud.md'), '云端缓存不能采集');
  await put(path.join(a.home, '.workbuddy/user-42/sessions/chat.md'), '聊天记录不能采集');
  await put(path.join(a.home, '.workbuddy/rules/secret.md'), 'api_key=super-secret-private-key');
  await put(path.join(pa, '.workbuddy/memory/MEMORY.md'), '项目使用隔离环境');
  await put(path.join(pa, 'CODEBUDDY.md'), '原有 WorkBuddy 项目指令\n');
  await put(path.join(pb, 'AGENTS.md'), '原有通用项目指令\n');
  await a.service.bind({ id, folder: pa, agents: ['workbuddy'] });
  const candidates = await a.service.discover();
  assert.equal(candidates.filter(c => c.agent === 'workbuddy').length, 5);
  assert.ok(candidates.every(c => !c.root.includes('sessions') && !c.root.endsWith('cloud.md')));
  await a.service.select({ sources: candidates.map(c => ({ id: c.id, scope: c.scope })) });
  await a.service.import();
  assert.equal(a.service.store.entries().filter(e => e.type === 'memory').length, 5);
  assert.ok(a.service.issues.some(s => s.includes('疑似凭据')));
  const shared = path.join(f.root, 'shared'); await fs.mkdir(shared);
  for (const d of [a, b]) await d.service.connection({ backend: 'local', target: shared });
  await a.service.cycle(); await b.service.cycle();
  await b.service.bind({ id, folder: pb, agents: ['codex', 'workbuddy'] }); await b.service.publish();
  const guidance = await fs.readFile(path.join(pb, 'CODEBUDDY.md'), 'utf8');
  assert.match(guidance, /agent-sync:start/); assert.match(guidance, /AGENTS.md/);
  assert.match(await fs.readFile(path.join(pb, '.agent-sync/RULES.md'), 'utf8'), /禁止编造报告数字/);
  assert.match(await fs.readFile(path.join(pb, 'AGENTS.md'), 'utf8'), /原有通用项目指令/);
  const before = a.service.store.events.size; await importAll(a.service, id); assert.equal(a.service.store.events.size, before);
  await b.service.bind({ id, folder: pb, agents: ['codex'] });
  assert.ok(!(await fs.readFile(path.join(pb, 'CODEBUDDY.md'), 'utf8')).includes(START));
  assert.match(await fs.readFile(path.join(pb, 'AGENTS.md'), 'utf8'), /agent-sync:start/);
  await a.service.disconnect({ id });
  assert.equal(await fs.readFile(path.join(pa, 'CODEBUDDY.md'), 'utf8'), '原有 WorkBuddy 项目指令\n');
});


test('portable paths map Windows short names, slash variants and case without changing neighboring projects', () => {
  const entry = { value: { originRoot: 'C:\\Users\\runneradmin\\project', originRoots: ['C:\\Users\\RUNNER~1\\project'] } };
  const text = 'C:/Users/RUNNER~1/project/src, c:\\users\\runneradmin\\project\\docs 和 C:/Users/RUNNER~1/project-other';
  const output = AgentService.prototype.portable(entry, text, { path: '/Users/me/project' });
  assert.equal(output, '/Users/me/project/src, /Users/me/project\\docs 和 C:/Users/RUNNER~1/project-other');
});
