const crypto = require('crypto')
const { logColor } = require('../../utils/logger')
const { kick, server, web } = require('../../config/env')
const dataStore = require('../../utils/dataStore')

const TOKEN_STORE = 'kick-tokens'
const AUTH_URL = 'https://id.kick.com/oauth/authorize'
const TOKEN_URL = 'https://id.kick.com/oauth/token'
const SCOPES = 'chat:write channel:rewards:read moderation:ban'

let pendingVerifier = null
let pendingState = null
let refreshTimer = null

function redirectUri() {
  if (web.publicUrl) return `${web.publicUrl}/kick/callback`
  const port = Number(process.env.PORT) || server.port || 3000
  return `http://localhost:${port}/kick/callback`
}

function getAuthorizeUrl() {
  if (!kick.clientId) return null

  pendingVerifier = crypto.randomBytes(32).toString('base64url')
  pendingState = crypto.randomBytes(16).toString('hex')
  const challenge = crypto.createHash('sha256').update(pendingVerifier).digest('base64url')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: kick.clientId,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: pendingState
  })

  return `${AUTH_URL}?${params}`
}

function verifyState(state) {
  return pendingState && state === pendingState
}

async function exchangeCode(code) {
  if (!pendingVerifier) throw new Error('No pending PKCE verifier — restart the bot and try the authorize link again')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: kick.clientId,
    client_secret: kick.clientSecret,
    code_verifier: pendingVerifier
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  pendingVerifier = null
  pendingState = null

  saveTokens(data)
  scheduleRefresh(data.expires_in)
  logColor('green', '[KICK] Authorization complete — bot can now send messages in chat')
  return true
}

function saveTokens(data) {
  dataStore.save(TOKEN_STORE, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000)
  })
}

async function refreshTokens() {
  const stored = dataStore.load(TOKEN_STORE, null)
  if (!stored?.refresh_token) return false

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: kick.clientId,
      client_secret: kick.clientSecret
    })

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })

    if (!res.ok) {
      logColor('red', '[KICK] Token refresh failed — re-authorize with the link printed at startup')
      dataStore.save(TOKEN_STORE, {})
      return false
    }

    const data = await res.json()
    saveTokens(data)
    scheduleRefresh(data.expires_in)
    logColor('green', '[KICK] Token refreshed')
    return true
  } catch (err) {
    logColor('red', `[KICK] Token refresh error: ${err?.message || err}`)
    return false
  }
}

function scheduleRefresh(expiresInSec) {
  if (refreshTimer) clearTimeout(refreshTimer)
  // Refresh 5 minutes before expiry, minimum 30 seconds
  const ms = Math.max((expiresInSec - 300) * 1000, 30000)
  refreshTimer = setTimeout(() => refreshTokens(), ms)
  refreshTimer.unref()
}

async function getAccessToken() {
  const stored = dataStore.load(TOKEN_STORE, null)
  if (!stored?.access_token) return null

  // Token still valid — use it
  if (Date.now() < stored.expires_at - 60000) return stored.access_token

  // Close to expiry — refresh now
  const ok = await refreshTokens()
  if (!ok) return null
  return dataStore.load(TOKEN_STORE, null)?.access_token || null
}

function isAuthorized() {
  const stored = dataStore.load(TOKEN_STORE, null)
  return !!(stored?.access_token)
}

function start() {
  if (!kick.clientId) return

  const stored = dataStore.load(TOKEN_STORE, null)
  if (stored?.access_token && stored?.expires_at) {
    const remaining = Math.floor((stored.expires_at - Date.now()) / 1000)
    if (remaining > 0) {
      scheduleRefresh(remaining)
      logColor('green', '[KICK] Loaded saved tokens — send is available')
    } else if (stored.refresh_token) {
      refreshTokens()
    }
  }
}

function stop() {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

module.exports = { getAuthorizeUrl, verifyState, exchangeCode, getAccessToken, isAuthorized, start, stop }
