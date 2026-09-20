const dataStore = require('../../utils/dataStore')

const STORE_NAME = 'cannonStacks'

function getStacks() {
  const data = dataStore.load(STORE_NAME, { stacks: 0 })
  return data.stacks
}

function removeStacks(amount = 10) {
  const data = dataStore.load(STORE_NAME, { stacks: 0 })
  data.stacks -= amount
  dataStore.save(STORE_NAME, data)
  return data.stacks
}

function setStacks(value) {
  dataStore.save(STORE_NAME, { stacks: value })
}

module.exports = { getStacks, removeStacks, setStacks }
