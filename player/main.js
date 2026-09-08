const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { WebSocketServer } = require('ws')

app.setName('SurferStalker Player')

const WS_PORT = 9001
const SIDEBAR_WIDTH = 320
const LOG_PANEL_WIDTH = 460
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 720

let mainWindow = null
let playerView = null
let pollTimer = null
let saveTimer = null
let logsOpen = false

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

// ── Log capture ───────────────────────────────────────────────────────────────
// The packaged app has no console, so mirror everything the main process prints
// into a ring buffer the sidebar can render.

const MAX_LOG_LINES = 1000
const logBuffer = []

function formatLogArg(a) {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || a.message
  try { return JSON.stringify(a) } catch { return String(a) }
}

function pushLog(level, text) {
  const entry = { t: Date.now(), level, text }
  logBuffer.push(entry)
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES)
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('log', entry) } catch {}
  }
}

function installLogCapture() {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      original(...args)
      pushLog(level === 'info' ? 'log' : level, args.map(formatLogArg).join(' '))
    }
  }
  // Node diagnostics that bypass console entirely. uncaughtException is left
  // alone on purpose — handling it would suppress crashes instead of logging.
  process.on('warning', (w) => pushLog('warn', `${w.name}: ${w.message}`))
  process.on('unhandledRejection', (reason) => {
    pushLog('error', `Unhandled rejection: ${formatLogArg(reason)}`)
  })
}

// ── Settings persistence ──────────────────────────────────────────────────────

const settingsPath = path.join(app.getPath('userData'), 'settings.json')

