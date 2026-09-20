const dataStore = require('../../utils/dataStore')
const { twitch } = require('../../config/env')

const STORE_NAME = 'points'

// The broadcaster and the bot both accumulate a balance from chatting, and
// neither competing with viewers on the leaderboard is interesting.
const HIDDEN_FROM_LEADERBOARD = new Set([
  twitch.channel.toLowerCase(),
  twitch.botUsername.toLowerCase()
])

// Shape is repaired on every read so a hand-edited file can never crash a command.
function loadData() {
  const data = dataStore.load(STORE_NAME, {})
  if (typeof data.currencyName !== 'string' || !data.currencyName) data.currencyName = 'Stacks'
  if (!data.balances || typeof data.balances !== 'object') data.balances = {}
  if (!data.names || typeof data.names !== 'object') data.names = {}
  return data
}

function persist(data) {
  dataStore.save(STORE_NAME, data)
}

function key(user) {
  return String(user || '').replace(/^@/, '').toLowerCase()
}

function getCurrencyName() {
  return loadData().currencyName
}

function setCurrencyName(name) {
  const data = loadData()
  data.currencyName = name
  persist(data)
  return name
}

/**
 * Command alias derived from the currency name, so renaming the currency
 * renames the balance command with it ("Surfer Bucks" -> "surferbucks").
 * Returns '' when the name has no usable characters, which callers must
 * treat as "no alias" rather than matching an empty command.
 */
function getCurrencyAlias() {
  return getCurrencyName().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function getBalance(user) {
  return loadData().balances[key(user)] || 0
}

function setBalance(user, amount) {
  const k = key(user)
  if (!k) return 0
  const data = loadData()
  const value = Math.max(0, Math.floor(Number(amount) || 0))
  data.balances[k] = value
  if (user && user !== k) data.names[k] = String(user).replace(/^@/, '')
  persist(data)
  return value
}

function addPoints(user, amount) {
  return setBalance(user, getBalance(user) + Math.floor(Number(amount) || 0))
}

function removePoints(user, amount) {
  return setBalance(user, getBalance(user) - Math.floor(Number(amount) || 0))
}

/**
 * Drops a chatter from the ledger entirely.
 *
 * Distinct from setting them to zero: a zero balance still occupies a row and
 * comes back the moment they chat again. This forgets them outright, which is
 * what you want for a name that should never have been there.
 *
 * @returns {boolean} false if there was nothing to remove
 */
function forget(user) {
  const k = key(user)
  const data = loadData()
  if (!(k in data.balances) && !(k in data.names)) return false
  delete data.balances[k]
  delete data.names[k]
  persist(data)
  return true
}

/** Every chatter on record, including zero balances, richest first. */
function allBalances() {
  const data = loadData()
  return Object.entries(data.balances)
    .sort((a, b) => b[1] - a[1])
    .map(([k, amount]) => ({ key: k, name: data.names[k] || k, amount }))
}

// Records a display name without touching the balance, so the leaderboard can
// show proper casing for users who have never earned anything yet.
function rememberName(user) {
  const k = key(user)
  if (!k || !user || user === k) return
  const data = loadData()
  if (data.names[k] === user) return
  data.names[k] = String(user).replace(/^@/, '')
  persist(data)
}

function displayName(user) {
  const k = key(user)
  return loadData().names[k] || k
}

function leaderboard(limit = 5) {
  const data = loadData()
  return Object.entries(data.balances)
    .filter(([k, amount]) => amount > 0 && !HIDDEN_FROM_LEADERBOARD.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, amount]) => ({ key: k, name: data.names[k] || k, amount }))
}

/**
 * Parses a wager written as a raw number, a percentage of the balance, or "all".
 *
 * @returns {number|null} whole number of points, or null if unparseable
 */
function parseAmount(input, balance) {
  const raw = String(input || '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'all' || raw === 'allin') return balance
  if (raw.endsWith('%')) {
    const pct = Number(raw.slice(0, -1))
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null
    return Math.floor(balance * (pct / 100))
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

function format(n) {
  return Number(n).toLocaleString('en-US')
}

module.exports = {
  getCurrencyName,
  setCurrencyName,
  getCurrencyAlias,
  getBalance,
  setBalance,
  addPoints,
  removePoints,
  forget,
  allBalances,
  rememberName,
  displayName,
  leaderboard,
  parseAmount,
  format
}
