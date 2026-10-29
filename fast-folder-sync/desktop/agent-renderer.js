'use strict';
const api = window.folderSync, $ = id => document.getElementById(id);
document.documentElement.classList.toggle('mac', api.platform === 'darwin');
let state, candidates = [], currentTab = 'memories', timer, working = false;
const agentNames = { codex: 'Codex', claude: 'Claude Code', zcode: 'ZCode', workbuddy: 'WorkBuddy', manual: '手动' };
const titles = { memories: ['共享记忆', '换电脑、换 Agent，也能接着理解你。'], projects: ['项目与 Agent', '相同项目，在每台电脑都有自己的位置。'], sources: ['记忆来源', '选择值得带走的偏好、约定与经验。'], devices: ['设备同步', '让知识在你的电脑之间延续。'], model: ['自动整理', '保留事实，减少重复，按需读取。'] };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(timer); timer = setTimeout(() => $('toast').hidden = true, 6000); }
function date(text) { return text ? new Date(text).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'; }
async function call(command, args) { return api.agent(command, args || {}); }
async function refresh() { render(await call('state')); }
async function perform(job, message) {
  if (working) return; working = true; document.body.setAttribute('aria-busy', 'true'); $('cycle').disabled = true; $('cycle').textContent = '处理中…';
  try { await job(); await refresh(); if (message) toast(message); }
  catch (e) { toast(e.message); }
  finally { working = false; document.body.removeAttribute('aria-busy'); $('cycle').disabled = false; $('cycle').textContent = '整理并同步'; }
}
function button(text, job, cls) { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', () => perform(job)); return b; }
function tab(name) {
  currentTab = name;
  for (const [key, value] of Object.entries(titles)) { $(key + '-panel').hidden = key !== name; const b = document.querySelector('[data-tab="' + key + '"]'); if (key === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  $('heading').textContent = titles[name][0]; $('description').textContent = titles[name][1];
}
function projectName(scope) { return scope === 'personal' ? '个人通用' : state.projects.find(p => p.id === scope)?.name || '未关联项目'; }
function options(select, personal, blank) {
  const value = select.value; select.replaceChildren();
  if (blank) select.add(new Option(blank, ''));
  if (personal) select.add(new Option('个人通用', 'personal'));
  for (const p of state.projects) select.add(new Option(p.name, p.id));
  if ([...select.options].some(o => o.value === value)) select.value = value;
}
function render(data) {
  state = data;
  const active = data.entries.filter(e => !e.deleted), sync = data.sync;
  $('memory-count').textContent = active.length;
  $('auto').checked = data.auto;
  const stats = [['共享记忆', active.length, '个人与项目分别管理'], ['关联项目', data.bindings.length, 'Codex · Claude Code · ZCode · WorkBuddy'], ['需要处理', data.entries.filter(e => e.conflict || e.warning).length + data.issues.length, '冲突或来源异常'], ['已提供给 Agent', Object.values(data.delivery).filter(d => d.phase === 'success').length, '项目已生成读取入口']];
  $('overview').replaceChildren(...stats.map(([name, count, note]) => { const n = el('div', undefined, 'stat'); n.append(el('span', name), el('strong', count), el('small', note)); return n; }));
  $('issues').textContent = data.issues.join('\n');
  options($('scope'), true, '所有项目'); options($('binding-project'), false, '选择共享项目');
  renderMemories(); renderBindings();
  $('device-status').replaceChildren(el('h2', '最近同步'), el('p', sync ? (sync.phase === 'error' ? sync.error : date(sync.time) + ' · 已上传 ' + sync.uploaded + ' 个版本 · 已下载 ' + sync.downloaded + ' 个版本') : '尚未连接设备。可以先在本机整理和共享记忆。'), el('p', '本机设备标识：' + data.device));
  // Polling must not replace settings while the user is editing them.
  if (!document.querySelector('#connection-form:focus-within')) {
    $('connection-backend').value = data.connection.backend || 'fns'; $('connection-server').value = data.connection.server || ''; $('connection-vault').value = data.connection.vault || ''; $('connection-target').value = data.connection.target || ''; connectionFields();
    $('connection-token').placeholder = data.connection.hasToken ? '已加密保存，留空保留' : '输入本机设备令牌';
  }
  if (!document.querySelector('#model-form:focus-within')) {
    $('model-base').value = data.model.base || ''; $('model-name').value = data.model.model || ''; $('model-enabled').checked = data.model.enabled !== false; $('model-key').placeholder = data.model.hasKey ? '已加密保存，留空保留' : '只保存在本机，本机模型可不填';
  }
}
function renderMemories() {
  const q = $('search').value.toLowerCase(), scope = $('scope').value;
  const items = state.entries.filter(e => ($('show-deleted').checked || !e.deleted) && (!scope || e.scope === scope) && [e.value.title, e.value.text, e.value.summary?.text || '', e.value.source.label || ''].join('\n').toLowerCase().includes(q));
  $('memory-list').replaceChildren(...items.map(entry => {
    const card = el('article', undefined, 'memory-card'), top = el('div', undefined, 'card-top'), tags = el('div', undefined, 'tags');
    tags.append(el('span', projectName(entry.scope), 'tag'), el('span', entry.value.kind === 'rule' ? '规则 · 保留原文' : entry.value.summary ? '已生成摘要' : state.model.base ? '待整理 / 原文可用' : '原文同步', 'tag'));
    if (entry.conflict) tags.append(el('span', '版本冲突 · 暂停提供', 'tag warning'));
    if (entry.warning) tags.append(el('span', '相反规则 · 待处理', 'tag warning'));
    if (entry.deleted || !entry.enabled) tags.append(el('span', entry.deleted ? '已删除' : '已停用', 'tag warning'));
    top.append(el('h3', entry.value.title), tags);
    card.append(top, el('div', entry.value.summary?.text || entry.value.text, 'excerpt'), el('div', (agentNames[entry.value.source.agent] || entry.value.source.agent) + ' · ' + (entry.value.source.label || '') + ' · ' + date(entry.time), 'meta'));
    if (entry.warning) card.append(el('p', entry.warning));
    const actions = el('div', undefined, 'actions'); actions.append(button('查看与编辑', () => detail(entry)), button('历史 / 恢复', () => showHistory(entry)));
    if (!entry.deleted) actions.append(button(entry.enabled ? '停用' : '启用', () => call('edit', { entity: entry.entity, enabled: !entry.enabled })), button('删除', async () => { if (confirm('删除这条共享记忆？删除记录会同步到其他设备，原生来源保留。历史版本可以恢复。')) await call('edit', { entity: entry.entity, deleted: true }); }));
    card.append(actions); return card;
  }));
  if (!items.length) {
    const empty = el('div', undefined, 'empty'); empty.append(el('div', '◈', 'symbol'), el('h2', state.entries.length ? '没有匹配的记忆' : '让 Agent 带着经验出发'), el('p', '创建项目，选择已有记忆，再把它提供给你使用的 Agent。'));
    empty.append(button('1 · 关联项目', () => tab('projects'), 'primary'), document.createTextNode(' '), button('2 · 选择记忆来源', () => tab('sources'))); $('memory-list').append(empty);
  }
}
function renderBindings() {
  $('binding-list').replaceChildren(...state.bindings.map(b => {
    const card = el('div', undefined, 'panel'), delivery = state.delivery[b.id];
    card.append(el('h2', b.name), el('p', b.path), el('p', b.agents.map(a => agentNames[a]).join(' · ') + (delivery?.phase === 'success' ? ' · 已提供 ' + delivery.count + ' 条记忆 · ' + date(delivery.time) : delivery?.error ? ' · ' + delivery.error : ' · 待提供记忆')));
    const actions = el('div', undefined, 'actions'); actions.append(button('提供记忆', () => call('publish'), 'primary'), button('调整关联', () => { $('binding-project').value = b.id; $('binding-path').value = b.path; document.querySelectorAll('[name=agent]').forEach(n => n.checked = b.agents.includes(n.value)); }), button('撤销读取入口', async () => { if (confirm('移除此项目的 Agent Sync 入口与生成文件？你原有的规则和共享记忆会保留。')) await call('disconnect', { id: b.id }); })); card.append(actions); return card;
  }));
}
async function detail(entry) {
  $('detail-title').textContent = entry.value.title; const body = $('detail-body'); body.replaceChildren();
  body.append(el('p', projectName(entry.scope) + ' · ' + (entry.value.source.label || '') + (entry.conflict ? ' · 保存编辑会将当前冲突版本合并为新版本，请先查看历史。' : '')));
  if (entry.value.summary) body.append(el('h3', '主题摘要'), el('pre', entry.value.summary.text));
  const label = el('label', '保留的原文'), input = el('textarea'); input.rows = 12; input.value = entry.value.text; label.append(input); body.append(label);
  body.append(button('保存原文并重新提供', async () => { await call('edit', { entity: entry.entity, text: input.value }); $('detail-dialog').close(); }, 'primary'));
  const feedback = el('div', undefined, 'actions'); feedback.append(el('p', '试用反馈：'));
  for (const [text, result] of [['正确使用', 'correct'], ['还需重复交代', 'repeat'], ['记错了', 'incorrect'], ['内容过期', 'stale']]) feedback.append(button(text, async () => { await call('feedback', { entity: entry.entity, result }); toast('已记录反馈，仅保存在本机'); }));
  body.append(feedback); $('detail-dialog').showModal();
}
async function showHistory(entry) {
  const versions = await call('history', { entity: entry.entity }); $('detail-title').textContent = '版本历史 · ' + entry.value.title; const body = $('detail-body'); body.replaceChildren();
  for (const v of versions) {
    const row = el('details', undefined, 'version-row'); row.append(el('summary', date(v.time) + ' · ' + (v.deleted ? '删除' : v.enabled ? '启用' : '停用') + ' · ' + (entry.heads.includes(v.id) ? '当前分支' : '历史版本')), el('pre', v.value.text), button('恢复并解决当前冲突', async () => { await call('restore', { entity: entry.entity, revision: v.id }); $('detail-dialog').close(); }, 'primary')); body.append(row);
  }
  $('detail-dialog').showModal();
}
function renderSources() {
  $('source-list').replaceChildren(...candidates.map(c => {
    const row = el('div', undefined, 'source-row'), check = el('input'); check.type = 'checkbox'; check.dataset.source = c.id; const selected = state.sources.find(s => s.id === c.id); check.checked = Boolean(selected); check.setAttribute('aria-label', '选择 ' + c.label);
    const label = el('label', c.label); label.append(el('small', agentNames[c.agent] + ' · ' + (c.kind === 'rule' ? '规则' : '经验记忆')), el('small', c.root));
    const scope = el('select'); scope.dataset.sourceScope = c.id; scope.setAttribute('aria-label', c.label + ' 所属项目'); options(scope, true, '请选择所属项目'); scope.value = selected?.scope || c.scope || '';
    row.append(check, label, scope, button('预览', async () => { const docs = await call('preview', { id: c.id }); $('detail-title').textContent = c.label; $('detail-body').replaceChildren(...docs.flatMap(d => [el('h3', d.relative + (d.blocked ? ' · 疑似凭据，将跳过' : '')), el('pre', d.blocked ? '此文件包含疑似凭据。请先在原文件中移除，再重新预览。' : d.text)])); if (!docs.length) $('detail-body').append(el('p', '没有可采集的内容，产品生成的内容会自动排除。')); $('detail-dialog').showModal(); })); return row;
  }));
  if (!candidates.length) $('source-list').append(el('p', '尚未识别到来源。请确认 Agent 已安装并保存过记忆，或先关联项目目录。'));
}
function connectionFields() { const local = $('connection-backend').value === 'local'; $('server-fields').hidden = local; $('directory-fields').hidden = !local; }
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
for (const id of ['search', 'scope', 'show-deleted']) $(id).addEventListener(id === 'search' ? 'input' : 'change', renderMemories);
$('cycle').addEventListener('click', () => perform(() => call('cycle'), '处理完成，请查看同步和提供状态'));
$('auto').addEventListener('change', () => perform(() => call('auto', { enabled: $('auto').checked })));
$('files').addEventListener('click', () => api.openView('files').catch(e => toast(e.message)));
$('data').addEventListener('click', () => api.openData().catch(e => toast(e.message)));
$('close-detail').addEventListener('click', () => $('detail-dialog').close());
$('project-form').addEventListener('submit', e => { e.preventDefault(); perform(async () => { await call('project', { name: $('project-name').value }); $('project-name').value = ''; }, '共享项目已创建'); });
for (const [buttonId, input] of [['pick-project', 'binding-path'], ['pick-target', 'connection-target']]) $(buttonId).addEventListener('click', () => perform(async () => { const folder = await api.chooseFolder(); if (folder) $(input).value = folder; }));
$('binding-form').addEventListener('submit', e => { e.preventDefault(); perform(() => call('bind', { id: $('binding-project').value, folder: $('binding-path').value, agents: [...document.querySelectorAll('[name=agent]:checked')].map(n => n.value) }), '关联已保存，可识别记忆来源或提供记忆'); });
$('detect').addEventListener('click', () => perform(async () => { candidates = await call('discover'); renderSources(); }));
$('save-sources').addEventListener('click', () => perform(async () => { const sources = [...document.querySelectorAll('[data-source]:checked')].map(n => ({ id: n.dataset.source, scope: document.querySelector('[data-source-scope="' + n.dataset.source + '"]').value })); await call('select', { sources }); await call('import'); }, '已采集所选来源')); 
$('connection-backend').addEventListener('change', connectionFields);
$('connection-form').addEventListener('submit', e => { e.preventDefault(); perform(async () => { await call('connection', { backend: $('connection-backend').value, server: $('connection-server').value, vault: $('connection-vault').value, token: $('connection-token').value, target: $('connection-target').value }); $('connection-token').value = ''; }, '连接已保存'); });
$('disconnect-server').addEventListener('click', () => perform(() => call('connection', { clear: true }), '已断开连接，本机记忆保留'));
$('model-form').addEventListener('submit', e => { e.preventDefault(); perform(async () => { await call('model', { base: $('model-base').value, model: $('model-name').value, key: $('model-key').value, enabled: $('model-enabled').checked, clearKey: $('model-clear').checked }); $('model-key').value = ''; $('model-clear').checked = false; }, '整理设置已保存'); });
refresh().catch(e => toast(e.message));
setInterval(() => { if (!working && !document.querySelector('form:focus-within') && !$('detail-dialog').open) refresh().catch(e => toast(e.message)); }, 15000);