// Volume is reported from saveSettings rather than the IPC handler: the slider
// fires on every pixel of drag, and that path is already debounced.
let lastLoggedVolume = null

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      if (typeof data.volume === 'number') volume = Math.max(0, Math.min(100, data.volume))
      if (typeof data.backupPlaylistUrl === 'string') backupPlaylistUrl = data.backupPlaylistUrl
      lastLoggedVolume = volume
      console.log(`[PLAYER] Settings loaded — volume ${volume}, backup playlist ${backupPlaylistUrl ? 'set' : 'none'}`)
    }
  } catch {}
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify({ volume, backupPlaylistUrl }, null, 2))
    if (lastLoggedVolume !== null && lastLoggedVolume !== volume) {
      console.log(`[PLAYER] Volume set to ${volume}`)
    }
    lastLoggedVolume = volume
  } catch (err) {
    console.error(`[PLAYER] Failed to save settings: ${err.message}`)
  }
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

  view.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // -3 is ABORTED, which fires routinely whenever we navigate away mid-load
    if (code === -3) return
    console.error(`[PLAYER] Page load failed (${code} ${desc}): ${url}`)
  })
  view.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[PLAYER] Player renderer gone: ${details.reason}`)
  })
  view.webContents.on('unresponsive', () => {
    console.warn('[PLAYER] Player view stopped responding')
  })

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
  console.log(`[PLAYER] Recycling player view after ${loadsSinceRecycle} loads (frees renderer memory)`)
  loadsSinceRecycle = 0
  const old = playerView

  // Detach the outgoing view before attaching the replacement, so the window
  // never holds two views at once and drops its per-view listeners promptly.
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

  playerView = createPlayerView()
  mainWindow.addBrowserView(playerView)
  resizePlayerView()
}

function resizePlayerView() {
  if (!mainWindow || !playerView) return
  const [w, h] = mainWindow.getContentSize()
  const reserved = SIDEBAR_WIDTH + (logsOpen ? LOG_PANEL_WIDTH : 0)
  playerView.setBounds({ x: 0, y: 0, width: Math.max(0, w - reserved), height: h })
}

// Grow the window rightwards so opening the log panel doesn't shrink the video.
// When maximised there's no room to grow, so the panel takes space from the
// video instead — resizePlayerView derives that from the actual content size.
function setLogsOpen(open) {
  if (!mainWindow || mainWindow.isDestroyed() || logsOpen === open) return
  logsOpen = open
  if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
    const b = mainWindow.getBounds()
    mainWindow.setBounds({
      ...b,
      width: b.width + (open ? LOG_PANEL_WIDTH : -LOG_PANEL_WIDTH)
    })
  }
  resizePlayerView()
  broadcast()
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
    backupMode,
    logsOpen
  })
}

function pushStatusToBot() {
  if (botSocket && botSocket.readyState === botSocket.OPEN) {
    const active = currentTrack || (backupMode ? backupCurrentTrack : null)
    botSocket.send(JSON.stringify({
      type: 'status',
      requestsEnabled,
      backupPlaylistUrl,
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
      console.log('[PLAYER] Queue empty — switching to backup playlist')
      playBackupPlaylist()
    } else {
      console.log('[PLAYER] Queue empty and no backup playlist — going idle')
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
  console.log(`[PLAYER] Now playing: "${currentTrack.title}" (by ${currentTrack.requester}) — ${queue.length} still queued`)

  if (++loadsSinceRecycle >= RECYCLE_EVERY) recyclePlayerView()
  const view = playerView
  safeSetMuted(view, true)
  view.webContents.loadURL(currentTrack.url)

  view.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const title = await safeExec(`
          document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
          || document.querySelector('meta[property="og:title"]')?.content
          || document.title.replace(' - YouTube', '').trim()
          || null
        `)
        if (title && currentTrack) {
          currentTrack.title = title
          broadcast()
          pushStatusToBot()
          console.log(`[PLAYER] Title resolved: "${title}"`)
        } else if (!title) {
          console.warn('[PLAYER] Could not read video title from the page')
        }
        await safeExec(`
          const p = document.querySelector('#movie_player')
          p?.setVolume(${volume})
          p?.playVideo()
        `)
      } finally {
        // Must always run — a skipped unmute leaves the player silent for good.
        safeSetMuted(view, false)
      }
    }, 2500)
  })
}

const VIDEO_ID_RE = /^[\w-]{11}$/

// YouTube now renders playlist entries as lockupViewModel objects (the old
// playlistVideoRenderer is gone). Collect them wherever they sit in the tree so
// we don't depend on the exact nesting path, which YouTube reshuffles often.
function collectLockups(obj, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 40) return out
  if (Array.isArray(obj)) {
    for (const v of obj) collectLockups(v, out, depth + 1)
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'lockupViewModel' && v && typeof v === 'object') out.push(v)
    else collectLockups(v, out, depth + 1)
  }
  return out
}

function firstVideoId(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 25) return null
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = firstVideoId(v, depth + 1); if (r) return r }
    return null
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'videoId' && typeof v === 'string' && VIDEO_ID_RE.test(v)) return v
    const r = firstVideoId(v, depth + 1)
    if (r) return r
  }
  return null
}

// A lockup's contentId is the video ID for video entries. The 11-char test also
// filters out playlist/channel lockups, whose ids are longer.
function lockupVideoId(lockup) {
  if (typeof lockup.contentId === 'string' && VIDEO_ID_RE.test(lockup.contentId)) return lockup.contentId
  return firstVideoId(lockup)
}

function findContinuationToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 40) return null
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findContinuationToken(v, depth + 1); if (r) return r }
    return null
  }
  const t = obj.continuationItemViewModel?.continuationCommand?.innertubeCommand?.continuationCommand?.token
  if (t) return t
  for (const v of Object.values(obj)) {
    const r = findContinuationToken(v, depth + 1)
    if (r) return r
  }
  return null
}

function addLockupIds(root, ids) {
  for (const lockup of collectLockups(root, [])) {
    const id = lockupVideoId(lockup)
    if (id) ids.add(id)
  }
}

async function getPlaylistVideoIds(listId) {
  const ids = new Set()
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
  }

  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${listId}`, { headers })
    if (!res.ok) return []
    const html = await res.text()

    // Fallback for the legacy layout, in case YouTube serves it to some clients
    const legacy = /"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g
    let m
    while ((m = legacy.exec(html)) !== null) ids.add(m[1])

    const dataMatch = html.match(/var\s+ytInitialData\s*=\s*(.+?);\s*<\/script>/)
    if (!dataMatch) return Array.from(ids)

    let initialData
    try { initialData = JSON.parse(dataMatch[1]) } catch { return Array.from(ids) }

    addLockupIds(initialData, ids)
    console.log(`[PLAYER] Playlist page 1: ${ids.size} IDs`)

    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
    let continuation = findContinuationToken(initialData)
    if (!apiKeyMatch || !continuation) return Array.from(ids)

    const clientVerMatch = html.match(/"clientVersion":"([^"]+)"/)
    const clientVersion = clientVerMatch ? clientVerMatch[1] : '2.20240101.00.00'

    const MAX_PAGES = 60
    for (let page = 0; page < MAX_PAGES && continuation; page++) {
      const browseRes = await fetch(
        `https://www.youtube.com/youtubei/v1/browse?key=${apiKeyMatch[1]}&prettyPrint=false`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion } },
            continuation
          })
        }
      )
      if (!browseRes.ok) break

      let browseData
      try { browseData = await browseRes.json() } catch { break }

      const before = ids.size
      addLockupIds(browseData, ids)
      console.log(`[PLAYER] Playlist page ${page + 2}: +${ids.size - before} (${ids.size} total)`)
      if (ids.size === before) break

      const next = findContinuationToken(browseData)
      if (!next || next === continuation) break
      continuation = next
    }

    return Array.from(ids)
  } catch (err) {
    console.error(`[PLAYER] Playlist scrape failed: ${err.message}`)
    return []
  }
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

