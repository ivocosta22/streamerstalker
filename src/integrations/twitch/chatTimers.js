const fs = require('fs')
const path = require('path')
const { isStreamLive, getStreamInfo, getChannelInformation, sendChatAnnouncement } = require('./twitchAPI')

// Overridable for the same reason as the data directory: a test run must not
// rewrite the timers the live bot is reading.
const TIMERS_PATH = process.env.SURFERSTALKER_TIMERS_PATH
  ? path.resolve(process.env.SURFERSTALKER_TIMERS_PATH)
  : path.resolve(__dirname, '../../config/timers.json')
const CHAT_COUNT_WINDOW_MS = 5 * 60 * 1000
const LIVE_CHECK_INTERVAL_MS = 60 * 1000
const GLOBAL_TIMER_COOLDOWN_MS = 5 * 60 * 1000

let timers = []
let lastGlobalSend = 0
let chatTimestamps = []
let isLive = false
let wasLive = false
let _say = null
let _kickSay = null
let _logColor = () => {}
let _broadcasterId = null
let _moderatorId = null
let _pingList = null
let _onGoLive = null

function loadTimers() {
  try {
    const raw = fs.readFileSync(TIMERS_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    const prev = new Map(timers.map(t => [t.name, t]))

    timers = parsed.filter(t => t.enabled !== false).map(t => {
      const existing = prev.get(t.name)
      return {
        ...t,
        lastSent: existing?.lastSent ?? 0,
        messageIndex: existing?.messageIndex ?? 0
      }
    })
  } catch (err) {
    _logColor('red', `[TWITCH] Failed to load timers.json: ${err.message}`)
  }
}

function recentChatLines() {
  const cutoff = Date.now() - CHAT_COUNT_WINDOW_MS
  chatTimestamps = chatTimestamps.filter(ts => ts > cutoff)
  return chatTimestamps.length
}

function recordChatLine() {
  chatTimestamps.push(Date.now())
}

function checkTimers() {
  const now = Date.now()
  const lines = recentChatLines()

  if (now - lastGlobalSend < GLOBAL_TIMER_COOLDOWN_MS) return

  const eligible = []
  for (const timer of timers) {
    const intervalMs = (isLive ? timer.onlineIntervalMinutes : timer.offlineIntervalMinutes) * 60 * 1000
    if (intervalMs <= 0) continue
    if (now - timer.lastSent < intervalMs) continue
    if (lines < (timer.chatLinesRequired || 0)) continue
    eligible.push(timer)
  }

  if (eligible.length === 0) return

  // Round-robin by staleness rather than a random pick. Picking randomly and
  // then resetting every eligible timer meant an unlucky one kept being pushed
  // back another full interval, so some timers were seen far less than their
  // configured interval suggested. Only the timer that actually fired resets.
  eligible.sort((a, b) => a.lastSent - b.lastSent)
  const oldest = eligible[0].lastSent
  const stalest = eligible.filter(t => t.lastSent === oldest)
  const timer = stalest[Math.floor(Math.random() * stalest.length)]

  const msg = timer.messages[timer.messageIndex % timer.messages.length]
  timer.messageIndex = (timer.messageIndex + 1) % timer.messages.length
  timer.lastSent = now
  lastGlobalSend = now

  const target = timer.target || 'both'
  if (target === 'twitch' || target === 'both') _say(msg)
  if ((target === 'kick' || target === 'both') && _kickSay) _kickSay(msg)
  _logColor('cyan', `[SYSTEM] Sent timer "${timer.name}" → ${target}: ${msg}`)
}

async function announceGoLive() {
  try {
    const info = await getChannelInformation(_broadcasterId)
    const name = info?.broadcaster_name || 'Streamer'
    const category = info?.game_name || 'something cool'
    const title = info?.title || 'Untitled stream'
    let message = `${name} is now live! Streaming ${category}: ${title}`
    const users = _pingList ? _pingList.getAll() : []
    if (users.length > 0) {
      message += ` | Pinging: ${users.map(u => `@${u}`).join(' ')}`
    }
    await sendChatAnnouncement({
      broadcasterId: _broadcasterId,
      moderatorId: _moderatorId,
      message,
      color: 'blue'
    })
    _logColor('green', `[TWITCH] Sent go-live announcement: ${message}`)
  } catch (err) {
    _logColor('red', `[TWITCH] Failed to send go-live announcement: ${err?.message || err}`)
  }
}

function startChatTimers({ say, kickSay, broadcasterId, moderatorId, pingList, onGoLive, logColor }) {
  _say = say
  _kickSay = kickSay || null
  _logColor = logColor
  _pingList = pingList
  _onGoLive = onGoLive || null
  _broadcasterId = broadcasterId
  _moderatorId = moderatorId

  loadTimers()
  _logColor('green', `[TWITCH] Loaded ${timers.length} timer(s)`)

  fs.watch(TIMERS_PATH, () => {
    loadTimers()
    _logColor('green', `[TWITCH] Reloaded ${timers.length} timer(s)`)
  })

  setInterval(checkTimers, 15 * 1000)

  async function pollLiveStatus() {
    try {
      const streamInfo = await getStreamInfo(broadcasterId)
      const live = !!streamInfo
      if (live && !wasLive) {
        announceGoLive()
        if (_onGoLive) _onGoLive(streamInfo)
      }
      wasLive = live
      isLive = live
    } catch {}
  }
  pollLiveStatus()
  setInterval(pollLiveStatus, LIVE_CHECK_INTERVAL_MS)
}

/** Raw timer definitions as stored on disk, including disabled ones. */
function getTimers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TIMERS_PATH, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Validates and writes the whole timer list.
 * The fs.watch in startChatTimers picks the file back up, so a save takes
 * effect without a restart and without this needing to touch live state.
 *
 * @returns {{ok: true, timers: object[]} | {ok: false, error: string}}
 */
function saveTimers(list) {
  if (!Array.isArray(list)) return { ok: false, error: 'expected a list of timers' }
  if (list.length > 100) return { ok: false, error: 'too many timers' }

  const seen = new Set()
  const clean = []

  for (const entry of list) {
    const name = String(entry?.name ?? '').trim()
    if (!name) return { ok: false, error: 'every timer needs a name' }
    if (name.length > 40) return { ok: false, error: `"${name}" is too long for a name` }
    if (seen.has(name.toLowerCase())) return { ok: false, error: `duplicate timer name "${name}"` }
    seen.add(name.toLowerCase())

    const messages = (Array.isArray(entry.messages) ? entry.messages : [])
      .map(m => String(m).trim())
      .filter(Boolean)
    if (messages.length === 0) return { ok: false, error: `"${name}" needs at least one message` }
    if (messages.some(m => m.length > 450)) {
      return { ok: false, error: `a message in "${name}" is too long for Twitch chat` }
    }

    const num = (value, fallback) => {
      const n = Math.floor(Number(value))
      return Number.isFinite(n) && n >= 0 && n <= 10000 ? n : fallback
    }

    const target = ['twitch', 'kick', 'both'].includes(entry.target) ? entry.target : 'both'

    clean.push({
      name,
      enabled: entry.enabled !== false,
      target,
      onlineIntervalMinutes: num(entry.onlineIntervalMinutes, 15),
      offlineIntervalMinutes: num(entry.offlineIntervalMinutes, 30),
      chatLinesRequired: num(entry.chatLinesRequired, 0),
      messages
    })
  }

  try {
    fs.writeFileSync(TIMERS_PATH, JSON.stringify(clean, null, 2))
  } catch (err) {
    return { ok: false, error: `could not save: ${err.message}` }
  }

  loadTimers()
  return { ok: true, timers: clean }
}

module.exports = { startChatTimers, recordChatLine, getTimers, saveTimers }
