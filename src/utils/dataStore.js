const fs = require('fs')
const path = require('path')

// Overridable so test runs can point at a scratch directory instead of writing
// balances, timers and custom commands into the live bot's state.
const DATA_DIR = process.env.STREAMERSTALKER_DATA_DIR
  ? path.resolve(process.env.STREAMERSTALKER_DATA_DIR)
  : path.resolve(__dirname, '../../data')

const cache = new Map()

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`)
}

function load(name, defaultValue = {}) {
  if (cache.has(name)) return cache.get(name)
  const fp = filePath(name)
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
      cache.set(name, data)
      return data
    }
  } catch {}
  cache.set(name, defaultValue)
  return defaultValue
}

function save(name, data) {
  cache.set(name, data)
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2))
  } catch (err) {
    console.error(`[SYSTEM] Failed to save ${name}: ${err.message}`)
  }
}

module.exports = { load, save }
