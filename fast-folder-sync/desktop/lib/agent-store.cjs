const { gzipSync, gunzipSync } = require('node:zlib');
const { randomUUID } = require('node:crypto');
const { fs, path, safePath } = require('./files.cjs');
const { hash, AGENTS } = require('./agent-adapters.cjs');
const HEX = /^[a-f0-9]{64}$/;
const scopeOK = s => s === 'personal' || /^[a-f0-9-]{36}$/.test(s);
function validate(e) {
  if (e?.schema !== 1 || !HEX.test(e.entity) || !scopeOK(e.scope) || !['memory', 'project'].includes(e.type) || !Array.isArray(e.parents) || e.parents.length > 100 || !e.parents.every(p => HEX.test(p)) || typeof e.deleted !== 'boolean' || typeof e.enabled !== 'boolean' || typeof e.device !== 'string' || typeof e.time !== 'string') throw Error('无效的记忆版本');
  if (e.type === 'project' && (e.scope === 'personal' || typeof e.value?.name !== 'string' || e.value.name.length > 100)) throw Error('无效的项目');
  if (e.type === 'memory' && (!['rule', 'memory'].includes(e.value?.kind) || typeof e.value?.text !== 'string' || e.value.text.length > 1024 * 1024 || typeof e.value?.title !== 'string' || e.value.title.length > 300 || ![...AGENTS, 'manual'].includes(e.value.source?.agent))) throw Error('无效的记忆内容');
  if (e.value.summary && (typeof e.value.summary.text !== 'string' || !HEX.test(e.value.summary.sourceHash) || e.value.summary.text.length > 24000)) throw Error('无效的摘要');
}
class AgentStore {
  constructor(root, device) { this.root = root; this.device = device || randomUUID(); this.events = new Map(); this.byEntity = new Map(); }
  async load() {
    await fs.mkdir(this.root, { recursive: true });
    const next = new Map(), errors = [];
    const names = (await fs.readdir(this.root)).filter(n => n.endsWith('.json.gz'));
    if (names.length > 20000) throw Error('记忆版本超过 20000 个，请先归档');
    let total = 0;
    for (const name of names) {
      try {
        const file = await safePath(this.root, name);
        if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw Error('版本文件过大');
        const text = gunzipSync(await fs.readFile(file), { maxOutputLength: 2 * 1024 * 1024 }).toString('utf8');
        total += Buffer.byteLength(text); if (total > 64 * 1024 * 1024) throw Error('共享记忆超过 64 MiB，请先归档');
        const e = JSON.parse(text); validate(e);
        const id = hash(text);
        if (name !== id + '.json.gz') throw Error('版本摘要不匹配');
        next.set(id, { ...e, id });
      } catch (e) { errors.push(name + '：' + e.message); }
    }
    for (const [id, e] of next) {
      if (e.parents.some(p => !next.has(p) || next.get(p).entity !== e.entity || next.get(p).scope !== e.scope || next.get(p).type !== e.type)) {
        next.delete(id); errors.push(id + '：记忆版本关系无效');
      }
    }
    this.events = next; this.errors = errors; this.byEntity = new Map();
    for (const e of next.values()) { if (!this.byEntity.has(e.entity)) this.byEntity.set(e.entity, []); this.byEntity.get(e.entity).push(e); }
    return this;
  }
  heads(entity) {
    const all = this.byEntity.get(entity) || [];
    const parents = new Set(all.flatMap(e => e.parents));
    return all.filter(e => !parents.has(e.id)).sort((a, b) => a.id.localeCompare(b.id));
  }
  entries() {
    return [...this.byEntity.keys()].map(entity => {
      const heads = this.heads(entity), e = heads.find(h => h.deleted) || heads.find(h => h.value.summary?.sourceHash === hash(h.value.text || '')) || heads[0];
      const distinct = new Set(heads.map(h => JSON.stringify([h.scope, h.type, h.deleted, h.enabled, h.value.kind || '', h.type === 'memory' ? h.value.text : h.value.name])));
      return { ...e, heads: heads.map(h => h.id), conflict: distinct.size > 1, enabled: heads.every(h => h.enabled), deleted: heads.some(h => h.deleted) };
    });
  }
  get(entity) { return this.entries().find(e => e.entity === entity); }
  async append({ entity, scope, type = 'memory', value, deleted = false, enabled = true, parents }) {
    const e = { schema: 1, entity, scope, type, value, deleted, enabled, parents: parents ?? this.heads(entity).map(h => h.id), time: new Date().toISOString(), device: this.device };
    validate(e);
    for (const p of e.parents) { const old = this.events.get(p); if (!old || old.entity !== entity || old.scope !== scope || old.type !== type) throw Error('记忆版本关系错误'); }
    const text = JSON.stringify(e), id = hash(text), target = path.join(this.root, id + '.json.gz');
    const temp = target + '.' + randomUUID() + '.ffs-tmp';
    try { await fs.writeFile(temp, gzipSync(Buffer.from(text)), { mode: 0o600 }); await fs.rename(temp, target); }
    finally { await fs.rm(temp, { force: true }); }
    const event = { ...e, id }; this.events.set(id, event);
    if (!this.byEntity.has(entity)) this.byEntity.set(entity, []);
    this.byEntity.get(entity).push(event); return event;
  }
  history(entity) { return [...this.events.values()].filter(e => e.entity === entity).sort((a, b) => b.time.localeCompare(a.time)); }
}
module.exports = { AgentStore, validate, scopeOK };
