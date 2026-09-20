const points = require('./pointsStore')
const modules = require('./modules')

const lastGamble = new Map()

/**
 * Runs a 50/50 gamble. Accepts a raw number, a percentage, or "all".
 *
 * @returns {string} chat response
 */
function gamble(user, amountInput) {
  const cfg = modules.get('gamble')
  const currency = points.getCurrencyName()

  if (!amountInput) return `@${user} usage: !gamble <amount | 50% | all>`

  const now = Date.now()
  const readyAt = (lastGamble.get(user.toLowerCase()) || 0) + cfg.cooldownSeconds * 1000
  if (now < readyAt) {
    return `@${user} gamble is on cooldown for ${Math.ceil((readyAt - now) / 1000)}s.`
  }

  const balance = points.getBalance(user)
  const bet = points.parseAmount(amountInput, balance)

  if (bet === null) return `@${user} "${amountInput}" isn't a valid amount. Try a number, a percentage, or "all".`
  if (bet < cfg.minBet) return `@${user} the minimum bet is ${points.format(cfg.minBet)} ${currency}.`
  if (bet > balance) return `@${user} you only have ${points.format(balance)} ${currency}.`

  lastGamble.set(user.toLowerCase(), now)

  const won = Math.random() < 0.5
  if (won) {
    const total = points.addPoints(user, bet)
    return `@${user} gambled ${points.format(bet)} ${currency} and WON! +${points.format(bet)} → ${points.format(total)} ${currency} PogChamp`
  }

  const total = points.removePoints(user, bet)
  return `@${user} gambled ${points.format(bet)} ${currency} and lost it all. → ${points.format(total)} ${currency} Sadge`
}

module.exports = { gamble }
