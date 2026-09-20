const { twitch } = require('../../config/env')
const { getToken } = require('./twitchAPI')
const { logColor } = require('../../utils/logger')

let cache = null
let cacheTime = 0
const CACHE_TTL = 30 * 60 * 1000

async function fetchBadges() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache

  try {
    const token = await getToken('app')
    if (!token) return cache || {}

    const headers = {
      'Client-ID': twitch.botClientId,
      'Authorization': `Bearer ${token}`
    }

    const [globalRes, channelRes] = await Promise.all([
      fetch(`${twitch.APIEndpoint}/chat/badges/global`, { headers }),
      fetch(`${twitch.APIEndpoint}/chat/badges?broadcaster_id=${twitch.channelUserId}`, { headers })
    ])

    const map = {}

    if (globalRes.ok) {
      const { data } = await globalRes.json()
      for (const set of data) {
        map[set.set_id] = {}
        for (const ver of set.versions) {
          map[set.set_id][ver.id] = {
            url1x: ver.image_url_1x,
            url2x: ver.image_url_2x,
            url4x: ver.image_url_4x,
            title: ver.title || set.set_id
          }
        }
      }
    }

    if (channelRes.ok) {
      const { data } = await channelRes.json()
      for (const set of data) {
        if (!map[set.set_id]) map[set.set_id] = {}
        for (const ver of set.versions) {
          map[set.set_id][ver.id] = {
            url1x: ver.image_url_1x,
            url2x: ver.image_url_2x,
            url4x: ver.image_url_4x,
            title: ver.title || set.set_id
          }
        }
      }
    }

    cache = map
    cacheTime = Date.now()
    logColor('green', `[TWITCH] Cached ${Object.keys(map).length} badge sets`)
  } catch (err) {
    logColor('red', `[TWITCH] Badge fetch failed: ${err?.message || err}`)
  }

  return cache || {}
}

function resolve(badges) {
  if (!badges || !cache) return []
  const result = []
  for (const [setId, version] of Object.entries(badges)) {
    const set = cache[setId]
    if (!set) continue
    const badge = set[version]
    if (badge) result.push({ set: setId, ...badge })
  }
  return result
}

module.exports = { fetchBadges, resolve }
