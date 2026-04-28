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

  // Screen capture
  captureScreen: () => ipcRenderer.invoke('capture-screen'),

  // Hotkey listeners (main process → renderer)
  onToggleQuickInput: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('toggle-quick-input', handler)
    return () => ipcRenderer.removeListener('toggle-quick-input', handler)
  },
  onTriggerScreenCapture: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('trigger-screen-capture', handler)
    return () => ipcRenderer.removeListener('trigger-screen-capture', handler)
  },
})
