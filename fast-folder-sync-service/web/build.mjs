import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(root, '../frontend');
if (path.basename(target) !== 'frontend' || path.dirname(target) !== path.resolve(root, '..')) throw Error('Invalid build target');
// frontend/ is tracked build output, never a data or configuration directory.
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(path.join(target, 'assets'), { recursive: true });
await fs.mkdir(path.join(target, 'static/images'), { recursive: true });
const result = await build({ absWorkingDir: root, entryPoints: { console: path.join(root, 'src/app.js') }, bundle: true, minify: true, sourcemap: false, target: ['es2022'], outdir: path.join(target, 'assets'), assetNames: '[name]-[hash]', entryNames: '[name]-[hash]', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file' }, metafile: true });
const script = Object.keys(result.metafile.outputs).find(key => result.metafile.outputs[key].entryPoint);
const style = result.metafile.outputs[script].cssBundle;
const template = await fs.readFile(path.join(root, 'index.html'), 'utf8');
await fs.writeFile(path.join(target, 'index.html'), template.replace('__SCRIPT__', '/assets/' + path.basename(script)).replace('__STYLE__', '/assets/' + path.basename(style)));
// OAuth and old public links keep an intentionally generic, minimal landing
// page. The authenticated console owns the file-management experience.
for (const name of ['share.html', 'oauth-authorize.html']) await fs.copyFile(path.join(target, 'index.html'), path.join(target, name));
await fs.copyFile(path.join(root, 'icon.svg'), path.join(target, 'static/images/icon.svg'));
console.log('Built editable Folder Sync console into frontend/');
