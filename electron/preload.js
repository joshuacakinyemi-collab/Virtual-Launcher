const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  chooseAppPath: () => ipcRenderer.invoke('choose-app-path'),
  chooseImagePath: () => ipcRenderer.invoke('choose-image-path'),
  chooseFontPath: () => ipcRenderer.invoke('choose-font-path'),
  selectFont: (fileName) => ipcRenderer.invoke('select-font', fileName),
  removeFont: (fileName) => ipcRenderer.invoke('remove-font', fileName),
  addApp: (payload) => ipcRenderer.invoke('add-app', payload),
  updateApp: (payload) => ipcRenderer.invoke('update-app', payload),
  removeApp: (slug) => ipcRenderer.invoke('remove-app', slug),
  saveSettings: (payload) => ipcRenderer.invoke('save-settings', payload),
  saveDisplaySettings: (payload) => ipcRenderer.invoke('save-display-settings', payload),
  updateUser: (payload) => ipcRenderer.invoke('update-user', payload),
  launchApp: (appPath) => ipcRenderer.invoke('launch-app', appPath),
  quit: () => ipcRenderer.invoke('quit'),
  onAppsUpdated: (callback) => {
    const listener = (_event, apps) => callback(apps);
    ipcRenderer.on('apps-updated', listener);
    return () => ipcRenderer.removeListener('apps-updated', listener);
  },
  getSteamGridDbKey: () => ipcRenderer.invoke('steamgriddb-get-key'),
  saveSteamGridDbKey: (key) => ipcRenderer.invoke('steamgriddb-save-key', key),
  steamGridDbSearch: (term) => ipcRenderer.invoke('steamgriddb-search', term),
  steamGridDbGrids: (gameId) => ipcRenderer.invoke('steamgriddb-grids', gameId),
  steamGridDbIcons: (gameId) => ipcRenderer.invoke('steamgriddb-icons', gameId),
  steamGridDbDownload: (payload) => ipcRenderer.invoke('steamgriddb-download', payload),
});
