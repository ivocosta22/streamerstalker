const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { WebSocketServer } = require('ws')

app.setName('SurferStalker Player')

const WS_PORT = 9001
const SIDEBAR_WIDTH = 320
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 720

let mainWindow = null
let playerView = null
let pollTimer = null
let saveTimer = null

const queue = []      // [{ url, requester, title, videoId }]
let currentTrack = null
let isPaused = false
let botConnected = false
let requestsEnabled = true
let volume = 100
let backupPlaylistUrl = ''
let backupMode = false
let backupCurrentTrack = null
let backupStoppedAt = 0

// Keep a reference to the active bot socket so we can push status updates
let botSocket = null

// ── Settings persistence ──────────────────────────────────────────────────────

const settingsPath = path.join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      if (typeof data.volume === 'number') volume = Math.max(0, Math.min(100, data.volume))
      if (typeof data.backupPlaylistUrl === 'string') backupPlaylistUrl = data.backupPlaylistUrl
    }
  } catch {}
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify({ volume, backupPlaylistUrl }, null, 2))
  } catch {}
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSettings, 500)
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 800,
    minHeight: 500,
    title: 'SurferStalker Player',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.setMenu(null)

  // Strip Electron from the UA before anything touches the YouTube session.
  // We also intercept every outgoing request to force the clean UA — this is
  // the only approach that's reliable across all Electron versions.
  const cleanUA = app.userAgentFallback.replace(/\s*Electron\/[\d.]+/i, '').trim()
  app.userAgentFallback = cleanUA

  const ytSession = session.fromPartition('persist:youtube')
  ytSession.setUserAgent(cleanUA)
  ytSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = cleanUA
    callback({ requestHeaders: details.requestHeaders })
  })

  // BrowserView hosts the real YouTube page — persistent partition means
  // the user only needs to log in once; Premium applies automatically.
  playerView = new BrowserView({
    webPreferences: {
      partition: 'persist:youtube',
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.addBrowserView(playerView)
  resizePlayerView()

  // Intercept navigation to blocked video IDs (event-driven, no polling delay)
  const handleNavUrl = (url) => {
    const match = url && url.match(/[?&]v=([^&#]+)/)
    if (match && BLOCKED_VIDEO_IDS.has(match[1])) {
      if (backupPlaylistUrl) {
        playBackupPlaylist()
      } else {
        playerView.webContents.loadURL('about:blank')
      }
    }
  }
  playerView.webContents.on('did-navigate', (_e, url) => handleNavUrl(url))
  playerView.webContents.on('did-navigate-in-page', (_e, url) => handleNavUrl(url))

  // Start blank — YouTube homepage auto-plays the "not available" video on Electron
  playerView.webContents.loadURL('about:blank')

  mainWindow.on('resize', resizePlayerView)
  mainWindow.on('closed', () => { mainWindow = null })
}

function resizePlayerView() {
  if (!mainWindow || !playerView) return
  const [w, h] = mainWindow.getContentSize()
  playerView.setBounds({ x: 0, y: 0, width: w - SIDEBAR_WIDTH, height: h })
}

// ── Broadcast state to renderer ───────────────────────────────────────────────

function broadcast() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('state', {
    current: currentTrack,
    queue: queue.map(t => ({ url: t.url, requester: t.requester, title: t.title, videoId: t.videoId })),
    isPaused,
    botConnected,
    requestsEnabled,
    volume,
    backupPlaylistUrl,
    backupMode
  })
}

function pushStatusToBot() {
  if (botSocket && botSocket.readyState === botSocket.OPEN) {
    const active = currentTrack || (backupMode ? backupCurrentTrack : null)
    botSocket.send(JSON.stringify({
      type: 'status',
      requestsEnabled,
      current: active
        ? { title: active.title, url: active.url, requester: active.requester }
        : null
    }))
  }
}

// ── Playback ──────────────────────────────────────────────────────────────────

function playNext() {
  if (queue.length === 0) {
    currentTrack = null
    if (backupPlaylistUrl) {
      playBackupPlaylist()
    } else {
      backupMode = false
      backupCurrentTrack = null
      backupStoppedAt = 0
      broadcast()
      playerView.webContents.loadURL('about:blank')
    }
    return
  }

  backupMode = false
  backupCurrentTrack = null
  backupStoppedAt = 0
  currentTrack = queue.shift()
  isPaused = false
  broadcast()

  playerView.webContents.loadURL(currentTrack.url)

  playerView.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const title = await playerView.webContents.executeJavaScript(`
          document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
          || document.querySelector('meta[property="og:title"]')?.content
          || document.title.replace(' - YouTube', '').trim()
          || null
        `)
        if (title && currentTrack) {
          currentTrack.title = title
          broadcast()
          pushStatusToBot()
        }
        await playerView.webContents.executeJavaScript(`
          const p = document.querySelector('#movie_player')
          p?.setVolume(${volume})
          p?.playVideo()
        `)
      } catch {}
    }, 2500)
  })
}

