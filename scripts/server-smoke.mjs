import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const binary = path.resolve(process.argv[2]);
const expected = (await fs.readFile(new URL('../VERSION', import.meta.url), 'utf8')).trim();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ffs-release-'));
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const child = spawn(binary, ['run', '-d', directory, '-p', `127.0.0.1:${port}`], { stdio: 'ignore', windowsHide: true });
const exited = once(child, 'exit');
let spawnError;
child.on('error', error => { spawnError = error; });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw Error('Service exited before becoming ready');
    try { ready = (await fetch(base + '/api/health')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Service did not become ready');
  const capabilities = await (await fetch(base + '/api/drive/capabilities')).json();
  assert.equal(capabilities.data.version, expected);
  const html = await (await fetch(base + '/webgui/')).text();
  const stylesheet = html.match(/href="([^"]+\.css)"/)[1];
  const script = html.match(/src="([^"]+\.js)"/)[1];
  const css = await (await fetch(base + stylesheet)).text();
  const js = await (await fetch(base + script)).text();
  assert.ok(css.includes('#5865d9'), 'Embedded client palette is missing');
  assert.ok(css.includes('backdrop-filter'), 'Embedded glass surfaces are missing');
  assert.ok(js.includes(expected), 'Embedded console version does not match');
  console.log(`Release service verified: ${expected}, health, capabilities, embedded glass UI`);
} finally {
  if (child.exitCode === null) child.kill();
  await exited.catch(() => {});
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(directory).startsWith(tempRoot)) throw Error('Unexpected smoke-test directory');
  await fs.rm(directory, { recursive: true, force: true });
}
