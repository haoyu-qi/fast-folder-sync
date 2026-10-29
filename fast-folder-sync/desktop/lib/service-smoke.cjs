const { fs, path } = require('./files.cjs');
async function verify(win, dataDir) {
  const source = dataDir + '-connection-source';
  await fs.mkdir(source, { recursive: true });
  const result = await win.webContents.executeJavaScript(`(async () => {
    const $ = id => document.getElementById(id);
    const check = (ok, message) => { if (!ok) throw Error(message); };
    $('add-task').click();
    $('backend').value = 'fns'; $('backend').dispatchEvent(new Event('change'));
    $('config-details').open = true;
    $('connection-config').value = JSON.stringify({ server: 'https://example.test/private', vault: '表单验证', token: 'smoke-only-token' });
    $('import-config').click();
    check($('server').value === 'https://example.test/private' && $('vault').value === '表单验证', '完整配置未填入');
    check(!$('connection-config').value && !$('config-details').open, '导入后未清空粘贴内容');
    $('task-name').value = '连接表单验证'; $('source').value = ${JSON.stringify(source)}; $('enabled').checked = false;
    $('task-form').requestSubmit();
    for (let i = 0; i < 100 && $('task-dialog').open; i++) await new Promise(r => setTimeout(r, 30));
    check(!$('task-dialog').open, '导入配置保存失败：' + $('form-error').textContent);
    check(!$('token').value, '保存后未清空令牌输入');
    const task = (await window.folderSync.getState()).tasks.find(t => t.name === '连接表单验证');
    check(task?.hasToken && !task.token, '已保存任务状态不正确');
    $('add-task').click();
    check($('backend').value === 'fns' && $('saved-connection').value === task.id, '未默认复用最近的服务连接');
    check($('server').disabled && $('token').disabled && !$('token').required, '复用连接仍要求输入凭据');
    check(!$('vault').value && !$('source').value, '新增任务错误沿用了文件库或路径');
    check($('vault').required && !$('vault').disabled, '新增任务不能指定独立文件库');
    return { taskId: task.id, imported: true, reused: true, vaultBlank: true };
  })()`);
  await fs.writeFile(path.join(dataDir, 'connection-form.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('cancel-dialog').click();
    await window.folderSync.deleteTask(${JSON.stringify(result.taskId)});
  })()`);
  return { imported: result.imported, reused: result.reused, vaultBlank: result.vaultBlank };
}
module.exports = { verify };
