const points = require('./pointsStore')
const modules = require('./modules')

let active = null   // { pot, singleWinner, entrants: Map, timer }

function winnerCount(entrants) {
  if (entrants < 5) return 1
  if (entrants < 10) return 2
  if (entrants < 20) return 3
  if (entrants < 35) return 4
  return 5
}

function isActive() {
  return active !== null
}

function finish(say) {
  if (!active) return
  const { pot, singleWinner, entrants } = active
  active = null

  const currency = points.getCurrencyName()
  const names = Array.from(entrants.values())

  if (names.length === 0) {
    say(`The raffle ended with nobody entering. Sadge`)
    return
  }

  const count = singleWinner ? 1 : Math.min(winnerCount(names.length), names.length)

  // Fisher-Yates over a copy, then take the first `count` — no duplicate winners.
  const pool = names.slice()
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const winners = pool.slice(0, count)
  const share = Math.floor(pot / count)

  for (const winner of winners) points.addPoints(winner, share)

  if (count === 1) {
    say(`The raffle has ended! @${points.displayName(winners[0])} won ${points.format(share)} ${currency} out of ${names.length} entrant(s)! PogChamp`)
    return
  }

  const list = winners.map(w => `@${points.displayName(w)}`).join(', ')
  say(`The raffle has ended! ${count} winners out of ${names.length} entrants — ${list} each won ${points.format(share)} ${currency}! PogChamp`)
}

/**
 * Opens a raffle and schedules its own conclusion.
 *
 * @param {object} params
 * @param {number} params.pot            total points to distribute
 * @param {boolean} params.singleWinner  true for !sraffle
 * @param {function} params.say          chat sender for the delayed result
 * @returns {string} opening announcement, or an error string
 */
function start({ pot, singleWinner, say }) {
  const cfg = modules.get('raffle')
  const currency = points.getCurrencyName()

  if (active) return 'A raffle is already running! Type !join to enter.'

  const timer = setTimeout(() => finish(say), cfg.durationSeconds * 1000)
  if (timer.unref) timer.unref()
  active = { pot, singleWinner, entrants: new Map(), timer }

  const kind = singleWinner ? 'single-winner raffle' : 'raffle'
  return `A ${kind} has begun for ${points.format(pot)} ${currency}! Type !join to enter — you have ${cfg.durationSeconds} seconds!`
}

function join(user) {
  if (!active) return false
  const k = String(user).toLowerCase()
  if (active.entrants.has(k)) return false
  active.entrants.set(k, user)
  return true
}

module.exports = { start, join, isActive }
