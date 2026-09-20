const fs = require('fs')
const path = require('path')

const SOUNDS_DIR = path.resolve(__dirname, '../../../sounds')
const EXTENSIONS = ['.mp3', '.ogg', '.wav', '.m4a', '.webm']

// Short-lived cache so dropping a new file into sounds/ works without a
// restart, while a chat-message-rate lookup still doesn't hit the disk.
const CACHE_MS = 10_000
let cache = null
let cachedAt = 0

function scan() {
  const map = new Map()
  try {
    for (const file of fs.readdirSync(SOUNDS_DIR)) {
      const ext = path.extname(file).toLowerCase()
      if (!EXTENSIONS.includes(ext)) continue
      const name = path.basename(file, ext).toLowerCase()
      if (name && !map.has(name)) map.set(name, file)
    }
  } catch {}
  return map
}

function all() {
  const now = Date.now()
  if (!cache || now - cachedAt > CACHE_MS) {
    cache = scan()
    cachedAt = now
  }
  return cache
}

function list() {
  return Array.from(all().keys()).sort()
}

function has(name) {
  return all().has(String(name || '').toLowerCase())
}

/** @returns {string|null} the on-disk filename, or null if unknown */
function fileFor(name) {
  return all().get(String(name || '').toLowerCase()) || null
}

function directory() {
  return SOUNDS_DIR
}

module.exports = { list, has, fileFor, directory }
