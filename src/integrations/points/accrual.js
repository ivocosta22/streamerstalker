const points = require('./pointsStore')
const modules = require('./modules')

// key -> { name, lastSeen }. Rebuilt from chat activity, so a restart simply
// means nobody is "active" until they talk again.
const activity = new Map()

let timer = null

function recordActivity(user, platform = 'twitch') {
  const raw = String(user || '').toLowerCase()
  if (!raw) return
  const k = platform === 'kick' ? `kick:${raw}` : raw
  activity.set(k, { name: user, platform, lastSeen: Date.now() })
}

function payout(logColor) {
  const cfg = modules.get('accrual')
  if (!cfg.enabled) return

  const cutoff = Date.now() - cfg.activeWindowMinutes * 60 * 1000
  let paid = 0

  for (const [k, entry] of activity) {
    if (entry.lastSeen < cutoff) {
      activity.delete(k)
      continue
    }
    const pointsUser = entry.platform === 'kick' ? `kick:${entry.name}` : entry.name
    points.addPoints(pointsUser, cfg.amount)
    paid++
  }

  if (paid > 0) {
    logColor('cyan', `[SYSTEM] Awarded ${cfg.amount} ${points.getCurrencyName()} to ${paid} active chatter(s)`)
  }
}

function start({ logColor }) {
  const cfg = modules.get('accrual')
  if (timer) clearInterval(timer)
  timer = setInterval(() => payout(logColor), cfg.intervalMinutes * 60 * 1000)
  if (timer.unref) timer.unref()
  logColor('green', `[SYSTEM] Accrual ready — ${cfg.amount} every ${cfg.intervalMinutes}m for chatters active in the last ${cfg.activeWindowMinutes}m`)
}

module.exports = { start, recordActivity }