async function getPlaylistVideoIds(listId) {
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${listId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })
    if (!res.ok) return []
    const html = await res.text()
    // playlistVideoRenderer entries are the videos that belong to the playlist
    // (this excludes recommendations / sidebar videos elsewhere on the page)
    const ids = new Set()
    const re = /"playlistVideoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"/g
    let m
    while ((m = re.exec(html)) !== null) ids.add(m[1])
    return Array.from(ids)
  } catch { return [] }
}

async function getPlaylistSeedVideoId(listId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/playlist?list=${listId}&format=json`
    )
    if (!res.ok) return null
    const data = await res.json()
    const match = data.thumbnail_url?.match(/\/vi\/([^/]+)\//)
    return match ? match[1] : null
  } catch { return null }
}

async function playBackupPlaylist() {
  backupMode = true
  backupStoppedAt = 0
  backupCurrentTrack = null
  broadcast()

  const listId = extractPlaylistId(backupPlaylistUrl)

  // Always use watch?v=VIDEO_ID&list=LIST_ID so YouTube doesn't
  // trigger device detection on a bare watch?list= URL.
  // Pick a random video from the playlist so it doesn't always start with the same one.
  let url = backupPlaylistUrl
  if (listId) {
    const ids = await getPlaylistVideoIds(listId)
    const seedId = ids.length > 0
      ? ids[Math.floor(Math.random() * ids.length)]
      : await getPlaylistSeedVideoId(listId)
    url = seedId
      ? `https://www.youtube.com/watch?v=${seedId}&list=${listId}`
      : `https://www.youtube.com/watch?list=${listId}`
  }

  playerView.webContents.loadURL(url)

  playerView.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        await playerView.webContents.executeJavaScript(`
          const p = document.querySelector('#movie_player')
          if (typeof p?.setVolume === 'function') p.setVolume(${volume})

          // Try enabling shuffle and loop via button clicks
          document.querySelectorAll('button, [role="button"]').forEach(btn => {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase()
            if (label.includes('shuffle') && btn.getAttribute('aria-pressed') !== 'true') btn.click()
            if (label.includes('loop') && btn.getAttribute('aria-pressed') !== 'true') btn.click()
          })
        `)
      } catch {}
    }, 3000)
  })
}

async function skipCurrent() {
  if (backupMode) {
    // Advance to next video in the backup playlist natively
    try {
      await playerView.webContents.executeJavaScript(
        `document.querySelector('.ytp-next-button')?.click()`
      )
    } catch {}
  } else {
    playNext()
  }
}

function addToQueue(url, requester, title) {
  const videoId = extractVideoId(url)
  const track = { url, requester, videoId, title: title || videoId || url }
  queue.push(track)

  const playsNow = !currentTrack || backupMode
  const position = playsNow ? 1 : queue.length

  if (backupMode) {
    backupMode = false
    backupCurrentTrack = null
    backupStoppedAt = 0
    playNext()
  } else {
    broadcast()
    if (!currentTrack) playNext()
  }

  return position
}

// ── Poll for video end ────────────────────────────────────────────────────────

const BLOCKED_VIDEO_IDS = new Set(['9xp1XWmJ_Wo'])

