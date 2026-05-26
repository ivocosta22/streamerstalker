const fs = require('fs')
const path = require('path')
const { isStreamLive, getChannelInformation, sendChatAnnouncement } = require('./twitchAPI')

const TIMERS_PATH = path.resolve(__dirname, '../../config/timers.json')
const CHAT_COUNT_WINDOW_MS = 5 * 60 * 1000
const LIVE_CHECK_INTERVAL_MS = 60 * 1000

let timers = []
let chatTimestamps = []
let isLive = false
let wasLive = false
let _say = null
let _logColor = () => {}
let _broadcasterId = null
let _moderatorId = null
let _pingList = null

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
    _logColor('red', `[TIMERS] Failed to load timers.json: ${err.message}`)
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

  for (const timer of timers) {
    const intervalMs = (isLive ? timer.onlineIntervalMinutes : timer.offlineIntervalMinutes) * 60 * 1000
    if (intervalMs <= 0) continue
    if (now - timer.lastSent < intervalMs) continue
    if (lines < (timer.chatLinesRequired || 0)) continue

    const msg = timer.messages[timer.messageIndex % timer.messages.length]
    timer.messageIndex = (timer.messageIndex + 1) % timer.messages.length
    timer.lastSent = now

    _say(msg)
    _logColor('cyan', `[TIMERS] Sent timer "${timer.name}": ${msg}`)
  }
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
    _logColor('green', `[TIMERS] Sent go-live announcement: ${message}`)
  } catch (err) {
    _logColor('red', `[TIMERS] Failed to send go-live announcement: ${err?.message || err}`)
  }
}

function startChatTimers({ say, broadcasterId, moderatorId, pingList, logColor }) {
  _say = say
  _logColor = logColor
  _pingList = pingList
  _broadcasterId = broadcasterId
  _moderatorId = moderatorId

  loadTimers()
  _logColor('green', `[TIMERS] Loaded ${timers.length} timer(s)`)

  fs.watch(TIMERS_PATH, () => {
    loadTimers()
    _logColor('green', `[TIMERS] Reloaded ${timers.length} timer(s)`)
  })

  setInterval(checkTimers, 15 * 1000)

  async function pollLiveStatus() {
    try {
      const live = await isStreamLive(broadcasterId)
      if (live && !wasLive) announceGoLive()
      wasLive = live
      isLive = live
    } catch {}
  }
  pollLiveStatus()
  setInterval(pollLiveStatus, LIVE_CHECK_INTERVAL_MS)
}

module.exports = { startChatTimers, recordChatLine }
