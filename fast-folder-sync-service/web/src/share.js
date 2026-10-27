import { url } from './api.js';
export function showSharedFile(root, resourceId, shareToken) {
  root.innerHTML = '<div class="login-shell"><div class="login-brand"><span class="wordmark"><i class="ph ph-folders" aria-hidden="true"></i> Folder Sync</span></div><div class="login-card"><div class="login-emblem"><i class="ph ph-file-arrow-down" aria-hidden="true"></i></div><h1>有一份文件，与你分享。</h1><p>此入口只允许读取链接授权的文件。</p><form id="shared-file-form"><label>访问密码（如有）<input type="password" name="password" autocomplete="off"></label><div class="form-error" role="alert"></div><button type="submit" class="primary full-width">获取文件 <i class="ph ph-download-simple" aria-hidden="true"></i></button></form></div><div class="login-footer">私有文件 · 受控访问</div></div>';
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    const form = event.currentTarget, button = form.querySelector('button'), error = form.querySelector('.form-error');
    button.disabled = true; error.textContent = '';
    const query = { id: resourceId, password: new FormData(form).get('password') || '' };
    try {
      const headers = { 'Share-Token': shareToken };
      const response = await fetch(url('/share/file', query), { headers });
      let blob, name = 'shared-file';
      if (response.ok && response.headers.get('etag')) blob = await response.blob();
      else {
        const textResponse = await fetch(url('/share/note', query), { headers });
        const result = await textResponse.json();
        if (!textResponse.ok || !result.status) throw Error('链接已失效、未授权，或访问密码不正确。');
        blob = new Blob([result.data.content], { type: 'application/octet-stream' }); name = result.data.path.split('/').pop();
      }
      const href = URL.createObjectURL(blob), link = document.createElement('a'); link.href = href; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (problem) { error.textContent = problem.message || '文件暂时不可用。'; }
    finally { button.disabled = false; }
  });
}
