/**
 * env.js
 *
 * Centralized environment configuration.
 *
 * Functionality:
 *
 * - Loads environment variables from the .env file
 * - Validates required variables
 * - Parses numeric and boolean values where appropriate
 *
 * This ensures all configuration is validated at startup
 * and prevents runtime errors.
 */

const path = require('path')

// ============================================================
// Load .env File
// ============================================================
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env')
})

// ============================================================
// Environment Variable Validation Helpers
// ============================================================
/**
 * Retrieves required environment variable
 * Throws error if missing
 *
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

/**
 * Retrieves required number environment variable
 *
 * @param {string} name
 * @returns {number}
 */
function requireEnvNumber(name) {
  const value = requireEnv(name)
  const number = Number(value)
  if (Number.isNaN(number)) throw new Error(`Environment variable must be a number: ${name}`)
  return number
}

function optionalEnvBool(name, defaultValue) {
  const value = process.env[name]
  if (value === undefined || value === '') return defaultValue
  return value.toLowerCase() !== 'false' && value !== '0'
}


// ============================================================
// Export Immutable Config Object
// ============================================================
module.exports = Object.freeze({
  twitch: Object.freeze({
    prefix: requireEnv('TWITCH_COMMAND_PREFIX'),
    channel: requireEnv('TWITCH_CHANNEL'),
    channelCaseSensitive: requireEnv('TWITCH_CHANNEL_CASE_SENSITIVE'),
    channelUserId: requireEnv('TWITCH_CHANNEL_USERID'),
    botUsername: requireEnv('TWITCH_BOT_USERNAME'),
    botUserId: requireEnv('TWITCH_BOT_USERID'),
    botOAuth: requireEnv('TWITCH_BOT_OAUTH'),
    botClientId: requireEnv('TWITCH_BOT_API_CLIENTID'),
    botClientSecret: requireEnv('TWITCH_BOT_API_CLIENT_SECRET'),
    botAuthorizationLink: requireEnv('TWITCH_BOT_AUTHORIZATION_LINK'),
    APIEndpoint: requireEnv('TWITCH_API_ENDPOINT'),
    userTokenEndpoint: requireEnv('TWITCH_USER_TOKEN_ENDPOINT')
  }),

  streamer: Object.freeze({
    kickChannelUrl: requireEnv('KICK_CHANNEL_URL'),
    timezone: requireEnv('STREAMER_TIMEZONE')
  }),

  // Kick's channel lookup is Cloudflare-protected, so the numeric chatroom id
  // often has to be supplied by hand. See .env.example for how to find it.
  kick: Object.freeze({
    enabled: optionalEnvBool('KICK_CHAT_ENABLED', true),
    chatroomId: process.env.KICK_CHATROOM_ID || null
  }),

  twitchChannelPointsRewards: (function () {
    const sr = process.env.TWITCH_CHANNEL_POINTS_REWARD_SONG_REQUEST
    const to = process.env.TWITCH_CHANNEL_POINTS_REWARD_TIMEOUT
    const wc = process.env.TWITCH_CHANNEL_POINTS_REWARD_WIDE_CAM
    const m5 = process.env.TWITCH_CHANNEL_POINTS_REWARD_MUTE_5MIN
    const m10 = process.env.TWITCH_CHANNEL_POINTS_REWARD_MUTE_10MIN
    if (!sr && !to && !wc && !m5 && !m10) return null
    return Object.freeze({ songRequest: sr, timeout: to, wideCam: wc, mute5: m5, mute10: m10 })
  })(),

  discord: Object.freeze({
    botToken: requireEnv('DISCORD_BOT_TOKEN'),
    botId: requireEnv('DISCORD_BOT_ID'),
    serverId: requireEnv('DISCORD_SERVER_ID'),
    communicationChannelId: requireEnv('DISCORD_TWITCH_CHANNEL_COMMUNICATION_ID'),
    goLiveChannelId: requireEnv('DISCORD_GO_LIVE_CHANNEL_ID')
  }),

  obs: Object.freeze({
    url: requireEnv('OBS_WS_URL'),
    password: requireEnv('OBS_WS_PASSWORD'),
    reconnectIntervalMs: requireEnvNumber('OBS_AUTO_RECONNECT_TIME'),
    revertDelayMs: requireEnvNumber('OBS_REVERT_DELAY_MS')
  }),

  server: Object.freeze({
    port: requireEnvNumber('SERVER_PORT')
  }),

  chat: Object.freeze({
    enabled: optionalEnvBool('CHAT_ENABLED', true)
  }),

  riot: Object.freeze({
    apiKey: process.env.RIOT_API_KEY || null
  }),

  // Admin pages stay off until a password is set, so exposing the server to the
  // internet can never accidentally publish the control panel.
  web: Object.freeze({
    adminPassword: process.env.WEB_ADMIN_PASSWORD || null,
    publicUrl: (process.env.WEB_PUBLIC_URL || '').replace(/\/+$/, '') || null,
    publicPages: optionalEnvBool('WEB_PUBLIC_PAGES', true)
  })
})