/**
 * twitchAPI.js
 *
 * Handles all Twitch API interactions including:
 * - App token management (client_credentials)
 * - User token management and refresh (authorization_code flow)
 * - Token persistence to storage
 * - User lookup and channel/category lookup
 *
 * Tokens are cached in memory and persisted to storage to reduce API calls.
 */

const { twitch } = require('../../config/env')
const { logColor } = require('../../utils/logger')
const superfetch = require('node-superfetch')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

// ============================================================
// Constants & Module State
// ============================================================

const TWITCH_TOKEN_URL = twitch.userTokenEndpoint
const TOKEN_EXPIRY_BUFFER = 60 // seconds: subtract from expires_in to avoid edge expiry
const tokenPath = path.resolve(__dirname, '../../config/tokens/twitch-user-tokens.json')

let userTokens = null
let appToken = null
let appTokenExpiresAt = 0

// ============================================================
// Helper Functions
// ============================================================

/**
 * Builds standard API headers for Twitch requests.
 * @param {string} token
 * @returns {{[header:string]: string}}
 */
function getApiHeaders(token) {
  return {
    'Client-ID': twitch.botClientId,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}

/**
 * Loads persisted user tokens from storage into memory.
 * If file doesn't exist or parse fails, initializes to an empty object.
 */
function loadTokens() {
  if (fs.existsSync(tokenPath)) {
    try {
      userTokens = JSON.parse(fs.readFileSync(tokenPath))
    } catch (error) {
      logColor('red', `[TWITCH] ❌ Failed to parse twitch-user-tokens.json: ${error}`)
      userTokens = {}
    }
  } else {
    userTokens = {}
  }
}

/**
 * Prompts the operator to paste the authorization code from the Twitch OAuth redirect URL.
 * Useful for manual token bootstrap.
 * @returns {Promise<string>} authorization code
 */
async function askForAuthorizationCode() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    rl.question('[TWITCH] 📝 Enter the authorization code from the URL: ', (code) => {
      rl.close()
      resolve(code)
    })
  })
}

/**
 * Returns true if the persisted user token is still valid (not expired).
 * @returns {Promise<boolean>}
 */
async function validateToken() {
  const now = Math.floor(Date.now() / 1000)
  return Boolean(userTokens?.expires_at && userTokens.expires_at > now)
}

// ============================================================
// Public API
// ============================================================

/**
 * Fetches Twitch user ID for a given username.
 *
 * @param {string} username
 * @returns {Promise<string|null>} user ID or null on failure
 */
async function getUser(username) {
  try {
    const token = await getToken('app')
    if (!token) {
      logColor('red', `[TWITCH] ❌ Could not acquire a valid token for getUser`)
      return null
    }

    const url = `${twitch.APIEndpoint}/users?login=${encodeURIComponent(username)}`
    const res = await superfetch.get(url).set(getApiHeaders(token))

    if (res.status !== 200) {
      logColor('red', `[TWITCH] ❌ Failed to fetch userID for ${username}. Status: ${res.status} ${res.statusText}`)
      return null
    }

    const userData = res.body?.data
    if (!userData || userData.length === 0) {
      logColor('red', `[TWITCH] ❌ No user data found in Twitch API for ${username}`)
      return null
    }

    return userData[0].id
  } catch (error) {
    logColor('red', `[TWITCH] ❌ Error getting user data for ${username}: ${error}`)
    return null
  }
}

/**
 * Fetches the current streaming category (game_name) for a Twitch user.
 *
 * @param {string} username
 * @returns {Promise<string|null>} game_name or null on failure
 */
async function getUserCategory(username) {
  try {
    const userID = await getUser(username)
    if (!userID) {
      logColor('red', `[TWITCH] ❌ Could not retrieve user ID for ${username}`)
      return null
    }

    const token = await getToken('app')
    if (!token) {
      logColor('red', `[TWITCH] ❌ Could not acquire a valid token for getUserCategory`)
      return null
    }

    const url = `${twitch.APIEndpoint}/channels?broadcaster_id=${encodeURIComponent(userID)}`
    const res = await superfetch.get(url).set(getApiHeaders(token))

    if (res.status !== 200) {
      logColor('red', `[TWITCH] ❌ Failed to fetch stream info for ${username}. Status: ${res.status} ${res.statusText}`)
      return null
    }

    const userData = res.body?.data
    if (!userData || userData.length === 0) {
      logColor('red', `[TWITCH] ❌ No channel data found in Twitch API for ${username}`)
      return null
    }

    return userData[0].game_name ?? null
  } catch (error) {
    logColor('red', `[TWITCH] ❌ Error getting category for ${username}: ${error}`)
    return null
  }
}

