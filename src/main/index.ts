import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  session,
} from 'electron'
import * as path from 'path'
import * as http from 'http'

let mainWindow: BrowserWindow | null = null
let isOverlayMode = false

/** Check if webpack dev server is running */
function isDevServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:9000', () => {
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    skipTaskbar: false,
    backgroundColor: '#001a1a2e',
    show: false, // Show after content loads to avoid flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const isDev = !app.isPackaged

  if (isDev) {
    const devServerUp = await isDevServerRunning()
    if (devServerUp) {
      console.log('Loading from webpack dev server (localhost:9000)')
      await mainWindow.loadURL('http://localhost:9000')
    } else {
      console.log('Dev server not running, loading built files')
      await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Hide window from screen capture/recording — interviewer won't see it during screen share
  mainWindow.setContentProtection(true)

  mainWindow.show()

  // Log load failures
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Page failed to load:', errorCode, errorDescription)
  })

  // Register global shortcut: Ctrl+Shift+I to toggle visibility
  globalShortcut.register('Ctrl+Shift+I', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  // Grant media permissions automatically (no user prompt)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'display-capture', 'audioCapture'].includes(permission)
    callback(allowed)
  })

  // Auto-select the entire screen for display media requests so no picker dialog appears.
  // This is required for desktopCapturer-based system audio capture in Electron 28+.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (sources.length > 0) {
      callback({ video: sources[0], audio: 'loopback' })
    } else {
      callback({})
    }
  })

  createWindow()
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  app.quit()
})

// IPC Handlers

ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow) return false
  const current = mainWindow.isAlwaysOnTop()
  mainWindow.setAlwaysOnTop(!current)
  return !current
})

ipcMain.handle('set-overlay-mode', (_event, enabled: boolean) => {
  if (!mainWindow) return
  isOverlayMode = enabled

  if (enabled) {
    mainWindow.setBackgroundColor('#00000000')
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setIgnoreMouseEvents(false)
    mainWindow.setOpacity(1.0)
  } else {
    mainWindow.setBackgroundColor('#1a1a2e')
    mainWindow.setAlwaysOnTop(true)
    mainWindow.setIgnoreMouseEvents(false)
    mainWindow.setOpacity(1.0)
  }

  return isOverlayMode
})

ipcMain.on('minimize-window', () => {
  mainWindow?.minimize()
})

ipcMain.on('close-window', () => {
  mainWindow?.close()
})

ipcMain.handle('get-display-info', () => {
  const displays = screen.getAllDisplays()
  return displays.map((d) => ({
    id: d.id,
    label: `${d.size.width}x${d.size.height}`,
    bounds: d.bounds,
    primary: d.id === screen.getPrimaryDisplay().id,
  }))
})

ipcMain.handle('get-resource-path', (_event, filename: string) => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, filename)
  }
  return path.join(__dirname, '../../public', filename)
})

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
  // Only return serializable data (thumbnails are NativeImage, not serializable)
  return sources.map((s) => ({ id: s.id, name: s.name }))
})
