/**
 * logger.js
 *
 * Centralized logging utility.
 *
 * Features:
 * - Timestamped log output
 * - ANSI color support
 * - Standardized service tags (TWITCH, KICK, DISCORD, OBS, PLAYER, SYSTEM)
 * - Error stack logging
 *
 * This ensures consistent and readable logs across the application.
 */

// ============================================================
// ANSI escape codes for colors
// ============================================================
const LOG_COLORS = {
  default: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
}

// ============================================================
// Neutral Service Tags
// These remain uncolored.
//
// One tag per external connection the bot holds open, plus [SYSTEM] for
// everything internal — the web server, overlay, points, timers, data store and
// startup work. Anything internal goes under [SYSTEM] rather than earning its
// own tag, otherwise the prefix stops telling you anything at a glance.
// ============================================================
const NEUTRAL_TAGS = ['[TWITCH]', '[KICK]', '[DISCORD]', '[OBS]', '[PLAYER]', '[SYSTEM]']

// ============================================================
// In-memory log history
// Backs the /logs web page. Kept deliberately small — this is a live tail,
// not an archive, and the whole buffer is sent to each new viewer.
// ============================================================
const MAX_LOG_ENTRIES = 500
const history = []
const subscribers = new Set()

function record(entry) {
  history.push(entry)
  if (history.length > MAX_LOG_ENTRIES) history.splice(0, history.length - MAX_LOG_ENTRIES)
  for (const fn of subscribers) {
    try { fn(entry) } catch {}
  }
}

/** @returns {Array<{time:string, tag:string, color:string, text:string}>} */
function getHistory() {
  return history.slice()
}

/** @returns {() => void} unsubscribe */
function subscribe(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

// ============================================================
// Logger Function
// ============================================================

/**
 * Logs a formatted message with timestamp and optional color.
 *
 * @param {keyof typeof LOG_COLORS} color - Color name
 * @param {string} text - Log message
 * @param {Error|null} [error=null] - Optional error object
 */
function logColor(color, text, error = null) {
  const time = new Date().toISOString().replace('T', ' ').split('.')[0]
  const timestamp = `[${time}]`
  const chosenColor = LOG_COLORS[color] || LOG_COLORS.default
  const matchingTag = NEUTRAL_TAGS.find(tag => text.startsWith(tag))
  let output
  
  if (matchingTag) {
    const rest = text.slice(matchingTag.length).trim()
    output = `${LOG_COLORS.default}${timestamp} ${matchingTag} ${chosenColor}${rest}${LOG_COLORS.default}`
  } else {
    output = `${LOG_COLORS.default}${timestamp} ${chosenColor}${text}${LOG_COLORS.default}`
  }
  console.log(output)

  record({
    time,
    tag: matchingTag ? matchingTag.slice(1, -1) : '',
    color: LOG_COLORS[color] ? color : 'default',
    text: matchingTag ? text.slice(matchingTag.length).trim() : text
  })

  if (error) {
    console.error(`${LOG_COLORS.red}${error?.stack || error}${LOG_COLORS.default}`)
    record({ time, tag: 'ERROR', color: 'red', text: String(error?.stack || error) })
  }
}

module.exports = { logColor, getHistory, subscribe }