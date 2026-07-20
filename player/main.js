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

// ── Backup shuffle state ──
// We drive the backup playlist ourselves instead of relying on YouTube's native
// shuffle. On a watch page YouTube only exposes a small ~7–15 video window via
// getPlaylist(), so its random jumps kept replaying the same handful of songs.
// Instead we scrape the full playlist once and keep a Fisher-Yates "shuffle bag"
// of remaining IDs, loading each next song directly — no repeats until the whole
// list has played through.
let backupAllIds = []        // full set of video IDs scraped from the playlist
let loadedPlaylistId = ''    // which playlist backupAllIds was fetched for
let backupBag = []           // remaining shuffled IDs for the current cycle
let backupLastVideoId = null // last song we chose (avoid back-to-back repeats)
let backupLoadStartedAt = 0  // when the current backup song began loading

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
  playerView = createPlayerView()
  mainWindow.addBrowserView(playerView)
  resizePlayerView()

  // Start blank — YouTube homepage auto-plays the "not available" video on Electron
  playerView.webContents.loadURL('about:blank')

  mainWindow.on('resize', resizePlayerView)
  mainWindow.on('closed', () => { mainWindow = null })
}

// Builds a fresh YouTube BrowserView. The persistent partition is shared
// across views, so recreating one keeps login/Premium intact while releasing
// the renderer memory the previous one accumulated.
function createPlayerView() {
  const view = new BrowserView({
    webPreferences: {
      partition: 'persist:youtube',
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Intercept navigation to blocked video IDs (event-driven, no polling delay)
  const handleNavUrl = (url) => {
    const match = url && url.match(/[?&]v=([^&#]+)/)
    if (match && BLOCKED_VIDEO_IDS.has(match[1])) {
      if (backupPlaylistUrl) {
        playBackupPlaylist()
      } else {
        view.webContents.loadURL('about:blank')
      }
    }
  }
  view.webContents.on('did-navigate', (_e, url) => handleNavUrl(url))
  view.webContents.on('did-navigate-in-page', (_e, url) => handleNavUrl(url))

  return view
}

// ── Player view recycling ──────────────────────────────────────────────────────
// Reusing a single YouTube webContents for many heavy watch pages leaks renderer
// memory until playback thrashes. We swap in a fresh view every RECYCLE_EVERY
// videos to keep memory flat. Both SR mode and backup mode navigate to a fresh
// watch page per song and count via loadsSinceRecycle.
const RECYCLE_EVERY = 10
let loadsSinceRecycle = 0

function recyclePlayerView() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  loadsSinceRecycle = 0
  const old = playerView
  playerView = createPlayerView()
  mainWindow.addBrowserView(playerView)
  resizePlayerView()
  try {
    if (old) {
      mainWindow.removeBrowserView(old)
      const wc = old.webContents
      if (wc && !wc.isDestroyed()) {
        // Forcefully tear down the old renderer to release its memory now.
        if (typeof wc.destroy === 'function') wc.destroy()
        else if (typeof wc.close === 'function') wc.close()
      }
    }
  } catch {}
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
      backupLoadStartedAt = 0
      broadcast()
      playerView.webContents.loadURL('about:blank')
    }
    return
  }

  backupMode = false
  backupCurrentTrack = null
  backupLoadStartedAt = 0
  currentTrack = queue.shift()
  isPaused = false
  broadcast()

  if (++loadsSinceRecycle >= RECYCLE_EVERY) recyclePlayerView()
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

// ── Backup shuffle helpers ──────────────────────────────────────────────────────

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Refill the bag with a fresh permutation of the whole playlist. Guards against
// the new cycle opening on the exact song that just finished.
function refillBackupBag() {
  if (backupAllIds.length === 0) { backupBag = []; return }
  backupBag = shuffle(backupAllIds)
  if (backupBag.length > 1 && backupBag[0] === backupLastVideoId) {
    const j = 1 + Math.floor(Math.random() * (backupBag.length - 1))
    ;[backupBag[0], backupBag[j]] = [backupBag[j], backupBag[0]]
  }
}

function nextBackupVideoId() {
  if (backupBag.length === 0) refillBackupBag()
  return backupBag.shift() || null
}

// Run JS in the player view, tolerating a view that was just recycled/destroyed.
async function safeExec(code) {
  const wc = playerView && playerView.webContents
  if (!wc || wc.isDestroyed()) return null
  try { return await wc.executeJavaScript(code) } catch { return null }
}

// Load one specific backup song. We navigate to a bare watch URL (no &list=) so
// YouTube can't inject its own sequential/related autoplay — we alone decide the
// next track. Recycles the view every RECYCLE_EVERY loads to keep memory flat.
function loadBackupVideo(videoId) {
  if (!videoId) { playBackupPlaylist(); return }
  backupMode = true
  backupLastVideoId = videoId
  backupLoadStartedAt = Date.now()
  if (++loadsSinceRecycle >= RECYCLE_EVERY) recyclePlayerView()
  const view = playerView
  view.webContents.loadURL(`https://www.youtube.com/watch?v=${videoId}`)
  view.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      await safeExec(`
        const p = document.querySelector('#movie_player')
        if (typeof p?.setVolume === 'function') p.setVolume(${volume})
        p?.playVideo?.()
      `)
    }, 2500)
  })
}

