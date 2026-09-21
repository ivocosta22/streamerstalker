const { logColor } = require('../../utils/logger')
const { kick } = require('../../config/env')
const kickAuth = require('./kickAuth')

const API_URL = 'https://api.kick.com/public/v1/chat'
const MAX_GRAPHEMES = 500
const MAX_BYTES = 2048

const queue = []
let processing = false
let backoffMs = 0

function splitMessage(text) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  const graphemes = [...segmenter.segment(text)].map(s => s.segment)

  const parts = []
  let current = ''
  let count = 0

  for (const g of graphemes) {
    const next = current + g
    if (count + 1 > MAX_GRAPHEMES || Buffer.byteLength(next, 'utf8') > MAX_BYTES) {
      if (current) parts.push(current)
      current = g
      count = 1
    } else {
      current = next
      count++
    }
  }
  if (current) parts.push(current)
  return parts
}

async function sendOne(content) {
  const token = await kickAuth.getAccessToken()
  if (!token) {
    logColor('yellow', '[KICK] Cannot send — not authorized')
    return false
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        type: 'user',
        broadcaster_user_id: Number(kick.broadcasterUserId),
        content
      })
    })

    if (res.status === 429) {
      backoffMs = Math.min((backoffMs || 1000) * 2, 30000)
      logColor('yellow', `[KICK] Rate limited — backing off ${backoffMs}ms`)
      return 'retry'
    }

    if (!res.ok) {
      const text = await res.text()
      logColor('red', `[KICK] Send failed (${res.status}): ${text}`)
      return false
    }

    backoffMs = 0
    return true
  } catch (err) {
    logColor('red', `[KICK] Send error: ${err?.message || err}`)
    return false
  }
}

async function processQueue() {
  if (processing || queue.length === 0) return
  processing = true

  while (queue.length > 0) {
    if (backoffMs > 0) await new Promise(r => setTimeout(r, backoffMs))

    const result = await sendOne(queue[0])
    if (result === 'retry') continue
    queue.shift()
  }

  processing = false
}

function send(text) {
  if (!kick.broadcasterUserId || !kick.clientId) return

  const parts = splitMessage(text)
  for (const part of parts) queue.push(part)
  processQueue().catch(err => {
    logColor('red', `[KICK] Queue error: ${err?.message || err}`)
    processing = false
  })
}

function isReady() {
  return !!(kick.broadcasterUserId && kick.clientId && kickAuth.isAuthorized())
}

module.exports = { send, isReady }
