function connectionToken(value, tasks, old) {
  if (value.connectionTaskId) {
    if (old || value.backend !== 'fns') throw Error('只有新建私有服务任务可以复用连接');
    const saved = tasks.find(t => t.id === value.connectionTaskId && t.backend === 'fns' && t.token);
    if (!saved) throw Error('已保存的服务连接不可用，请重新选择');
    const normalize = server => new URL(String(server).trim()).href.replace(/\/$/, '');
    if (normalize(saved.server) !== normalize(value.server)) throw Error('复用连接的服务地址不一致，请重新选择连接');
    return saved.token;
  }
  return String(value.token || '').trim() || old?.token || '';
}
module.exports = { connectionToken };
