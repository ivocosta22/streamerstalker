const PLAYER_URL = 'ws://localhost:9001'
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 10000

let socket = null
let ready = false
let requestsEnabled = true
let currentSong = null   // { title, url, requester } — pushed by player on track change
let backupPlaylistUrl = null
let _logColor = () => {}
let _onRequestsToggled = null
let _reconnectDelay = RECONNECT_MIN_MS

// Mirror of the player's own state, refreshed by every status frame. The web
// player page renders from this, so it stays a plain snapshot with no methods.
let mirror = {
  connected: false,
  current: null,
  queue: [],
  isPaused: false,
  volume: 100,
  requestsEnabled: true,
  backupMode: false,
  backupPlaylistUrl: null,
  // A player built before the web page existed sends no queue and ignores
  // control frames. Detecting it lets /player say so instead of looking broken.
  legacy: false
}

const stateSubscribers = new Set()
let warnedLegacy = false

function publishState() {
  const snapshot = getState()
  for (const fn of stateSubscribers) {
    try { fn(snapshot) } catch {}
  }
}

function getState() {
  return { ...mirror, queue: mirror.queue.map(t => ({ ...t })), connected: ready }
}

/** @returns {() => void} unsubscribe */
function onStateChange(fn) {
  stateSubscribers.add(fn)
  return () => stateSubscribers.delete(fn)
}

// FIFO queue of callbacks waiting for a WS response (enqueue ack)
const pendingCallbacks = []

function connect() {
  if (socket) return

  const ws = new WebSocket(PLAYER_URL)
  socket = ws
  let reconnectScheduled = false

  function scheduleReconnect() {
    if (reconnectScheduled) return
    reconnectScheduled = true
    const wasReady = ready
    ready = false
    socket = null
    currentSong = null
    backupPlaylistUrl = null
    mirror = { ...mirror, connected: false, current: null, queue: [], backupMode: false }
    publishState()
    if (wasReady) {
      _reconnectDelay = RECONNECT_MIN_MS
      _logColor('yellow', '[PLAYER] ⚠️ Player disconnected — will retry')
    }
    setTimeout(connect, _reconnectDelay)
    _reconnectDelay = Math.min(_reconnectDelay * 2, RECONNECT_MAX_MS)
  }

  ws.onopen = () => {
    ready = true
    _reconnectDelay = RECONNECT_MIN_MS
    publishState()
    _logColor('green', '[PLAYER] ✅ Connected to song request player')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') {
        if (typeof msg.requestsEnabled === 'boolean') {
          const changed = requestsEnabled !== msg.requestsEnabled
          requestsEnabled = msg.requestsEnabled
          if (changed) {
            _logColor(requestsEnabled ? 'green' : 'yellow', `[PLAYER] Song requests ${requestsEnabled ? 'enabled' : 'disabled'} by player`)
            if (_onRequestsToggled) _onRequestsToggled(requestsEnabled)
          }
        }
        if ('current' in msg) currentSong = msg.current
        if ('backupPlaylistUrl' in msg) backupPlaylistUrl = msg.backupPlaylistUrl || null

        // Fields below arrive only from a player new enough to send them, so
        // each is merged individually rather than replacing the whole mirror.
        mirror = {
          ...mirror,
          connected: true,
          requestsEnabled,
          backupPlaylistUrl,
          current: 'current' in msg ? msg.current : mirror.current,
          queue: Array.isArray(msg.queue) ? msg.queue : mirror.queue,
          isPaused: typeof msg.isPaused === 'boolean' ? msg.isPaused : mirror.isPaused,
          volume: typeof msg.volume === 'number' ? msg.volume : mirror.volume,
          backupMode: typeof msg.backupMode === 'boolean' ? msg.backupMode : mirror.backupMode,
          legacy: !('queue' in msg)
        }

        if (mirror.legacy && !warnedLegacy) {
          warnedLegacy = true
          _logColor('yellow', '[PLAYER] ⚠️ The player app predates the web player page — rebuild it (npm start in player/) for the queue and controls to work')
        }
        publishState()
        return
      }
      // Any non-status message is an ack for a pending enqueue
      if (pendingCallbacks.length > 0) {
        const cb = pendingCallbacks.shift()
        cb(msg)
      }
    } catch {}
  }

  ws.onclose = () => scheduleReconnect()
  ws.onerror = () => scheduleReconnect()
}

