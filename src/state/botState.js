/**
 * botState.js
 *
 * Shared runtime state for the bot process.
 *
 * This module intentionally exports a single mutable object
 * so all modules share the same in-memory state.
 */

module.exports = {
  startTime: Date.now(),
  commandCaller: null,
  platform: 'twitch',
  timeouts: {},
  lastKnownStreamTitle: null
}
