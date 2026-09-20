/**
 * auth.js
 *
 * Session auth for the admin pages, built on a signed cookie so the bot needs
 * no session store and no extra dependencies.
 *
 * Admin pages are unreachable unless WEB_ADMIN_PASSWORD is set, which means
 * exposing this server to the internet without configuring one leaves only the
 * read-only public pages available.
 */

const crypto = require('crypto')
const { web } = require('../config/env')
const dataStore = require('../utils/dataStore')

const COOKIE = 'ss_admin'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000

// Brute-force throttle. In-memory on purpose: a restart clearing it is fine,
// and it exists to make guessing slow rather than to be an audit trail.
const MAX_ATTEMPTS = 8
const LOCKOUT_MS = 15 * 60 * 1000
const attempts = new Map()

/**
 * Signing secret, generated once and persisted so sessions survive a restart.
 * Kept out of .env deliberately — one less thing for the operator to manage.
 */
function secret() {
  const store = dataStore.load('webSecret', {})
  if (typeof store.secret === 'string' && store.secret.length >= 64) return store.secret
  const generated = crypto.randomBytes(48).toString('hex')
  dataStore.save('webSecret', { secret: generated })
  return generated
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

function issue() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false
  const [payload, mac] = token.split('.')
  if (!payload || !mac) return false

  const expected = sign(payload)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof exp === 'number' && exp > Date.now()
  } catch {
    return false
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

function isAdminEnabled() {
  return typeof web.adminPassword === 'string' && web.adminPassword.length > 0
}

function isAuthed(req) {
  return isAdminEnabled() && verify(readCookie(req, COOKIE))
}

/** Constant-time password check that tolerates differing lengths. */
function passwordMatches(input) {
  if (!isAdminEnabled()) return false
  const given = crypto.createHash('sha256').update(String(input ?? '')).digest()
  const real = crypto.createHash('sha256').update(web.adminPassword).digest()
  return crypto.timingSafeEqual(given, real)
}

function throttleKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

/** @returns {number} milliseconds remaining in a lockout, or 0 when allowed */
function lockoutRemaining(req) {
  const entry = attempts.get(throttleKey(req))
  if (!entry || entry.count < MAX_ATTEMPTS) return 0
  const remaining = entry.until - Date.now()
  if (remaining <= 0) {
    attempts.delete(throttleKey(req))
    return 0
  }
  return remaining
}

function recordFailure(req) {
  const key = throttleKey(req)
  const entry = attempts.get(key) || { count: 0, until: 0 }
  entry.count++
  entry.until = Date.now() + LOCKOUT_MS
  attempts.set(key, entry)
}

function clearFailures(req) {
  attempts.delete(throttleKey(req))
}

function setSession(req, res) {
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https'
  const bits = [
    `${COOKIE}=${issue()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`
  ]
  if (https) bits.push('Secure')
  res.setHeader('Set-Cookie', bits.join('; '))
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

/** Express middleware: sends unauthenticated visitors to the login page. */
function requireAdmin(req, res, next) {
  if (isAuthed(req)) return next()
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(401).json({ error: 'unauthorized' })
  }
  res.redirect('/login')
}

module.exports = {
  COOKIE,
  isAdminEnabled,
  isAuthed,
  passwordMatches,
  lockoutRemaining,
  recordFailure,
  clearFailures,
  setSession,
  clearSession,
  requireAdmin
}
