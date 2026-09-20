/**
 * kickChat.js
 *
 * Reads Kick chat over the Pusher socket the Kick web player itself uses.
 *
 * Kick's REST channel lookup sits behind Cloudflare and refuses most
 * server-side calls, so the numeric chatroom id cannot be resolved reliably
 * from the channel slug. The lookup is attempted once at startup (it usually
 * succeeds from a residential IP) and KICK_CHATROOM_ID overrides it when it
 * does not.
 */

const chatBus = require('../twitch/chatBus')
const emoteResolver = require('../twitch/emoteResolver')
const { logColor } = require('../../utils/logger')
const { streamer, kick } = require('../../config/env')

// Kick channels share the streamer's 7TV set, but BTTV and FFZ do not exist there.
const KICK_EMOTE_PROVIDERS = new Set(['7tv'])

// Two traps live in these three lines, both of which fail quietly:
//
//   * Most community libraries still publish the app key eb1d5f283081a78b932c.
//     It is dead — Pusher answers "not in this cluster" and the socket closes.
//     Do not swap this key for one found online without connecting first.
//   * The channel must be chatrooms.<id>.v2. The older chatroom.<id> still
//     ACKs the subscription and then never delivers a single message, so a
//     typo here looks like a dead chat rather than a bad channel name.
const PUSHER_KEY = '32cbd69e4b950bf97679'
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`

const MAX_BACKOFF_MS = 30000
const EMOTE_RE = /\[emote:(\d+):([^\]]*)\]/g

const KICK_GREEN = '#53fc18'

let socket = null
let reconnectTimer = null
let attempt = 0
let stopped = false

function slugFromUrl(url) {
  const match = String(url || '').match(/kick\.com\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

async function resolveChatroomId(slug) {
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${slug}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
      }
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.chatroom?.id ?? null
  } catch {
    return null
  }
}

function pushText(segments, text) {
  emoteResolver.appendEmotes(segments, text, KICK_EMOTE_PROVIDERS)
}

/** Kick inlines its own emotes as [emote:<id>:<name>]; 7TV ones arrive as plain words. */
function parseKickMessage(content) {
  const segments = []
  let last = 0
  let match
  EMOTE_RE.lastIndex = 0

  while ((match = EMOTE_RE.exec(content)) !== null) {
    if (match.index > last) pushText(segments, content.slice(last, match.index))
    segments.push({
      type: 'emote',
      name: match[2] || 'emote',
      url: `https://files.kick.com/emotes/${match[1]}/fullsize`,
      provider: 'kick'
    })
    last = match.index + match[0].length
  }
  if (last < content.length) pushText(segments, content.slice(last))

  return segments.length ? segments : [{ type: 'text', value: content }]
}

function escXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function svgBadge(inner, title) {
  return `<svg viewBox="0 0 16 16" class="kbadge" width="18" height="18" ` +
    `style="vertical-align:middle;margin-right:3px"><title>${escXml(title)}</title>${inner}</svg>`
}

const ROUNDED = (fill) => `<rect x="1" y="1" width="14" height="14" rx="3" fill="${fill}"/>`
const LABEL = (text, fill, size) =>
  `<text x="8" y="11.5" text-anchor="middle" font-size="${size}" font-weight="700" ` +
  `font-family="Arial, sans-serif" fill="${fill}">${text}</text>`

function subGifterColor(count) {
  if (count >= 200) return '#ff3b3b'
  if (count >= 100) return '#ff8c00'
  if (count >= 50) return '#c85cff'
  if (count >= 25) return '#3ea6ff'
  return KICK_GREEN
}

/** Kick draws its role badges as inline vectors rather than serving images. */
function roleBadgeSvg(type, count, label) {
  switch (type) {
    case 'subscriber':
      return svgBadge(
        `<path d="M8 1.5l2 4.2 4.6.6-3.4 3.2.9 4.6L8 11.8l-4.1 2.3.9-4.6L1.4 6.3 6 5.7z" fill="${KICK_GREEN}"/>`,
        `Subscriber (${count} month${count === 1 ? '' : 's'})`
      )
    case 'sub_gifter': {
      const c = subGifterColor(count)
      return svgBadge(
        `<rect x="2" y="6" width="12" height="8.5" rx="1.5" fill="${c}"/>` +
        `<rect x="1" y="3.5" width="14" height="3.5" rx="1" fill="${c}"/>` +
        `<rect x="7" y="3.5" width="2" height="11" fill="#0b0e0f"/>` +
        `<path d="M8 3.5C6 3.5 4.5 1 6.5 1 7.5 1 8 2.5 8 3.5zm0 0c2 0 3.5-2.5 1.5-2.5C8.5 1 8 2.5 8 3.5z" fill="${c}"/>`,
        `Sub Gifter (${count} gift${count === 1 ? '' : 's'})`
      )
    }
    case 'moderator':
      return svgBadge(
        `<path d="M13.5 1.5L5.2 9.8l1 1L14.5 2.5z" fill="${KICK_GREEN}"/>` +
        `<path d="M4.2 10.8l1-1 1 1-1 1z" fill="${KICK_GREEN}"/>` +
        `<path d="M2 14l2.2-3.2 1 1L2 14z" fill="${KICK_GREEN}"/>` +
        `<path d="M4.5 8.5l3 3-1.2 1.2-3-3z" fill="#2cb80f"/>`,
        label
      )
    case 'vip':
      return svgBadge(
        `<path d="M3 2h10l2.5 4L8 14.5 0.5 6z" fill="#ff4fd8"/>` +
        `<path d="M3 2l2 4h6l2-4" fill="#ffb3ee"/>` +
        `<path d="M5 6l3 8.5L11 6z" fill="#ff85e4"/>`,
        label
      )
    case 'og':
      return svgBadge(
        ROUNDED('#1f2a30') +
        `<rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="${KICK_GREEN}" stroke-width="1"/>` +
        LABEL('OG', KICK_GREEN, 7),
        label
      )
    case 'broadcaster':
      return svgBadge(
        ROUNDED('#e5484d') +
        `<rect x="3" y="5" width="7" height="6" rx="1" fill="#fff"/>` +
        `<path d="M10 7l3-1.5v5L10 9z" fill="#fff"/>`,
        label
      )
    case 'verified':
      return svgBadge(
        `<circle cx="8" cy="8" r="7" fill="${KICK_GREEN}"/>` +
        `<path d="M4.5 8.2l2.3 2.3 4.7-4.7" fill="none" stroke="#0b0e0f" stroke-width="2" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`,
        label
      )
    case 'founder':
      return svgBadge(ROUNDED('#f5a524') + LABEL('F', '#0b0e0f', 9), label)
    case 'staff':
      return svgBadge(ROUNDED(KICK_GREEN) + LABEL('K', '#0b0e0f', 9), label)
    case 'bot':
      return svgBadge(ROUNDED('#3ea6ff') + LABEL('BOT', '#fff', 5.5), label)
    default:
      return null
  }
}

