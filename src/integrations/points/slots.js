const points = require('./pointsStore')
const modules = require('./modules')

const REELS = ['Kappa', 'LULE', 'PogChamp', 'Sadge', 'EZ', 'Clap', 'peepoBlanket', 'FeelsOkayMan']

const lastSpin = new Map()

function spinReels() {
  return [0, 1, 2].map(() => REELS[Math.floor(Math.random() * REELS.length)])
}

/**
 * Spins the slots for a user.
 *
 * @param {string} user
 * @param {string} [amountArg] - raw bet input (number, percentage, or "all")
 * @returns {string} chat response
 */
function spin(user, amountArg) {
  const cfg = modules.get('slots')
  const currency = points.getCurrencyName()
  const minBet = cfg.minBet || 10

  const now = Date.now()
  const name = points.displayName(user)
  const readyAt = (lastSpin.get(user.toLowerCase()) || 0) + cfg.cooldownSeconds * 1000
  if (now < readyAt) {
    return `@${name} slots are on cooldown for ${Math.ceil((readyAt - now) / 1000)}s.`
  }

  const balance = points.getBalance(user)

  if (!amountArg) {
    return `@${name} usage: !slots <amount> (min ${points.format(minBet)} ${currency})`
  }

  const bet = points.parseAmount(amountArg, balance)
  if (bet === null || bet <= 0) {
    return `@${name} invalid amount.`
  }
  if (bet < minBet) {
    return `@${name} minimum bet is ${points.format(minBet)} ${currency}.`
  }
  if (bet > balance) {
    return `@${name} you only have ${points.format(balance)} ${currency}.`
  }

  lastSpin.set(user.toLowerCase(), now)
  points.removePoints(user, bet)

  const reels = spinReels()
  const display = reels.join(' | ')
  const allSame = reels[0] === reels[1] && reels[1] === reels[2]
  const twoSame = !allSame && (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2])

  if (allSame) {
    const payout = bet * cfg.jackpotMultiplier
    const total = points.addPoints(user, payout)
    return `[ ${display} ] JACKPOT! @${name} won ${points.format(payout)} ${currency}! Balance: ${points.format(total)} PogChamp`
  }

  if (twoSame) {
    const payout = bet * cfg.pairMultiplier
    const total = points.addPoints(user, payout)
    return `[ ${display} ] @${name} matched a pair and won ${points.format(payout)} ${currency}! Balance: ${points.format(total)}`
  }

  const total = points.getBalance(user)
  return `[ ${display} ] @${name} lost ${points.format(bet)} ${currency}. Balance: ${points.format(total)} Sadge`
}

module.exports = { spin }
