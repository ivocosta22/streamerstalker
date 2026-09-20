/**
 * settings.js
 *
 * User-editable bot settings, persisted to data/settings.json and changeable
 * from the dashboard.
 *
 * Distinct from env.js on purpose: env.js is deployment configuration that
 * belongs in .env, while these are things the streamer tweaks while running.
 */

const dataStore = require('../utils/dataStore')
const { streamer } = require('./env')

const STORE_NAME = 'settings'

const DEFAULTS = Object.freeze({
  timeTemplate: "It's currently {time} in {streamer}'s timezone.",
  // Empty means "fall back to STREAMER_TIMEZONE from .env", so setting one here
  // is an override rather than a second place the value has to be kept in sync.
  timezone: ''
})

/** Placeholders the dashboard advertises, and what fills them. */
const PLACEHOLDERS = Object.freeze({
  '{time}': 'the current local time',
  '{streamer}': 'the channel name',
  '{timezone}': 'the configured IANA timezone'
})

function all() {
  const data = dataStore.load(STORE_NAME, {})
  return { ...DEFAULTS, ...data }
}

function get(key) {
  return all()[key]
}

function set(key, value) {
  if (!(key in DEFAULTS)) return null
  const data = dataStore.load(STORE_NAME, {})
  data[key] = value
  dataStore.save(STORE_NAME, data)
  return value
}

/** The timezone in effect: the dashboard override, else the one from .env. */
function timezone() {
  return get('timezone') || streamer.timezone
}

function isValidTimezone(name) {
  if (!name) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(name) })
    return true
  } catch {
    return false
  }
}

/** Every IANA zone this Node build knows, for the dashboard picker. */
function availableTimezones() {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return [streamer.timezone]
  }
}

/** Substitutes {placeholders}; unknown ones are left alone rather than blanked. */
function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    (key in values ? String(values[key]) : match)
  )
}

/** The finished !time message, so chat and the dashboard preview cannot drift. */
function renderTime(streamerName) {
  const zone = timezone()
  return fill(get('timeTemplate'), {
    time: new Date().toLocaleTimeString(undefined, {
      timeZone: zone, timeStyle: 'medium', hour12: false
    }),
    streamer: streamerName,
    timezone: zone
  })
}

module.exports = {
  all, get, set, fill,
  timezone, isValidTimezone, availableTimezones, renderTime,
  DEFAULTS, PLACEHOLDERS
}
