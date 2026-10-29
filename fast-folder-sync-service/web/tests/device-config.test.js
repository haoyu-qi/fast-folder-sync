import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { parse } = createRequire(import.meta.url)('../../../fast-folder-sync/desktop/service-config.js');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const connectCode = app.slice(app.indexOf('function connectDevice()'), app.indexOf('function editBackup('));

for (const scope of ['selected', 'all']) test(`device configuration round trip: ${scope} library authorization`, async () => {
  const modals = [], requests = [];
  const context = vm.createContext({
    URL, JSON, state: { spaces: [{ name: '工作资料' }], selected: '工作资料' },
    spaceOptions: () => '<option>工作资料</option>', input: () => '', icon: () => '',
    escape: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    showModal: (...args) => modals.push(args), closeModal() {}, modalBusy: false,
    request: async (endpoint, options) => { requests.push({ endpoint, ...options }); return { token: 'device-token' }; },
    url: () => 'https://sync.test/prefix/api/version', refresh: async () => {},
  });
  vm.runInContext(connectCode + '\nconnectDevice();', context);
  assert.match(modals[0][2], /value="selected".*value="all"/);
  await modals[0][3](new Map([['vault', '工作资料'], ['scope', scope], ['days', '30']]));
  assert.equal(requests[0].endpoint, '/token');
  assert.equal(requests[0].body.vaults, scope === 'all' ? '' : '工作资料');
  const config = modals[1][2].match(/id="issued-config"[^>]*>(.*?)<\/textarea>/s)[1];
  assert.deepEqual(parse(config), { server: 'https://sync.test/prefix', vault: '工作资料', token: 'device-token' });
});
