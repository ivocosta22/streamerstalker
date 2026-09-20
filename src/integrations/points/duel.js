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

  if (!targetRaw || !amountInput) return `@${challenger} usage: !duel <user> <amount>`

  const target = String(targetRaw).replace(/^@/, '')
  const targetKey = normalize(target)
  const challengerKey = normalize(challenger)

  if (targetKey === challengerKey) return `@${challenger} you can't duel yourself.`
  if (pending.has(targetKey)) return `@${challenger} ${target} already has a pending duel.`

  const balance = points.getBalance(challenger)
  const amount = points.parseAmount(amountInput, balance)

  if (amount === null) return `@${challenger} "${amountInput}" isn't a valid amount.`
  if (amount < cfg.minAmount) return `@${challenger} the minimum duel is ${points.format(cfg.minAmount)} ${currency}.`
  if (amount > balance) return `@${challenger} you only have ${points.format(balance)} ${currency}.`
  if (points.getBalance(target) < amount) return `@${challenger} ${target} doesn't have ${points.format(amount)} ${currency}.`

  const timer = setTimeout(() => pending.delete(targetKey), cfg.expireSeconds * 1000)
  if (timer.unref) timer.unref()
  pending.set(targetKey, { challenger, amount, timer })

  return `@${target} you have been challenged to a duel by @${challenger} for ${points.format(amount)} ${currency}! Type !accept or !deny (${cfg.expireSeconds}s)`
}

function accept(target) {
  const targetKey = normalize(target)
  const duel = pending.get(targetKey)
  if (!duel) return ''

  clearTimeout(duel.timer)
  pending.delete(targetKey)

  const currency = points.getCurrencyName()
  const { challenger, amount } = duel

  // Balances can move between challenge and accept, so re-verify both sides.
  if (points.getBalance(challenger) < amount) {
    return `@${target} the duel is off — @${challenger} can no longer cover ${points.format(amount)} ${currency}.`
  }
  if (points.getBalance(target) < amount) {
    return `@${target} you no longer have ${points.format(amount)} ${currency}.`
  }

  const challengerWins = Math.random() < 0.5
  const winner = challengerWins ? challenger : target
  const loser = challengerWins ? target : challenger

  points.addPoints(winner, amount)
  points.removePoints(loser, amount)

  return `@${winner} won the duel against @${loser} and took ${points.format(amount)} ${currency}! (Balance: ${points.format(points.getBalance(winner))})`
}

function deny(target) {
  const targetKey = normalize(target)
  const duel = pending.get(targetKey)
  if (!duel) return ''

  clearTimeout(duel.timer)
  pending.delete(targetKey)
  return `@${target} declined the duel from @${duel.challenger}.`
}

module.exports = { challenge, accept, deny }
