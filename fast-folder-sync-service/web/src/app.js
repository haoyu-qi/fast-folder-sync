import '@phosphor-icons/web/regular/style.css';
import './style.css';
import { request, session, saveSession, clearSession, list, bytes, timestamp, url } from './api.js';
import { showSharedFile } from './share.js';
import { version } from '../package.json';

const $ = selector => document.querySelector(selector);
const root = $('#app'), modal = $('#modal');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = (name, cls = '') => `<i class="ph ph-${name} ${cls}" aria-hidden="true"></i>`;
const button = (action, text, glyph, cls = '') => `<button class="${cls}" data-action="${action}">${glyph ? icon(glyph) : ''}<span>${text}</span></button>`;
const viewNames = { overview: '概览', files: '文件浏览', backups: '备份任务', devices: '连接设备', activity: '同步记录', recycle: '回收站', storage: '存储位置', settings: '设置' };
let state = { view: 'overview', user: session(), spaces: [], backups: [], storage: [], tokens: [], clients: [], logs: [], entries: [], total: 0, selected: '', keyword: '', page: 1, healthy: false, busy: true, admin: false, loaded: false, registrationEnabled: null, oidc: null, error: '' };
let toastTimer, submitHandler, modalBusy = false, refreshSerial = 0;

function toast(message, error = false) {
  const target = $('#toast'); target.textContent = message; target.className = 'toast' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => target.classList.add('hidden'), 4000);
}
function go(view, space) {
  state.view = view; state.page = 1; state.keyword = '';
  if (space !== undefined) state.selected = space;
  location.hash = '/' + view;
  render(); window.scrollTo(0, 0); if (view === 'files' || view === 'recycle') void loadEntries();
}
function closeModal() { modal.close(); modal.replaceChildren(); submitHandler = null; }
function showModal(title, description, body, onSubmit, submitText = '保存', wide = false) {
  submitHandler = onSubmit;
  modal.className = wide ? 'wide' : '';
  modal.innerHTML = `<form id="modal-form"><div class="modal-heading"><div><h2>${escape(title)}</h2>${description ? `<p>${escape(description)}</p>` : ''}</div><button type="button" data-action="close-modal" class="icon-button" aria-label="关闭">${icon('x')}</button></div>${body}<div class="form-error" role="alert"></div><div class="modal-footer"><button type="button" data-action="close-modal">取消</button>${onSubmit ? `<button type="submit" class="primary">${escape(submitText)}</button>` : ''}</div></form>`;
  modal.showModal();
  (modal.querySelector('input:not([readonly]), select, textarea:not([readonly])') || modal.querySelector('button'))?.focus();
}
const input = (name, label, value = '', type = 'text', extra = '') => `<label>${name === 'username' ? '用户名' : label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra} ${name === 'username' ? 'minlength="3" maxlength="15" pattern="[A-Za-z0-9_]+" placeholder="3–15 位字母、数字或下划线"' : ''}></label>`;
const spaceOptions = selected => state.spaces.map(s => `<option value="${escape(s.name)}" ${s.name === selected ? 'selected' : ''}>${escape(s.name)}</option>`).join('');
const selectedSpace = () => state.spaces.find(s => s.name === state.selected);
const statCount = () => state.spaces.reduce((sum, s) => sum + s.fileCount, 0);
const statBytes = () => state.spaces.reduce((sum, s) => sum + s.size, 0);
const status = (text, cls = '') => `<span class="status ${cls}"><span></span>${escape(text)}</span>`;
const backupStatus = config => ({ 0: ['等待运行', 'muted'], 1: ['正在备份', 'running'], 2: ['备份成功', ''], 3: ['需要关注', 'failed'], 4: ['已停止', 'muted'] }[config.lastStatus] || ['等待运行', 'muted']);
const empty = (glyph, title, text, action = '') => `<div class="empty-state">${icon(glyph)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
function fileGlyph(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'heic'].includes(ext) ? 'image' : ['mp4', 'mov', 'avi', 'webm'].includes(ext) ? 'film-strip' : ['zip', '7z', 'tar', 'gz'].includes(ext) ? 'file-zip' : ext === 'pdf' ? 'file-pdf' : ['xlsx', 'csv', 'xls'].includes(ext) ? 'table' : 'file';
}
function libraryCard(space, index) {
  return `<article class="library-card"><div class="card-top"><div class="library-icon tone-${index % 3}">${icon('folder-simple')}</div><button class="icon-button" data-action="space-edit" data-index="${index}" aria-label="修改文件库名称">${icon('dots-three')}</button></div><button class="library-link" data-action="space-open" data-index="${index}">${escape(space.name)} ${icon('arrow-up-right')}</button><div class="library-meta"><span>${space.fileCount.toLocaleString()} 个文件</span><span>${bytes(space.size)}</span></div><div class="card-rule"></div><div class="card-foot">${icon('arrows-clockwise')}<span>更新于 ${timestamp(space.updatedAt)}</span></div></article>`;
}
function shell(content) {
  const nav = (view, glyph) => `<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${viewNames[view]}</span>${view === 'files' ? `<small>${statCount()}</small>` : ''}</button>`;
  const initials = (state.user?.username || state.user?.email || 'U').slice(0, 1).toUpperCase();
  root.innerHTML = `<button class="nav-backdrop" data-action="mobile-menu" aria-label="关闭导航" hidden></button><aside id="sidebar"><a class="wordmark" href="#/overview"><span class="brand-icon">${icon('arrows-left-right')}</span><span>Folder Sync<span class="wordmark-caption">文件夹同步与备份</span></span></a><div class="nav-label">工作空间</div><nav aria-label="文件空间">${nav('overview', 'squares-four')}${nav('files', 'folders')}${nav('backups', 'clock-clockwise')}${nav('devices', 'devices')}</nav><div class="nav-label second">管理</div><nav aria-label="服务管理">${nav('activity', 'pulse')}${nav('recycle', 'trash')}${nav('storage', 'hard-drives')}${nav('settings', 'gear-six')}</nav><div class="sidebar-bottom"><div class="side-note">${icon('shield-check')}<strong>文件在你掌控之中</strong><p>私有部署，安心同步。<br>每一份变化，都有迹可循。</p><span>${status(state.healthy ? '服务已连接' : '连接待检查', state.healthy ? '' : 'muted')}</span></div><div class="storage-summary">${icon('database')}<div><strong>${bytes(statBytes())}</strong><span>${state.spaces.length} 个文件库 · 私人文件空间</span></div></div><button class="account" data-action="account"><span class="avatar">${escape(initials)}</span><span><strong>${escape(state.user?.username || '我的账户')}</strong><small>账户与设置</small></span>${icon('caret-up-down')}</button><div class="app-version">Fast Folder Sync · v${version}</div></div></aside><div class="main-shell"><header class="topbar"><div class="crumbs"><button class="icon-button mobile-menu" data-action="mobile-menu" aria-label="打开导航" aria-expanded="false" aria-controls="sidebar">${icon('list')}</button><span>个人工作空间</span>${icon('caret-right')}<strong>${viewNames[state.view]}</strong></div><div class="topbar-right"><form id="search-form"><label class="search"><span class="sr-only">搜索文件</span>${icon('magnifying-glass')}<input name="keyword" placeholder="搜索文件名称或路径" value="${escape(state.keyword)}"><kbd>/</kbd></label></form><button class="icon-button" data-action="refresh" aria-label="刷新">${icon('arrow-clockwise', state.busy ? 'spinning' : '')}</button></div></header><main>${state.error ? `<div class="error-banner" role="alert">${icon('warning-circle')}<span>${escape(state.error)}</span><button data-action="refresh">重试</button></div>` : ''}${content}<footer><span>${icon('lock-key')} 文件保存在你的私有服务中</span><span>安心存储 · 自在同步</span></footer></main></div>`;
}
function overview() {
  const enabled = state.backups.filter(b => b.isEnabled).length;
  return `<section class="welcome"><div class="eyebrow">YOUR FILES, EVERYWHERE</div><div class="heading-row"><div><h1>文件工作空间</h1><p>管理每一份文件，连接每一台设备。</p></div><div class="welcome-actions">${button('connect', '连接桌面端', 'desktop', 'subtle')}${button('space-create', '新建文件库', 'plus', 'primary')}</div></div></section><section class="stats" aria-label="文件概览"><div><span>全部文件${icon('files')}</span><strong>${statCount().toLocaleString()}<small>个</small></strong><p>集中存放，随时取用</p></div><div><span>存储用量${icon('database')}</span><strong>${bytes(statBytes())}</strong><p>保存在你的私有服务中</p></div><div><span>自动备份${icon('arrows-clockwise')}</span><strong>${enabled}<small>项</small></strong><p>${enabled ? '备份计划已启用' : '按你的节奏安排'}</p></div><div><span>文件库${icon('folders')}</span><strong>${state.spaces.length}<small>个</small></strong><p>按文件夹独立管理</p></div></section><div class="overview-grid"><section><div class="section-title"><h2>我的文件库 <span>${state.spaces.length} 个</span></h2><button class="text-button" data-view="files">查看文件 ${icon('arrow-right')}</button></div>${state.spaces.length ? `<div class="library-grid">${state.spaces.slice(0, 6).map(libraryCard).join('')}</div>` : empty('folder-simple-plus', '从一个文件库开始', '把工作文档、照片或项目文件放在一起，连接电脑开始同步。', button('space-create', '创建第一个文件库', 'plus', 'primary'))}<div class="quiet-note">${icon('shield-check')}<span>文件变动由同步客户端核对，删除项可从回收站恢复。</span></div></section><section class="right-column"><div class="section-title"><h2>备份安排</h2><button class="icon-button" data-view="backups" aria-label="查看备份任务">${icon('arrow-up-right')}</button></div><div class="paper-card">${state.backups.length ? state.backups.slice(0, 3).map(b => `<div class="mini-backup"><div class="mini-icon">${icon('clock-clockwise')}</div><div><strong>${escape(b.vault || '全部文件库')}</strong><span>下次 ${timestamp(b.nextRunTime, '待安排')}</span>${status(...backupStatus(b))}</div></div>`).join('') : `<div class="paper-icon">${icon('clock-clockwise')}</div><h3>为重要文件多留一份</h3><p>把文件定期备份到另一处存储，重要资料多一份保障。</p>${button('backup-create', '安排一次备份', 'plus', 'full-width')}`}</div><div class="tip-card"><div class="tip-heading">${icon('desktop')}<strong>让电脑里的文件也归位</strong></div><p>连接桌面客户端，选择本地文件夹。以后的变化，交给自动同步。</p><button class="text-button" data-action="connect">连接我的电脑 ${icon('arrow-right')}</button></div></section></div>`;
}
function filesPage(recycle = false) {
  const title = recycle ? '回收站' : '文件浏览';
  const rows = state.entries.map((entry, index) => {
    const parts = entry.path.split('/'), name = parts.pop();
    return `<tr><td><div class="file-name"><span class="file-icon">${icon(fileGlyph(entry.path))}</span><div><strong>${escape(name)}</strong><small>${escape(parts.join('/') || '文件库根目录')}</small></div></div></td><td class="file-size">${bytes(entry.size)}</td><td class="file-date">${timestamp(entry.mtime)}</td><td><div class="row-actions">${recycle ? `<button data-action="file-restore" data-index="${index}" aria-label="恢复 ${escape(name)}">${icon('arrow-counter-clockwise')} 恢复</button>` : `<button class="icon-button" data-action="file-download" data-index="${index}" aria-label="下载 ${escape(name)}">${icon('download-simple')}</button><button class="icon-button" data-action="file-rename" data-index="${index}" aria-label="重命名 ${escape(name)}">${icon('pencil-simple')}</button><button class="icon-button" data-action="file-delete" data-index="${index}" aria-label="移入回收站 ${escape(name)}">${icon('trash')}</button>`}</div></td></tr>`;
  }).join('');
  return `<section class="page-heading"><div class="eyebrow">${recycle ? '给误删一次回旋的机会' : '文件浏览'}</div><div class="heading-row"><div><h1>${title}</h1><p>${recycle ? '删除的文件会在服务端保留期内等待恢复。' : '在浏览器中上传和下载，也可以交给桌面端自动同步。'}</p></div>${!recycle ? button('upload', '上传文件', 'upload-simple', 'primary') : ''}</div></section><div class="file-toolbar"><label class="library-select">${icon('folder-simple')}<select id="space-filter" aria-label="选择文件库">${spaceOptions(state.selected)}</select></label><span>${state.total.toLocaleString()} 个${recycle ? '已删除' : ''}文件</span><div class="toolbar-end">${!recycle ? button('upload-folder', '上传文件夹', 'folder-simple-plus', 'subtle') : ''}</div></div><section class="file-panel">${state.entries.length ? `<div class="table-scroll"><table><thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th class="align-right">操作</th></tr></thead><tbody>${rows}</tbody></table></div><div class="pagination"><span>第 ${state.page} 页 · 共 ${Math.ceil(state.total / 30) || 1} 页</span><div><button data-action="page-prev" ${state.page <= 1 ? 'disabled' : ''}>${icon('caret-left')} 上一页</button><button data-action="page-next" ${state.page * 30 >= state.total ? 'disabled' : ''}>下一页 ${icon('caret-right')}</button></div></div>` : empty(state.busy ? 'circle-notch spinning' : recycle ? 'trash' : 'folder-open', state.busy ? '正在整理文件清单…' : state.keyword ? '没有找到匹配的文件。' : recycle ? '这里暂时空空的。' : state.spaces.length ? '文件库已就绪。' : '还没有文件库。', state.busy ? '' : state.keyword ? '换一个文件名或路径试试。' : recycle ? '被移入回收站的文件会出现在这里。' : '上传第一份文件，或连接你的电脑开始同步。', !recycle && !state.busy ? button(state.spaces.length ? 'upload' : 'space-create', state.spaces.length ? '上传文件' : '新建文件库', 'plus', 'primary') : '')}</section><input class="hidden" id="file-picker" type="file" multiple><input class="hidden" id="folder-picker" type="file" webkitdirectory multiple>`;
}
function backupsPage() {
  return `<section class="page-heading"><div class="eyebrow">为重要文件留一份余地</div><div class="heading-row"><div><h1>备份任务</h1><p>按计划把文件库备份到本地磁盘或云端存储。</p></div>${button('backup-create', '新建备份任务', 'plus', 'primary')}</div></section><div class="stack">${state.backups.length ? state.backups.map((b, index) => `<article class="backup-card"><div class="backup-mark">${icon(b.type === 'sync' ? 'arrows-clockwise' : 'archive')}</div><div class="backup-info"><h3>${escape(b.vault || '全部文件库')} <span class="type-tag">${({ full: '全量归档', incremental: '增量归档', sync: '镜像同步' })[b.type] || '备份'}</span></h3><p>${escape(b.cronExpression || b.cronStrategy)} · 保留 ${b.retentionDays <= 0 ? '不限天数' : b.retentionDays + ' 天'} · ${b.isEnabled ? '自动执行' : '自动已暂停'}</p><div class="backup-times"><span>最近 ${timestamp(b.lastRunTime)}</span><span>下次 ${timestamp(b.nextRunTime, '待安排')}</span></div>${b.lastMessage && b.lastStatus === 3 ? `<p class="error-text">${escape(b.lastMessage)}</p>` : ''}</div><div class="backup-actions">${status(...backupStatus(b))}<div><button data-action="backup-run" data-index="${index}" ${b.lastStatus === 1 ? 'disabled' : ''}>立即备份</button><button class="icon-button" data-action="backup-edit" data-index="${index}" aria-label="编辑备份任务">${icon('gear-six')}</button><button class="icon-button" data-action="backup-history" data-index="${index}" aria-label="查看备份历史">${icon('clock-counter-clockwise')}</button></div></div></article>`).join('') : empty('archive', '下一份安心，从这里开始。', '选择文件库和存储位置，安排一个适合你的备份节奏。', button('backup-create', '新建备份任务', 'plus', 'primary'))}</div><div class="quiet-note">${icon('info')}<span>全量与增量归档用于保留备份；镜像同步会让目标跟随源内容。创建时请确认备份模式。</span></div>`;
}
function devicesPage() {
  const devices = state.admin ? state.clients : state.tokens.flatMap(t => (t.activeClients || []).map(name => ({ clientName: name, clientType: t.clientType, startTime: t.lastUsedAt })));
  return `<section class="page-heading"><div class="eyebrow">文件在设备之间，自然流动</div><div class="heading-row"><div><h1>连接设备</h1><p>这里展示当前在线的同步连接。</p></div>${button('connect', '连接新设备', 'plus', 'primary')}</div></section><div class="device-grid">${devices.length ? devices.map(d => `<article class="device-card"><div class="device-icon">${icon(d.platformInfo?.isMobile ? 'device-mobile' : 'desktop')}</div>${status('在线')}<h3>${escape(d.clientName || d.name || '同步设备')}</h3><p>${escape(d.clientType || '桌面客户端')}</p><div>连接于 ${timestamp(d.startTime || d.createdAt)}</div>${state.admin && d.remoteAddr ? `<small>${escape(d.remoteAddr)}</small>` : ''}</article>`).join('') : empty('devices', '在电脑上选好文件夹，其余交给同步。', '连接桌面客户端后，在线设备会显示在这里。', button('connect', '连接我的电脑', 'desktop', 'primary'))}</div><div class="section-title token-heading"><h2>访问令牌</h2><button class="text-button" data-action="connect">签发新令牌 ${icon('plus')}</button></div><div class="simple-panel">${state.tokens.length ? state.tokens.map((t, index) => `<div class="token-row"><div>${icon('key')}<strong>${escape(t.clientType)}</strong><span>${escape(t.vaults || '全部文件库')}</span></div><span>有效期至 ${timestamp(t.expiredAt)}</span><button class="text-button danger" data-action="token-revoke" data-index="${index}">撤销</button></div>`).join('') : `<p class="panel-hint">还没有签发桌面端访问令牌。</p>`}</div>`;
}
function activityPage() {
  return `<section class="page-heading"><div class="eyebrow">每一份变化，都有迹可循</div><h1>同步记录</h1><p>最近的文件变动与传输记录。</p></section><div class="simple-panel">${state.logs.length ? state.logs.map(log => `<div class="activity-row"><span class="activity-dot ${log.action === 'delete' ? 'deleted' : ''}">${icon(log.action === 'delete' ? 'trash' : 'arrows-clockwise')}</span><div><strong>${escape(log.path || log.filePath || '文件同步')}</strong><small>${escape(log.vault || '')} ${log.clientName ? '· ' + escape(log.clientName) : ''}</small></div><span class="activity-label">${escape(({ create: '新增', modify: '更新', delete: '删除', rename: '重命名', restore: '恢复', soft_delete: '移入回收站' })[log.action] || '同步')}</span><time>${timestamp(log.createdAt || log.timestamp)}</time></div>`).join('') : empty('list-checks', '变化会在这里留下记录。', '上传或同步文件后，刷新即可查看活动。')}</div>`;
}
function storagePage() {
  const typeNames = { 'localfs': '本地文件系统', 's3': 'Amazon S3', 'oss': '阿里云 OSS', 'r2': 'Cloudflare R2', minio: 'MinIO', webdav: 'WebDAV' };
  return `<section class="page-heading"><div class="eyebrow">为备份选择一个好去处</div><div class="heading-row"><div><h1>存储位置</h1><p>添加存储位置，供备份任务使用。</p></div>${button('storage-create', '添加存储位置', 'plus', 'primary')}</div></section><div class="storage-grid">${state.storage.length ? state.storage.map((s, index) => `<article class="storage-card"><div class="card-top"><div class="library-icon">${icon(s.type === 'localfs' ? 'hard-drives' : 'cloud')}</div>${status(s.isEnabled ? '已启用' : '已停用', s.isEnabled ? '' : 'muted')}</div><h3>${escape(typeNames[s.type] || s.type)}</h3><p>${escape(s.bucketName || s.customPath || s.endpoint || '已配置')}</p><div class="storage-card-actions"><button data-action="storage-edit" data-index="${index}">管理位置</button><button class="icon-button" data-action="storage-delete" data-index="${index}" aria-label="移除存储配置">${icon('trash')}</button></div></article>`).join('') : empty('cloud-arrow-up', '让文件，多一个落脚点。', '可以使用服务器本地磁盘，也可以连接你已有的云存储。', button('storage-create', '添加存储位置', 'plus', 'primary'))}</div>`;
}
function settingsPage() {
  return `<section class="page-heading"><div class="eyebrow">让同步适合你的习惯</div><h1>设置</h1><p>管理账户与服务连接。</p></section><section class="settings-card"><h2>账户</h2><div class="setting-row"><div><strong>${escape(state.user?.username)}</strong><p>${escape(state.user?.email)}</p></div>${button('password', '修改密码', 'lock-key')}</div><div class="setting-row"><div><strong>当前会话</strong><p>登录信息仅保存在当前浏览器会话中。</p></div>${button('logout', '退出登录', 'sign-out')}</div></section><section class="settings-card"><h2>服务连接</h2><div class="setting-row"><div><strong>${escape(new URL(url('/version')).origin)}</strong><p>文件与备份保存在你自己的服务和存储位置中。</p></div>${status(state.healthy ? '已连接' : '连接待检查', state.healthy ? '' : 'failed')}</div><div class="setting-row"><div><strong>客户端同步</strong><p>为每台设备创建访问令牌，并选择需要同步的文件库。</p></div>${button('connect', '连接设备', 'devices')}</div></section><div class="quiet-note">${icon('shield-check')}<span>自动同步、排除规则和覆盖前的本地历史版本，在桌面客户端中设置。服务端负责保存文件与执行备份计划。</span></div>`;
}
function render() {
  if (!state.user) { renderLogin(); decorateLogin(); return; }
  const pages = { overview, files: () => filesPage(false), recycle: () => filesPage(true), backups: backupsPage, devices: devicesPage, activity: activityPage, storage: storagePage, settings: settingsPage };
  shell((pages[state.view] || overview)());
}
async function loadEntries() {
  const serial = ++refreshSerial;
  if (!state.selected) { state.entries = []; state.total = 0; state.busy = false; render(); return; }
  state.busy = true; render();
  try {
    const data = await request('/drive/entries', { query: { vault: state.selected, keyword: state.keyword, page: state.page, pageSize: 30, isRecycle: state.view === 'recycle' } });
    if (serial !== refreshSerial) return; state.entries = list(data); state.total = data?.pager?.totalRows || 0; state.error = '';
  } catch (error) { state.error = error.message; state.entries = []; state.total = 0; }
  finally { if (serial === refreshSerial) { state.busy = false; render(); } }
}
async function refresh() {
  if (!state.user) return;
  state.busy = true; render();
  try {
    const spaces = await request('/drive/spaces'); state.spaces = list(spaces).sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name, 'zh-CN'));
    if (!state.spaces.some(s => s.name === state.selected)) state.selected = state.spaces[0]?.name || '';
    const routes = ['/backup/configs', '/storage', '/tokens', '/sync-logs', '/admin/check', '/health'];
    const results = await Promise.allSettled(routes.map(route => request(route, { query: route === '/sync-logs' ? { page: 1, pageSize: 30 } : undefined })));
    const data = results.map(r => r.status === 'fulfilled' ? r.value : undefined);
    state.backups = list(data[0]); state.storage = list(data[1]); state.tokens = list(data[2]); state.logs = list(data[3]); state.admin = Boolean(data[4]?.isAdmin); state.healthy = results[5].status === 'fulfilled';
    if (state.admin) { try { state.clients = list(await request('/admin/ws_clients')); } catch { state.clients = []; } }
    state.loaded = true; state.error = '';
  } catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); }
  if (state.view === 'files' || state.view === 'recycle') await loadEntries();
}
function renderLogin(register = false) {
  root.innerHTML = `<div class="login-shell"><div class="login-brand"><span class="wordmark">${icon('folders')} Folder Sync</span><span>文件备份与同步</span></div><div class="login-card"><div class="login-emblem">${icon('folders')}</div><h1>${register ? '为你的文件，留个位置。' : '欢迎回到 Folder Sync'}</h1><p>安放文件，连接设备。其余的，交给同步。</p><form id="login-form" data-register="${register}">${register ? input('username', '你的称呼', '', 'text', 'required autocomplete="username"') + input('email', '电子邮箱', '', 'email', 'required autocomplete="email"') : input('credentials', '邮箱或用户名', '', 'text', 'required autocomplete="username"')}${input('password', '密码', '', 'password', 'required minlength="8" autocomplete="' + (register ? 'new-password' : 'current-password') + '"')}${register ? input('confirmPassword', '确认密码', '', 'password', 'required minlength="8" autocomplete="new-password"') : ''}<div class="form-error" role="alert"></div><button type="submit" class="primary full-width">${register ? '创建账户' : '进入工作空间'} ${icon('arrow-right')}</button></form><div class="login-switch">${register ? '已有账户？' : '第一次来？'}<button class="text-button" data-action="${register ? 'login' : 'register'}">${register ? '返回登录' : '创建账户'}</button></div></div><div class="login-footer">${icon('lock-key')} 私有部署 · 文件由你掌控</div></div>`;
}
function decorateLogin() {
  if (state.registrationEnabled === false && $('.login-switch')) $('.login-switch').textContent = '请使用已有账户登录此私有服务。';
  if (!state.oidc?.enabled || !$('#login-form')) return;
  const providers = state.oidc.providers?.length ? state.oidc.providers : [{ displayName: state.oidc.displayName, startUrl: state.oidc.startUrl }];
  const container = document.createElement('div'); container.className = 'sso-options';
  for (const provider of providers) {
    const target = new URL(provider.startUrl, new URL(url('/version')).origin);
    if (target.origin !== new URL(url('/version')).origin || !target.pathname.startsWith('/api/user/auth/oidc/start')) continue;
    const link = document.createElement('a'); link.href = target.toString(); link.textContent = (provider.displayName || 'SSO') + ' 登录'; link.className = 'sso-login'; container.append(link);
  }
  $('#login-form').after(container);
}
function editSpace(space) {
  showModal(space ? '修改文件库名称' : '新建文件库', space ? '修改后，请同步更新桌面客户端的文件库配置。' : '把同一类文件放在一起，让同步有条不紊。', input('vault', '文件库名称', space?.name || '', 'text', 'required maxlength="100" placeholder="例如：工作资料、家庭相册"'), async data => {
    const name = data.get('vault').trim(); await request('/drive/spaces', { method: 'POST', body: { vault: name, ...(space ? { id: space.id } : {}) } });
    state.selected = name; closeModal(); toast(space ? '文件库名称已更新' : '文件库已创建'); await refresh();
  }, space ? '保存名称' : '创建文件库');
}
function connectDevice() {
  if (!state.spaces.length) { toast('先建立一个文件库，再连接设备。'); editSpace(); return; }
  showModal('连接你的电脑', '选择这台电脑可以同步的文件库。', `<div class="connection-steps"><span>1 选择文件库</span><span>2 生成配置</span><span>3 填入桌面端</span></div><label>同步到文件库<select name="vault" required>${spaceOptions(state.selected)}</select></label><label>授权范围<select name="scope"><option value="selected">仅所选文件库</option><option value="all">全部文件库（含今后新建的文件库）</option></select></label><p class="form-help">选择全部文件库后，桌面端新增文件夹可复用此次连接。仅向可信电脑授予此权限。</p>${input('days', '令牌有效天数', 30, 'number', 'min="1" max="3650" required')}<p class="form-help">在桌面端选择私有同步服务，粘贴下一步生成的完整配置，保存后可复用服务连接。</p>`, async data => {
    const vault = data.get('vault');
    const result = await request('/token', { method: 'POST', body: { clientType: 'FastFolderSync', protocol: 'ws', client: 'FastFolderSync', function: '*', expiredDays: Number(data.get('days')), vaults: data.get('scope') === 'all' ? '' : vault } });
    const server = new URL(url('/version')).origin + new URL(url('/version')).pathname.replace(/\/api\/version$/, '');
    modalBusy = false; closeModal();
    showModal('设备配置已准备好。', '在桌面端新建私有服务任务，展开“粘贴服务配置”后填入。', `<div class="config-field"><span>服务地址</span><code>${escape(server)}</code></div><div class="config-field"><span>文件库名称</span><code>${escape(vault)}</code></div><label>设备令牌<textarea id="issued-token" rows="4" readonly>${escape(result.token)}</textarea></label><button type="button" data-action="copy-token" class="full-width">${icon('copy')} 复制令牌</button><label>完整配置<textarea id="issued-config" rows="4" readonly>${escape(JSON.stringify({ server, vault, token: result.token }, null, 2))}</textarea></label><button type="button" data-action="copy-config" class="full-width">${icon('copy')} 复制完整配置</button><p class="form-help">授权范围：${data.get('scope') === 'all' ? '全部文件库（含今后新建）' : escape(vault)}。配置含设备令牌，请妥善保存；可在「连接设备」中随时撤销。</p>`, null);
    await refresh();
  }, '生成设备配置');
}
function editBackup(config) {
  if (!state.spaces.length) { editSpace(); return; }
  if (!state.storage.some(s => s.isEnabled)) { toast('先添加一个可用的存储位置。'); go('storage'); return; }
  let selectedIds = []; try { selectedIds = JSON.parse(config?.storageIds || '[]'); } catch { selectedIds = String(config?.storageIds || '').split(',').map(Number); }
  showModal(config ? '编辑备份任务' : '安排一次备份', '选择需要保护的文件库，以及另一处存储位置。', `<label>文件库<select name="vault" required>${spaceOptions(config?.vault || state.selected)}</select></label><div class="form-grid"><label>备份方式<select name="type"><option value="full" ${config?.type === 'full' ? 'selected' : ''}>全量归档</option><option value="incremental" ${config?.type === 'incremental' ? 'selected' : ''}>增量归档</option><option value="sync" ${config?.type === 'sync' ? 'selected' : ''}>镜像同步</option></select></label>${input('retentionDays', '保留天数（0 为不限）', config?.retentionDays ?? 30, 'number', 'min="0" required')}</div><label>存储位置<select name="storageIds" multiple required size="${Math.min(4, state.storage.length)}">${state.storage.filter(s => s.isEnabled).map(s => `<option value="${s.id}" ${selectedIds.includes(s.id) ? 'selected' : ''}>${escape(s.type === 'localfs' ? '本地磁盘' : s.type)} · ${escape(s.customPath || s.bucketName || s.endpoint)}</option>`).join('')}</select></label>${input('cronExpression', '执行计划（Cron）', config?.cronExpression || '30 0 * * *', 'text', 'required')}<p class="form-help">默认每天 00:30。使用服务器时区，格式：分钟 小时 日期 月份 星期。镜像模式会让目标跟随源内容。</p><label class="check"><input type="checkbox" name="isEnabled" ${config?.isEnabled === false ? '' : 'checked'}>启用自动备份</label>`, async data => {
    const body = { ...(config ? { id: config.id } : {}), vault: data.get('vault'), type: data.get('type'), storageIds: JSON.stringify(data.getAll('storageIds').map(Number)), cronStrategy: 'custom', cronExpression: data.get('cronExpression').trim(), retentionDays: Number(data.get('retentionDays')), includeVaultName: true, passwordMode: config?.passwordMode || 0, passwordValue: config?.passwordValue || '', isEnabled: data.has('isEnabled') };
    await request('/backup/config', { method: 'POST', body }); closeModal(); toast('备份计划已保存'); await refresh();
  }, '保存备份计划');
}
async function editStorage(config) {
  const enabled = list(await request('/storage/enabled_types'));
  const typeNames = { 'localfs': '本地文件系统', 's3': 'Amazon S3', 'oss': '阿里云 OSS', 'r2': 'Cloudflare R2', minio: 'MinIO', webdav: 'WebDAV' };
  const types = enabled.map(item => typeof item === 'string' ? item : item.type || item.value);
  showModal(config ? '管理存储位置' : '添加存储位置', '凭据只会提交到你当前连接的私有服务。', `<label>存储类型<select name="type" id="storage-type">${types.map(type => `<option value="${escape(type)}" ${config?.type === type ? 'selected' : ''}>${escape(typeNames[type] || type)}</option>`).join('')}</select></label>${input('customPath', '保存目录 / 路径前缀', config?.customPath || 'storage/backups', 'text', 'required')}<div id="cloud-storage-fields"><div class="form-grid">${input('endpoint', '服务端点', config?.endpoint || '', 'text', 'placeholder="https://s3.example.com"')}${input('bucketName', '存储桶', config?.bucketName || '')}</div><div class="form-grid">${input('region', '区域', config?.region || '')}${input('accountId', '账户 ID（R2）', config?.accountId || '')}</div>${input('accessKeyId', 'Access Key ID', config?.accessKeyId || '', 'password', 'autocomplete="off"')}${input('accessKeySecret', 'Access Key Secret', config?.accessKeySecret || '', 'password', 'autocomplete="off"')}<div class="form-grid">${input('user', '用户名（WebDAV）', config?.user || '')}${input('password', '密码（WebDAV）', config?.password || '', 'password', 'autocomplete="off"')}</div></div><p class="form-help">本地路径位于服务端机器。网络存储需要先在服务端配置中启用对应类型。</p><label class="check"><input name="isEnabled" type="checkbox" ${config?.isEnabled === false ? '' : 'checked'}>启用此存储位置</label>`, async data => {
    const body = new FormData();
    for (const [key, value] of data) body.append(key, value);
    body.set('isEnabled', data.has('isEnabled') ? '1' : '0'); body.set('accessUrlPrefix', config?.accessUrlPrefix || new URL(url('/version')).origin);
    if (config) body.set('id', String(config.id));
    await request('/storage/validate', { method: 'POST', body });
    await request('/storage', { method: 'POST', body }); closeModal(); toast('存储位置已保存'); await refresh();
  }, '验证并保存', true);
  updateStorageFields();
}
function updateStorageFields() { const select = $('#storage-type'); if (select) $('#cloud-storage-fields').classList.toggle('hidden', select.value === 'localfs'); }
async function uploadFiles(files) {
  if (!state.selected) { editSpace(); return; }
  const selected = [...files]; if (!selected.length) return;
  const target = state.selected; let completed = 0;
  for (const file of selected) {
    const data = new FormData(); data.append('vault', target); data.append('path', file.webkitRelativePath || file.name); data.append('mtime', String(file.lastModified || Date.now())); data.append('file', file);
    toast(`正在上传 ${++completed} / ${selected.length}：${file.name}`);
    await request('/drive/upload', { method: 'POST', body: data });
  }
  toast(`${selected.length} 个文件已上传`); await refresh();
}
async function downloadEntry(entry) {
  const blob = await request('/drive/content', { query: { vault: state.selected, path: entry.path, pathHash: entry.pathHash, kind: entry.kind, isRecycle: state.view === 'recycle' }, binary: true });
  const href = URL.createObjectURL(blob), a = document.createElement('a'); a.href = href; a.download = entry.path.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(href), 10000);
}
async function backupHistory(config) {
  const data = await request('/backup/historys', { query: { configId: config.id, page: 1, pageSize: 30 } });
  showModal('备份执行记录', config.vault || '全部文件库', `<div class="history-list">${list(data).length ? list(data).map(h => `<div><strong>${timestamp(h.startTime)}</strong>${status(...backupStatus({ lastStatus: h.status }))}<p>${h.fileCount} 个文件 · ${bytes(h.fileSize)}</p><small>${escape(h.message || '')}</small></div>`).join('') : '<p class="form-help">任务执行后会在这里生成记录。</p>'}</div>`, null, '', true);
}
function confirmAction(title, description, handler, label = '确认') {
  showModal(title, description, '', async () => { await handler(); closeModal(); await refresh(); }, label);
}

const actions = {
  home: () => go('overview'), 'space-create': () => editSpace(),
  'space-edit': el => editSpace(state.spaces[Number(el.dataset.index)]),
  'space-open': el => go('files', state.spaces[Number(el.dataset.index)].name),
  'backup-create': () => editBackup(), 'backup-edit': el => editBackup(state.backups[Number(el.dataset.index)]),
  'backup-run': async el => { await request('/backup/execute', { method: 'POST', body: { id: state.backups[Number(el.dataset.index)].id } }); toast('备份已开始，可稍后刷新查看结果'); await refresh(); },
  'backup-history': el => backupHistory(state.backups[Number(el.dataset.index)]),
  'storage-create': () => editStorage(), 'storage-edit': el => editStorage(state.storage[Number(el.dataset.index)]),
  'storage-delete': el => { const item = state.storage[Number(el.dataset.index)]; confirmAction('移除这个存储配置？', '仅移除连接配置，已备份的文件仍保留在存储位置。', () => request('/storage', { method: 'DELETE', query: { id: item.id } }), '移除配置'); },
  'file-download': el => downloadEntry(state.entries[Number(el.dataset.index)]),
  'file-delete': el => { const entry = state.entries[Number(el.dataset.index)], vault = state.selected; confirmAction('将文件移入回收站？', entry.path, () => request('/drive/entry', { method: 'DELETE', query: { vault, path: entry.path, pathHash: entry.pathHash, kind: entry.kind } }), '移入回收站'); },
  'file-restore': async el => { const entry = state.entries[Number(el.dataset.index)]; await request('/drive/entry/restore', { method: 'PUT', query: { kind: entry.kind }, body: { vault: state.selected, path: entry.path, pathHash: entry.pathHash } }); toast('文件已恢复'); await refresh(); },
  'file-rename': el => { const entry = state.entries[Number(el.dataset.index)], vault = state.selected; showModal('调整文件路径', '可以修改文件名，也可以移动到另一个相对目录。', input('path', '相对路径', entry.path, 'text', 'required'), async data => { await request('/drive/entry/rename', { method: 'POST', query: { kind: entry.kind }, body: { vault, oldPath: entry.path, oldPathHash: entry.pathHash, path: data.get('path') } }); closeModal(); await refresh(); }, '保存路径'); },
  upload: () => state.selected ? $('#file-picker')?.click() : editSpace(), 'upload-folder': () => state.selected ? $('#folder-picker')?.click() : editSpace(),
  'page-prev': () => { state.page--; return loadEntries(); }, 'page-next': () => { state.page++; return loadEntries(); },
  connect: connectDevice, refresh,
  'token-revoke': el => { const token = state.tokens[Number(el.dataset.index)]; confirmAction('撤销此访问令牌？', '使用此令牌的设备将断开连接。你可以随时签发新令牌。', () => request('/token/' + token.id, { method: 'DELETE' }), '撤销令牌'); },
  'copy-config': async () => { const field = $('#issued-config'); try { await navigator.clipboard.writeText(field.value); toast('完整配置已复制'); } catch { field.select(); toast('请复制已选中的完整配置'); } },
  'copy-token': async () => { const field = $('#issued-token'); try { await navigator.clipboard.writeText(field.value); toast('令牌已复制'); } catch { field.select(); toast('请复制已选中的令牌'); } },
  'close-modal': () => { if (!modalBusy) closeModal(); },
  account: () => go('settings'),
  logout: async () => { await request('/auth/logout', { method: 'POST' }); clearSession(); state.user = null; render(); },
  password: () => showModal('修改账户密码', '使用至少 8 位的新密码。', input('oldPassword', '当前密码', '', 'password', 'required autocomplete="current-password"') + input('password', '新密码', '', 'password', 'required minlength="8" autocomplete="new-password"') + input('confirmPassword', '确认新密码', '', 'password', 'required minlength="8" autocomplete="new-password"'), async data => { await request('/user/change_password', { method: 'POST', body: Object.fromEntries(data) }); closeModal(); toast('密码已更新，请重新登录'); clearSession(); state.user = null; render(); }, '更新密码'),
  register: () => renderLogin(true), login: () => renderLogin(false),
  'mobile-menu': () => {
    const open = $('#sidebar').classList.toggle('mobile-open');
    $('.nav-backdrop').hidden = !open;
    $('.main-shell').inert = open;
    $('.mobile-menu').setAttribute('aria-expanded', String(open));
    (open ? $('#sidebar .nav-item.active') : $('.mobile-menu'))?.focus();
  }
};
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]'); if (nav) { event.preventDefault(); go(nav.dataset.view); return; }
  const target = event.target.closest('[data-action]'); if (!target) return;
  event.preventDefault(); const handler = actions[target.dataset.action]; if (!handler) return;
  target.disabled = true; try { await handler(target); } catch (error) { toast(error.message, true); } finally { target.disabled = false; }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, data = new FormData(form);
  if (form.id === 'search-form') { state.keyword = data.get('keyword').trim(); state.view = 'files'; state.page = 1; location.hash = '/files'; await loadEntries(); return; }
  const submit = form.querySelector('[type="submit"]'), error = form.querySelector('.form-error');
  submit.disabled = true; if (error) error.textContent = '';
  try {
    if (form.id === 'login-form') {
      const registering = form.dataset.register === 'true';
      const user = await request(registering ? '/user/register' : '/user/login', { method: 'POST', body: Object.fromEntries(data) });
      if (user?.token) { saveSession(user); state.user = user; await refresh(); }
      else { renderLogin(false); toast('账户已创建，请登录。'); }
    } else if (form.id === 'modal-form' && submitHandler) {
      modalBusy = true; const handler = submitHandler;
      // The handler may replace the current modal after completing its request.
      await handler(data);
    }
  } catch (problem) { if (error?.isConnected) error.textContent = problem.message; else toast(problem.message, true); }
  finally { modalBusy = false; if (submit?.isConnected) submit.disabled = false; }
});
document.addEventListener('change', event => {
  if (event.target.id === 'space-filter') { state.selected = event.target.value; state.page = 1; void loadEntries(); }
  if (event.target.id === 'storage-type') updateStorageFields();
  if (['file-picker', 'folder-picker'].includes(event.target.id)) void uploadFiles(event.target.files).catch(error => toast(error.message, true));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#sidebar.mobile-open') && !modal.open) actions['mobile-menu']();
  if (event.key === '/' && !modal.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) { event.preventDefault(); $('input[name="keyword"]')?.focus(); }
});
modal.addEventListener('cancel', event => { if (modalBusy) event.preventDefault(); });
window.addEventListener('session-expired', () => { state.user = null; state.error = ''; modalBusy = false; closeModal(); render(); });
window.matchMedia('(max-width: 700px)').addEventListener('change', event => {
  if (!event.matches && $('#sidebar.mobile-open')) actions['mobile-menu']();
});
window.addEventListener('hashchange', () => { const view = location.hash.replace(/^#\//, ''); if (viewNames[view] && view !== state.view) { state.view = view; state.page = 1; render(); window.scrollTo(0, 0); if (['files', 'recycle'].includes(view)) void loadEntries(); } });
state.view = viewNames[location.hash.replace(/^#\//, '')] ? location.hash.replace(/^#\//, '') : 'overview';
const publicShare = location.pathname.match(/^\/share\/(\d+)\/([^/]+)\/?$/);
if (publicShare) showSharedFile(root, publicShare[1], decodeURIComponent(publicShare[2]));
else if (state.user) { render(); void refresh(); }
else {
  render();
  void request('/webgui/config').then(config => { state.registrationEnabled = config.registerIsEnable; if (!state.user) { renderLogin(); decorateLogin(); } }).catch(() => {});
  void request('/user/auth/oidc/config').then(config => { state.oidc = config; if (!state.user) { renderLogin(); decorateLogin(); } }).catch(() => {});
}
