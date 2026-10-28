const base = () => (localStorage.getItem('API_URL') || '').replace(/\/$/, '');
const tokenKey = 'ffs-console-session';
export function session() { try { return JSON.parse(sessionStorage.getItem(tokenKey) || 'null'); } catch { return null; } }
export function saveSession(user) { sessionStorage.setItem(tokenKey, JSON.stringify(user)); }
export function clearSession() { sessionStorage.removeItem(tokenKey); }
export function url(route, query = {}) {
  const result = new URL(base() + '/api' + route, location.origin);
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') result.searchParams.set(key, String(value));
  return result.toString();
}
export async function request(route, { method = 'GET', body, query, binary = false, signal } = {}) {
  const headers = { 'x-client': 'WebGui', 'x-client-name': 'Folder Sync Console', 'x-client-version': '0.2.1' };
  const user = session(); if (user?.token) headers.token = user.token;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url(route, query), { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal });
  if (binary && response.ok && response.headers.get('X-Folder-Sync-Content') === 'file') return response.blob();
  let result; try { result = await response.json(); } catch { throw Error('服务暂时不可用，请稍后重试。'); }
  if (!response.ok || !result.status) {
    if ([306, 307, 308, 309, 310].includes(result.code)) { clearSession(); window.dispatchEvent(new Event('session-expired')); }
    const message = String(result.message || result.msg || result.details || '请求失败').replaceAll('笔记库', '文件库').replaceAll('笔记', '文件');
    throw Error(message);
  }
  return result.data;
}
export const list = data => Array.isArray(data) ? data : data?.list || [];
export function bytes(value = 0) {
  if (!value) return '0 B'; const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return (value / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit ? 1 : 0 }) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][unit];
}
export function timestamp(value) {
  if (!value || new Date(value).getFullYear() < 2000) return '尚未运行';
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
