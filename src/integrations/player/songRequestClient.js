const PLAYER_URL = 'ws://localhost:9001'
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 10000

let socket = null
let ready = false
let requestsEnabled = true
let currentSong = null   // { title, url, requester } — pushed by player on track change
let _logColor = () => {}
let _onRequestsToggled = null
let _reconnectDelay = RECONNECT_MIN_MS

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
    _logColor('green', '[PLAYER] ✅ Connected to song request player')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') {
        if (typeof msg.requestsEnabled === 'boolean') {
          const changed = requestsEnabled !== msg.requestsEnabled
          requestsEnabled = msg.requestsEnabled
          _logColor(requestsEnabled ? 'green' : 'yellow', `[PLAYER] Song requests ${requestsEnabled ? 'enabled' : 'disabled'} by player`)
          if (changed && _onRequestsToggled) _onRequestsToggled(requestsEnabled)
        }
        if ('current' in msg) currentSong = msg.current
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

/**
 * Validates, fetches the title, and sends a song request to the player.
 *
 * @param {string} url
 * @param {string} requester
 * @returns {Promise<{ result: 'queued'|'invalid_url'|'player_offline'|'requests_disabled', title?: string, position?: number }>}
 */
async function enqueue(url, requester) {
  if (!isYouTubeUrl(url)) return { result: 'invalid_url' }
  if (!ready || !socket) return { result: 'player_offline' }
  if (!requestsEnabled) return { result: 'requests_disabled' }

  const title = await fetchTitle(url) || url

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

function start(logColor, onRequestsToggled) {
  _logColor = logColor
  _onRequestsToggled = onRequestsToggled || null
  connect()
}

module.exports = { start, enqueue, skip, getCurrentSong }
