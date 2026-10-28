const { Menu, nativeImage } = require('electron');
const path = require('node:path');

function windowOptions() {
  return {
    width: 1240, height: 880, minWidth: 960, minHeight: 700,
    backgroundColor: '#00000000', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 23, y: 23 }, vibrancy: 'under-window', visualEffectState: 'followWindow',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  };
}

function installMenu(win) {
  const command = name => () => { win.show(); win.focus(); win.webContents.send('mac-menu-command', name); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: '文件', submenu: [
      { label: '新建同步任务', accelerator: 'CmdOrCtrl+N', click: command('new-task') },
      { label: '搜索任务', accelerator: 'CmdOrCtrl+F', click: command('search') },
      { type: 'separator' }, { role: 'close' }
    ] },
    { role: 'editMenu' },
    { label: '显示', submenu: [
      { label: '文件夹任务', accelerator: 'CmdOrCtrl+1', click: command('tasks') },
      { label: '同步记录', accelerator: 'CmdOrCtrl+2', click: command('activity') },
      { label: '历史版本', accelerator: 'CmdOrCtrl+3', click: command('history') },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu' }
  ]));
}

function trayIcon() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  image.setTemplateImage(true);
  return image;
}

module.exports = { windowOptions, installMenu, trayIcon };
