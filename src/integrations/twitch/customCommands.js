const dataStore = require('../../utils/dataStore')

const STORE_NAME = 'customCommands'

function getAll() {
  return dataStore.load(STORE_NAME, {})
}

function get(name) {
  return getAll()[name.toLowerCase()] || null
}

function add(name, response) {
  const key = name.toLowerCase()
  const commands = getAll()
  if (commands[key]) return false
  commands[key] = response
  dataStore.save(STORE_NAME, commands)
  return true
}

function edit(name, response) {
  const key = name.toLowerCase()
  const commands = getAll()
  if (!commands[key]) return false
  commands[key] = response
  dataStore.save(STORE_NAME, commands)
  return true
}

function remove(name) {
  const key = name.toLowerCase()
  const commands = getAll()
  if (!commands[key]) return false
  delete commands[key]
  dataStore.save(STORE_NAME, commands)
  return true
}

module.exports = { getAll, get, add, edit, remove }
