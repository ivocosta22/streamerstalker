const points = require('./pointsStore')
const modules = require('./modules')

// targetKey -> { challenger, amount, timer }. Intentionally in-memory only:
// a restart cancelling open challenges is the correct behaviour.
const pending = new Map()

function normalize(name) {
  return String(name || '').replace(/^@/, '').toLowerCase()
}

function challenge(challenger, targetRaw, amountInput) {
  const cfg = modules.get('duel')
  const currency = points.getCurrencyName()
  const challengerName = points.displayName(challenger)

  if (!targetRaw || !amountInput) return `@${challengerName} usage: !duel <user> <amount>`

  const target = String(targetRaw).replace(/^@/, '')
  const targetName = points.displayName(target)
  const targetKey = normalize(target)
  const challengerKey = normalize(challenger)

  if (targetKey === challengerKey) return `@${challengerName} you can't duel yourself.`
  if (pending.has(targetKey)) return `@${challengerName} ${targetName} already has a pending duel.`

  const balance = points.getBalance(challenger)
  const amount = points.parseAmount(amountInput, balance)

  if (amount === null) return `@${challengerName} "${amountInput}" isn't a valid amount.`
  if (amount < cfg.minAmount) return `@${challengerName} the minimum duel is ${points.format(cfg.minAmount)} ${currency}.`
  if (amount > balance) return `@${challengerName} you only have ${points.format(balance)} ${currency}.`
  if (points.getBalance(target) < amount) return `@${challengerName} ${targetName} doesn't have ${points.format(amount)} ${currency}.`

  const timer = setTimeout(() => pending.delete(targetKey), cfg.expireSeconds * 1000)
  if (timer.unref) timer.unref()
  pending.set(targetKey, { challenger, amount, timer })

  return `@${targetName} you have been challenged to a duel by @${challengerName} for ${points.format(amount)} ${currency}! Type !accept or !deny (${cfg.expireSeconds}s)`
}

function accept(target) {
  const targetKey = normalize(target)
  const duel = pending.get(targetKey)
  if (!duel) return ''

  clearTimeout(duel.timer)
  pending.delete(targetKey)

  const currency = points.getCurrencyName()
  const { challenger, amount } = duel
  const targetName = points.displayName(target)
  const challengerName = points.displayName(challenger)

  if (points.getBalance(challenger) < amount) {
    return `@${targetName} the duel is off — @${challengerName} can no longer cover ${points.format(amount)} ${currency}.`
  }
  if (points.getBalance(target) < amount) {
    return `@${targetName} you no longer have ${points.format(amount)} ${currency}.`
  }

  const challengerWins = Math.random() < 0.5
  const winner = challengerWins ? challenger : target
  const loser = challengerWins ? target : challenger

  points.addPoints(winner, amount)
  points.removePoints(loser, amount)

  return `@${points.displayName(winner)} won the duel against @${points.displayName(loser)} and took ${points.format(amount)} ${currency}! (Balance: ${points.format(points.getBalance(winner))})`
}

function deny(target) {
  const targetKey = normalize(target)
  const duel = pending.get(targetKey)
  if (!duel) return ''

  clearTimeout(duel.timer)
  pending.delete(targetKey)
  return `@${points.displayName(target)} declined the duel from @${points.displayName(duel.challenger)}.`
}

module.exports = { challenge, accept, deny }
