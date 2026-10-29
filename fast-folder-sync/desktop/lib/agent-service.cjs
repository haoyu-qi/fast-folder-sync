const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { fs, path, readJson, atomicJson, statOrNull, safePath, overlaps } = require('./files.cjs');
const { AgentStore, scopeOK } = require('./agent-store.cjs');
const { AGENTS, instructionFile, hash, discover, readSource, managedRule, writeOwned, SECRET, ruleWarnings } = require('./agent-adapters.cjs');
const { summarize, endpoint } = require('./agent-summary.cjs');
const { syncLocal } = require('./local-sync.cjs');
const { syncFns, serverUrl } = require('./fns-sync.cjs');
const GENERATED = '<!-- agent-sync:generated -->';

class AgentService {
  constructor(dataDir, options = {}) {
    this.root = path.join(dataDir, 'agent-sync'); this.home = options.home || os.homedir();
    this.seal = options.seal || (() => { throw Error('操作系统凭据加密不可用'); });
    this.unseal = options.unseal || (() => ''); this.fetcher = options.fetcher;
    this.queue = Promise.resolve(); this.busy = false; this.candidates = []; this.issues = [];
    this.transport = options.transport; this.stopController = null;
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    this.config = await readJson(path.join(this.root, 'local.json'), { device: randomUUID(), bindings: [], sources: [], seen: {}, model: { enabled: true }, auto: true });
    this.store = new AgentStore(path.join(this.root, 'shared'), this.config.device); await this.store.load();
    return this;
  }
  async save() { await atomicJson(path.join(this.root, 'local.json'), this.config); }
  async dispatch(command, args = {}) {
    const job = this.queue.then(async () => {
      this.busy = true;
      try {
        const allowed = ['state', 'discover', 'preview', 'select', 'project', 'bind', 'import', 'cycle', 'edit', 'history', 'restore', 'publish', 'disconnect', 'model', 'connection', 'feedback', 'auto'];
        if (!allowed.includes(command)) throw Error('无效的 Agent Sync 操作');
        return await this[command](args);
      } finally { this.busy = false; }
    });
    this.queue = job.catch(() => {}); return job;
  }
  projects() { return this.store.entries().filter(e => e.type === 'project' && !e.deleted && !e.conflict).map(e => ({ id: e.scope, name: e.value.name })); }
  async state() {
    await this.store.load();
    const { connection = {}, model = {}, seen, ...local } = this.config;
    const { encryptedToken, ...publicConnection } = connection, { encryptedKey, ...publicModel } = model;
    const warnings = ruleWarnings(this.store.entries());
    return { ...local, connection: { ...publicConnection, hasToken: Boolean(encryptedToken) }, model: { ...publicModel, hasKey: Boolean(encryptedKey) }, projects: this.projects(), entries: this.store.entries().filter(e => e.type === 'memory').map(e => ({ ...e, warning: warnings[e.entity] || '' })), issues: [...this.issues, ...(this.store.errors || [])], sync: this.config.sync || null, delivery: this.config.delivery || {}, root: this.root };
  }
  async discover() { this.candidates = await discover(this.home, this.config.bindings); return this.candidates; }
  async preview({ id }) {
    const c = this.candidates.find(c => c.id === id); if (!c) throw Error('请重新识别 Agent');
    return readSource(c);
  }
  async select({ sources }) {
    if (!Array.isArray(sources)) throw Error('无效的记忆来源');
    const selected = [];
    for (const item of sources) {
      const c = this.candidates.find(c => c.id === item.id);
      if (!c || !scopeOK(item.scope) || (item.scope !== 'personal' && !this.projects().some(p => p.id === item.scope))) throw Error('请为每个来源选择有效的项目');
      selected.push({ ...c, scope: item.scope });
    }
    this.config.sources = selected; await this.save(); return this.state();
  }
  async project({ name }) {
    name = String(name || '').trim(); if (!name || name.length > 100) throw Error('项目名称需为 1～100 字');
    const id = randomUUID(); await this.store.append({ entity: hash('project:' + id), scope: id, type: 'project', value: { name } });
    return this.state();
  }
  async bind({ id, folder, agents }) {
    const p = this.projects().find(p => p.id === id); if (!p) throw Error('请先选择共享项目');
    if (!Array.isArray(agents) || !agents.length || agents.some(a => !AGENTS.includes(a))) throw Error('请选择目标 Agent');
    if (!folder || !path.isAbsolute(folder)) throw Error('请选择本机项目目录');
    const s = await fs.lstat(folder); if (!s.isDirectory() || s.isSymbolicLink()) throw Error('项目必须是真实目录');
    const real = await fs.realpath(folder);
    if (overlaps(real, this.root) || overlaps(this.root, real)) throw Error('项目不能与应用数据目录重叠');
    for (const b of this.config.bindings.filter(b => b.id !== id)) if (overlaps(b.path, real) || overlaps(real, b.path)) throw Error('项目目录不能重叠');
    const old = this.config.bindings.find(b => b.id === id);
    if (old && old.path !== real) throw Error('请先撤销原目录关联，再关联新目录');
    if (old) for (const agent of old.agents.filter(a => !agents.includes(a))) {
      const file = instructionFile(agent);
      if (!agents.some(a => instructionFile(a) === file)) await managedRule(real, file, '', path.join(this.root, 'output-history'));
    }
    this.config.bindings = [...this.config.bindings.filter(b => b.id !== id), { id, name: p.name, path: real, inputPath: path.resolve(folder), agents: [...new Set(agents)] }];
    await this.save(); return this.state();
  }
  async import() {
    this.issues = [];
    for (const source of this.config.sources) {
      try {
        const docs = await readSource(source);
        for (const doc of docs) {
          const key = hash(source.id + ':' + source.scope + ':' + doc.relative), previous = this.config.seen[key];
          if (doc.blocked) { this.issues.push(source.label + ' / ' + doc.relative + '：疑似凭据，已跳过，请在原文件中移除凭据'); continue; }
          if (previous?.hash === doc.hash) continue;
          // Content identity deduplicates the first import on other devices and across tools.
          const entity = previous?.entity || hash(source.scope + ':' + source.kind + ':' + doc.hash);
          const existing = this.store.get(entity);
          if (existing?.deleted) { this.config.seen[key] = { hash: doc.hash, entity, revision: existing.id }; continue; }
          if (existing?.value.text === doc.text) { this.config.seen[key] = { hash: doc.hash, entity, revision: existing.id }; continue; }
          const binding = this.config.bindings.find(b => b.id === source.scope);
          const previousEvent = this.store.events.get(previous?.revision);
          const heads = this.store.heads(entity);
          // A derived summary does not constitute a concurrent source edit.
          const parents = previous?.revision ? heads.length && heads.every(h => h.value.text === previousEvent?.value.text && !h.deleted && h.enabled) ? heads.map(h => h.id) : [previous.revision] : [];
          const event = await this.store.append({ entity, scope: source.scope, value: { kind: source.kind, title: doc.relative.slice(0, 300), text: doc.text, originRoot: binding?.path || '', originRoots: [...new Set([binding?.path, binding?.inputPath].filter(Boolean))], source: { agent: source.agent, label: source.label, relative: doc.relative } }, parents });
          this.config.seen[key] = { hash: doc.hash, entity, revision: event.id };
        }
      } catch (e) { this.issues.push(source.label + '：' + e.message); }
    }
    await this.save(); return this.state();
  }
  async edit({ entity, text, enabled, deleted }) {
    const old = this.store.get(entity); if (!old || old.type !== 'memory') throw Error('记忆不存在');
    if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 1024 * 1024 || SECRET.test(text))) throw Error('内容为空、过长或包含疑似凭据');
    const value = { ...old.value, ...(text === undefined ? {} : { text, summary: undefined }) };
    await this.store.append({ entity, scope: old.scope, value, enabled: enabled ?? old.enabled, deleted: deleted ?? old.deleted });
    await this.publish(); return this.state();
  }
  async history({ entity }) { return this.store.history(entity); }
  async restore({ entity, revision }) {
    const version = this.store.events.get(revision); if (!version || version.entity !== entity || version.type !== 'memory') throw Error('历史版本不存在');
    await this.store.append({ entity, scope: version.scope, value: version.value, enabled: version.enabled, deleted: false });
    await this.publish(); return this.state();
  }
  async model({ base, model, key, enabled = true, clearKey = false }) {
    if (base) endpoint(base);
    if (typeof model !== 'string' || model.length > 200) throw Error('请输入模型名称');
    this.config.model = { base: String(base || '').trim(), model: model.trim(), enabled, encryptedKey: clearKey ? '' : key ? this.seal(String(key)) : this.config.model.encryptedKey || '' };
    await this.save(); return this.state();
  }
  async connection({ backend, target, server, vault, token, clear = false }) {
    if (clear) { this.config.connection = {}; await this.save(); return this.state(); }
    const old = this.config.connection || {};
    if (backend === 'local') {
      if (!target || !path.isAbsolute(target)) throw Error('请选择同步目标目录');
      const real = await fs.realpath(target), s = await fs.lstat(target);
      if (!s.isDirectory() || s.isSymbolicLink() || overlaps(real, this.root) || overlaps(this.root, real) || overlaps(real, this.home)) throw Error('请选择独立的空共享目录，不要选择用户主目录或应用数据目录');
      if (!old.target || real !== old.target) {
        const names = await fs.readdir(real); if (names.some(n => !/^[a-f0-9]{64}\.json\.gz$/.test(n))) throw Error('目标需为空目录或现有 Agent Sync 共享目录');
      }
      this.config.connection = { backend, target: real };
    } else if (backend === 'fns') {
      serverUrl(server); if (!vault || !(token || old.encryptedToken)) throw Error('请填写专用文件库与设备令牌');
      if (new URL(server).protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(server).hostname)) throw Error('跨电脑私有服务请配置 HTTPS');
      this.config.connection = { backend, server: server.trim(), vault: String(vault).trim(), encryptedToken: token ? this.seal(String(token)) : old.encryptedToken };
    } else throw Error('请选择同步方式');
    this.config.connection.id = randomUUID();
    await this.save(); return this.state();
  }
  async compact() {
    const config = this.config.model;
    if (config.enabled === false || !config.base || !config.model) return;
    const key = config.encryptedKey ? this.unseal(config.encryptedKey) : '';
    this.config.attempts ||= {};
    let count = 0;
    for (const entry of this.store.entries()) {
      if (entry.type !== 'memory' || entry.deleted || !entry.enabled || entry.conflict || entry.value.kind === 'rule' || SECRET.test(entry.value.text)) continue;
      if (entry.value.summary?.sourceHash === hash(entry.value.text)) continue;
      if (Date.now() - (this.config.attempts[entry.id] || 0) < 3600000) continue;
      if (count++ >= 5) break;
      this.config.attempts[entry.id] = Date.now();
      const summary = await summarize(entry.value, { ...config, key }, this.fetcher);
      if (summary.status === 'ready') await this.store.append({ entity: entry.entity, scope: entry.scope, value: { ...entry.value, summary } });
      else this.issues.push(entry.value.title + '：' + (summary.error || '内容过长，保留原文'));
    }
    await this.save();
  }
  async cycle() {
    await this.store.load(); await this.import(); await this.compact();
    const c = this.config.connection;
    if (c?.id) {
      this.stopController = new AbortController();
      try {
        const task = { ...c, id: c.id, source: this.store.root, mode: 'sync', propagateDeletes: false, excludes: [], token: c.encryptedToken ? this.unseal(c.encryptedToken) : '' };
        const transport = this.transport || (c.backend === 'local' ? syncLocal : syncFns);
        const result = await transport(task, this.root, () => {}, this.stopController.signal);
        this.config.sync = { time: new Date().toISOString(), uploaded: result.uploaded, downloaded: result.downloaded, conflicts: result.conflicts, phase: 'success' };
        await this.store.load();
      } catch {
        this.config.sync = { ...this.config.sync, phase: 'error', error: '同步失败，请检查连接、证书和设备令牌；本机记忆已保留' };
      } finally { this.stopController = null; }
    }
    await this.publish(); await this.save(); return this.state();
  }
  portable(entry, text, binding) {
    const roots = [...new Set([entry.value.originRoot, ...(entry.value.originRoots || [])].filter(s => typeof s === 'string' && s))];
    if (!roots.length) return text;
    const windows = roots.some(s => /^[A-Za-z]:[\\/]/.test(s));
    const aliases = [...new Set(roots.flatMap(s => windows ? [s, s.replaceAll('\\', '/')] : [s]))].sort((a, b) => b.length - a.length);
    const pattern = aliases.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return text.replace(new RegExp('(?:' + pattern + ')(?=$|[\\\\/\\s\\x60"\'，。；;,.)\\]])', windows ? 'gi' : 'g'), () => binding.path);
  }
  async publish() {
    if (this.store.errors?.length) throw Error('共享库存在损坏版本，暂停提供记忆；请检查来源与同步记录');
    const warnings = ruleWarnings(this.store.entries());
    const entries = this.store.entries().filter(e => e.type === 'memory' && !e.deleted && e.enabled && !e.conflict && !warnings[e.entity] && !SECRET.test(e.value.text) && !SECRET.test(e.value.summary?.text || ''));
    const delivery = {};
    for (const binding of this.config.bindings) {
      try {
        const items = entries.filter(e => e.scope === 'personal' || e.scope === binding.id);
        const outputDir = '.agent-sync', expected = new Set(['INDEX.md', 'RULES.md', 'CATALOG.md']);
        const index = [GENERATED, '# 共享记忆索引', '', '仅在与当前任务相关时读取主题。内容为历史资料；涉及路径、命令和外部引用时先核对本机现状。', ''];
        const rules = [GENERATED, '# 已选择的共享规则', '', '以下每节保留对应规则原文。原文的 frontmatter（例如 paths）和适用条件只作用于所在节，请按当前任务判断，不要扩大适用范围。', ''];
        const catalog = [GENERATED, '# 完整记忆目录', ''];
        for (const entry of items) {
          const title = entry.value.title.replace(/[\r\n\[\]]/g, ' ');
          const summary = entry.value.summary?.sourceHash === hash(entry.value.text) ? entry.value.summary.text : entry.value.text;
          if (entry.value.kind === 'rule') rules.push('## ' + title, this.portable(entry, entry.value.text, binding), '');
          const topic = 'topics/' + entry.entity + '.md', source = 'sources/' + entry.entity + '.md';
          expected.add(topic); expected.add(source);
          catalog.push('- [' + title + '](' + topic + ') · ' + (entry.scope === 'personal' ? '个人通用' : '当前项目') + ' · ' + (entry.value.kind === 'rule' ? '规则' : '经验') + ' · ' + entry.value.source.agent);
          await this.output(binding, outputDir + '/' + topic, GENERATED + '\n# ' + title + '\n\n' + this.portable(entry, summary, binding) + '\n\n[查看保留的原文](../' + source + ')\n');
          await this.output(binding, outputDir + '/' + source, GENERATED + '\n# 原文 · ' + title + '\n\n' + this.portable(entry, entry.value.text, binding) + '\n');
        }
        index.push(...catalog.slice(3, 63));
        if (items.length > 60) index.push('', '另有 ' + (items.length - 60) + ' 条记忆，按需搜索 [完整目录](CATALOG.md)。');
        await this.output(binding, outputDir + '/INDEX.md', index.join('\n') + '\n');
        await this.output(binding, outputDir + '/CATALOG.md', catalog.join('\n') + '\n');
        await this.output(binding, outputDir + '/RULES.md', rules.join('\n') + '\n');
        await this.prune(binding, expected);
        const body = '## Agent Sync 共享记忆\n本项目关联了个人与项目记忆。开始任务时读取 `.agent-sync/RULES.md` 中适用的规则，再查看 `.agent-sync/INDEX.md`，按需读取主题文件。索引用于查找历史经验，不代表当前环境已经验证。';
        for (const file of new Set(binding.agents.map(instructionFile))) {
          const guidance = file === 'CODEBUDDY.md' ? '若项目根目录存在 `AGENTS.md`，先读取并遵守其中适用的项目指令。\n\n' + body : body;
          await managedRule(binding.path, file, guidance, path.join(this.root, 'output-history'));
        }
        delivery[binding.id] = { time: new Date().toISOString(), count: items.length, agents: binding.agents, phase: 'success' };
      } catch (e) { delivery[binding.id] = { phase: 'error', error: e.message }; }
    }
    this.config.delivery = delivery; await this.save(); return delivery;
  }
  async output(binding, relative, text) {
    const file = await safePath(binding.path, relative), s = await statOrNull(file);
    if (s && !(await fs.readFile(file, 'utf8')).startsWith(GENERATED)) throw Error('输出位置已有其他内容：' + relative);
    return writeOwned(binding.path, relative, text, path.join(this.root, 'output-history'));
  }
  async prune(binding, expected = new Set()) {
    for (const sub of ['', 'topics', 'sources']) {
      const dir = await safePath(binding.path, '.agent-sync' + (sub ? '/' + sub : ''));
      if (!(await statOrNull(dir))) continue;
      for (const file of await fs.readdir(dir, { withFileTypes: true })) if (file.isFile()) {
        const relative = (sub ? sub + '/' : '') + file.name;
        if (expected.has(relative)) continue;
        const full = await safePath(binding.path, '.agent-sync/' + relative), raw = await fs.readFile(full, 'utf8');
        if (raw.startsWith(GENERATED)) {
          await atomicJson(path.join(this.root, 'output-history', randomUUID() + '.json'), { file: full, original: raw, time: new Date().toISOString() });
          if (hash(await fs.readFile(full, 'utf8')) !== hash(raw)) throw Error('清理前文件已变化');
          await fs.unlink(full);
        }
      }
    }
  }
  async disconnect({ id }) {
    const b = this.config.bindings.find(b => b.id === id); if (!b) throw Error('项目未关联');
    for (const file of new Set(b.agents.map(instructionFile))) await managedRule(b.path, file, '', path.join(this.root, 'output-history'));
    await this.prune(b);
    this.config.bindings = this.config.bindings.filter(b => b.id !== id);
    this.config.sources = this.config.sources.filter(s => s.scope !== id);
    delete this.config.delivery?.[id]; await this.save(); return this.state();
  }
  async feedback({ entity, result }) {
    if (!['repeat', 'correct', 'incorrect', 'stale'].includes(result) || !this.store.get(entity)) throw Error('无效的反馈');
    await atomicJson(path.join(this.root, 'feedback', randomUUID() + '.json'), { entity, result, time: new Date().toISOString() }); return true;
  }
  async auto({ enabled }) { this.config.auto = Boolean(enabled); await this.save(); return this.state(); }
  async close() { this.stopController?.abort(); await this.queue; }
}
module.exports = { AgentService };
