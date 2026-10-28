// Runs only with --smoke-test. Uses the actual renderer, isolated IPC and sync tasks.
const { nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verify(win, output) {
  const evaluate = code => win.webContents.executeJavaScript(code);
  const capture = async name => {
    await new Promise(resolve => setTimeout(resolve, 180));
    await fs.writeFile(path.join(output, 'mac-' + name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  const report = await evaluate(`(async () => {
    document.documentElement.dataset.platform = 'darwin';
    const $ = id => document.getElementById(id);
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const count = () => document.querySelectorAll('.task-card').length;
    const original = count();
    check(original > 0, '缺少用于检查的真实同步任务');
    $('task-search').value = '不存在的任务-qa'; $('task-search').dispatchEvent(new Event('input'));
    check(count() === 0 && !$('no-results').classList.contains('hidden'), '搜索无结果状态失败');
    $('clear-search').click(); check(count() === original, '清除筛选失败');
    const name = document.querySelector('.task-title h3').textContent;
    $('task-search').value = name; $('task-search').dispatchEvent(new Event('input'));
    check(count() === 1, '按名称搜索失败'); $('clear-search').click();
    document.querySelector('[data-filter=auto]').click(); check(count() === 0, '暂停任务不应出现在自动同步中');
    document.querySelector('[data-filter=attention]').click(); check(count() === 0, '成功任务不应显示为需要关注');
    document.querySelector('[data-filter=all]').click();
    document.querySelectorAll('.task-actions button')[1].click();
    for (let i=0;i<60 && $('enabled-count').textContent !== '1';i++) await new Promise(r=>setTimeout(r,50));
    check($('enabled-count').textContent === '1', '启用自动同步失败');
    document.querySelector('[data-filter=auto]').click(); check(count() === 1, '自动任务筛选失败');
    document.querySelectorAll('.task-actions button')[1].click();
    for (let i=0;i<60 && $('enabled-count').textContent !== '0';i++) await new Promise(r=>setTimeout(r,50));
    check($('enabled-count').textContent === '0', '暂停自动同步失败');
    document.querySelector('[data-filter=all]').click();
    document.querySelectorAll('.task-actions button')[2].click();
    check($('task-dialog').open && $('pick-source').disabled && $('backend').disabled && $('delete-button'), '编辑任务保护失败');
    $('cancel-dialog').click();
    document.querySelector('[data-page=activity]').click();
    check(!$('activity-page').classList.contains('hidden') && document.querySelector('[aria-current=page]').dataset.page === 'activity', '记录导航失败');
    check(document.querySelectorAll('.log').length > 0, '真实同步记录未显示');
    document.querySelector('[data-page=history]').click(); $('history-task').selectedIndex = 1; await renderHistory();
    check(document.querySelectorAll('.history-row').length > 0, '历史版本未显示');
    $('add-task').click(); check($('task-dialog').open && document.activeElement.id === 'task-name', '新建弹窗焦点失败');
    $('backend').value = 'fns'; $('backend').dispatchEvent(new Event('change'));
    check(!$('remote-fields').classList.contains('hidden') && $('mode').disabled && $('mode').value === 'sync' && $('token').required, '远程表单切换失败');
    $('backend').value = 'local'; $('backend').dispatchEvent(new Event('change'));
    check(!$('local-fields').classList.contains('hidden') && !$('mode').disabled && $('target').required, '本地表单切换失败');
    $('cancel-dialog').click(); check(!$('task-dialog').open, '关闭弹窗失败');
    document.querySelector('[data-page=tasks]').click(); $('toast').classList.add('hidden');
    return {host:window.folderSync.platform,layout:'darwin',search:true,filters:true,toggle:true,editProtection:true,navigation:true,history:true,formFocus:true,backendFields:true};
  })()`);
  win.webContents.send('mac-menu-command', 'new-task');
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!await evaluate("document.getElementById('task-dialog').open")) throw Error('Mac 菜单命令未到达隔离渲染器');
  report.menuCommand = true;
  const previousTheme = nativeTheme.themeSource;
  try {
    nativeTheme.themeSource = 'light';
    await capture('dialog');
    await evaluate("document.getElementById('cancel-dialog').click()");
    await capture('light');
    await evaluate("document.querySelector('[data-page=activity]').click()"); await capture('activity');
    await evaluate("document.querySelector('[data-page=history]').click()"); await capture('history');
    await evaluate("document.querySelector('[data-page=tasks]').click()");
    nativeTheme.themeSource = 'dark'; await capture('dark');
    nativeTheme.themeSource = 'light'; win.setSize(960, 700); await capture('compact');
    report.compact = await evaluate(`(() => {
      if (document.documentElement.scrollWidth > innerWidth) throw Error('最小窗口横向溢出');
      for(const el of document.querySelectorAll('button')) { if(!el.checkVisibility()) continue; const r=el.getBoundingClientRect(); if(r.left<0 || r.right>innerWidth) throw Error('按钮被截断:'+el.textContent); }
      return {width:innerWidth,height:innerHeight,horizontalOverflow:false};
    })()`);
  } finally { nativeTheme.themeSource = previousTheme; }
  return report;
}
module.exports = { verify };