function resetBackupShuffle() {
  backupAllIds = []
  loadedPlaylistId = ''
  backupBag = []
  backupLastVideoId = null
}

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
  console.log(`[PLAYER] Starting new shuffle cycle over ${backupAllIds.length} songs (no repeats until it runs out)`)
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

// Mute/unmute a specific view. Deferred unmutes can fire after a recycle has
// already torn that view down, so never assume webContents is still there.
function safeSetMuted(view, muted) {
  const wc = view && view.webContents
  if (!wc || wc.isDestroyed()) return
  try { wc.setAudioMuted(muted) } catch {}
}

// Try to harvest playlist IDs from the YouTube player API in the BrowserView.
// This works even for private/unlisted playlists because the view has the user's
// login session.  Called from did-finish-load and from the poll loop as a retry.
async function tryHarvestPlaylistIds() {
  if (backupAllIds.length > 0) return
  const harvested = await safeExec(`
    ;(() => {
      const p = document.querySelector('#movie_player')
      const pl = typeof p?.getPlaylist === 'function' ? p.getPlaylist() : null
      const params = new URLSearchParams(window.location.search)
      return {
        ids: Array.isArray(pl) && pl.length > 1 ? pl : null,
        videoId: params.get('v') || null
      }
    })()
  `)
  if (harvested && harvested.ids && harvested.ids.length > 0) {
    // Deliberately leave loadedPlaylistId unset: this is only YouTube's small
    // in-page window, so the next playBackupPlaylist should retry the full
    // scrape and upgrade to the complete list rather than treating it as final.
    backupAllIds = harvested.ids
    backupBag = []
    if (harvested.videoId) backupLastVideoId = harvested.videoId
    console.log(`[PLAYER] Harvested ${harvested.ids.length} IDs from YouTube player (partial)`)
  }
}

