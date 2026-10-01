const path = require('path')
const fs = require('fs')

// In a built app, .env is bundled as an extraResource.
// In dev, it's in the parent directory.
const envPaths = [
  path.join(path.dirname(process.execPath), '.env'),
  path.join(process.resourcesPath || '', '.env'),
  path.resolve(__dirname, '..', '.env')
]
const envFile = envPaths.find(p => { try { return fs.statSync(p).isFile() } catch { return false } })
if (envFile) require('dotenv').config({ path: envFile })

const { app, BrowserWindow, globalShortcut, screen } = require('electron')

const HOST = process.env.CHAT_HOST || 'localhost'
const PORT = process.env.SERVER_PORT || 3000
const BASE = `http://${HOST}:${PORT}`
const TARGET = `${BASE}/chatpop`

try {
  const debugLog = `env: ${envFile || 'NOT FOUND'}\nTarget: ${TARGET}\nPaths tried:\n${envPaths.join('\n')}\nCHAT_HOST: ${process.env.CHAT_HOST || '(not set)'}\nSERVER_PORT: ${process.env.SERVER_PORT || '(not set)'}\nexecPath: ${process.execPath}\n`
  fs.writeFileSync(path.join(path.dirname(process.execPath), 'chat-debug.txt'), debugLog)
} catch {}

// Icon: extraResource in built app, player/assets in dev
const iconPaths = [
  path.join(process.resourcesPath || '', 'iconChat.png'),
  path.resolve(__dirname, '..', 'player', 'assets', 'iconChat.png')
]
const iconPath = iconPaths.find(p => { try { return fs.statSync(p).isFile() } catch { return false } })

// ── Window state persistence ──────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')
const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 720

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function saveWindowState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state))
  } catch {}
}

function isOnScreen(state) {
  const displays = screen.getAllDisplays()
  const cx = state.x + state.width / 2
  const cy = state.y + state.height / 2
  return displays.some(d => {
    const b = d.workArea
    return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height
  })
}

function getValidState() {
  const saved = loadWindowState()
  if (!saved) return null
  if (typeof saved.x !== 'number' || typeof saved.y !== 'number' ||
      typeof saved.width !== 'number' || typeof saved.height !== 'number') return null
  if (saved.width < 200 || saved.height < 200) return null
  if (!isOnScreen(saved)) return null
  return saved
}
// ──────────────────────────────────────────────────────────────

let win

app.whenReady().then(() => {
  const saved = getValidState()

  const opts = {
    width: saved?.width || DEFAULT_WIDTH,
    height: saved?.height || DEFAULT_HEIGHT,
    minWidth: 200,
    minHeight: 200,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e10',
    title: 'StreamerStalker Chat',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  }
  if (saved) {
    opts.x = saved.x
    opts.y = saved.y
  }
  if (iconPath) opts.icon = iconPath

  win = new BrowserWindow(opts)

  if (saved?.maximized) win.maximize()
  if (saved?.fullscreen) win.setFullScreen(true)

  win.once('ready-to-show', () => win.show())

  // Debounced state save on every move/resize
  let saveTimer = null
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return
      const maximized = win.isMaximized()
      const fullscreen = win.isFullScreen()
      const bounds = maximized || fullscreen ? (win._lastNormalBounds || win.getBounds()) : win.getBounds()
      if (!maximized && !fullscreen) win._lastNormalBounds = bounds
      saveWindowState({ ...bounds, maximized, fullscreen })
    }, 500)
  }

  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)
  win.on('enter-full-screen', scheduleSave)
  win.on('leave-full-screen', scheduleSave)

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
  // Final save before quitting
  if (win && !win.isDestroyed()) {
    const maximized = win.isMaximized()
    const fullscreen = win.isFullScreen()
    const bounds = maximized || fullscreen ? (win._lastNormalBounds || win.getBounds()) : win.getBounds()
    saveWindowState({ ...bounds, maximized, fullscreen })
  }
  globalShortcut.unregisterAll()
})