/**
 * Kick splits badges across two arrays: `badges` holds the channel roles, which
 * carry no image and are drawn as vectors here, and `badges_v2` holds the global
 * ones (chat level, event badges) that do come with a hosted image. Kick renders
 * channel badges first, then global, each in its own sort_order.
 */
function mapBadges(badges, badgesV2) {
  const out = []

  const byOrder = (a, b) => (a?.sort_order || 0) - (b?.sort_order || 0)

  if (Array.isArray(badges)) {
    for (const b of [...badges].sort(byOrder)) {
      const type = String(b?.type || '')
      if (!type) continue
      const count = Number(b?.count) || 0
      const label = count ? `${b.text || type} ${count}` : (b.text || type)
      const svg = roleBadgeSvg(type, count, label)
      // Unknown roles keep the text pill so a new Kick badge is still readable.
      out.push(svg ? { set: type, svg, title: label } : { set: type, label, color: '#b5b5b5' })
    }
  }

  if (Array.isArray(badgesV2)) {
    for (const b of [...badgesV2].sort(byOrder)) {
      // `selected: false` means the viewer owns the badge but chose to hide it.
      if (!b?.image_url || b.selected === false) continue
      const name = String(b.name || 'badge')
      const level = b.metadata?.level
      out.push({
        set: name,
        url1x: b.image_url,
        url2x: b.image_url,
        title: level != null ? `Level ${level}` : name.replace(/[_-]+/g, ' ')
      })
    }
  }

  return out
}

function handleChatMessage(payload) {
  const sender = payload?.sender || {}
  const identity = sender.identity || {}
  const badges = Array.isArray(identity.badges) ? identity.badges : []
  const types = new Set(badges.map((b) => String(b?.type || '')))
  const content = String(payload?.content ?? '')

  chatBus.pushEntry({
    id: payload?.id,
    platform: 'kick',
    user: sender.username || 'unknown',
    color: identity.color || null,
    message: content,
    parsedMessage: parseKickMessage(content),
    resolvedBadges: mapBadges(badges, identity.badges_v2),
    mod: types.has('moderator'),
    subscriber: types.has('subscriber'),
    vip: types.has('vip'),
    broadcaster: types.has('broadcaster'),
    timestamp: payload?.created_at ? Date.parse(payload.created_at) || Date.now() : Date.now()
  })
}

function handleFrame(raw) {
  let frame
  try { frame = JSON.parse(raw) } catch { return }

  const event = String(frame?.event || '')

  if (event === 'pusher:ping') {
    send({ event: 'pusher:pong', data: {} })
    return
  }
  if (!event.endsWith('ChatMessageEvent')) return

  // Pusher nests the payload as a JSON string inside the frame.
  let payload = frame.data
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { return }
  }
  if (payload) handleChatMessage(payload)
}

function send(obj) {
  try { socket?.send(JSON.stringify(obj)) } catch {}
}

function scheduleReconnect(chatroomId) {
  if (stopped || reconnectTimer) return
  const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS)
  attempt++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect(chatroomId)
  }, delay)
}

function connect(chatroomId) {
  if (stopped) return

  socket = new WebSocket(PUSHER_URL)

  socket.addEventListener('open', () => {
    attempt = 0
    send({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } })
    logColor('green', `[KICK] Connected to chatroom ${chatroomId}`)
  })

  socket.addEventListener('message', (ev) => handleFrame(ev.data))

  socket.addEventListener('close', () => {
    socket = null
    if (!stopped) {
      logColor('yellow', '[KICK] Chat socket closed — reconnecting')
      scheduleReconnect(chatroomId)
    }
  })

  socket.addEventListener('error', () => {
    try { socket?.close() } catch {}
  })
}

async function start() {
  if (!kick.enabled) return

  let chatroomId = kick.chatroomId
  const slug = slugFromUrl(streamer.kickChannelUrl)

  if (!chatroomId && slug) chatroomId = await resolveChatroomId(slug)

  if (!chatroomId) {
    logColor('yellow', '[KICK] Chatroom id unavailable (Cloudflare blocks the lookup) — set KICK_CHATROOM_ID to enable Kick chat')
    return
  }

  stopped = false
  connect(chatroomId)
}

function stop() {
  stopped = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  try { socket?.close() } catch {}
  socket = null
}

module.exports = { start, stop, parseKickMessage, mapBadges, resolveChatroomId, slugFromUrl }
