const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { fs, path, statOrNull, safePath, digest } = require('./files.cjs');

const START = '<!-- agent-sync:start -->', END = '<!-- agent-sync:end -->';
const AGENTS = ['codex', 'claude', 'zcode', 'workbuddy'];
const instructionFile = agent => agent === 'claude' ? 'CLAUDE.md' : agent === 'workbuddy' ? 'CODEBUDDY.md' : 'AGENTS.md';
const hash = value => createHash('sha256').update(value).digest('hex');
function stripManaged(text) {
  const starts = text.split(START).length - 1, ends = text.split(END).length - 1;
  if (!starts && !ends) return text;
  if (starts !== 1 || ends !== 1 || text.indexOf(END) < text.indexOf(START)) throw Error('Agent Sync 内容区域损坏，请先修复标记');
  return text.slice(0, text.indexOf(START)) + text.slice(text.indexOf(END) + END.length);
}
async function markdownFiles(root, max = 1500) {
  if (!(await statOrNull(root))) return [];
  const result = [];
  async function walk(dir, depth) {
    if (depth > 8) throw Error('记忆目录层级过深');
    const s = await fs.lstat(dir);
    if (s.isSymbolicLink() || !s.isDirectory()) return;
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink() || ['.git', 'node_modules', '.agent-sync'].includes(item.name)) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file, depth + 1);
      else if (item.isFile() && /\.(md|mdc)$/i.test(item.name)) {
        result.push(file); if (result.length > max) throw Error('记忆文件过多，请选择更小的目录');
      }
    }
  }
  await walk(root, 0); return result.sort();
}
async function discover(home = os.homedir(), bindings = []) {
  const result = [];
  async function add(agent, root, kind, scope = 'personal', label = '') {
    const s = await statOrNull(root);
    if (!s || s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())) return;
    result.push({ id: hash(agent + ':' + root), agent, root, kind, scope, label: label || path.basename(root), directory: s.isDirectory() });
  }
  await add('codex', path.join(home, '.codex', 'memories'), 'memory', '', 'Codex 本地记忆（请选择所属项目）');
  for (const [agent, folder, rule] of [['codex', '.codex', 'AGENTS.md'], ['claude', '.claude', 'CLAUDE.md'], ['zcode', '.zcode', 'AGENTS.md']]) {
    await add(agent, path.join(home, folder, rule), 'rule', 'personal', agent + ' 个人规则');
  }
  for (const [agent, base] of [['claude', path.join(home, '.claude', 'projects')], ['zcode', path.join(home, '.zcode', 'cli', 'memories', 'projects')]]) {
    const s = await statOrNull(base);
    if (!s?.isDirectory() || s.isSymbolicLink()) continue;
    for (const entry of await fs.readdir(base, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await add(agent, path.join(base, entry.name, 'memory'), 'memory', '', agent + ' · ' + entry.name);
    }
  }
  await add('claude', path.join(home, '.claude', 'rules'), 'rule', 'personal', 'Claude 个人规则目录');
  const workbuddy = path.join(home, '.workbuddy');
  await add('workbuddy', path.join(workbuddy, 'MEMORY.md'), 'memory', 'personal', 'WorkBuddy 个人本地记忆');
  await add('workbuddy', path.join(workbuddy, 'rules'), 'rule', 'personal', 'WorkBuddy 个人规则目录');
  const wbStat = await statOrNull(workbuddy);
  if (wbStat?.isDirectory() && !wbStat.isSymbolicLink()) {
    for (const entry of await fs.readdir(workbuddy, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && /^user-[\w-]+$/.test(entry.name)) {
        await add('workbuddy', path.join(workbuddy, entry.name, 'MEMORY.md'), 'memory', 'personal', 'WorkBuddy · ' + entry.name + ' 本地记忆');
      }
    }
  }
  for (const b of bindings) {
    for (const agent of b.agents) {
      let rule = instructionFile(agent);
      if (agent === 'workbuddy' && !(await statOrNull(path.join(b.path, rule)))) rule = 'AGENTS.md';
      await add(agent, path.join(b.path, rule), 'rule', b.id, b.name + ' · ' + agent + ' 项目规则');
      if (agent === 'claude') await add(agent, path.join(b.path, '.claude', 'rules'), 'rule', b.id, b.name + ' · Claude 规则目录');
      if (agent === 'workbuddy') {
        await add(agent, path.join(b.path, '.workbuddy', 'memory'), 'memory', b.id, b.name + ' · WorkBuddy 项目记忆');
        await add(agent, path.join(b.path, '.workbuddy', 'rules'), 'rule', b.id, b.name + ' · WorkBuddy 项目规则');
      }
    }
  }
  return result;
}
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,})\b|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/i;
async function readSource(candidate) {
  const files = candidate.directory ? await markdownFiles(candidate.root) : [candidate.root];
  const docs = [];
  for (const file of files) {
    const relative = candidate.directory ? path.relative(candidate.root, file).split(path.sep).join('/') : path.basename(file);
    const full = candidate.directory ? await safePath(candidate.root, relative) : await safePath(path.dirname(file), path.basename(file));
    const before = await fs.stat(full);
    if (before.size > 1024 * 1024) throw Error('单个记忆文件超过 1 MiB：' + relative);
    const raw = await fs.readFile(full, 'utf8');
    const after = await fs.stat(full);
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw Error('文件正在写入，请稍后重试');
    const text = stripManaged(raw).trim();
    if (!text || text.startsWith('<!-- agent-sync:generated -->')) continue;
    docs.push({ relative, text, hash: hash(text), blocked: SECRET.test(text) });
  }
  return docs;
}
// Compare immediately before atomic replacement. Never follow links or truncate user content.
async function writeOwned(root, relative, text, backupDir) {
  const full = await safePath(root, relative), s = await statOrNull(full);
  if (s && !s.isFile()) throw Error('输出位置不是普通文件');
  const old = s ? await fs.readFile(full, 'utf8') : null;
  if (old === text) return false;
  await fs.mkdir(path.dirname(full), { recursive: true });
  const temp = full + '.' + randomUUID() + '.ffs-tmp';
  try {
    await fs.writeFile(temp, text, { mode: 0o600 });
    if (s) {
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(path.join(backupDir, randomUUID() + '.json'), JSON.stringify({ file: full, original: old, replacement: hash(text), time: new Date().toISOString() }), { mode: 0o600 });
    }
    const latest = await statOrNull(full);
    if ((latest ? await digest(full) : null) !== (old === null ? null : hash(old))) throw Error('写入前文件已变化，请重试');
    await fs.rename(temp, full);
    return true;
  } finally { await fs.rm(temp, { force: true }); }
}
async function managedRule(root, name, body, backupDir) {
  const full = await safePath(root, name);
  const old = await fs.readFile(full, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
  stripManaged(old); // Validate before editing.
  if (!body && !old.includes(START)) return false;
  const block = body ? START + '\n' + body + '\n' + END + '\n' : '';
  const after = old.includes(END) ? old.slice(old.indexOf(END) + END.length).replace(/^\r?\n/, '') : '';
  const next = old.includes(START)
    ? old.slice(0, old.indexOf(START)) + block + after
    : block + old;
  return writeOwned(root, name, next, backupDir);
}
// Conservative check for directly opposed instructions. Ambiguous wording remains reviewable as original text.
function ruleWarnings(entries) {
  const lines = [], warnings = {};
  for (const e of entries.filter(e => e.type === 'memory' && e.value.kind === 'rule' && !e.deleted && e.enabled)) {
    for (let line of e.value.text.split(/\r?\n/)) {
      line = line.replace(/^[\s#*>\d.\-]+/, '').trim().toLowerCase();
      if (!line) continue;
      const negative = /^(不要|不得|禁止|不能|不允许|never\s+|do not\s+)/.test(line);
      const key = line.replace(/^(不要|不得|禁止|不能|不允许|必须|请|需要|允许|never\s+|do not\s+|must\s+|always\s+)/, '').replace(/[\s。.!！；;]+$/g, '').trim();
      for (const old of lines) if (key.length > 2 && old.key === key && old.negative !== negative && (old.scope === e.scope || old.scope === 'personal' || e.scope === 'personal')) {
        warnings[old.entity] = warnings[e.entity] = '检测到相反规则：' + key + '，请编辑或停用其中一条';
      }
      lines.push({ key, negative, entity: e.entity, scope: e.scope });
    }
  }
  return warnings;
}
module.exports = { AGENTS, instructionFile, START, END, hash, stripManaged, discover, readSource, markdownFiles, writeOwned, managedRule, SECRET, ruleWarnings };
