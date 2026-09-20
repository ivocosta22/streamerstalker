const emotes = require('./emotes')
const bus = require('./bus')
const modules = require('../points/modules')

// A combo counts messages that are a SINGLE emote token; a pyramid counts
// messages that are all the same emote at any width. Keeping them separate is
// what stops the middle rows of a pyramid ("LUL LUL") from also spamming combo
// milestones, since those rows simply aren't single-token messages.
let combo = { emote: null, count: 0 }
let pyramid = { emote: null, counts: [] }

// A pyramid can't be wider than this, so the row history never grows unbounded.
const MAX_ROWS = 41

function isPyramidShape(rows, width) {
  const len = 2 * width - 1
  for (let i = 0; i < len; i++) {
    const expected = i < width ? i + 1 : len - i
    if (rows[i] !== expected) return false
  }
  return true
}

/**
 * Looks for a completed pyramid ending on the most recent row. Checking
 * suffixes (rather than the whole history) means a false start like 1,2,5
 * can't poison detection of the pyramid that follows it.
 *
 * @returns {number} pyramid width, or 0 if the rows don't end in one
 */
function detectPyramid(rows) {
  for (let width = Math.floor((rows.length + 1) / 2); width >= 2; width--) {
    const len = 2 * width - 1
    if (rows.length < len) continue
    if (isPyramidShape(rows.slice(rows.length - len), width)) return width
  }
  return 0
}

function pyramidMessage(width, user, emote) {
  if (width === 2) return `@${user} made a 2-width ${emote} pyramid. Congrats I guess LULE`
  if (width === 3) return `nice ${width}-width ${emote} fake pyramid @${user} LULE`
  if (width === 4) return `@${user} built a ${width}-width ${emote} pyramid. Alright, that one counts.`
  if (width <= 6) return `POGGERS @${user} built a ${width}-width ${emote} pyramid! Genuinely impressive.`
  return `WHAT @${user} just built a ${width}-WIDTH ${emote} PYRAMID! Absolute madness PogChamp`
}

/**
 * Feeds one chat message through combo and pyramid detection.
 * Announcements go to chat via `say`; visuals go to the overlay via the bus.
 */
function processMessage({ user, message, say }) {
  const tokens = String(message || '').trim().split(/\s+/).filter(Boolean)
  const uniform = tokens.length > 0 && tokens.every(t => t === tokens[0])
  const emote = uniform && emotes.isEmote(tokens[0]) ? tokens[0] : null

  const pyramidCfg = modules.get('pyramids')
  if (pyramidCfg.enabled) {
    if (emote && pyramid.emote === emote) pyramid.counts.push(tokens.length)
    else if (emote) pyramid = { emote, counts: [tokens.length] }
    else pyramid = { emote: null, counts: [] }

    if (pyramid.counts.length > MAX_ROWS) pyramid.counts = pyramid.counts.slice(-MAX_ROWS)

    if (emote) {
      const width = detectPyramid(pyramid.counts)
      if (width >= pyramidCfg.minWidth) {
        say(pyramidMessage(width, user, emote))
        bus.broadcast('pyramid', { emote, url: emotes.find(emote)?.url || null, width, user })
        pyramid = { emote: null, counts: [] }
      }
    }
  }

  const comboCfg = modules.get('emotes')
  if (!comboCfg.enabled) return

  const single = emote && tokens.length === 1 ? emote : null

  if (single && combo.emote === single) {
    combo.count++
  } else {
    if (combo.count >= comboCfg.minStreak) {
      say(`${combo.emote} x${combo.count} streak!`)
      bus.broadcast('streakEnd', { emote: combo.emote, count: combo.count })
    }
    combo = single ? { emote: single, count: 1 } : { emote: null, count: 0 }
  }

  if (!combo.emote || combo.count < 2) return

  bus.broadcast('streak', {
    emote: combo.emote,
    url: emotes.find(combo.emote)?.url || null,
    count: combo.count
  })
}

function reset() {
  combo = { emote: null, count: 0 }
  pyramid = { emote: null, counts: [] }
}

function state() {
  return { combo: { ...combo }, pyramid: { emote: pyramid.emote, counts: pyramid.counts.slice() } }
}

module.exports = { processMessage, reset, state, detectPyramid }
