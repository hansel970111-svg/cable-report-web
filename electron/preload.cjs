const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_STATE_CHANNEL = 'cable-report:update-state';

contextBridge.exposeInMainWorld(
  'cableReport',
  Object.freeze({
    getDesktopSessionToken: () => ipcRenderer.invoke('cable-report:get-session-token'),
    savePdf: request => ipcRenderer.invoke('cable-report:save-pdf', request),
    getUpdateState: () => ipcRenderer.invoke('cable-report:get-update-state'),
    checkForUpdates: () => ipcRenderer.invoke('cable-report:check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('cable-report:download-update'),
    installUpdate: () => ipcRenderer.invoke('cable-report:install-update'),
    onUpdateState: callback => {
      if (typeof callback !== 'function') {
        throw new TypeError('Update state callback must be a function.');
      }
      const listener = (_event, state) => callback(state);
      ipcRenderer.on(UPDATE_STATE_CHANNEL, listener);
      return () => ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, listener);
    },
  }),
);
