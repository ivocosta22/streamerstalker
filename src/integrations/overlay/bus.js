const { logColor } = require('../../utils/logger')

// Connected overlay browser sources. Server-Sent Events rather than WebSocket:
// the overlay only ever receives, and EventSource reconnects on its own.
const clients = new Set()

let heartbeat = null

function addClient(res) {
  clients.add(res)
  logColor('green', `[SYSTEM] Browser source connected (${clients.size} active)`)

  if (!heartbeat) {
    // Comment frames keep idle connections from being reaped.
    heartbeat = setInterval(() => {
      for (const client of clients) {
        try { client.write(': ping\n\n') } catch { clients.delete(client) }
      }
    }, 25_000)
    if (heartbeat.unref) heartbeat.unref()
  }
}

function removeClient(res) {
  if (!clients.delete(res)) return
  logColor('yellow', `[SYSTEM] Browser source disconnected (${clients.size} active)`)
  if (clients.size === 0 && heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

function broadcast(type, payload) {
  if (clients.size === 0) return 0
  const frame = `data: ${JSON.stringify({ type, ...payload })}\n\n`
  let sent = 0
  for (const client of clients) {
    try { client.write(frame); sent++ } catch { clients.delete(client) }
  }
  return sent
}

function clientCount() {
  return clients.size
}

module.exports = { addClient, removeClient, broadcast, clientCount }
