// Shared by the Windows and Mac forms. Credentials never come from saved tasks.
(function (root) {
  function parse(text) {
    let config;
    try { config = JSON.parse(text); } catch { throw Error('请粘贴网页端“复制完整配置”生成的 JSON'); }
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        !['server', 'vault', 'token'].every(key => typeof config[key] === 'string' && config[key].trim())) {
      throw Error('配置需包含服务地址 server、文件库 vault 和设备令牌 token');
    }
    let url;
    try { url = new URL(config.server.trim()); } catch { throw Error('配置中的服务地址无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('配置中的服务地址应为 HTTP 或 HTTPS 根地址');
    return { server: url.href.replace(/\/$/, ''), vault: config.vault.trim(), token: config.token.trim() };
  }
  function bind({ getTasks, getEditing, updateBackend }) {
    const $ = id => document.getElementById(id);
    const select = $('saved-connection');
    function update() {
      const editing = getEditing(), reuse = !editing && Boolean(select.value);
      $('connection-tools').classList.toggle('hidden', Boolean(editing));
      $('server').disabled = Boolean(editing) || reuse;
      $('token').disabled = reuse;
      $('token').required = $('backend').value === 'fns' && !editing?.hasToken && !reuse;
      $('token').placeholder = reuse ? '使用此连接已加密保存的令牌' : editing?.hasToken ? '留空保留已保存的令牌' : '仅在此电脑加密保存';
    }
    select.addEventListener('change', () => {
      const task = getTasks().find(t => t.id === select.value);
      $('server').value = task?.server || '';
      $('token').value = '';
      update();
    });
    $('import-config').addEventListener('click', () => {
      try {
        const config = parse($('connection-config').value);
        select.value = '';
        for (const key of ['server', 'vault', 'token']) $(key).value = config[key];
        $('connection-config').value = ''; $('config-details').open = false;
        $('form-error').textContent = ''; updateBackend();
      } catch (e) { $('form-error').textContent = e.message; }
    });
    return {
      update,
      reset(task) {
        select.replaceChildren(new Option('新连接 / 手动填写', ''), ...getTasks().filter(t => t.backend === 'fns' && t.hasToken).map(t => new Option(t.name + ' · ' + t.server, t.id)));
        $('connection-config').value = ''; $('config-details').open = false;
        const recent = getTasks().at(-1);
        if (!task && recent?.backend === 'fns' && recent.hasToken) {
          select.value = recent.id; $('server').value = recent.server; $('backend').value = 'fns';
        }
      },
      connectionTaskId: () => getEditing() ? '' : select.value
    };
  }
  const api = { parse, bind };
  if (typeof module === 'object') module.exports = api;
  else root.ServiceConfig = api;
})(globalThis);
