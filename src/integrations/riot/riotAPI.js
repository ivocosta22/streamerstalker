const { logColor } = require('../../utils/logger')
const { riot } = require('../../config/env')

const apiKey = riot.apiKey

const ACCOUNTS = [
  { gameName: 'Delfortin', tagLine: '1701', region: 'euw1', routingRegion: 'europe' },
  { gameName: 'SurferKiller', tagLine: 'TTV', region: 'euw1', routingRegion: 'europe' }
]

const ROUTING_REGIONS = {
  br1: 'americas', la1: 'americas', la2: 'americas', na1: 'americas',
  jp1: 'asia', kr: 'asia',
  eun1: 'europe', euw1: 'europe', tr1: 'europe', ru: 'europe',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea'
}

function formatRank(entry) {
  if (!entry) return 'Unranked'
  const tier = entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase()
  const highElo = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(entry.tier)
  const division = highElo ? '' : ` ${entry.rank}`
  const total = entry.wins + entry.losses
  const wr = total > 0 ? Math.round((entry.wins / total) * 100) : 0
  return `${tier}${division} (${entry.leaguePoints} LP) - ${wr}% WR (${entry.wins}W/${entry.losses}L)`
}

async function fetchRank(gameName, tagLine, region, routingRegion) {
  if (!apiKey) return { name: `${gameName}#${tagLine}`, rank: 'API key not configured' }

  try {
    const accountRes = await fetch(
      `https://${routingRegion}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      { headers: { 'X-Riot-Token': apiKey } }
    )
    if (!accountRes.ok) {
      if (accountRes.status === 404) return { name: `${gameName}#${tagLine}`, rank: 'Account not found' }
      logColor('red', `[SYSTEM] Failed to fetch account ${gameName}#${tagLine}: ${accountRes.status}`)
      return { name: `${gameName}#${tagLine}`, rank: 'Error fetching account' }
    }
    const { puuid } = await accountRes.json()

    const leagueRes = await fetch(
      `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
      { headers: { 'X-Riot-Token': apiKey } }
    )
    if (!leagueRes.ok) {
      return { name: `${gameName}#${tagLine}`, rank: 'Error fetching rank' }
    }
    const entries = await leagueRes.json()

    const soloQ = entries.find(e => e.queueType === 'RANKED_SOLO_5x5')
    return { name: `${gameName}#${tagLine}`, rank: formatRank(soloQ) }
  } catch (err) {
    logColor('red', `[SYSTEM] Error fetching rank for ${gameName}#${tagLine}: ${err.message}`)
    return { name: `${gameName}#${tagLine}`, rank: 'Error' }
  }
}

async function getAccountRank(account) {
  return fetchRank(account.gameName, account.tagLine, account.region, account.routingRegion)
}

async function getAllRanks() {
  const results = await Promise.all(ACCOUNTS.map(getAccountRank))
  return results.map(r => `${r.name} -> ${r.rank}`).join(' | ')
}

async function lookupRank(riotId) {
  const hash = riotId.indexOf('#')
  if (hash < 1 || hash === riotId.length - 1) return `Invalid format. Use: Name#Tag`
  const gameName = riotId.slice(0, hash).trim()
  const tagLine = riotId.slice(hash + 1).trim()
  const region = 'euw1'
  const routingRegion = ROUTING_REGIONS[region]
  const result = await fetchRank(gameName, tagLine, region, routingRegion)
  return `${result.name} -> ${result.rank}`
}

module.exports = { getAllRanks, lookupRank, ACCOUNTS }
