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

  twitchChannelPointsRewards: Object.freeze({
    songRequest: requireEnv('TWITCH_CHANNEL_POINTS_REWARD_SONG_REQUEST'),
    timeout: requireEnv('TWITCH_CHANNEL_POINTS_REWARD_TIMEOUT'),
    wideCam: requireEnv('TWITCH_CHANNEL_POINTS_REWARD_WIDE_CAM'),
    mute5: requireEnv('TWITCH_CHANNEL_POINTS_REWARD_MUTE_5MIN'),
    mute10: requireEnv('TWITCH_CHANNEL_POINTS_REWARD_MUTE_10MIN')
  }),

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
  })
})