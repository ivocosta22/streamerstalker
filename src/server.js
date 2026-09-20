/**
 * server.js
 *
 * HTTP server for the bot's web interface and the OBS overlay.
 *
 * Serves three things:
 * - /overlay   browser source for OBS
 * - public     read-only pages (commands, leaderboard, sounds, stats)
 * - admin      authenticated control panel, off unless a password is set
 */
const express = require('express')
const { server, web } = require('./config/env')
const { logColor } = require('./utils/logger')
const createOverlayRouter = require('./integrations/overlay/routes')
const { createWebRouter, describe, requireAdmin } = require('./web')

function createServer() {
    const app = express()

    // Correct client IPs behind Cloudflare Tunnel / ngrok / any reverse proxy,
    // which the login throttle depends on to tell visitors apart.
    app.set('trust proxy', true)
    app.disable('x-powered-by')

    // OBS browser source overlay (emotes, sounds, streaks)
    app.use('/overlay', createOverlayRouter({ guard: requireAdmin }))

    // Public pages and the control panel
    app.use(createWebRouter())

    // Fallback
    app.all('*', (req, res) => {
        res.status(404).send('Not Found')
    })

    return app
}

/**
 * Starts the HTTP server.
 * @returns {import('http').Server} Node HTTP server instance
 */
function keepAlive() {
    const PORT = Number(process.env.PORT) || server.port || 3000
    const app = createServer()

    const httpServer = app.listen(PORT, () => {
        logColor('green',`[SYSTEM] ✅ Server is now running on port ${PORT}`)
        logColor('cyan', `[SYSTEM] OBS browser source URL: http://localhost:${PORT}/overlay`)
        for (const [color, line] of describe(PORT)) logColor(color, line)
        if (web.publicUrl) logColor('cyan', `[SYSTEM] Public URL: ${web.publicUrl}`)
    })

    httpServer.on('error', (err) => {
    logColor('red', `[SYSTEM] ❌ Server failed to start: ${err?.message || err}`)
    })

    return httpServer
}

module.exports = keepAlive
