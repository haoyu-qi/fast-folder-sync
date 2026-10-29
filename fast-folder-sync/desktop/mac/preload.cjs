const { contextBridge, ipcRenderer } = require('electron');
const invoke = name => async (...args) => { const response = await ipcRenderer.invoke(name, ...args); if (!response.ok) throw Error(response.error); return response.value; };
contextBridge.exposeInMainWorld('folderSync', {
  agent: invoke('agent-command'), openView: invoke('open-view'),
  platform: process.platform,
  onMenuCommand: callback => { const listener = (_event, command) => callback(command); ipcRenderer.on('mac-menu-command', listener); return () => ipcRenderer.removeListener('mac-menu-command', listener); },
  getState: invoke('get-state'), chooseFolder: invoke('choose-folder'), saveTask: invoke('save-task'), runTask: invoke('run-task'), toggleTask: invoke('toggle-task'), deleteTask: invoke('delete-task'), history: invoke('history'), restore: invoke('restore'), openFolder: invoke('open-folder'), openData: invoke('open-data'),
  onState: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); }
});
