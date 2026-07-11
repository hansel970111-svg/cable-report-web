const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'cableReport',
  Object.freeze({
    getDesktopSessionToken: () => ipcRenderer.invoke('cable-report:get-session-token'),
  }),
);