async function fetchTitle(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!res.ok) return null
    const data = await res.json()
    return data.title || null
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

function findVideoRenderers(obj, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 30) return out
  if (Array.isArray(obj)) {
    for (const v of obj) findVideoRenderers(v, out, depth + 1)
    return out
  }
  if (obj.videoRenderer && obj.videoRenderer.videoId) {
    out.push(obj.videoRenderer)
    return out
  }
  for (const v of Object.values(obj)) findVideoRenderers(v, out, depth + 1)
  return out
}

async function searchYouTube(query) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })
    if (!res.ok) return null
    const html = await res.text()

    const dataMatch = html.match(/var\s+ytInitialData\s*=\s*(.+?);\s*<\/script>/)
    if (!dataMatch) return null

    let initialData
    try { initialData = JSON.parse(dataMatch[1]) } catch { return null }

    const renderers = findVideoRenderers(initialData, [])
    if (renderers.length === 0) return null

    const video = renderers[0]
    const videoId = video.videoId
    const title = video.title?.runs?.map(r => r.text).join('') || video.title?.simpleText || null
    const url = `https://www.youtube.com/watch?v=${videoId}`

    _logColor('cyan', `[PLAYER] YouTube search "${query}" → "${title}" (${videoId})`)
    return { url, title, videoId }
  } catch (err) {
    _logColor('red', `[PLAYER] YouTube search failed for "${query}": ${err.message}`)
    return null
  }
}

/**
 * Validates, fetches the title, and sends a song request to the player.
 * Accepts a YouTube URL or free-text search terms.
 *
 * @param {string} input  YouTube URL or search query
 * @param {string} requester
 * @returns {Promise<{ result: 'queued'|'invalid_url'|'no_results'|'player_offline'|'requests_disabled', title?: string, position?: number }>}
 */
async function enqueue(input, requester) {
  if (!ready || !socket) return { result: 'player_offline' }
  if (!requestsEnabled) return { result: 'requests_disabled' }

  let url = input
  let title = null

  if (isYouTubeUrl(input)) {
    title = await fetchTitle(input) || input
  } else {
    const result = await searchYouTube(input)
    if (!result) return { result: 'no_results' }
    url = result.url
    title = result.title || url
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      const idx = pendingCallbacks.indexOf(cb)
      if (idx !== -1) pendingCallbacks.splice(idx, 1)
      resolve({ result: 'queued', title, position: null })
    }, 3000)

    const cb = (response) => {
      clearTimeout(timeout)
      resolve({ result: 'queued', title, position: response.position ?? null })
    }

    pendingCallbacks.push(cb)
    socket.send(JSON.stringify({ url: url.trim(), requester, title }))
  })
}

function skip() {
  if (!ready || !socket) return 'player_offline'
  socket.send(JSON.stringify({ type: 'skip' }))
  return 'skipped'
}

function getCurrentSong() {
  return currentSong
}

function getBackupPlaylistUrl() {
  return backupPlaylistUrl
}

/**
 * Sends a control command to the player.
 * Used by the web player page; chat has no access to these.
 *
 * @param {'pause'|'volume'|'clearQueue'|'removeFromQueue'|'toggleRequests'|'setBackupPlaylist'} action
 * @returns {boolean} false when the player isn't connected
 */
function control(action, value) {
  if (!ready || !socket) return false
  socket.send(JSON.stringify({ type: 'control', action, value }))
  return true
}

function start(logColor, onRequestsToggled) {
  _logColor = logColor
  _onRequestsToggled = onRequestsToggled || null
  connect()
}

module.exports = {
  start,
  enqueue,
  skip,
  getCurrentSong,
  getBackupPlaylistUrl,
  getState,
  onStateChange,
  control,
  isConnected: () => ready
}
