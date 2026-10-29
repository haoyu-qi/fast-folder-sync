const $ = id => document.getElementById(id);
const api = window.folderSync;
const agentHome = document.createElement('button'); agentHome.id = 'agent-entry'; agentHome.className = 'nav'; agentHome.textContent = 'Agent 记忆同步'; agentHome.addEventListener('click', () => api.openView('agent').catch(e => toast(e.message))); document.querySelector('aside nav').append(agentHome);
document.documentElement.dataset.platform = api.platform;
let state = { tasks: [], logs: [] }, editing = null, toastTimer, taskFilter = 'all';
const connectionForm = ServiceConfig.bind({ getTasks: () => state.tasks, getEditing: () => editing, updateBackend });
const phaseNames = { running: '正在同步', waiting: '等待下次同步', success: '同步完成', error: '需要关注', paused: '已暂停' };
function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; }
function toast(text) { $('toast').textContent = text; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500); }
function action(label, handler, cls) { const button = node('button', cls, label); button.type = 'button'; button.addEventListener('click', async () => { button.disabled = true; try { await handler(); } catch (e) { toast(e.message); } finally { button.disabled = false; } }); return button; }
function date(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未运行'; }
function switchPage(page) {
  for (const p of ['tasks', 'activity', 'history']) $(p + '-page').classList.toggle('hidden', p !== page);
  document.querySelectorAll('[data-page]').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('page-title').textContent = { tasks: '文件夹任务', activity: '同步记录', history: '历史版本' }[page];
  $('page-description').textContent = { tasks: '让重要文件，始终多一份安心。', activity: '每一次变化，都有迹可循。', history: '找回覆盖或删除前的那一份文件。' }[page];
}
function render(data) {
  state = data;
  $('total-count').textContent = data.tasks.length; $('nav-count').textContent = data.tasks.length;
  $('enabled-count').textContent = data.tasks.filter(t => t.enabled).length;
  $('success-count').textContent = data.tasks.filter(t => t.status.lastRun).length;
  $('attention-count').textContent = data.tasks.filter(t => t.status.phase === 'error' || t.status.result?.conflicts).length;
  $('empty').classList.toggle('hidden', data.tasks.length > 0);
  const running = data.tasks.filter(t => t.status.phase === 'running').length;
  $('scheduler-status').textContent = running ? `${running} 个任务正在同步` : data.tasks.some(t => t.enabled) ? '自动同步已就绪' : '暂无自动任务';
  renderTasks();
  for (const id of ['log-filter', 'history-task']) {
    const select = $(id), selected = select.value;
    select.replaceChildren(new Option(id === 'log-filter' ? '所有任务' : '选择一个任务', ''), ...data.tasks.map(t => new Option(t.name, t.id)));
    select.value = selected;
  }
  renderLogs();
}
function renderTasks() {
  const query = $('task-search').value.trim().toLocaleLowerCase();
  const tasks = state.tasks.filter(task => {
    const match = !query || [task.name, task.source, task.target, task.server, task.vault].some(value => String(value || '').toLocaleLowerCase().includes(query));
    return match && (taskFilter === 'all' || taskFilter === 'auto' && task.enabled || taskFilter === 'attention' && (task.status.phase === 'error' || task.status.result?.conflicts > 0));
  });
  $('task-list').replaceChildren(...tasks.map(taskCard));
  $('visible-count').textContent = tasks.length + ' 项';
  $('no-results').classList.toggle('hidden', tasks.length > 0 || state.tasks.length === 0);
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.classList.toggle('selected', button.dataset.filter === taskFilter);
    button.setAttribute('aria-pressed', String(button.dataset.filter === taskFilter));
  });
}
function progressCard(progress) {
  const labels = { starting: '准备同步', probe: '检查服务能力', index: '读取服务端文件索引', 'scan-source': '扫描源文件夹', 'scan-target': '扫描目标文件夹', connect: '连接同步服务', compare: '核对两端文件', copy: '复制并校验文件', upload: '上传文件', download: '下载文件' };
  const size = value => { let n = value || 0, unit = 0; const units = ['B', 'KB', 'MB', 'GB', 'TB']; while (n >= 1024 && unit < 4) { n /= 1024; unit++; } return n.toFixed(unit ? 1 : 0) + ' ' + units[unit]; };
  const box = node('div', 'sync-progress');
  const scanning = progress.stage?.startsWith('scan-');
  let summary = labels[progress.stage] || '正在同步';
  if (progress.stage === 'index') summary += ' · 已读取 ' + (progress.checked || 0) + ' 个文件标识';
  if (scanning) summary += ' · 已检查 ' + (progress.checked || 0) + ' 个文件 · 已校验 ' + size(progress.bytes);
  if (progress.uploaded !== undefined) summary += ' · 已上传 ' + progress.uploaded + ' · 已下载 ' + progress.downloaded;
  box.append(node('div', '', summary));
  if (progress.path) { const current = node('div', 'sync-current', progress.path); current.title = progress.path; box.append(current); }
  if (progress.fileSize > 0) {
    const meter = node('progress', 'sync-meter'); meter.max = progress.fileSize; meter.value = progress.fileBytes || 0;
    meter.setAttribute('aria-label', scanning ? '当前文件校验进度' : '当前文件传输进度');
    box.append(meter, node('small', '', size(progress.fileBytes) + ' / ' + size(progress.fileSize) + '（当前文件）'));
  }
  return box;
}
function taskCard(task) {
  const card = node('article', 'task-card');
  const top = node('div', 'task-top'), title = node('div', 'task-title');
  title.append(icon(task.backend === 'local' ? 'Folder' : 'Cloud'), node('h3', '', task.name), node('span', 'tag', task.mode === 'backup' ? '单向备份' : '双向同步'));
  const badge = node('span', 'badge ' + task.status.phase, phaseNames[task.status.phase] || '等待中');
  badge.prepend(icon(({ success: 'CircleCheck', error: 'CircleAlert', running: 'RefreshCw', paused: 'Pause', waiting: 'RefreshCw' })[task.status.phase] || 'RefreshCw'));
  top.append(title, badge);
  const paths = node('div', 'paths');
  for (const [index, value] of [task.source, task.backend === 'local' ? task.target : task.server + ' / ' + task.vault].entries()) {
    if (index) { const arrow = icon(task.mode === 'backup' ? 'ArrowRight' : 'ArrowLeftRight'); arrow.classList.add('arrow'); paths.append(arrow); }
    const box = node('div', 'folder-path'); box.append(node('small', '', index ? task.backend === 'local' ? '目标文件夹' : '私有同步服务' : '源文件夹'));
    box.querySelector('small').prepend(icon(index && task.backend !== 'local' ? 'Cloud' : 'Folder'));
    const text = node('div', '', value); text.title = value; box.append(text); paths.append(box);
    if (!index || task.backend === 'local') {
      box.title = '双击或按回车打开文件夹'; box.tabIndex = 0; box.setAttribute('role', 'button'); box.setAttribute('aria-label', '打开' + (index ? '目标' : '源') + '文件夹：' + value);
      const open = () => api.openFolder(task.id, index ? 'target' : 'source').catch(e => toast(e.message));
      box.addEventListener('dblclick', open); box.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    }
  }
  const bottom = node('div', 'task-bottom'), details = node('div', 'task-details');
  details.textContent = `每 ${task.interval} 秒核对 · ${task.propagateDeletes ? '传播删除' : '保留删除项'} · ${task.status.result?.files ?? '—'} 个源文件`;
  details.append(node('div', '', '最近成功：' + date(task.status.lastRun)));
  const actions = node('div', 'task-actions');
  const run = action('立即同步', () => api.runTask(task.id), 'primary'); run.disabled = task.status.phase === 'running';
  actions.append(run, action(task.enabled ? '暂停自动' : '启用自动', () => api.toggleTask(task.id)), action('设置', () => editTask(task)), action('历史', async () => { switchPage('history'); $('history-task').value = task.id; await renderHistory(); }));
  for (const [index, name] of ['RefreshCw', task.enabled ? 'Pause' : 'Play', 'Settings2', 'History'].entries()) actions.children[index].prepend(icon(name));
  bottom.append(details, actions); card.append(top, paths); if (task.status.phase === 'running' && task.status.progress) card.append(progressCard(task.status.progress)); card.append(bottom);
  if (task.status.error) card.append(node('p', 'task-error', task.status.error));
  return card;
}
function renderLogs() {
  const filter = $('log-filter').value, logs = state.logs.filter(l => !filter || l.taskId === filter);
  $('logs').replaceChildren(...logs.map(l => { const row = node('div', 'log ' + l.level); row.append(node('time', '', date(l.time)), node('span', 'task-label', l.task), node('span', '', l.message)); return row; }));
  if (!logs.length) $('logs').append(node('div', 'panel-empty', '同步开始后，活动记录会显示在这里。'));
}
async function renderHistory() {
  const id = $('history-task').value;
  $('history-list').replaceChildren(node('div', 'panel-empty', id ? '正在读取历史版本…' : '选择任务，查看覆盖和删除前的版本。'));
  if (!id) return;
  const versions = await api.history(id);
  if ($('history-task').value !== id) return;
  $('history-list').replaceChildren(...versions.map(v => {
    const row = node('div', 'history-row'), text = node('div'); text.append(node('strong', '', v.path), node('small', '', `${date(v.time)} · ${v.side === 'source' ? '源文件夹' : '目标文件夹'} · ${v.reason} · ${(v.size / 1024).toFixed(1)} KB`));
    row.append(text, action('恢复此版本', async () => {
      if (!confirm('将此历史版本恢复到原文件夹？当前文件会先备份。\n恢复后请确认内容，再启用自动同步。')) return;
      await api.restore(id, v.id); toast('历史版本已恢复'); await renderHistory();
    })); return row;
  }));
  if (!versions.length) $('history-list').append(node('div', 'panel-empty', '尚无历史版本。第一次覆盖或删除文件前会自动生成。'));
}
function updateBackend() {
  const remote = $('backend').value === 'fns';
  $('local-fields').classList.toggle('hidden', remote); $('remote-fields').classList.toggle('hidden', !remote);
  $('target').required = !remote; $('server').required = remote; $('vault').required = remote; $('token').required = remote && !editing?.hasToken;
  if (remote) $('mode').value = 'sync'; $('mode').disabled = remote || Boolean(editing);
  connectionForm.update();
}
function editTask(task = null) {
  editing = task; $('task-form').reset(); $('form-error').textContent = '';
  $('form-title').textContent = task ? '任务设置' : '新建文件夹任务';
  for (const [id, field] of [['task-name', 'name'], ['source', 'source'], ['target', 'target'], ['backend', 'backend'], ['server', 'server'], ['vault', 'vault'], ['mode', 'mode'], ['interval', 'interval']]) $(id).value = task?.[field] ?? ({ backend: 'local', mode: 'backup', interval: 30 }[field] || '');
  $('token').value = ''; $('token').placeholder = task?.hasToken ? '留空保留已保存的令牌' : '仅在此电脑加密保存';
  $('excludes').value = (task?.excludes || []).join('\n'); $('enabled').checked = task?.enabled ?? true; $('propagate-deletes').checked = task?.propagateDeletes ?? false;
  for (const id of ['pick-source', 'pick-target', 'backend', 'server', 'vault', 'propagate-deletes']) $(id).disabled = Boolean(task);
  $('edit-hint').classList.toggle('hidden', !task); connectionForm.reset(task); updateBackend();
  // Removal only changes the task configuration; histories remain on disk.
  document.querySelector('#delete-button')?.remove();
  if (task) { const button = action('移除任务', async () => { if (!confirm('移除此任务？文件和已有历史备份会保留。')) return; await api.deleteTask(task.id); $('task-dialog').close(); }); button.id = 'delete-button'; document.querySelector('.dialog-actions').prepend(button); }
  $('task-dialog').showModal();
}
$('task-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save-button').disabled = true; $('form-error').textContent = '';
  try {
    await api.saveTask({ id: editing?.id, name: $('task-name').value, source: $('source').value, target: $('target').value, backend: $('backend').value, mode: $('mode').value, server: $('server').value, vault: $('vault').value, token: $('token').value, connectionTaskId: connectionForm.connectionTaskId(), interval: Number($('interval').value), enabled: $('enabled').checked, propagateDeletes: $('propagate-deletes').checked, excludes: $('excludes').value.split('\n') });
    $('token').value = ''; $('connection-config').value = ''; $('task-dialog').close(); toast('任务已保存，可点击“立即同步”开始');
  } catch (e) { $('form-error').textContent = e.message; } finally { $('save-button').disabled = false; }
});
for (const id of ['source', 'target']) $('pick-' + id).addEventListener('click', async () => { try { const folder = await api.chooseFolder(); if (folder) $(id).value = folder; } catch (e) { toast(e.message); } });
for (const id of ['add-task', 'empty-add']) $(id).addEventListener('click', () => editTask());
for (const id of ['close-dialog', 'cancel-dialog']) $(id).addEventListener('click', () => $('task-dialog').close());
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.page)));
$('backend').addEventListener('change', updateBackend);
$('log-filter').addEventListener('change', renderLogs);
$('history-task').addEventListener('change', () => renderHistory().catch(e => toast(e.message)));
$('refresh-history').addEventListener('click', () => renderHistory().catch(e => toast(e.message)));
$('open-data').addEventListener('click', () => api.openData().catch(e => toast(e.message)));
api.onState(render);
api.onMenuCommand?.(command => {
  if (command === 'new-task') { if (!$('task-dialog').open) editTask(); }
  if (['tasks', 'activity', 'history'].includes(command)) switchPage(command);
  if (command === 'search') { switchPage('tasks'); $('task-search').focus(); }
});
$('task-search').addEventListener('input', renderTasks);
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { taskFilter = button.dataset.filter; renderTasks(); }));
$('clear-search').addEventListener('click', () => { $('task-search').value = ''; taskFilter = 'all'; renderTasks(); });
api.getState().then(render).catch(e => toast(e.message));
