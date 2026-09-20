const dataStore = require('../../utils/dataStore')

const STORE_NAME = 'disabledCommands'

// Turning these off from chat would leave no way to turn anything back on
// except hand-editing the data file, so they are permanently exempt.
const PROTECTED = new Set(['enablecommand', 'disablecommand', 'disabledcommands'])

function loadData() {
  const data = dataStore.load(STORE_NAME, {})
  if (!Array.isArray(data.disabled)) data.disabled = []
  return data
}

function key(name) {
  return String(name || '').replace(/^!/, '').trim().toLowerCase()
}

function list() {
  return loadData().disabled.slice().sort()
}

function isDisabled(name) {
  return loadData().disabled.includes(key(name))
}

function isProtected(name) {
  return PROTECTED.has(key(name))
}

/** @returns {'ok'|'already'|'protected'} */
function disable(name) {
  const k = key(name)
  if (PROTECTED.has(k)) return 'protected'
  const data = loadData()
  if (data.disabled.includes(k)) return 'already'
  data.disabled.push(k)
  dataStore.save(STORE_NAME, data)
  return 'ok'
}

/** @returns {'ok'|'not_disabled'} */
function enable(name) {
  const k = key(name)
  const data = loadData()
  const index = data.disabled.indexOf(k)
  if (index === -1) return 'not_disabled'
  data.disabled.splice(index, 1)
  dataStore.save(STORE_NAME, data)
  return 'ok'
}

module.exports = { list, isDisabled, isProtected, disable, enable, PROTECTED }
