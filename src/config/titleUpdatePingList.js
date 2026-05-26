const fs = require('fs')
const path = require('path')

const FILE_PATH = path.resolve(__dirname, 'pingList.json')

let users = []

function load() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      users = JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8'))
    }
  } catch {
    users = []
  }
}

function save() {
  fs.writeFileSync(FILE_PATH, JSON.stringify(users, null, 2))
}

function getAll() {
  return [...users]
}

function has(username) {
  return users.includes(username.toLowerCase())
}

function add(username) {
  const name = username.toLowerCase()
  if (!users.includes(name)) {
    users.push(name)
    save()
  }
}

function remove(username) {
  const name = username.toLowerCase()
  const idx = users.indexOf(name)
  if (idx !== -1) {
    users.splice(idx, 1)
    save()
  }
}

function toggle(username) {
  const name = username.toLowerCase()
  if (has(name)) {
    remove(name)
    return false
  }
  add(name)
  return true
}

load()

module.exports = { getAll, has, add, remove, toggle }
