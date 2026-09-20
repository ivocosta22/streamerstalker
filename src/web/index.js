/**
 * web/index.js
 *
 * Assembles the bot's web interface.
 *
 * Two tiers: public read-only pages that are safe to expose to the internet,
 * and an authenticated control panel that stays unreachable until an admin
 * password is configured.
 */

const express = require('express')
const createPublicRouter = require('./publicRoutes')
const createAdminRouter = require('./adminRoutes')
const { chatPage, chatOverlayPage, chatStream, overlayStream, chatSend } = require('./chatRoutes')
const auth = require('./auth')
const { page } = require('./layout')
const { web } = require('../config/env')

function createWebRouter() {
  const router = express.Router()

  // Always available so a host's keepalive ping works even with pages disabled.
  router.get('/health', (_req, res) => res.status(200).send('OK'))

  router.use(createAdminRouter())

  // Chat overlay (OBS browser source) — no auth required
  router.get('/chat/overlay', chatOverlayPage)
  router.get('/api/chat/overlay/stream', overlayStream)

  // Streamer chat page — admin only
  router.get('/chat', auth.requireAdmin, chatPage(page, auth))
  router.get('/api/admin/chat/stream', auth.requireAdmin, chatStream)
  router.post('/api/admin/chat/send', auth.requireAdmin, express.json({ limit: '4kb' }), chatSend)

  if (web.publicPages) {
    router.use(createPublicRouter({ admin: auth.isAuthed }))
  }

  return router
}

/** Lines the boot sequence prints so the operator knows what is reachable. */
function describe(port) {
  const base = web.publicUrl || `http://localhost:${port}`
  const lines = []

  if (web.publicPages) {
    lines.push(['cyan', `[SYSTEM] Public pages: ${base}/commands · /leaderboard · /sounds · /stats`])
  } else {
    lines.push(['yellow', '[SYSTEM] Public pages are disabled (WEB_PUBLIC_PAGES=false)'])
  }

  if (auth.isAdminEnabled()) {
    lines.push(['cyan', `[SYSTEM] Control panel: ${base}/dashboard`])
    lines.push(['cyan', `[SYSTEM] Chat: ${base}/chat · Overlay: ${base}/chat/overlay`])
  } else {
    lines.push(['yellow', '[SYSTEM] Control panel is off — set WEB_ADMIN_PASSWORD to enable it'])
  }

  return lines
}

module.exports = { createWebRouter, describe, isAuthed: auth.isAuthed, requireAdmin: auth.requireAdmin }
