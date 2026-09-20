const express = require('express')
const path = require('path')
const bus = require('./bus')
const sounds = require('./sounds')
const emotes = require('./emotes')
const modules = require('../points/modules')

/**
 * @param {object} [opts]
 * @param {import('express').RequestHandler} [opts.guard]
 *   Applied to endpoints that cause a visible effect on stream. Once this
 *   server is reachable from the internet, /test is a spam vector without it.
 */
function createOverlayRouter({ guard } = {}) {
  const router = express.Router()
  const protect = guard || ((_req, _res, next) => next())

  router.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'))
  })

  router.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    if (res.flushHeaders) res.flushHeaders()
    res.setTimeout(0)

    res.write('retry: 3000\n\n')

    const cfg = modules.get('emotes')
    res.write(`data: ${JSON.stringify({
      type: 'config',
      showMs: cfg.showMs,
      streakHoldMs: cfg.streakHoldMs
    })}\n\n`)

    bus.addClient(res)
    req.on('close', () => bus.removeClient(res))
  })

  // Serves only filenames the scanner actually found in sounds/. basename()
  // strips any path components and the allowlist check means a crafted name
  // like "../../.env" can never resolve to a real file.
  router.get('/sounds/:file', (req, res) => {
    const requested = path.basename(req.params.file)
    const known = sounds.list().some(name => sounds.fileFor(name) === requested)
    if (!known) return res.status(404).send('Not found')
    res.sendFile(path.join(sounds.directory(), requested))
  })

  router.get('/status', (_req, res) => {
    res.json({
      overlaysConnected: bus.clientCount(),
      emotesLoaded: emotes.count(),
      sounds: sounds.list()
    })
  })

  // Fires a visible event so the browser source can be verified without chat.
  router.get('/test', protect, (_req, res) => {
    const sample = emotes.find('LUL') || emotes.find('Kappa')
    const sent = bus.broadcast('test', {
      emote: sample ? sample.name : 'TEST',
      url: sample ? sample.url : null,
      count: 3
    })
    res.json({ delivered: sent, overlaysConnected: bus.clientCount() })
  })

  return router
}

module.exports = createOverlayRouter
