const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  chooseAppPath: () => ipcRenderer.invoke('choose-app-path'),
  chooseImagePath: () => ipcRenderer.invoke('choose-image-path'),
  chooseFontPath: () => ipcRenderer.invoke('choose-font-path'),
  selectFont: (fileName) => ipcRenderer.invoke('select-font', fileName),
  removeFont: (fileName) => ipcRenderer.invoke('remove-font', fileName),
  setFontScale: (payload) => ipcRenderer.invoke('set-font-scale', payload),
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
  steamGridDbGrids: (gameId, page) => ipcRenderer.invoke('steamgriddb-grids', gameId, page),
  steamGridDbIcons: (gameId, page) => ipcRenderer.invoke('steamgriddb-icons', gameId, page),
  steamGridDbHeroes: (gameId, page) => ipcRenderer.invoke('steamgriddb-heroes', gameId, page),
  steamGridDbDownload: (payload) => ipcRenderer.invoke('steamgriddb-download', payload),
  chooseMusicPath: () => ipcRenderer.invoke('choose-music-path'),
  selectMusic: (fileName) => ipcRenderer.invoke('select-music', fileName),
  removeMusic: (fileName) => ipcRenderer.invoke('remove-music', fileName),
  setMusicVolume: (volume) => ipcRenderer.invoke('set-music-volume', volume),
  setMusicMuted: (muted) => ipcRenderer.invoke('set-music-muted', muted),
  chooseUiSound: (kind) => ipcRenderer.invoke('choose-ui-sound', kind),
  selectUiSound: (kind, fileName) => ipcRenderer.invoke('select-ui-sound', { kind, fileName }),
  clearUiSound: (kind) => ipcRenderer.invoke('clear-ui-sound', kind),
  removeUiSound: (kind, fileName) => ipcRenderer.invoke('remove-ui-sound', { kind, fileName }),
  onGameExited: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('game-exited', listener);
    return () => ipcRenderer.removeListener('game-exited', listener);
  },
});
