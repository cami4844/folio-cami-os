const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('folioDesktop', {
  platform: process.platform,
  saveFile: (data, fileName, filters) => ipcRenderer.invoke('folio:save-file', { data, fileName, filters }),
});