function startPollTimer() {
  pollTimer = setInterval(async () => {
    if (!playerView) return

    // Skip YouTube's "not available on this device" video and any other blocklisted IDs
    const currentUrl = playerView.webContents.getURL()
    const blockedMatch = currentUrl.match(/[?&]v=([^&]+)/)
    if (blockedMatch && BLOCKED_VIDEO_IDS.has(blockedMatch[1])) {
      if (backupPlaylistUrl) {
        playBackupPlaylist()
      } else {
        playerView.webContents.loadURL('about:blank')
      }
      return
    }

    // In backup mode: track current song for !song command, re-trigger if playlist ended
    if (backupMode) {
      try {
        const info = await playerView.webContents.executeJavaScript(`
          ;(() => {
            const p = document.querySelector('#movie_player')
            const params = new URLSearchParams(window.location.search)
            return {
              state: typeof p?.getPlayerState === 'function' ? p.getPlayerState() : -1,
              videoId: params.get('v') || null,
              title: document.title ? document.title.replace(/ - YouTube$/i, '').trim() : null,
              currentVolume: typeof p?.getVolume === 'function' ? p.getVolume() : -1,
              hasPlaylist: typeof p?.getPlaylist === 'function' && Array.isArray(p.getPlaylist()) && p.getPlaylist().length > 1
            }
          })()
        `)

        if (info.state === 0 || info.state === -1) {
          if (!backupStoppedAt) {
            backupStoppedAt = Date.now()
            // Shuffle: jump to a random video in the playlist
            await playerView.webContents.executeJavaScript(`
              ;(() => {
                const p = document.querySelector('#movie_player')
                if (typeof p?.getPlaylist === 'function' && typeof p?.playVideoAt === 'function') {
                  const pl = p.getPlaylist()
                  if (pl && pl.length > 1) {
                    p.playVideoAt(Math.floor(Math.random() * pl.length))
                  }
                }
              })()
            `)
          } else if (Date.now() - backupStoppedAt > 10000) {
            backupStoppedAt = 0
            playBackupPlaylist()
          }
        } else if (info.videoId) {
          backupStoppedAt = 0
          if (info.currentVolume !== volume && info.currentVolume >= 0) {
            await playerView.webContents.executeJavaScript(
              `document.querySelector('#movie_player')?.setVolume(${volume})`
            )
          }
          const url = `https://www.youtube.com/watch?v=${info.videoId}`
          const changed = !backupCurrentTrack
            || backupCurrentTrack.videoId !== info.videoId
          if (changed) {
            backupCurrentTrack = { title: info.title || info.videoId, url, videoId: info.videoId, requester: null }
            pushStatusToBot()
          } else if (info.title && backupCurrentTrack.title !== info.title) {
            backupCurrentTrack.title = info.title
            pushStatusToBot()
          }
        }
      } catch {}
      return
    }

    if (!currentTrack || isPaused) return
    try {
      const info = await playerView.webContents.executeJavaScript(`
        const p = document.querySelector('#movie_player')
        ;({ state: p?.getPlayerState() ?? -1, currentVolume: p?.getVolume() ?? -1 })
      `)
      if (info.currentVolume !== volume && info.currentVolume >= 0) {
        await playerView.webContents.executeJavaScript(
          `document.querySelector('#movie_player')?.setVolume(${volume})`
        )
      }
      if (info.state === 0) playNext()
    } catch {}
  }, 2000)
}

// ── IPC handlers (from renderer sidebar) ─────────────────────────────────────

ipcMain.on('skip', () => skipCurrent())

ipcMain.on('toggle-pause', async () => {
  if (!currentTrack && !backupMode) return
  try {
    const method = isPaused ? 'playVideo' : 'pauseVideo'
    await playerView.webContents.executeJavaScript(
      `document.querySelector('#movie_player')?.${method}()`
    )
    isPaused = !isPaused
    broadcast()
  } catch {}
})

ipcMain.on('set-volume', async (_e, value) => {
  volume = Math.round(value)
  scheduleSave()
  try {
    await playerView.webContents.executeJavaScript(
      `document.querySelector('#movie_player')?.setVolume(${volume})`
    )
  } catch {}
})

