const { twitch } = require('../../config/env')
const { logColor } = require('../../utils/logger')

let emoteMap = {}
let cacheTime = 0
const CACHE_TTL = 30 * 60 * 1000

async function fetchEmotes() {
  if (Object.keys(emoteMap).length && Date.now() - cacheTime < CACHE_TTL) return

  const map = {}
  const userId = twitch.channelUserId

  const fetchers = [
    ['FFZ', fetchFFZ],
    ['BTTV', fetchBTTV],
    ['7TV', fetch7TV]
  ]

  for (const [name, fn] of fetchers) {
    try {
      await fn(map, userId)
    } catch (err) {
      logColor('yellow', `[SYSTEM] ${name} fetch failed: ${err?.message || err}`)
    }
  }

  emoteMap = map
  cacheTime = Date.now()
  logColor('green', `[SYSTEM] Cached ${Object.keys(map).length} third-party emotes`)
}

async function fetch7TV(map, userId) {
  const globalRes = await fetch('https://7tv.io/v3/emote-sets/global')
  if (globalRes.ok) {
    const data = await globalRes.json()
    add7TVEmotes(map, data.emotes || [])
  }

  const channelRes = await fetch(`https://7tv.io/v3/users/twitch/${userId}`)
  if (channelRes.ok) {
    const data = await channelRes.json()
    add7TVEmotes(map, data.emote_set?.emotes || [])
  }
}

function add7TVEmotes(map, emotes) {
  for (const e of emotes) {
    const host = e.data?.host
    if (!host?.url) continue
    const base = 'https:' + host.url
    const entry = { url: `${base}/2x.webp`, provider: '7tv' }
    if ((e.flags ?? 0) & 1) entry.zeroWidth = true
    map[e.name] = entry
  }
}

async function fetchBTTV(map, userId) {
  const globalRes = await fetch('https://api.betterttv.net/3/cached/emotes/global')
  if (globalRes.ok) {
    const emotes = await globalRes.json()
    addBTTVEmotes(map, emotes)
  }

  const channelRes = await fetch(`https://api.betterttv.net/3/cached/users/twitch/${userId}`)
  if (channelRes.ok) {
    const data = await channelRes.json()
    addBTTVEmotes(map, data.channelEmotes || [])
    addBTTVEmotes(map, data.sharedEmotes || [])
  }
}

function addBTTVEmotes(map, emotes) {
  for (const e of emotes) {
    map[e.code] = { url: `https://cdn.betterttv.net/emote/${e.id}/2x`, provider: 'bttv' }
  }
}

async function fetchFFZ(map, userId) {
  const globalRes = await fetch('https://api.frankerfacez.com/v1/set/global')
  if (globalRes.ok) {
    const data = await globalRes.json()
    addFFZSets(map, data.sets || {})
  }

  const channelRes = await fetch(`https://api.frankerfacez.com/v1/room/id/${userId}`)
  if (channelRes.ok) {
    const data = await channelRes.json()
    addFFZSets(map, data.sets || {})
  }
}

function addFFZSets(map, sets) {
  for (const set of Object.values(sets)) {
    for (const e of (set.emoticons || [])) {
      const url = e.urls?.['2'] || e.urls?.['1'] || null
      if (url) map[e.name] = { url: url.startsWith('//') ? 'https:' + url : url, provider: 'ffz' }
    }
  }
}

function parseMessage(text, twitchEmotes) {
  if (!text) return [{ type: 'text', value: '' }]

  const positions = []
  if (twitchEmotes) {
    for (const [id, ranges] of Object.entries(twitchEmotes)) {
      for (const range of (Array.isArray(ranges) ? ranges : [])) {
        const [s, e] = String(range).split('-').map(Number)
        if (!isNaN(s) && !isNaN(e)) {
          positions.push({ start: s, end: e + 1, id })
        }
      }
    }
    positions.sort((a, b) => a.start - b.start)
  }

  if (positions.length) {
    const segments = []
    let last = 0
    for (const p of positions) {
      if (p.start > last) pushThirdParty(segments, text.slice(last, p.start))
      segments.push({
        type: 'emote',
        name: text.slice(p.start, p.end),
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${p.id}/default/dark/2.0`,
        provider: 'twitch'
      })
      last = p.end
    }
    if (last < text.length) pushThirdParty(segments, text.slice(last))
    return segments
  }

  const segments = []
  pushThirdParty(segments, text)
  return segments
}

/**
 * Appends `text` to `segments`, swapping in any word that matches a cached emote.
 * `allow` limits which providers may match — Kick shares the 7TV set but has no
 * BTTV or FFZ, so matching those there would show emotes Kick viewers never see.
 */
function pushThirdParty(segments, text, allow) {
  if (!text) return
  const tokens = text.split(/(\s+)/)
  for (const tok of tokens) {
    const emote = emoteMap[tok]
    if (emote && (!allow || allow.has(emote.provider))) {
      const seg = { type: 'emote', name: tok, url: emote.url, provider: emote.provider }
      if (emote.zeroWidth) seg.zeroWidth = true
      segments.push(seg)
    } else {
      const prev = segments.length ? segments[segments.length - 1] : null
      if (prev && prev.type === 'text') {
        prev.value += tok
      } else {
        segments.push({ type: 'text', value: tok })
      }
    }
  }
}

module.exports = { fetchEmotes, parseMessage, appendEmotes: pushThirdParty }