async function playBackupPlaylist() {
  backupMode = true
  backupCurrentTrack = null
  backupLoadStartedAt = 0
  broadcast()

  const listId = extractPlaylistId(backupPlaylistUrl)

  // Scrape the full playlist once — or again if the configured playlist changed.
  if (listId && (backupAllIds.length === 0 || listId !== loadedPlaylistId)) {
    const ids = await getPlaylistVideoIds(listId)
    if (ids.length > 0) {
      backupAllIds = ids
      loadedPlaylistId = listId
      backupBag = []
    }
  }

  // Preferred path: our own true shuffle across the entire playlist.
  if (backupAllIds.length > 0) {
    loadBackupVideo(nextBackupVideoId())
    return
  }

  // Fallback: couldn't scrape IDs (private/edge-case playlist) — let YouTube drive
  // the list natively from a seed video. watch?v=ID&list=ID avoids the device
  // detection that a bare watch?list= URL triggers.
  backupLoadStartedAt = Date.now()
  let url = backupPlaylistUrl
  if (listId) {
    const seedId = await getPlaylistSeedVideoId(listId)
    url = seedId
      ? `https://www.youtube.com/watch?v=${seedId}&list=${listId}`
      : `https://www.youtube.com/watch?list=${listId}`
  }
  if (++loadsSinceRecycle >= RECYCLE_EVERY) recyclePlayerView()
  const view = playerView
  view.webContents.loadURL(url)
  view.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      await safeExec(`
        const p = document.querySelector('#movie_player')
        if (typeof p?.setVolume === 'function') p.setVolume(${volume})
      `)
    }, 3000)
  })
}

async function skipCurrent() {
  if (backupMode) {
    // Advance to the next shuffled backup song ourselves
    loadBackupVideo(nextBackupVideoId())
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
    backupLoadStartedAt = 0
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
  let pollBusy = false
  pollTimer = setInterval(async () => {
    // A poll tick can await for longer than the interval; never let two run at
    // once or they double-advance and race the view during a recycle.
    if (!playerView || pollBusy) return
    pollBusy = true
    try {
      const wc = playerView.webContents
      if (!wc || wc.isDestroyed()) return

      // Skip YouTube's "not available on this device" video and other blocklisted IDs
      const currentUrl = wc.getURL()
      const blockedMatch = currentUrl.match(/[?&]v=([^&]+)/)
      if (blockedMatch && BLOCKED_VIDEO_IDS.has(blockedMatch[1])) {
        if (backupMode) loadBackupVideo(nextBackupVideoId())
        else if (backupPlaylistUrl) playBackupPlaylist()
        else wc.loadURL('about:blank')
        return
      }

      // Backup mode: track the current song and advance the shuffle when it ends.
      if (backupMode) {
        const info = await safeExec(`
          ;(() => {
            const p = document.querySelector('#movie_player')
            const params = new URLSearchParams(window.location.search)
            return {
              state: typeof p?.getPlayerState === 'function' ? p.getPlayerState() : -1,
              videoId: params.get('v') || null,
              title: document.title ? document.title.replace(/ - YouTube$/i, '').trim() : null,
              currentVolume: typeof p?.getVolume === 'function' ? p.getVolume() : -1
            }
          })()
        `)
        if (!info) return

        // Keep volume in sync with the slider
        if (info.currentVolume !== volume && info.currentVolume >= 0) {
          await safeExec(`document.querySelector('#movie_player')?.setVolume(${volume})`)
        }

        // Expose the current song for the !song command
        if (info.videoId) {
          const changed = !backupCurrentTrack || backupCurrentTrack.videoId !== info.videoId
          if (changed) {
            backupCurrentTrack = {
              title: info.title || info.videoId,
              url: `https://www.youtube.com/watch?v=${info.videoId}`,
              videoId: info.videoId,
              requester: null
            }
            pushStatusToBot()
          } else if (info.title && backupCurrentTrack.title !== info.title) {
            backupCurrentTrack.title = info.title
            pushStatusToBot()
          }
        }

        const sinceLoad = Date.now() - backupLoadStartedAt

        // Reclaim control if YouTube slipped in its own autoplay (a video we
        // didn't queue). Only when we're self-driving and the load has settled.
        if (backupAllIds.length > 0 && info.videoId
            && info.videoId !== backupLastVideoId
            && backupLoadStartedAt > 0 && sinceLoad > 5000) {
          loadBackupVideo(nextBackupVideoId())
          return
        }

        // Advance when the song ends (state 0), or if it never starts within 30s.
        // Crucially we do NOT treat "unstarted" (-1) as ended during load — doing
        // so used to interrupt the page before it could finish loading.
        const ended = info.state === 0
        const stuck = info.state === -1 && backupLoadStartedAt > 0 && sinceLoad > 30000
        if (ended || stuck) loadBackupVideo(nextBackupVideoId())
        return
      }

      // Song-request mode
      if (!currentTrack || isPaused) return
      const info = await safeExec(`
        ;(() => {
          const p = document.querySelector('#movie_player')
          const params = new URLSearchParams(window.location.search)
          return {
            state: p?.getPlayerState?.() ?? -1,
            currentVolume: p?.getVolume?.() ?? -1,
            videoId: params.get('v') || null
          }
        })()
      `)
      if (!info) return
      if (info.currentVolume !== volume && info.currentVolume >= 0) {
        await safeExec(`document.querySelector('#movie_player')?.setVolume(${volume})`)
      }
      const videoChanged = currentTrack.videoId && info.videoId && info.videoId !== currentTrack.videoId
      if (info.state === 0 || videoChanged) playNext()
    } catch {}
    finally { pollBusy = false }
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
