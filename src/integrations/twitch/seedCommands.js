/**
 * seedCommands.js
 *
 * One-time migration of commands that used to be hard-coded into editable
 * custom commands.
 *
 * These were all channel-specific text — a Discord invite, a spreadsheet link,
 * some in-jokes — so they belong in the dashboard rather than the source. The
 * seed runs once and records that it did, so a command the streamer later
 * deletes does not reappear on the next restart.
 */

const dataStore = require('../../utils/dataStore')
const customCommands = require('./customCommands')

const STORE_NAME = 'migrations'
const SEED_KEY = 'customisedBuiltIns'

/**
 * @param {object} deps
 * @param {string} deps.kickChannelUrl from env, so the seeded !kick keeps working
 */
function defaults({ kickChannelUrl }) {
  return {}
}

/**
 * Creates the seeded commands if this has never run before.
 *
 * @returns {{seeded: string[], skipped: boolean}}
 */
function run({ kickChannelUrl, logColor = () => {} }) {
  const migrations = dataStore.load(STORE_NAME, {})
  if (migrations[SEED_KEY]) return { seeded: [], skipped: true }

  const seeded = []
  for (const [name, response] of Object.entries(defaults({ kickChannelUrl }))) {
    if (!response) continue
    // add() refuses to overwrite, so a command the streamer already made wins.
    if (customCommands.add(name, response)) seeded.push(name)
  }

  migrations[SEED_KEY] = new Date().toISOString()
  dataStore.save(STORE_NAME, migrations)

  if (seeded.length > 0) {
    logColor('green', `[TWITCH] Moved ${seeded.length} command(s) into editable custom commands: ${seeded.map(n => `!${n}`).join(', ')}`)
  }
  return { seeded, skipped: false }
}

module.exports = { run, defaults, SEED_KEY, STORE_NAME }
