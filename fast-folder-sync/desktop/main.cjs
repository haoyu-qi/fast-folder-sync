const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Tray, Menu, nativeImage } = require('electron');
const { randomUUID } = require('node:crypto');
const { fs, path, readJson, atomicJson, safePath, statOrNull, digest, replaceFromFile, overlaps, validateRoots } = require('./lib/files.cjs');
const { syncLocal } = require('./lib/local-sync.cjs');
const { syncFns, serverUrl } = require('./lib/fns-sync.cjs');

const smoke = process.argv.includes('--smoke-test');
if (process.env.FFS_TEST_DATA && smoke) app.setPath('userData', path.resolve(process.env.FFS_TEST_DATA));
let win, tray, dataDir, tasks = [], logs = [], scheduler, quitting = false, writing = false;
const runs = new Map(), statuses = new Map();
const suspended = new Set();
function cleanTask(t) { const { token, ...rest } = t; return { ...rest, hasToken: Boolean(token) }; }
function snapshot() { return { tasks: tasks.map(t => ({ ...cleanTask(t), status: statuses.get(t.id) || { phase: t.enabled ? 'waiting' : 'paused' } })), logs, encryptionAvailable: safeStorage.isEncryptionAvailable() }; }
function publish() { if (win && !win.isDestroyed()) win.webContents.send('state', snapshot()); }
function redact(text) { for (const t of tasks) if (t.token) text = text.replaceAll(t.token, '[令牌已隐藏]'); return text; }
function log(id, level, message) {
  const task = tasks.find(t => t.id === id);
  // Never forward credentials from remote errors into the renderer or disk log.
  for (const t of tasks) if (t.token) message = message.replaceAll(t.token, '[令牌已隐藏]');
  logs.unshift({ id: randomUUID(), taskId: id, task: task?.name || '系统', level, message, time: new Date().toISOString() });
  logs = logs.slice(0, 500); publish();
}
async function persist(list) {
  if (writing) throw Error('正在保存配置，请稍后重试');
  writing = true;
  try {
    const disk = list.map(t => {
      const { token, ...rest } = t;
      if (token && !safeStorage.isEncryptionAvailable()) throw Error('操作系统凭据加密不可用，无法保存服务端令牌');
      return { ...rest, encryptedToken: token ? safeStorage.encryptString(token).toString('base64') : '' };
    });
    await atomicJson(path.join(dataDir, 'tasks.json'), disk);
    tasks = list; publish();
  } finally { writing = false; }
}
async function run(id) {
  if (runs.has(id) || suspended.has(id)) return;
  const task = tasks.find(t => t.id === id); if (!task) throw Error('任务不存在');
  const controller = new AbortController();
  const status = { ...statuses.get(id), phase: 'running', startedAt: new Date().toISOString() };
  statuses.set(id, status);
  const promise = (async () => {
    try {
      log(id, 'info', '开始' + (task.mode === 'backup' ? '备份' : '同步'));
      const result = await (task.backend === 'local' ? syncLocal : syncFns)(task, dataDir, (level, text) => log(id, level, text), controller.signal);
      statuses.set(id, { phase: 'success', lastRun: new Date().toISOString(), result, nextRun: Date.now() + task.interval * 1000 });
      log(id, result.conflicts ? 'warning' : 'success', `完成：上传 ${result.uploaded} · 下载 ${result.downloaded} · 删除 ${result.deleted} · 冲突 ${result.conflicts}`);
    } catch (e) {
      const stopped = controller.signal.aborted;
      statuses.set(id, { ...status, phase: stopped ? 'paused' : 'error', error: stopped ? '同步已暂停' : redact(e.message), nextRun: Date.now() + task.interval * 1000 });
      log(id, stopped ? 'info' : 'error', stopped ? '同步已暂停' : e.message);
    } finally { runs.delete(id); publish(); }
  })();
  runs.set(id, { controller, promise }); publish();
  return true;
}
async function stop(id) {
  const active = runs.get(id); if (active) { active.controller.abort(); await active.promise; }
}
async function saveTask(value) {
  if (!value || typeof value !== 'object') throw Error('无效的任务');
  const old = tasks.find(t => t.id === value.id);
  if (value.id && !old) throw Error('任务不存在');
  if (old && runs.has(old.id)) throw Error('请先暂停正在同步的任务');
  const task = {
    id: old?.id || randomUUID(), name: String(value.name || '').trim().slice(0, 100),
    source: path.resolve(String(value.source || '')), backend: value.backend,
    target: value.backend === 'local' ? path.resolve(String(value.target || '')) : '',
    server: value.backend === 'fns' ? String(value.server || '').trim().replace(/\/$/, '') : '',
    vault: value.backend === 'fns' ? String(value.vault || '').trim() : '',
    token: value.backend === 'fns' ? (String(value.token || '').trim() || old?.token || '') : '',
    mode: value.mode, interval: Number(value.interval), enabled: value.enabled !== false,
    propagateDeletes: value.propagateDeletes === true,
    excludes: Array.isArray(value.excludes) ? value.excludes.map(v => String(v).trim()).filter(Boolean).slice(0, 100) : []
  };
  if (!task.name || !value.source || !['local', 'fns'].includes(task.backend) || !['backup', 'sync'].includes(task.mode) || !Number.isInteger(task.interval) || task.interval < 10 || task.interval > 86400) throw Error('请完整填写任务，并将同步间隔设为 10～86400 秒');
  const sourceStat = await fs.lstat(task.source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw Error('请选择真实的源文件夹');
  if (task.backend === 'local') {
    if (!value.target) throw Error('请选择目标文件夹');
    await validateRoots(task.source, task.target);
  } else {
    serverUrl(task.server);
    if (!task.vault || !task.token) throw Error('请填写仓库名和令牌');
    if (task.mode !== 'sync') throw Error('服务端目标请选择双向同步');
  }
  const roots = [task.source, ...(task.backend === 'local' ? [task.target] : [])];
  for (const root of roots) {
    const real = await fs.realpath(root), appData = await fs.realpath(dataDir);
    if (overlaps(real, appData) || overlaps(appData, real)) throw Error('同步文件夹不能包含应用的数据或备份目录');
    for (const other of tasks.filter(t => t.id !== task.id)) for (const otherRoot of [other.source, ...(other.backend === 'local' ? [other.target] : [])]) {
      let otherReal; try { otherReal = await fs.realpath(otherRoot); } catch { otherReal = path.resolve(otherRoot); }
      if (overlaps(real, otherReal) || overlaps(otherReal, real)) throw Error('此文件夹与任务“' + other.name + '”重叠，请为不同任务选择独立目录');
    }
  }
  if (task.backend === 'fns' && tasks.some(t => t.id !== task.id && t.backend === 'fns' && t.server === task.server && t.vault === task.vault)) throw Error('同一服务端仓库只能绑定一个本地任务');
  if (old && ['source', 'target', 'backend', 'server', 'vault', 'mode', 'propagateDeletes'].some(k => task[k] !== old[k])) {
    // A changed endpoint gets a fresh reconciliation baseline; old histories stay
    // attached to their original task rather than restoring into a new folder.
    throw Error('更换路径、目标类型、模式或删除策略时，请新建任务，避免复用旧同步基线');
  }
  await persist(old ? tasks.map(t => t.id === task.id ? task : t) : [...tasks, task]);
  statuses.set(task.id, { ...statuses.get(task.id), phase: task.enabled ? 'waiting' : 'paused', nextRun: Date.now() + task.interval * 1000 });
  log(task.id, 'info', '任务已保存'); return cleanTask(task);
}
async function history(id) {
  if (!tasks.some(t => t.id === id)) throw Error('任务不存在');
  const folder = path.join(dataDir, 'history', id);
  if (!(await statOrNull(folder))) return [];
  const result = [];
  for (const file of await fs.readdir(folder)) if (/^[0-9a-f-]{36}\.json$/.test(file)) result.push(await readJson(path.join(folder, file), null));
  return result.filter(Boolean).sort((a, b) => b.time.localeCompare(a.time));
}
async function restore(id, version) {
  const task = tasks.find(t => t.id === id);
  if (!task || !/^[0-9a-f-]{36}$/.test(version)) throw Error('无效的版本');
  if (runs.has(id)) throw Error('请先暂停任务，再恢复文件');
  if (task.enabled) throw Error('请先关闭此任务的自动同步，再恢复文件');
  const folder = path.join(dataDir, 'history', id), item = await readJson(path.join(folder, version + '.json'), null);
  if (!item || !['source', 'target'].includes(item.side)) throw Error('版本不存在');
  const root = item.side === 'source' ? task.source : task.target;
  if (!root) throw Error('恢复目标不存在');
  const target = await safePath(root, item.path), s = await statOrNull(target);
  const backup = path.join(folder, version + '.bin');
  if (await digest(backup) !== item.hash) throw Error('历史版本校验失败');
  await replaceFromFile(root, item.path, backup, { historyDir: folder, side: item.side, expectedHash: s ? await digest(target) : null, reason: '恢复前备份' });
  log(id, 'success', '已恢复 ' + item.path); return true;
}
function ipc(name, handler) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('无效请求来源');
    try { return { ok: true, value: await handler(...args) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
}
function registerIpc() {
  ipc('get-state', snapshot);
  ipc('choose-folder', async () => { const answer = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return answer.canceled ? null : answer.filePaths[0]; });
  ipc('save-task', async value => { if (value?.id) suspended.add(value.id); try { return await saveTask(value); } finally { if (value?.id) suspended.delete(value.id); } });
  ipc('run-task', run);
  ipc('toggle-task', async id => {
    const task = tasks.find(t => t.id === id); if (!task) throw Error('任务不存在');
    suspended.add(id);
    try {
      await stop(id); await persist(tasks.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
      statuses.set(id, { ...statuses.get(id), phase: task.enabled ? 'paused' : 'waiting', nextRun: Date.now() + task.interval * 1000 }); publish();
    } finally { suspended.delete(id); }
  });
  ipc('delete-task', async id => { suspended.add(id); try { await stop(id); await persist(tasks.filter(t => t.id !== id)); statuses.delete(id); return true; } finally { suspended.delete(id); } });
  ipc('history', history);
  ipc('restore', async (id, version) => { suspended.add(id); try { return await restore(id, version); } finally { suspended.delete(id); } });
  ipc('open-folder', async (id, side) => {
    const task = tasks.find(t => t.id === id); if (!task || !['source', 'target'].includes(side)) throw Error('无效的目录');
    const folder = task[side]; if (!folder || !(await fs.stat(folder)).isDirectory()) throw Error('目录不可用');
    const error = await shell.openPath(folder); if (error) throw Error(error);
  });
  ipc('open-data', async () => { const error = await shell.openPath(dataDir); if (error) throw Error(error); });
}
async function createWindow() {
  win = new BrowserWindow({ width: 1240, height: 840, minWidth: 960, minHeight: 660, backgroundColor: '#f6f8fb', title: 'Fast Folder Sync', icon: path.join(__dirname, 'icon.png'), show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.on('close', event => { if (!quitting && tray) { event.preventDefault(); win.hide(); } });
  await win.loadFile(path.join(__dirname, 'index.html')); win.show();
  if (smoke) {
    await new Promise(r => setTimeout(r, 700));
    const report = {};
    if (process.env.FFS_SMOKE_SOURCE && process.env.FFS_SMOKE_TARGET) {
      const source = path.resolve(process.env.FFS_SMOKE_SOURCE), target = path.resolve(process.env.FFS_SMOKE_TARGET);
      await win.webContents.executeJavaScript(`(() => { document.getElementById('add-task').click(); document.getElementById('task-name').value='工作文档备份'; document.getElementById('source').value=${JSON.stringify(source)}; document.getElementById('target').value=${JSON.stringify(target)}; document.getElementById('enabled').checked=false; document.getElementById('task-form').requestSubmit(); })()`);
      for (let i = 0; i < 80 && !tasks.length; i++) await new Promise(r => setTimeout(r, 50));
      if (tasks.length !== 1) throw Error('UI 保存任务失败');
      const task = tasks[0];
      await win.webContents.executeJavaScript(`document.querySelector('.task-actions .primary').click()`);
      for (let i = 0; i < 100 && statuses.get(task.id)?.phase !== 'success'; i++) {
        if (statuses.get(task.id)?.phase === 'error') throw Error(statuses.get(task.id).error);
        await new Promise(r => setTimeout(r, 50));
      }
      if (statuses.get(task.id)?.phase !== 'success') throw Error('UI 同步未完成');
      report.firstResult = statuses.get(task.id).result;
      await fs.writeFile(path.join(source, 'readme.txt'), 'Version 2'); await run(task.id); await runs.get(task.id)?.promise;
      const versions = await history(task.id); report.historyCount = versions.length;
      if (!versions.length) throw Error('未生成历史版本');
      await restore(task.id, versions[0].id);
      report.restored = await fs.readFile(path.join(target, 'readme.txt'), 'utf8');
      if (report.restored !== 'Version 1') throw Error('历史恢复失败');
    }
    await new Promise(r => setTimeout(r, 1500));
    await win.webContents.executeJavaScript("document.getElementById('toast').classList.add('hidden')");
    await fs.writeFile(path.join(dataDir, 'smoke.png'), (await win.webContents.capturePage()).toPNG());
    const state = await win.webContents.executeJavaScript('({title:document.title,cards:document.querySelectorAll(".task-card").length,bridge:typeof window.folderSync.getState})');
    await atomicJson(path.join(dataDir, 'smoke.json'), { ...state, ...report }); quitting = true; app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    dataDir = app.getPath('userData'); await fs.mkdir(dataDir, { recursive: true });
    const disk = await readJson(path.join(dataDir, 'tasks.json'), []);
    if (!Array.isArray(disk)) throw Error('任务配置损坏');
    tasks = disk.map(t => {
      if (!/^[0-9a-f-]{36}$/.test(t.id)) throw Error('任务标识无效');
      const { encryptedToken, ...rest } = t;
      return { ...rest, token: encryptedToken ? safeStorage.decryptString(Buffer.from(encryptedToken, 'base64')) : '' };
    });
    registerIpc(); await createWindow();
    if (!smoke) {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 20, height: 20 }));
      tray.setToolTip('Fast Folder Sync');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 Fast Folder Sync', click: () => win.show() }, { label: '退出', click: () => { quitting = true; app.quit(); } }])); tray.on('double-click', () => win.show());
      scheduler = setInterval(() => { for (const t of tasks) if (t.enabled && !runs.has(t.id) && (statuses.get(t.id)?.nextRun || 0) <= Date.now()) void run(t.id); }, 1000);
    }
  }).catch(async e => { if (smoke) { await atomicJson(path.join(dataDir, 'smoke-error.json'), { error: e.message, stack: e.stack }); app.exit(1); } else { dialog.showErrorBox('Fast Folder Sync 启动失败', e.message); quitting = true; app.quit(); } });
  app.on('before-quit', event => {
    clearInterval(scheduler);
    if (runs.size) {
      event.preventDefault(); quitting = true;
      Promise.all([...runs.keys()].map(stop)).then(() => app.quit());
    }
  });
  app.on('activate', () => { win?.show(); });
}
