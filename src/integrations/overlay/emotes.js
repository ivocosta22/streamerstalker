const { twitch } = require('../../config/env')
const { getToken } = require('../twitch/twitchAPI')
const { logColor } = require('../../utils/logger')

const REFRESH_MS = 30 * 60 * 1000

// Lowercased name -> { name, url, provider }. Lowercase keys make !showemote
// forgiving about typing, while `exact` preserves case for chat detection:
// "LUL" renders as an emote in Twitch chat, "lul" does not, and a combo should
// only count what viewers actually see as an emote.
let byLower = new Map()
let exact = new Set()
let lastRefresh = 0

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

function absolute(url) {
  if (!url) return null
  return url.startsWith('//') ? `https:${url}` : url
}

async function loadTwitch(broadcasterId) {
  const out = []
  const token = await getToken('app')
  if (!token) throw new Error('no app token')
  const headers = { 'Client-Id': twitch.botClientId, Authorization: `Bearer ${token}` }

  const urls = [
    `${twitch.APIEndpoint}/chat/emotes/global`,
    `${twitch.APIEndpoint}/chat/emotes?broadcaster_id=${encodeURIComponent(broadcasterId)}`
  ]
  for (const url of urls) {
    try {
      const body = await fetchJson(url, headers)
      for (const e of body.data || []) {
        const img = e.images?.url_2x || e.images?.url_1x
        if (e.name && img) out.push({ name: e.name, url: img, provider: 'twitch' })
      }
    } catch (err) {
      logColor('yellow', `[SYSTEM] Twitch emote fetch failed (${url}): ${err.message}`)
    }
  }
  return out
}

async function load7tv(broadcasterId) {
  const out = []
  const push = (emotes) => {
    for (const e of emotes || []) {
      if (e.name && e.id) out.push({ name: e.name, url: `https://cdn.7tv.app/emote/${e.id}/2x.webp`, provider: '7tv' })
    }
  }
  try { push((await fetchJson('https://7tv.io/v3/emote-sets/global')).emotes) } catch {}
  try {
    const user = await fetchJson(`https://7tv.io/v3/users/twitch/${encodeURIComponent(broadcasterId)}`)
    push(user.emote_set?.emotes)
  } catch {}
  return out
}

async function loadBttv(broadcasterId) {
  const out = []
  const push = (emotes) => {
    for (const e of emotes || []) {
      if (e.code && e.id) out.push({ name: e.code, url: `https://cdn.betterttv.net/emote/${e.id}/2x`, provider: 'bttv' })
    }
  }
  try { push(await fetchJson('https://api.betterttv.net/3/cached/emotes/global')) } catch {}
  try {
    const user = await fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(broadcasterId)}`)
    push(user.channelEmotes)
    push(user.sharedEmotes)
  } catch {}
  return out
}

async function loadFfz(broadcasterId) {
  const out = []
  const push = (sets) => {
    for (const set of Object.values(sets || {})) {
      for (const e of set.emoticons || []) {
        const img = absolute(e.urls?.['2'] || e.urls?.['1'] || e.urls?.['4'])
        if (e.name && img) out.push({ name: e.name, url: img, provider: 'ffz' })
      }
    }
  }
  try { push((await fetchJson('https://api.frankerfacez.com/v1/set/global')).sets) } catch {}
  try { push((await fetchJson(`https://api.frankerfacez.com/v1/room/id/${encodeURIComponent(broadcasterId)}`)).sets) } catch {}
  return out
}

async function refresh() {
  const broadcasterId = twitch.channelUserId

  const results = await Promise.allSettled([
    loadTwitch(broadcasterId),
    load7tv(broadcasterId),
    loadBttv(broadcasterId),
    loadFfz(broadcasterId)
  ])

  const nextLower = new Map()
  const nextExact = new Set()
  const counts = {}

  // Later entries win, and each loader already returns global-before-channel,
  // so channel emotes override globals of the same name.
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const emote of result.value) {
      nextLower.set(emote.name.toLowerCase(), emote)
      nextExact.add(emote.name)
      counts[emote.provider] = (counts[emote.provider] || 0) + 1
    }
  }

  if (nextLower.size === 0) {
    logColor('red', '[SYSTEM] Emote refresh returned nothing — keeping previous set')
    return byLower.size
  }

  byLower = nextLower
  exact = nextExact
  lastRefresh = Date.now()

  const breakdown = Object.entries(counts).map(([p, n]) => `${p} ${n}`).join(', ')
  logColor('green', `[SYSTEM] Loaded ${byLower.size} emotes (${breakdown || 'none'})`)
  return byLower.size
}

/** Case-insensitive lookup, for explicit commands like !showemote. */
function find(name) {
  return byLower.get(String(name || '').toLowerCase()) || null
}

/** Case-sensitive check, for deciding whether chat actually shows an emote. */
function isEmote(token) {
  return exact.has(token)
}

function count() {
  return byLower.size
}

function start() {
  refresh().catch(err => logColor('red', `[SYSTEM] Emote load failed: ${err.message}`))
  const timer = setInterval(() => {
    refresh().catch(err => logColor('red', `[SYSTEM] Emote refresh failed: ${err.message}`))
  }, REFRESH_MS)
  if (timer.unref) timer.unref()
}

module.exports = { start, refresh, find, isEmote, count, lastRefresh: () => lastRefresh }
