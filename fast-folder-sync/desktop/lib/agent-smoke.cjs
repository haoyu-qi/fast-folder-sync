const { fs, path } = require('./files.cjs');
async function verify(win, service, dataDir) {
  const legacy = await win.webContents.executeJavaScript(`(async () => {
    if (document.title !== 'Fast Folder Sync' || !document.getElementById('agent-entry')) throw Error('原首页或新增 Agent 入口不可用');
    return (await window.folderSync.getState()).tasks.map(t => t.id).sort();
  })()`);
  await fs.writeFile(path.join(dataDir, 'folder-home.png'), (await win.webContents.capturePage()).toPNG());
  const project = path.join(dataDir, 'agent-test-project');
  await fs.mkdir(project, { recursive: true });
  const native = path.join(service.home, '.claude/projects/smoke/memory');
  await fs.mkdir(native, { recursive: true });
  await fs.writeFile(path.join(native, 'MEMORY.md'), '发布前必须验证 staging\n项目约定使用 pnpm');
  const opened = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript("document.getElementById('agent-entry').click()");
  await opened;
  win.setSize(1280, 880);
  await new Promise(r => setTimeout(r, 300));
  const report = await win.webContents.executeJavaScript(`(async () => {
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const wait = async predicate => { for (let n = 0; n < 150; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('等待 Agent UI 超时'); };
    await wait(() => Boolean(state));
    check(document.title.includes('Agent Sync'), 'Agent 首页未加载');
    for (const name of ['projects', 'sources', 'devices', 'model', 'memories']) {
      document.querySelector('[data-tab="' + name + '"]').click();
      check(!document.getElementById(name + '-panel').hidden, '导航失败：' + name);
    }
    tab('projects');
    document.getElementById('project-name').value = '产品官网'; document.getElementById('project-form').requestSubmit();
    await wait(() => !working && state.projects.length === 1);
    const id = state.projects[0].id;
    document.getElementById('binding-project').value = id;
    document.getElementById('binding-path').value = ${JSON.stringify(project)};
    document.getElementById('binding-form').requestSubmit(); await wait(() => !working && state.bindings.length === 1);
    check(state.bindings[0].agents.includes('workbuddy'), 'WorkBuddy 未加入项目关联');
    tab('sources'); document.getElementById('detect').click(); await wait(() => !working && candidates.length > 0);
    const source = candidates.find(c => c.agent === 'claude' && c.kind === 'memory'); check(source, '未发现 Claude 记忆');
    document.querySelector('[data-source="' + source.id + '"]').checked = true;
    document.querySelector('[data-source-scope="' + source.id + '"]').value = id;
    document.getElementById('save-sources').click(); await wait(() => !working && state.entries.length === 1);
    document.getElementById('cycle').click(); await wait(() => !working && state.delivery[id]?.phase === 'success');
    tab('memories'); check(document.querySelectorAll('.memory-card').length === 1, '记忆卡片未显示');
    await perform(() => detail(state.entries[0])); check(document.getElementById('detail-dialog').open, '详情打不开'); document.getElementById('close-detail').click();
    await perform(() => showHistory(state.entries[0])); check(document.querySelector('.version-row'), '历史版本未显示'); document.getElementById('close-detail').click();
    const original = state.entries[0].value.text;
    check(original.includes('必须验证'), '原文约束丢失');
    return { navigation: true, projectForm: true, bindingForm: true, discovery: true, import: true, publish: true, detail: true, history: true };
  })()`);
  if (!(await fs.readFile(path.join(project, 'CODEBUDDY.md'), 'utf8')).includes('agent-sync:start')) throw Error('WorkBuddy 读取入口未生成');
  report.workbuddy = true;
  await fs.writeFile(path.join(dataDir, 'agent-home.png'), (await win.webContents.capturePage()).toPNG());
  for (const page of ['projects', 'sources', 'devices', 'model']) {
    await win.webContents.executeJavaScript(`tab(${JSON.stringify(page)})`);
    await new Promise(r => setTimeout(r, 150));
    await fs.writeFile(path.join(dataDir, 'agent-' + page + '.png'), (await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.executeJavaScript("tab('memories'); document.getElementById('toast').hidden = true");
  win.setSize(960, 700); await new Promise(r => setTimeout(r, 150));
  report.compact = await win.webContents.executeJavaScript(`(() => {
    if (document.documentElement.scrollWidth > innerWidth) throw Error('Agent 最小窗口横向溢出');
    for (const b of document.querySelectorAll('button')) if (b.checkVisibility()) {
      const rect = b.getBoundingClientRect(); if (rect.left < 0 || rect.right > innerWidth) throw Error('按钮被截断：' + b.textContent);
    }
    return true;
  })()`);
  await fs.writeFile(path.join(dataDir, 'agent-compact.png'), (await win.webContents.capturePage()).toPNG());
  const returned = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript("document.getElementById('files').click()");
  await returned;
  await new Promise(r => setTimeout(r, 150));
  report.legacyRoundTrip = await win.webContents.executeJavaScript(`(async () => {
    if (document.title !== 'Fast Folder Sync' || document.getElementById('tasks-page').classList.contains('hidden')) throw Error('返回原首页失败');
    const ids = (await window.folderSync.getState()).tasks.map(t => t.id).sort();
    if (JSON.stringify(ids) !== ${JSON.stringify(JSON.stringify(legacy))}) throw Error('切换功能后原任务发生变化');
    return true;
  })()`);
  return report;
}
module.exports = { verify };
