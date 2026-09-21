const MAX_HISTORY = 200

const history = []
const subscribers = new Set()

function publish(entry) {
  history.push(entry)
  while (history.length > MAX_HISTORY) history.shift()
  for (const fn of subscribers) {
    try { fn(entry) } catch {}
  }
}

function push(context, message, platform = 'twitch') {
  publish({
    id: context.id || context['msg-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    platform,
    user: context['display-name'] || context.username || 'unknown',
    color: context.color || null,
    badges: context.badges || {},
    badgeInfo: context['badge-info'] || {},
    mod: !!context.mod,
    subscriber: !!context.subscriber,
    vip: !!context.vip,
    broadcaster: !!context.badges?.broadcaster,
    userId: context['user-id'] || null,
    message,
    emotes: context.emotes || null,
    timestamp: Date.now()
  })
}

/** Publishes an already-normalized entry. Used by non-Twitch platforms. */
function pushEntry(entry) {
  publish({
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    platform: entry.platform || 'twitch',
    user: entry.user || 'unknown',
    color: entry.color || null,
    badges: entry.badges || {},
    badgeInfo: {},
    mod: !!entry.mod,
    subscriber: !!entry.subscriber,
    vip: !!entry.vip,
    broadcaster: !!entry.broadcaster,
    userId: entry.userId || null,
    message: entry.message || '',
    emotes: null,
    parsedMessage: entry.parsedMessage || null,
    resolvedBadges: entry.resolvedBadges || null,
    profilePic: entry.profilePic || null,
    timestamp: entry.timestamp || Date.now()
  })
}

function pushSystem(text) {
  publish({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    platform: 'system',
    user: '',
    color: null,
    badges: {},
    badgeInfo: {},
    mod: false,
    subscriber: false,
    vip: false,
    broadcaster: false,
    message: text,
    emotes: null,
    timestamp: Date.now()
  })
}

function getHistory() {
  return history.slice()
}

function subscribe(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

let _say = null
let _kickSay = null

function setSay(fn) { _say = fn }
function setKickSay(fn) { _kickSay = fn }

function say(msg) {
  if (!_say) return false
  _say(msg)
  return true
}

function kickSay(msg) {
  if (!_kickSay) return false
  _kickSay(msg)
  return true
}

module.exports = { push, pushEntry, pushSystem, getHistory, subscribe, setSay, say, setKickSay, kickSay }