/**
 * Fetches channel information for a broadcaster.
 *
 * @param {string} broadcasterId
 * @returns {Promise<object|null>} channel info or null on failure
 */
async function getChannelInformation(broadcasterId) {
  try {
    const token = await getToken('app')
    if (!token) {
      logColor('red', '[TWITCH] ❌ Could not acquire a valid token for getChannelInformation')
      return null
    }

    const url = `${twitch.APIEndpoint}/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`
    const res = await superfetch.get(url).set(getApiHeaders(token))

    if (res.status !== 200) {
      logColor('red', `[TWITCH] ❌ Failed to fetch channel info for broadcaster ${broadcasterId}. Status: ${res.status} ${res.statusText}`)
      return null
    }

    const channelData = res.body?.data
    if (!channelData || channelData.length === 0) {
      logColor('red', `[TWITCH] ❌ No channel data found for broadcaster ${broadcasterId}`)
      return null
    }

    return channelData[0]
  } catch (error) {
    logColor('red', `[TWITCH] ❌ Error getting channel info for broadcaster ${broadcasterId}: ${error}`)
    return null
  }
}

/**
 * Sends a highlighted Twitch chat announcement.
 *
 * @param {object} params
 * @param {string} params.broadcasterId
 * @param {string} params.moderatorId
 * @param {string} params.message
 * @param {'blue'|'green'|'orange'|'purple'|'primary'} [params.color='primary']
 * @returns {Promise<boolean>}
 */
async function sendChatAnnouncement({ broadcasterId, moderatorId, message, color = 'primary' }) {
  if (!broadcasterId || !moderatorId || !message?.trim()) return false

  try {
    const token = await getToken('user')
    if (!token) {
      logColor('red', '[TWITCH] ❌ Could not acquire a valid user token for sendChatAnnouncement')
      return false
    }

    const res = await superfetch
      .post(`${twitch.APIEndpoint}/chat/announcements`)
      .query({
        broadcaster_id: broadcasterId,
        moderator_id: moderatorId
      })
      .set('Authorization', `Bearer ${token}`)
      .set('Client-Id', twitch.botClientId)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        message: message.trim(),
        color
      }))

    if (res.status === 204) {
      logColor('green', `[TWITCH] ✅ Announcement sent: ${message.trim()}`)
      return true
    }

    logColor('red', `[TWITCH] ❌ Failed to send announcement. Status: ${res.status} ${res.statusText}`)
    return false
  } catch (error) {
    logColor('red', `[TWITCH] ❌ Error sending announcement: ${error?.message || error}`)
    return false
  }
}

/**
 * Returns either an app token (client credentials) or a persisted user token.
 *
 * @param {'app'|'user'} [type='user']
 * @returns {Promise<string|null>} access token or null on failure
 */
async function getToken(type = 'user') {
  if (type === 'app') {
    const now = Math.floor(Date.now() / 1000)
    if (appToken && appTokenExpiresAt > now) return appToken

    try {
      const res = await superfetch
        .post(TWITCH_TOKEN_URL)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .query({
          client_id: twitch.botClientId,
          client_secret: twitch.botClientSecret,
          grant_type: 'client_credentials'
        })
        .send()

      if (res.status !== 200) {
        logColor('red', `[TWITCH] ❌ Failed to get app token. Status: ${res.status} ${res.statusText}`)
        return null
      }

      const { access_token, expires_in } = res.body
      appToken = access_token
      appTokenExpiresAt = Math.floor(Date.now() / 1000) + (Number(expires_in) || 0) - TOKEN_EXPIRY_BUFFER
      logColor('green', `[TWITCH] ✅ New app token acquired.`)
      return access_token
    } catch (error) {
      logColor('red', `[TWITCH] ❌ Error fetching app token: ${error}`)
      return null
    }
  }

  // User token flow
  loadTokens()

  if (await validateToken()) {
    return userTokens.access_token ?? null
  }

  try {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }

    if (userTokens?.refresh_token) {
      const res = await superfetch
        .post(TWITCH_TOKEN_URL)
        .set(headers)
        .query({
          grant_type: 'refresh_token',
          refresh_token: userTokens.refresh_token,
          client_id: twitch.botClientId,
          client_secret: twitch.botClientSecret
        })
        .send()

      if (res.status !== 200) {
        logColor('red', `[TWITCH] ❌ Failed to refresh user token. Status: ${res.status} ${res.statusText}`)
        return null
      }

      const { access_token, refresh_token, expires_in } = res.body
      userTokens.access_token = access_token
      if (refresh_token) userTokens.refresh_token = refresh_token
      userTokens.expires_at = Math.floor(Date.now() / 1000) + (Number(expires_in) || 0) - TOKEN_EXPIRY_BUFFER

      try {
        fs.writeFileSync(tokenPath, JSON.stringify(userTokens, null, 2))
      } catch (err) {
        logColor('red', `[TWITCH] ❌ Failed to persist refreshed tokens to storage: ${err}`)
      }

      logColor('green', `[TWITCH] 🔁 Refreshed user token successfully`)
      return access_token
    } else {
      // No refresh token: interactive flow to obtain new user token
      return await getNewAuthToken()
    }
  } catch (error) {
    logColor('red', `[TWITCH] ❌ Error refreshing user token: ${error}`)
    return null
  }
}