// Load one specific backup song. We navigate to a bare watch URL (no &list=) so
// YouTube can't inject its own sequential/related autoplay — we alone decide the
// next track. Recycles the view every RECYCLE_EVERY loads to keep memory flat.
function loadBackupVideo(videoId) {
  if (!videoId) {
    console.warn('[PLAYER] No backup song available — falling back to YouTube\'s next button')
    backupLoadStartedAt = Date.now()
    safeExec(`document.querySelector('.ytp-next-button')?.click()`)
    return
  }
  backupMode = true
  backupLastVideoId = videoId
  backupLoadStartedAt = Date.now()
  console.log(`[PLAYER] Backup song: ${videoId} — ${backupBag.length} of ${backupAllIds.length} left this cycle`)
  if (++loadsSinceRecycle >= RECYCLE_EVERY) recyclePlayerView()
  const view = playerView
  safeSetMuted(view, true)
  view.webContents.loadURL(`https://www.youtube.com/watch?v=${videoId}`)
  view.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        await safeExec(`
          const p = document.querySelector('#movie_player')
          if (typeof p?.setVolume === 'function') p.setVolume(${volume})
          p?.playVideo?.()
        `)
      } finally {
        safeSetMuted(view, false)
      }
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
    console.log(`[PLAYER] Server-side playlist scrape: ${ids.length} IDs`)
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

  // Server-side scrape failed (private playlist, rate-limit, etc.).
  // Load with &list= so YouTube's player exposes the playlist via getPlaylist().
  // The poll loop will harvest IDs from there and our shuffle will take over.
  console.log('[PLAYER] Server scrape empty — loading with &list= for in-page harvest')
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
  safeSetMuted(view, true)
  view.webContents.loadURL(url)
  view.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        await safeExec(`
          const p = document.querySelector('#movie_player')
          if (typeof p?.setVolume === 'function') p.setVolume(${volume})
        `)
        tryHarvestPlaylistIds()
      } finally {
        safeSetMuted(view, false)
      }
    }, 3000)
  })
}

async function skipCurrent(source = 'unknown') {
  const what = backupMode
    ? `backup song ${backupLastVideoId}`
    : `"${currentTrack ? currentTrack.title : 'nothing'}"`
  console.log(`[PLAYER] Skip requested by ${source} — skipping ${what}`)
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
  console.log(`[PLAYER] Queued "${track.title}" by ${requester} at position ${position}`)

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
        console.warn(`[PLAYER] Blocked video ${blockedMatch[1]} detected — moving on`)
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

        // If we don't have playlist IDs yet, try harvesting from YouTube's
        // player API on every tick (works for private/unlisted playlists
        // because the BrowserView has the user's login session).
        if (backupAllIds.length === 0) await tryHarvestPlaylistIds()

        // Reclaim control if YouTube slipped in its own autoplay (a video we
        // didn't queue). Only when we're self-driving and the load has settled.
        if (backupAllIds.length > 0 && info.videoId
            && info.videoId !== backupLastVideoId
            && backupLoadStartedAt > 0 && sinceLoad > 5000) {
          console.warn(`[PLAYER] YouTube autoplayed ${info.videoId} on its own — taking back control`)
          loadBackupVideo(nextBackupVideoId())
          return
        }

        // Advance when the song ends (state 0), or if it never starts within 30s.
        // Crucially we do NOT treat "unstarted" (-1) as ended during load — doing
        // so used to interrupt the page before it could finish loading.
        const ended = info.state === 0
        const stuck = info.state === -1 && backupLoadStartedAt > 0 && sinceLoad > 30000
        if (stuck) {
          console.warn(`[PLAYER] Backup song ${backupLastVideoId} never started within 30s — skipping it`)
        } else if (ended) {
          console.log('[PLAYER] Backup song finished')
        }
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
      if (videoChanged) {
        console.warn(`[PLAYER] Page navigated to ${info.videoId} unexpectedly — advancing queue`)
      } else if (info.state === 0) {
        console.log(`[PLAYER] Finished: "${currentTrack.title}"`)
      }
      if (info.state === 0 || videoChanged) playNext()
    } catch {}
    finally { pollBusy = false }
  }, 2000)
}

// ── IPC handlers (from renderer sidebar) ─────────────────────────────────────

ipcMain.on('skip', () => skipCurrent('sidebar'))

