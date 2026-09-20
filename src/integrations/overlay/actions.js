const bus = require('./bus')
const emotes = require('./emotes')
const sounds = require('./sounds')
const modules = require('../points/modules')
const dataStore = require('../../utils/dataStore')

const soundCooldowns = new Map()

function offlineNote() {
  return bus.clientCount() === 0 ? ' (no overlay is connected — add the browser source in OBS)' : ''
}

/**
 * @returns {string} chat response, or '' to stay silent
 */
function showEmote(user, name) {
  if (!modules.isEnabled('emotes')) return `The emotes module is currently disabled.`
  if (!name) return `@${user} usage: !showemote <emote>`

  const emote = emotes.find(name)
  if (!emote) {
    return emotes.count() === 0
      ? `@${user} emotes haven't finished loading yet — try again shortly.`
      : `@${user} I don't know the emote "${name}".`
  }

  bus.broadcast('emote', { emote: emote.name, url: emote.url, user })
  const note = offlineNote()
  return note ? `@${user} showing ${emote.name}${note}` : ''
}

function playSound(user, name) {
  if (!modules.isEnabled('sounds')) return `The sounds module is currently disabled.`

  const available = sounds.list()
  if (available.length === 0) {
    return `@${user} there are no sounds installed yet.`
  }
  if (!name) return listSounds()

  const file = sounds.fileFor(name)
  if (!file) return `@${user} there's no sound called "${name}". Try !playsoundlist`

  const cfg = modules.get('sounds')
  const now = Date.now()
  const key = user.toLowerCase()
  const readyAt = soundCooldowns.get(key) || 0
  if (now < readyAt) {
    return `@${user} sounds are on cooldown for ${Math.ceil((readyAt - now) / 1000)}s.`
  }
  soundCooldowns.set(key, now + cfg.cooldownSeconds * 1000)

  // Clamped here because the dashboard's generic number editor can write any
  // value into the config, and an Audio volume outside 0-1 throws in browsers.
  const volume = Math.max(0, Math.min(100, Number(cfg.volume ?? 90))) / 100
  bus.broadcast('sound', { name: String(name).toLowerCase(), url: `/overlay/sounds/${encodeURIComponent(file)}`, volume })
  const note = offlineNote()
  return note ? `@${user} playing ${name}${note}` : ''
}

function listSounds() {
  const available = sounds.list()
  if (available.length === 0) return 'There are no sounds installed yet.'
  return `Playable sounds (${available.length}): ${available.join(', ')}`
}

function setVolume(level) {
  const data = dataStore.load('modules', {})
  if (!data.sounds) data.sounds = {}
  data.sounds.volume = level
  dataStore.save('modules', data)
}

function getVolume() {
  const cfg = modules.get('sounds')
  return cfg.volume ?? 90
}

module.exports = { showEmote, playSound, listSounds, setVolume, getVolume }