/**
 * Initiates an interactive authorization code exchange to obtain new user tokens.
 * This prompts the operator to visit the authorization URL and paste the returned code.
 *
 * @returns {Promise<string|null>} access token or null on failure
 */
async function getNewAuthToken() {
  logColor('red', `[TWITCH] ❌ Your refresh token is invalid or missing.`)
  logColor('red', `[TWITCH] ⚠️ Please visit the following URL to authorize your app and get a new code:`)
  console.log(twitch.botAuthorizationLink)

  // Wait for the user to paste the code here
  const code = await askForAuthorizationCode()
  if (!code) {
    logColor('red', '[TWITCH] ❌ No code provided')
    return null
  }

  logColor('yellow', `[TWITCH] Got the code, exchanging for tokens...`)

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }

  try {
    const response = await superfetch
      .post(TWITCH_TOKEN_URL)
      .set(headers)
      .query({
        grant_type: 'authorization_code',
        code,
        client_id: twitch.botClientId,
        client_secret: twitch.botClientSecret,
        redirect_uri: 'http://localhost:3000'
      })
      .send()

    if (response.status !== 200) {
      logColor('red', `[TWITCH] ❌ Failed to get tokens. Status: ${response.status} ${response.statusText}`)
      return null
    }

    const { access_token, refresh_token, expires_in } = response.body

    // Ensure userTokens is an object
    userTokens = userTokens || {}
    userTokens.access_token = access_token
    userTokens.refresh_token = refresh_token
    userTokens.expires_at = Math.floor(Date.now() / 1000) + (Number(expires_in) || 0) - TOKEN_EXPIRY_BUFFER

    try {
      fs.writeFileSync(tokenPath, JSON.stringify(userTokens, null, 2))
    } catch (err) {
      logColor('red', `[TWITCH] ❌ Failed to persist new tokens to disk: ${err}`)
    }

    logColor('green', `[TWITCH] 🔁 New tokens obtained and saved successfully.`)
    return access_token
  } catch (error) {
    logColor('red', `[TWITCH] ❌ Error getting new tokens ${error}`)
    return null
  }
}

async function isStreamLive(broadcasterId) {
  try {
    const token = await getToken('app')
    if (!token) return false
    const url = `${twitch.APIEndpoint}/streams?user_id=${encodeURIComponent(broadcasterId)}`
    const res = await superfetch.get(url).set(getApiHeaders(token))
    if (res.status !== 200) return false
    return (res.body?.data?.length ?? 0) > 0
  } catch {
    return false
  }
}

async function getStreamInfo(broadcasterId) {
  try {
    const token = await getToken('app')
    if (!token) return null
    const url = `${twitch.APIEndpoint}/streams?user_id=${encodeURIComponent(broadcasterId)}`
    const res = await superfetch.get(url).set(getApiHeaders(token))
    if (res.status !== 200 || !res.body?.data?.length) return null
    return res.body.data[0]
  } catch {
    return null
  }
}

// ============================================================
// Module Exports
// ============================================================
module.exports = Object.freeze({
  getToken,
  getUser,
  getUserCategory,
  getChannelInformation,
  sendChatAnnouncement,
  isStreamLive,
  getStreamInfo
})
