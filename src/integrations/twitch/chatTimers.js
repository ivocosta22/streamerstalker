const fs = require('fs')
const path = require('path')
const { isStreamLive, getStreamInfo, getChannelInformation, sendChatAnnouncement } = require('./twitchAPI')

const TIMERS_PATH = path.resolve(__dirname, '../../config/timers.json')
const CHAT_COUNT_WINDOW_MS = 5 * 60 * 1000
const LIVE_CHECK_INTERVAL_MS = 60 * 1000
const GLOBAL_TIMER_COOLDOWN_MS = 5 * 60 * 1000

let timers = []
let lastGlobalSend = 0
let chatTimestamps = []
let isLive = false
let wasLive = false
let _say = null
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

  const timer = eligible[Math.floor(Math.random() * eligible.length)]
  const msg = timer.messages[timer.messageIndex % timer.messages.length]
  timer.messageIndex = (timer.messageIndex + 1) % timer.messages.length
  for (const t of eligible) t.lastSent = now
  lastGlobalSend = now

  _say(msg)
  _logColor('cyan', `[TIMERS] Sent timer "${timer.name}": ${msg}`)
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

function startChatTimers({ say, broadcasterId, moderatorId, pingList, onGoLive, logColor }) {
  _say = say
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

module.exports = { startChatTimers, recordChatLine }
