import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, url, bytes, list, saveSession, session, timestamp } from '../src/api.js';
const local = new Map(), sessionValues = new Map();
globalThis.localStorage = { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v) };
globalThis.sessionStorage = { getItem: k => sessionValues.get(k) || null, setItem: (k, v) => sessionValues.set(k, v), removeItem: k => sessionValues.delete(k) };
globalThis.location = { origin: 'https://sync.example.test' };
globalThis.window = { dispatchEvent() {} };

test('API URL keeps configured reverse-proxy prefixes and encodes filenames', () => {
  local.set('API_URL', 'https://sync.example.test/private');
  const target = new URL(url('/drive/content', { path: '资料/a & b.json', vault: '家庭' }));
  assert.equal(target.pathname, '/private/api/drive/content'); assert.equal(target.searchParams.get('path'), '资料/a & b.json');
  local.clear();
});
test('JSON files with response-like contents are downloaded as bytes', async () => {
  const content = '{"status":false,"code":500,"message":"this is a real file"}';
  globalThis.fetch = async () => new Response(content, { headers: { 'Content-Type': 'application/json', 'X-Folder-Sync-Content': 'file' } });
  const result = await request('/drive/content', { binary: true }); assert.ok(result instanceof Blob); assert.equal(await result.text(), content);
});
test('expired authentication clears the browser session and surfaces a readable error', async () => {
  saveSession({ token: 'test-only', username: 'demo' });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['x-client'], 'WebGui'); assert.equal(options.headers.token, 'test-only');
    return new Response(JSON.stringify({ code: 308, status: false, message: 'Session expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  };
  await assert.rejects(request('/drive/spaces'), /Session expired/); assert.equal(session(), null);
});
test('empty lists and byte counts render truthfully', () => {
  assert.deepEqual(list(undefined), []); assert.deepEqual(list({ list: [1] }), [1]); assert.equal(bytes(0), '0 B'); assert.equal(bytes(1024), '1 KB');
});

test('unset or invalid schedules do not display a misleading date', () => {
  for (const value of [undefined, null, 0, '', '0001-01-01T00:00:00Z', 'invalid']) {
    assert.equal(timestamp(value), '尚未运行');
    assert.equal(timestamp(value, '待安排'), '待安排');
  }
  assert.match(timestamp('2026-10-28T10:30:00Z'), /10\/28/);
});