ipcMain.on('toggle-pause', async () => {
  if (!currentTrack && !backupMode) return
  try {
    const method = isPaused ? 'playVideo' : 'pauseVideo'
    await playerView.webContents.executeJavaScript(
      `document.querySelector('#movie_player')?.${method}()`
    )
    isPaused = !isPaused
    broadcast()
    console.log(`[PLAYER] ${isPaused ? 'Paused' : 'Resumed'} playback`)
  } catch (err) {
    console.error(`[PLAYER] Pause/resume failed: ${err.message}`)
  }
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

ipcMain.on('toggle-logs', () => setLogsOpen(!logsOpen))

ipcMain.handle('get-logs', () => logBuffer)

ipcMain.on('clear-logs', () => { logBuffer.length = 0 })

ipcMain.on('clear-queue', () => {
  if (queue.length > 0) console.log(`[PLAYER] Queue cleared (${queue.length} removed)`)
  queue.length = 0
  broadcast()
})

ipcMain.on('remove-from-queue', (_e, index) => {
  if (index >= 0 && index < queue.length) {
    console.log(`[PLAYER] Removed "${queue[index].title}" from the queue`)
    queue.splice(index, 1)
    broadcast()
  }
})

ipcMain.on('toggle-requests', () => {
  requestsEnabled = !requestsEnabled
  broadcast()
  pushStatusToBot()
  console.log(`[PLAYER] Song requests ${requestsEnabled ? 'ENABLED' : 'DISABLED'}`)
})

ipcMain.on('set-backup-playlist', (_e, url) => {
  const prev = backupPlaylistUrl
  backupPlaylistUrl = url.trim()
  scheduleSave()
  if (backupPlaylistUrl !== prev) {
    console.log(`[PLAYER] Backup playlist saved: ${backupPlaylistUrl || '(none)'}`)
    resetBackupShuffle()
  }
  broadcast()
  if (!currentTrack && !backupMode && backupPlaylistUrl) playBackupPlaylist()
})

ipcMain.on('update-backup-playlist', (_e, url) => {
  backupPlaylistUrl = url.trim()
  scheduleSave()
  console.log(`[PLAYER] Backup playlist updated, switching now: ${backupPlaylistUrl || '(none)'}`)
  resetBackupShuffle()
  broadcast()
  if (backupPlaylistUrl && (!currentTrack || backupMode)) playBackupPlaylist()
})

ipcMain.handle('manual-sr', async (_e, url) => {
  const trimmed = (url || '').trim()
  if (!isYouTubeUrl(trimmed)) {
    console.warn(`[PLAYER] Manual request rejected, not a YouTube URL: ${trimmed}`)
    return { ok: false, error: 'Invalid YouTube URL' }
  }
  let title = null
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`)
    if (res.ok) {
      const data = await res.json()
      title = data.title || null
    }
  } catch (err) {
    console.warn(`[PLAYER] Could not look up title for ${trimmed}: ${err.message}`)
  }
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
            skipCurrent('chat')
            ws.send(JSON.stringify({ ok: true, type: 'skipped' }))
          } else {
            console.warn('[PLAYER] Chat skip ignored — nothing is playing')
            ws.send(JSON.stringify({ ok: false, error: 'nothing_playing' }))
          }
          return
        }

        if (!msg.url || !isYouTubeUrl(msg.url)) {
          console.warn(`[PLAYER] Request from ${msg.requester || 'unknown'} rejected, bad URL: ${msg.url}`)
          ws.send(JSON.stringify({ ok: false, error: 'Invalid or non-YouTube URL' }))
          return
        }
        const position = addToQueue(msg.url, msg.requester || 'unknown', msg.title || null)
        ws.send(JSON.stringify({ ok: true, position }))
      } catch (err) {
        console.error(`[PLAYER] Malformed message from bot: ${err.message}`)
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
  installLogCapture()
  console.log(`[PLAYER] SurferStalker Player v${app.getVersion()} starting (Electron ${process.versions.electron})`)
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
