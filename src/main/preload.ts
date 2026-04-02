import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  setOverlayMode: (enabled: boolean) =>
    ipcRenderer.invoke('set-overlay-mode', enabled),
  minimize: () => ipcRenderer.send('minimize-window'),
  close: () => ipcRenderer.send('close-window'),
  getDisplays: () => ipcRenderer.invoke('get-display-info'),
  getResourcePath: (filename: string) =>
    ipcRenderer.invoke('get-resource-path', filename),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
})
