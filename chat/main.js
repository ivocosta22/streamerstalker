const path = require('path')
const fs = require('fs')

// In a built app, .env is bundled as an extraResource.
// In dev, it's in the parent directory.
const envPaths = [
  path.join(process.resourcesPath || '', '.env'),
  path.resolve(__dirname, '..', '.env')
]
const envFile = envPaths.find(p => { try { return fs.statSync(p).isFile() } catch { return false } })
if (envFile) require('dotenv').config({ path: envFile })

const { app, BrowserWindow, globalShortcut } = require('electron')

const HOST = process.env.CHAT_HOST || 'localhost'
const PORT = process.env.SERVER_PORT || 3000
const BASE = `http://${HOST}:${PORT}`
const TARGET = `${BASE}/chatpop`

// Icon: extraResource in built app, player/assets in dev
const iconPaths = [
  path.join(process.resourcesPath || '', 'iconChat.png'),
  path.resolve(__dirname, '..', 'player', 'assets', 'iconChat.png')
]
const iconPath = iconPaths.find(p => { try { return fs.statSync(p).isFile() } catch { return false } })

let win

app.whenReady().then(() => {
  const opts = {
    width: 380,
    height: 720,
    minWidth: 200,
    minHeight: 200,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e10',
    title: 'StreamerStalker Chat',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  }
  if (iconPath) opts.icon = iconPath

  win = new BrowserWindow(opts)

  // After login redirect, navigate back to chatpop
  win.webContents.on('did-navigate', (_e, url) => {
    if (url.startsWith(BASE) && !url.includes('/chatpop') && !url.includes('/login')) {
      win.loadURL(TARGET)
    }
  })

  win.loadURL(TARGET)

  // Ctrl+T toggles always-on-top
  globalShortcut.register('CommandOrControl+T', () => {
    if (!win) return
    const next = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(next)
    win.setTitle(next ? 'StreamerStalker Chat (pinned)' : 'StreamerStalker Chat')
  })

  win.on('closed', () => { win = null })
})

app.on('window-all-closed', () => app.quit())

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
