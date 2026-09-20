const dataStore = require('../../utils/dataStore')

const STORE_NAME = 'rewards'

const ACTIONS = {
  songRequest: { label: 'Song Request', hasParams: false },
  timeout: { label: 'Timeout', hasParams: false },
  wideCam: { label: 'Wide Cam', hasParams: false },
  mute: { label: 'Mute Mic', hasParams: true, paramLabel: 'Duration (minutes)', paramKey: 'durationMinutes', paramDefault: 5 }
}

function loadAll() {
  return dataStore.load(STORE_NAME, [])
}

function save(rewards) {
  dataStore.save(STORE_NAME, rewards)
}

function getAll() {
  return loadAll()
}

function findByRewardId(rewardId) {
  return loadAll().find(r => r.rewardId === rewardId) || null
}

function add(entry) {
  const rewards = loadAll()
  const existing = rewards.findIndex(r => r.rewardId === entry.rewardId)
  if (existing !== -1) return { ok: false, error: 'that reward ID is already configured' }
  if (!ACTIONS[entry.action]) return { ok: false, error: 'unknown action type' }
  rewards.push({
    rewardId: String(entry.rewardId).trim(),
    name: String(entry.name || ACTIONS[entry.action].label).trim(),
    action: entry.action,
    params: entry.params || {}
  })
  save(rewards)
  return { ok: true }
}

function update(rewardId, patch) {
  const rewards = loadAll()
  const idx = rewards.findIndex(r => r.rewardId === rewardId)
  if (idx === -1) return { ok: false, error: 'reward not found' }
  if (patch.name !== undefined) rewards[idx].name = String(patch.name).trim()
  if (patch.action !== undefined) {
    if (!ACTIONS[patch.action]) return { ok: false, error: 'unknown action type' }
    rewards[idx].action = patch.action
  }
  if (patch.params !== undefined) rewards[idx].params = patch.params
  if (patch.rewardId !== undefined) {
    const newId = String(patch.rewardId).trim()
    if (newId !== rewardId && rewards.some(r => r.rewardId === newId)) {
      return { ok: false, error: 'that reward ID is already configured' }
    }
    rewards[idx].rewardId = newId
  }
  save(rewards)
  return { ok: true, reward: rewards[idx] }
}

function remove(rewardId) {
  const rewards = loadAll()
  const idx = rewards.findIndex(r => r.rewardId === rewardId)
  if (idx === -1) return false
  rewards.splice(idx, 1)
  save(rewards)
  return true
}

function seedFromEnv(envRewards, logColor = () => {}) {
  const migrations = dataStore.load('migrations', {})
  if (migrations.rewardsFromEnv) return { seeded: 0, skipped: true }

  const existing = loadAll()
  if (existing.length > 0) {
    migrations.rewardsFromEnv = new Date().toISOString()
    dataStore.save('migrations', migrations)
    return { seeded: 0, skipped: true }
  }

  const seeded = []
  const entries = [
    { rewardId: envRewards.songRequest, name: 'Song Request', action: 'songRequest' },
    { rewardId: envRewards.timeout, name: 'Timeout', action: 'timeout' },
    { rewardId: envRewards.wideCam, name: 'Wide Cam', action: 'wideCam' },
    { rewardId: envRewards.mute5, name: 'Mute 5 Minutes', action: 'mute', params: { durationMinutes: 5 } },
    { rewardId: envRewards.mute10, name: 'Mute 10 Minutes', action: 'mute', params: { durationMinutes: 10 } }
  ]

  for (const entry of entries) {
    if (!entry.rewardId) continue
    const result = add(entry)
    if (result.ok) seeded.push(entry.name)
  }

  migrations.rewardsFromEnv = new Date().toISOString()
  dataStore.save('migrations', migrations)

  if (seeded.length > 0) {
    logColor('green', `[TWITCH] Migrated ${seeded.length} channel point reward(s) from .env to dashboard: ${seeded.join(', ')}`)
  }
  return { seeded: seeded.length, skipped: false }
}

module.exports = { ACTIONS, getAll, findByRewardId, add, update, remove, seedFromEnv }