ipcMain.on('clear-queue', () => {
  queue.length = 0
  broadcast()
})

ipcMain.on('remove-from-queue', (_e, index) => {
  if (index >= 0 && index < queue.length) {
    queue.splice(index, 1)
    broadcast()
  }
})

ipcMain.on('toggle-requests', () => {
  requestsEnabled = !requestsEnabled
  broadcast()
  pushStatusToBot()
})

ipcMain.on('set-backup-playlist', (_e, url) => {
  backupPlaylistUrl = url.trim()
  scheduleSave()
  broadcast()
  // If nothing is playing and we just set a URL, start it
  if (!currentTrack && !backupMode && backupPlaylistUrl) playBackupPlaylist()
})

ipcMain.on('update-backup-playlist', (_e, url) => {
  backupPlaylistUrl = url.trim()
  scheduleSave()
  broadcast()
  // Immediately switch to the new playlist if idle or already in backup mode
  if (backupPlaylistUrl && (!currentTrack || backupMode)) playBackupPlaylist()
})

ipcMain.handle('manual-sr', async (_e, url) => {
  const trimmed = (url || '').trim()
  if (!isYouTubeUrl(trimmed)) return { ok: false, error: 'Invalid YouTube URL' }
  let title = null
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`)
    if (res.ok) {
      const data = await res.json()
      title = data.title || null
    }
  } catch { /* title stays null */ }
  const position = addToQueue(trimmed, 'Manual', title)
  return { ok: true, title: title || trimmed, position }
})

// ── WebSocket server (SurferStalker bot connects here) ────────────────────────

function startWebSocketServer() {
  const wss = new WebSocketServer({ port: WS_PORT })

  wss.on('listening', () => {
    console.log(`[PLAYER] WebSocket server listening on ws://localhost:${WS_PORT}`)
  })

  wss.on('connection', (ws) => {
    botConnected = true
    botSocket = ws
    broadcast()
    pushStatusToBot()
    console.log('[PLAYER] SurferStalker bot connected')

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.type === 'skip') {
          if (currentTrack || backupMode) {
            skipCurrent()
            ws.send(JSON.stringify({ ok: true, type: 'skipped' }))
          } else {
            ws.send(JSON.stringify({ ok: false, error: 'nothing_playing' }))
          }
          return
        }

        if (!msg.url || !isYouTubeUrl(msg.url)) {
          ws.send(JSON.stringify({ ok: false, error: 'Invalid or non-YouTube URL' }))
          return
        }
        const position = addToQueue(msg.url, msg.requester || 'unknown', msg.title || null)
        ws.send(JSON.stringify({ ok: true, position }))
      } catch {
        ws.send(JSON.stringify({ ok: false, error: 'Invalid message format' }))
      }
    })

    ws.on('close', () => {
      botConnected = false
      botSocket = null
      broadcast()
      console.log('[PLAYER] SurferStalker bot disconnected')
    })

    ws.on('error', (err) => {
      console.error(`[PLAYER] Bot WS error: ${err.message}`)
    })
  })

  wss.on('error', (err) => {
    console.error(`[PLAYER] WebSocket server error: ${err.message}`)
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    return u.searchParams.get('v') || null
  } catch { return null }
}

function extractPlaylistId(url) {
  try {
    return new URL(url).searchParams.get('list') || null
  } catch { return null }
}

function isYouTubeUrl(url) {
  try {
    const u = new URL(url)
    const isWatch = (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && u.searchParams.has('v')
    const isShort = u.hostname === 'youtu.be' && u.pathname.length > 1
    return isWatch || isShort
  } catch { return false }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  loadSettings()
  createWindow()
  startWebSocketServer()
  startPollTimer()
  // Start backup playlist immediately on launch if configured
  if (backupPlaylistUrl) setTimeout(playBackupPlaylist, 2000)
})

app.on('window-all-closed', () => {
  if (pollTimer) clearInterval(pollTimer)
  app.quit()
})
