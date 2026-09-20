const dataStore = require('../../utils/dataStore')

const STORE_NAME = 'modules'

const DEFAULTS = {
  slots:   { enabled: true, minBet: 10, cooldownSeconds: 30, jackpotMultiplier: 10, pairMultiplier: 2 },
  gamble:  { enabled: true, minBet: 10, cooldownSeconds: 10 },
  duel:    { enabled: true, minAmount: 10, expireSeconds: 60 },
  raffle:  { enabled: true, durationSeconds: 60, defaultPot: 1000 },
  accrual: { enabled: true, intervalMinutes: 5, amount: 10, activeWindowMinutes: 15 },
  emotes:   { enabled: true, minStreak: 3, milestoneEvery: 5, showMs: 3000, streakHoldMs: 6000 },
  pyramids: { enabled: true, minWidth: 2 },
  sounds:   { enabled: true, cooldownSeconds: 60, volume: 90 }
}

const NAMES = Object.keys(DEFAULTS)

function loadData() {
  const data = dataStore.load(STORE_NAME, {})
  for (const name of NAMES) {
    if (!data[name] || typeof data[name] !== 'object') data[name] = { ...DEFAULTS[name] }
    else for (const [k, v] of Object.entries(DEFAULTS[name])) {
      if (data[name][k] === undefined) data[name][k] = v
    }
  }
  return data
}

function get(name) {
  return loadData()[name] || null
}

function isEnabled(name) {
  const mod = get(name)
  return !!(mod && mod.enabled)
}

function setEnabled(name, enabled) {
  if (!NAMES.includes(name)) return false
  const data = loadData()
  data[name].enabled = !!enabled
  dataStore.save(STORE_NAME, data)
  return true
}

function list() {
  const data = loadData()
  return NAMES.map(name => ({ name, enabled: !!data[name].enabled }))
}

/** Full config for every module, for the dashboard to render and edit. */
function getAll() {
  const data = loadData()
  return NAMES.map(name => ({ name, config: { ...data[name] }, defaults: { ...DEFAULTS[name] } }))
}

/**
 * Applies a partial config update. Only keys that exist in the module's
 * defaults are accepted, so a crafted request can't inject arbitrary fields.
 *
 * @returns {object|null} the updated config, or null for an unknown module
 */
function setConfig(name, patch) {
  if (!NAMES.includes(name) || !patch || typeof patch !== 'object') return null
  const data = loadData()

  for (const [key, raw] of Object.entries(patch)) {
    if (key === 'enabled') {
      data[name].enabled = !!raw
      continue
    }
    if (!(key in DEFAULTS[name])) continue
    const value = Math.floor(Number(raw))
    if (Number.isFinite(value) && value >= 0 && value <= 1e9) data[name][key] = value
  }

  dataStore.save(STORE_NAME, data)
  return { ...data[name] }
}

module.exports = { get, isEnabled, setEnabled, list, getAll, setConfig, NAMES }
