/**
 * twitchCommands.js
 *
 * Defines all Twitch chat commands and moderation commands.
 *
 * Functionality:
 * - Chat interaction commands
 * - Twitch moderation commands
 * - OBS interaction commands
 * - Channel point timeout command
 *
 * All commands operate using injected context.
 */
const superfetch = require('node-superfetch')
const { twitch, streamer, web } = require('../../config/env')
const { getToken, getUser, getUserCategory, getChannelInformation, sendChatAnnouncement } = require('./twitchAPI')
const songRequestClient = require('../player/songRequestClient')
const customCommands = require('./customCommands')
const commandToggles = require('./commandToggles')
const cannonStacks = require('./cannonStacks')
const { getAllRanks, lookupRank } = require('../riot/riotAPI')
const points = require('../points/pointsStore')
const modules = require('../points/modules')
const slots = require('../points/slots')
const gambleModule = require('../points/gamble')
const duel = require('../points/duel')
const raffle = require('../points/raffle')
const overlayActions = require('../overlay/actions')
const overlaySounds = require('../overlay/sounds')
const settings = require('../../config/settings')

const WITHER_COOLDOWN_MS = 300_000

/**
 * Builds the standard shoutout chat message for a Twitch user.
 *
 * @param {string} username
 * @returns {Promise<string>}
 */
async function buildShoutoutMessage(username) {
  if (!username) return ''

  const uname = username.replace('@', '').toLowerCase()
  const category = await getUserCategory(uname)
  return `Check out ${uname} at https://twitch.tv/${uname}, they are playing ${category || 'something cool'}!`
}

/**
 * Calculates stacking timeout duration and updates botState.
 *
 * @param {object} botState
 * @param {string} uname
 * @param {number} baseDuration seconds
 * @returns {number}
 */
function calculateTimeoutDuration(botState, uname, baseDuration) {

  if (!botState.timeouts) botState.timeouts = {}

  const now = Math.floor(Date.now() / 1000)

  const userData = botState.timeouts[uname]

  let timeoutDuration = baseDuration

  if (userData) {
    timeoutDuration =
      (now - userData.timestamp > userData.duration)
        ? baseDuration
        : userData.duration + baseDuration
  }

  botState.timeouts[uname] = {
    duration: timeoutDuration,
    timestamp: now
  }

  return timeoutDuration
}

/**
 * Creates Twitch chat commands for the bot.
 *
 * @param {object} context
 * @returns {Array<{name: string, response: function}>}
 */
function createCommands(context) {
  if (!context) throw new Error('createCommands requires a context object')

  const {
    ComfyJS,
    obsController,
    twitchChannel,
    twitchChannelCaseSensitive,
    twitchChannelUserID,
    twitchBotUserID,
    twitchBotAPIClientID,
    userCooldown,
    botState,
    pingList,
    logColor = (...args) => console.log(...args)
  } = context

  // ============================================================
  // Initializes Bot State
  // ============================================================
  botState.startTime = botState.startTime || Date.now()
  botState.commandCaller = botState.commandCaller || null
  botState.timeouts = botState.timeouts || {}

  // ============================================================
  // Simple Commands
  // ============================================================

  const playlistCommand = () => {
    const url = songRequestClient.getBackupPlaylistUrl()
    if (!url) return 'No playlist is currently set.'
    return `Current playlist: ${url}`
  }

  const videosCommand = () => `You can insert videos here for Surfer to watch Sprite https://docs.google.com/document/d/1bxSoH8t5fFlTETAFe0xPk24fAA1hsHyH_-U0BrY1aBU/edit`

  // !playsound <name> plays; bare !playsound falls through to the list, as do
  // the !soundlist aliases.
  const playSoundCommand = (name) => overlayActions.playSound(botState.commandCaller, name)

  const soundListCommand = () => overlayActions.listSounds()

  const soundVolCommand = (levelRaw) => {
    const caller = botState.commandCaller
    if (!botState.isBroadcaster) return `@${caller} only the broadcaster can change sound volume.`
    if (levelRaw === undefined || levelRaw === '') return `@${caller} sound volume is at ${overlayActions.getVolume()}%.`
    const level = Math.floor(Number(levelRaw))
    if (!Number.isFinite(level) || level < 0 || level > 100) return `@${caller} volume must be a number from 0 to 100.`
    overlayActions.setVolume(level)
    return `@${caller} sound volume set to ${level}%.`
  }

  const showEmoteCommand = (name) => overlayActions.showEmote(botState.commandCaller, name)


  const lurkCommand = () => `${botState.commandCaller} turned on lurk mode peepoBlanket`

  const unlurkCommand = () => `${botState.commandCaller} is back! PeepoCheer`

  const pingCommand = () => {
    const totalSeconds = Math.floor((Date.now() - botState.startTime) / 1000)
    const parts = []
    const weeks = Math.floor(totalSeconds / 604800)
    const days = Math.floor((totalSeconds % 604800) / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (weeks) parts.push(`${weeks} week${weeks !== 1 ? 's' : ''}`)
    if (days) parts.push(`${days} day${days !== 1 ? 's' : ''}`)
    if (hours) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
    if (minutes) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)
    if (seconds || parts.length === 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`)
    return `Pong. I have been stalking for ${parts.join(', ')}.`
  }

  const tuckCommand = (username) => {

    if (!username) return ''

    const uname = username.replace('@', '').toLowerCase()
    return `@${botState.commandCaller} tucked ${uname} to bed FeelsOkayMan 👉 🛏️`
  }

  const timeCommand = () => settings.renderTime(twitchChannelCaseSensitive)

  // ============================================================
  // Async Commands (Twitch API / ComfyJS)
  // ============================================================
  const soCommand = async (username) => {
    const message = await buildShoutoutMessage(username)
    if (!message) return null
    await sendChatAnnouncement({
      broadcasterId: twitchChannelUserID,
      moderatorId: twitchBotUserID,
      message,
      color: 'blue'
    })
    return null
  }

  const categoryCommand = async () => {
    const category = await getUserCategory(twitchChannel)
    return `@${twitchChannelCaseSensitive} is on the "${category || 'unknown'}" category.`
  }

  const titleCommand = async () => {
    const info = await getChannelInformation(twitchChannelUserID)
    const title = info?.title?.trim()
    return title
      ? `@${twitchChannelCaseSensitive}'s stream title is: ${title}`
      : `Could not fetch the current stream title.`
  }

  const witherCommand = async (username) => {
    if (!username) return `@${botState.commandCaller} usage: !wither <user>`

    if (userCooldown.has(botState.commandCaller)) {
      logColor('cyan', `[TWITCH] 🤡 ${botState.commandCaller} is on cooldown for wither.`)
      return `${botState.commandCaller} is on cooldown for wither... 🤡`
    }

    const uname = username.replace('@', '').toLowerCase()
    const timeoutDuration = calculateTimeoutDuration(botState, uname, 60)
    const randomNumber = Math.floor(Math.random() * 11)

    // 50/50 dodge chance
    if (randomNumber >= 5) {
      logColor('cyan', `[TWITCH] 🏃‍ ${uname} dodged the wither cast by ${botState.commandCaller}!`)
      if (botState.commandCaller !== twitchChannelCaseSensitive) {
        userCooldown.add(botState.commandCaller)
        setTimeout(() => userCooldown.delete(botState.commandCaller), WITHER_COOLDOWN_MS)
      }
      return `${uname} dodged the wither cast by ${botState.commandCaller}! 🤡`
    }

    try {
      const token = await getToken('user')
      const userID = await getUser(uname)

      if (!userID) {
        logColor('red', `[TWITCH] ❌ Could not find user ID for ${uname}, skipping wither`)
        return ''
      }

      const res = await superfetch
      .post(`${twitch.APIEndpoint}/moderation/bans`)
      .query({
        broadcaster_id: twitchChannelUserID,
        moderator_id: twitchBotUserID
      })
      .set('Authorization', `Bearer ${token}`)
      .set('Client-Id', twitchBotAPIClientID)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        data: {
          user_id: String(userID),
          duration: timeoutDuration,
          reason: `You have been withered by ${botState.commandCaller} in chat.`
        }
      }))

      if (res.status === 200) {
        logColor('cyan', `[TWITCH] 💀 ${uname} was withered by ${botState.commandCaller}.`)
        const displayText = `${uname} was withered by ${botState.commandCaller}.`
        if (obsController?.setWitherText) await obsController.setWitherText(displayText)
        if (obsController?.slideWitherTextInAllScenes) await obsController.slideWitherTextInAllScenes()
        return ''
      }

      logColor('red', `[TWITCH] ❌ Error withering ${uname}. Status: ${res.status} ${res.statusText}`)
      return ''

    } catch (error) {
      logColor('red', `[TWITCH] ❌ Error withering ${uname}: ${error.message}`)
      return ''
    }
  }
  let skipCooldownUntil = 0
  const SKIP_COOLDOWN_MS = 5 * 60 * 1000

  const skipCommand = () => {
    const now = Date.now()
    if (now < skipCooldownUntil) {
      const remaining = Math.ceil((skipCooldownUntil - now) / 1000)
      return `@${botState.commandCaller} skip is on cooldown for ${remaining}s.`
    }
    const result = songRequestClient.skip()
    if (result === 'skipped') {
      skipCooldownUntil = now + SKIP_COOLDOWN_MS
      return `@${botState.commandCaller} skipped!`
    }
    if (result === 'player_offline') return `@${botState.commandCaller} the song request player isn't running right now.`
    return ''
  }

  const srCommand = async (...args) => {
    const caller = botState.commandCaller
    const input = args.join(' ').trim()
    if (!input) return `@${caller} usage: !sr <YouTube URL or song name>`
    const { result, title, position } = await songRequestClient.enqueue(input, caller)
    if (result === 'queued') {
      const pos = position ? `at position #${position}` : 'to the queue'
      return `@${caller} added "${title}" ${pos}`
    }
    if (result === 'no_results')        return `@${caller} couldn't find a video for "${input}".`
    if (result === 'invalid_url')       return `@${caller} that doesn't look like a valid YouTube link.`
    if (result === 'requests_disabled') return `@${caller} song requests are currently disabled. Try again later!`
    return `@${caller} the song request player isn't running right now. Please try again later!`
  }

  const songCommand = () => {
    const song = songRequestClient.getCurrentSong()
    if (!song) return 'No song is currently playing.'
    if (!song.requester) return `Current song: ${song.title} - ${song.url}`
    return `Current song: ${song.title} - ${song.url} | Requested by @${song.requester}`
  }

  const reconnectOBSCommand = async () => {
    if (botState.commandCaller !== twitchChannelCaseSensitive) return
    await obsController.connect((result) => ComfyJS?.Say?.(`${result}`))
  }

  const statusOBSCommand = async () => {
    if (botState.commandCaller !== twitchChannelCaseSensitive) return
    ComfyJS?.Say?.(`${obsController.getStatus()}`)
  }

  const pingmeCommand = () => {
    const user = botState.commandCaller
    const added = pingList.toggle(user)
    return added
      ? `@${user} you've been added to the ping list! You'll be pinged when the title updates or the stream goes live.`
      : `@${user} you've been removed from the ping list.`
  }

  // ============================================================
  // Privilege check — mod or broadcaster
  // ============================================================
  function isPrivileged() {
    return botState.isBroadcaster || botState.isMod
  }

  // ============================================================
  // Custom Command Management (mod/broadcaster only)
  // ============================================================
  const addCommandCmd = (...args) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can add commands.`
    if (args.length < 2) return `@${caller} usage: !addcommand <name> <response>`
    const name = args[0].toLowerCase()
    const response = args.slice(1).join(' ')
    if (builtInNames.has(name)) return `@${caller} "${name}" is a built-in command and can't be overridden.`
    if (name === points.getCurrencyAlias()) {
      return `@${caller} "${name}" is the balance command for ${points.getCurrencyName()} and can't be overridden.`
    }
    if (overlaySounds.has(name)) {
      return `@${caller} "${name}" is a sound and already plays as !${name}.`
    }
    if (customCommands.add(name, response)) {
      logColor('green', `[TWITCH] Custom command !${name} added by ${caller}`)
      return `@${caller} command !${name} has been added.`
    }
    return `@${caller} command !${name} already exists. Use !changecommand to update it.`
  }

  const deleteCommandCmd = (...args) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can delete commands.`
    if (args.length < 1) return `@${caller} usage: !deletecommand <name>`
    const name = args[0].toLowerCase()
    if (customCommands.remove(name)) {
      logColor('green', `[TWITCH] Custom command !${name} deleted by ${caller}`)
      return `@${caller} command !${name} has been deleted.`
    }
    return `@${caller} command !${name} doesn't exist.`
  }

  const changeCommandCmd = (...args) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can edit commands.`
    if (args.length < 2) return `@${caller} usage: !changecommand <name> <new response>`
    const name = args[0].toLowerCase()
    const response = args.slice(1).join(' ')
    if (customCommands.edit(name, response)) {
      logColor('green', `[TWITCH] Custom command !${name} updated by ${caller}`)
      return `@${caller} command !${name} has been updated.`
    }
    return `@${caller} command !${name} doesn't exist. Use !addcommand to create it.`
  }

  // ============================================================
  // Enabling / disabling built-in commands
  // ============================================================
  function resolveBuiltIn(caller, rawName) {
    const name = String(rawName || '').replace(/^!/, '').trim().toLowerCase()
    if (!name) return { error: null, name: '' }
    if (builtInNames.has(name)) return { error: null, name }
    if (customCommands.get(name)) {
      return { error: `@${caller} "${name}" is a custom command — remove it with !deletecommand instead.` }
    }
    return { error: `@${caller} there's no built-in command called "${name}".` }
  }

  const disableCommandCmd = (rawName) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can disable commands.`
    if (!rawName) return `@${caller} usage: !disablecommand <name>`

    const { error, name } = resolveBuiltIn(caller, rawName)
    if (error) return error

    const result = commandToggles.disable(name)
    if (result === 'protected') {
      return `@${caller} "${name}" can't be disabled — you'd have no way to re-enable anything from chat.`
    }
    if (result === 'already') return `@${caller} !${name} is already disabled.`

    logColor('yellow', `[TWITCH] Command !${name} disabled by ${caller}`)
    return `@${caller} !${name} is now disabled.`
  }

  const enableCommandCmd = (rawName) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can enable commands.`
    if (!rawName) return `@${caller} usage: !enablecommand <name>`

    const { error, name } = resolveBuiltIn(caller, rawName)
    if (error) return error

    if (commandToggles.enable(name) === 'not_disabled') {
      return `@${caller} !${name} isn't disabled.`
    }

    logColor('green', `[TWITCH] Command !${name} re-enabled by ${caller}`)
    return `@${caller} !${name} is now enabled.`
  }

  const disabledCommandsCmd = () => {
    const disabled = commandToggles.list()
    if (disabled.length === 0) return 'No commands are disabled.'
    return `Disabled commands (${disabled.length}): ${disabled.map(n => `!${n}`).join(', ')}`
  }

  // ============================================================
  // !cannon — Nasus stacks counter
  // ============================================================
  const cannonCommand = () => {
    const stacks = cannonStacks.removeStacks(10)
    return `Surfer lagged Kappa and lost a total of ${stacks} stacks LULE`
  }

  // ============================================================
  // !vanish — self-timeout for 1 second
  // ============================================================
  const vanishCommand = async () => {
    const caller = botState.commandCaller
    const callerUserId = botState.commandCallerUserId
    if (!callerUserId) return ''

    try {
      const token = await getToken('user')
      await superfetch
        .post(`${twitch.APIEndpoint}/moderation/bans`)
        .query({
          broadcaster_id: twitchChannelUserID,
          moderator_id: twitchBotUserID
        })
        .set('Authorization', `Bearer ${token}`)
        .set('Client-Id', twitchBotAPIClientID)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({
          data: {
            user_id: String(callerUserId),
            duration: 1,
            reason: `${caller} vanished!`
          }
        }))
      logColor('cyan', `[TWITCH] ${caller} vanished!`)
    } catch (err) {
      logColor('red', `[TWITCH] Vanish failed for ${caller}: ${err.message}`)
    }
    return ''
  }

  // ============================================================
  // !rank — League of Legends rank lookup via Riot API
  // ============================================================
  const rankCommand = async (...args) => {
    try {
      const input = args.join(' ').trim()
      if (input) return await lookupRank(input)
      return await getAllRanks()
    } catch (err) {
      logColor('red', `[TWITCH] Rank lookup failed: ${err.message}`)
      return 'Could not fetch rank data right now.'
    }
  }

  // ============================================================
  // Points System
  // ============================================================
  const say = (msg) => ComfyJS?.Say?.(msg)

  const disabledMsg = (name) => `The ${name} module is currently disabled.`

  function callerKey() {
    return (botState.platform === 'kick' ? 'kick:' : '') + botState.commandCaller
  }

  function userKey(user) {
    return (botState.platform === 'kick' ? 'kick:' : '') + String(user).replace(/^@/, '')
  }

  const pointsCommand = (targetRaw) => {
    const caller = botState.commandCaller
    const currency = points.getCurrencyName()
    if (targetRaw) {
      const key = userKey(targetRaw)
      return `@${points.displayName(key)} has ${points.format(points.getBalance(key))} ${currency}.`
    }
    const key = callerKey()
    return `@${caller} you have ${points.format(points.getBalance(key))} ${currency}.`
  }

  // Chat only has room for the top few, so point at the full page when the web
  // interface is actually published somewhere viewers can reach.
  const webLink = (path) => (web.publicUrl ? ` ${web.publicUrl}${path}` : '')

  const leaderboardCommand = () => {
    const currency = points.getCurrencyName()
    const top = points.leaderboard(5)
    if (top.length === 0) return `Nobody has any ${currency} yet.`
    const list = top.map((e, i) => `${i + 1}. ${e.name} (${points.format(e.amount)})`).join(' | ')
    return `Top ${currency}: ${list}${webLink('/leaderboard')}`
  }

  const commandsCommand = () => {
    if (!web.publicUrl) {
      return `@${botState.commandCaller} the command list isn't published online yet.`
    }
    return `Every command: ${web.publicUrl}/commands`
  }

  const givePointsCommand = (targetRaw, amountRaw) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can grant ${points.getCurrencyName()}.`
    if (!targetRaw || !amountRaw) return `@${caller} usage: !givepoints <user> <amount>`
    const amount = Math.floor(Number(amountRaw))
    if (!Number.isFinite(amount) || amount <= 0) return `@${caller} "${amountRaw}" isn't a valid amount.`
    const key = userKey(targetRaw)
    const total = points.addPoints(key, amount)
    return `@${points.displayName(key)} received ${points.format(amount)} ${points.getCurrencyName()}! Balance: ${points.format(total)}`
  }

  const removePointsCommand = (targetRaw, amountRaw) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can remove ${points.getCurrencyName()}.`
    if (!targetRaw || !amountRaw) return `@${caller} usage: !removepoints <user> <amount>`
    const amount = Math.floor(Number(amountRaw))
    if (!Number.isFinite(amount) || amount <= 0) return `@${caller} "${amountRaw}" isn't a valid amount.`
    const key = userKey(targetRaw)
    const total = points.removePoints(key, amount)
    return `@${points.displayName(key)} lost ${points.format(amount)} ${points.getCurrencyName()}. Balance: ${points.format(total)}`
  }

  const setPointsCommand = (targetRaw, amountRaw) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can set ${points.getCurrencyName()}.`
    if (!targetRaw || amountRaw === undefined) return `@${caller} usage: !setpoints <user> <amount>`
    const amount = Math.floor(Number(amountRaw))
    if (!Number.isFinite(amount) || amount < 0) return `@${caller} "${amountRaw}" isn't a valid amount.`
    const key = userKey(targetRaw)
    const total = points.setBalance(key, amount)
    return `@${points.displayName(key)} now has ${points.format(total)} ${points.getCurrencyName()}.`
  }

  const setPointsNameCommand = (...args) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can rename the currency.`
    const name = args.join(' ').trim()
    if (!name) return `@${caller} usage: !setpointsname <name>`
    const previous = points.getCurrencyName()
    points.setCurrencyName(name)
    const alias = points.getCurrencyAlias()
    logColor('green', `[SYSTEM] Currency renamed from "${previous}" to "${name}" by ${caller}`)
    const how = alias ? `!${alias} or !points` : '!points'
    return `@${caller} the currency is now called "${name}" (was "${previous}"). Check balances with ${how}.`
  }

  const modulesCommand = () => {
    const list = modules.list().map(m => `${m.name}: ${m.enabled ? 'ON' : 'OFF'}`).join(' | ')
    return `Modules — ${list}`
  }

  const moduleCommand = (action, name) => {
    const caller = botState.commandCaller
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can toggle modules.`
    if (!action || !name) return `@${caller} usage: !module <enable|deactivate> <${modules.NAMES.join('|')}>`
    const verb = String(action).toLowerCase()
    const enable = verb === 'enable' || verb === 'activate' || verb === 'on'
    const disable = verb === 'disable' || verb === 'deactivate' || verb === 'off'
    if (!enable && !disable) return `@${caller} usage: !module <enable|disable> <${modules.NAMES.join('|')}>`
    const key = String(name).toLowerCase()
    if (!modules.setEnabled(key, enable)) {
      return `@${caller} unknown module "${name}". Options: ${modules.NAMES.join(', ')}`
    }
    logColor('green', `[SYSTEM] Module ${key} ${enable ? 'enabled' : 'disabled'} by ${caller}`)
    return `@${caller} module "${key}" is now ${enable ? 'ENABLED' : 'DISABLED'}.`
  }

  const slotsCommand = (amountRaw) => {
    if (!modules.isEnabled('slots')) return disabledMsg('slots')
    return slots.spin(callerKey(), amountRaw)
  }

  const gambleCommand = (amountRaw) => {
    if (!modules.isEnabled('gamble')) return disabledMsg('gamble')
    return gambleModule.gamble(callerKey(), amountRaw)
  }

  const duelCommand = (targetRaw, amountRaw) => {
    if (!modules.isEnabled('duel')) return disabledMsg('duel')
    return duel.challenge(callerKey(), userKey(targetRaw), amountRaw)
  }

  const acceptCommand = () => {
    if (!modules.isEnabled('duel')) return ''
    return duel.accept(callerKey())
  }

  const denyCommand = () => {
    if (!modules.isEnabled('duel')) return ''
    return duel.deny(callerKey())
  }

  const startRaffle = (potRaw, singleWinner) => {
    const caller = botState.commandCaller
    if (!modules.isEnabled('raffle')) return disabledMsg('raffle')
    if (!isPrivileged()) return `@${caller} only mods or the broadcaster can start a raffle.`
    const cfg = modules.get('raffle')
    const pot = potRaw === undefined ? cfg.defaultPot : Math.floor(Number(potRaw))
    if (!Number.isFinite(pot) || pot <= 0) return `@${caller} "${potRaw}" isn't a valid pot amount.`
    logColor('green', `[SYSTEM] Raffle started by ${caller} for ${pot} (${singleWinner ? 'single' : 'multi'})`)
    return raffle.start({ pot, singleWinner, say })
  }

  const raffleCommand  = (potRaw) => startRaffle(potRaw, false)
  const sraffleCommand = (potRaw) => startRaffle(potRaw, true)

  // Joins are silent on purpose — confirming each one would flood chat.
  const joinCommand = () => {
    raffle.join(callerKey())
    return ''
  }

  const VIP_COST = 100_000

  const redeemVipCommand = async () => {
    const caller = botState.commandCaller
    const callerUserId = botState.commandCallerUserId
    const currency = points.getCurrencyName()

    if (!callerUserId) return ''

    const key = callerKey()
    const balance = points.getBalance(key)
    if (balance < VIP_COST) {
      return `@${caller} you need ${points.format(VIP_COST)} ${currency} to redeem VIP (you have ${points.format(balance)}).`
    }

    try {
      const token = await getToken('user')
      const res = await superfetch
        .post(`${twitch.APIEndpoint}/channels/vips`)
        .query({
          broadcaster_id: twitchChannelUserID,
          user_id: String(callerUserId)
        })
        .set('Authorization', `Bearer ${token}`)
        .set('Client-Id', twitchBotAPIClientID)

      if (res.status === 204 || res.status === 200) {
        points.removePoints(key, VIP_COST)
        logColor('green', `[TWITCH] ⭐ ${caller} redeemed VIP for ${points.format(VIP_COST)} ${currency}`)
        return `@${caller} you are now a VIP! (−${points.format(VIP_COST)} ${currency})`
      }

      logColor('red', `[TWITCH] VIP assign failed for ${caller}: status ${res.status}`)
      return `@${caller} something went wrong assigning VIP. Points were NOT deducted.`
    } catch (err) {
      logColor('red', `[TWITCH] VIP assign failed for ${caller}: ${err.message}`)
      return `@${caller} something went wrong assigning VIP. Points were NOT deducted.`
    }
  }

  // ============================================================
  // Return Commands Array
  // ============================================================
  const commandList = [
    { name: 'ping', response: pingCommand },
    { name: 'wither', response: witherCommand },
    { name: 'playlist', response: playlistCommand },
    { name: 'time', response: timeCommand },
    { name: 'videos', response: videosCommand },
    { name: 'playsound', response: playSoundCommand },
    { name: 'playsoundlist', response: soundListCommand },
    { name: 'sound', response: soundListCommand },
    { name: 'sounds', response: soundListCommand },
    { name: 'soundlist', response: soundListCommand },
    { name: 'soundboard', response: soundListCommand },
    { name: 'soundclips', response: soundListCommand },
    { name: 'soundvol', response: soundVolCommand },
    { name: 'showemote', response: showEmoteCommand },
    { name: 'lurk', response: lurkCommand },
    { name: 'unlurk', response: unlurkCommand },
    { name: 'sr', response: srCommand },
    { name: 'skip', response: skipCommand },
    { name: 'song', response: songCommand },
    { name: 'so', response: soCommand },
    { name: 'tuck', response: tuckCommand },
    { name: 'game', response: categoryCommand },
    { name: 'category', response: categoryCommand },
    { name: 'title', response: titleCommand },
    { name: 'obsreconnect', response: reconnectOBSCommand },
    { name: 'obsstatus', response: statusOBSCommand },
    { name: 'pingme', response: pingmeCommand },
    { name: 'addcommand', response: addCommandCmd },
    { name: 'deletecommand', response: deleteCommandCmd },
    { name: 'changecommand', response: changeCommandCmd },
    { name: 'disablecommand', response: disableCommandCmd },
    { name: 'enablecommand', response: enableCommandCmd },
    { name: 'disabledcommands', response: disabledCommandsCmd },
    { name: 'cannon', response: cannonCommand },
    { name: 'vanish', response: vanishCommand },
    { name: 'rank', response: rankCommand },
    { name: 'points', response: pointsCommand },
    { name: 'balance', response: pointsCommand },
    { name: 'leaderboard', response: leaderboardCommand },
    { name: 'top', response: leaderboardCommand },
    { name: 'givepoints', response: givePointsCommand },
    { name: 'removepoints', response: removePointsCommand },
    { name: 'setpoints', response: setPointsCommand },
    { name: 'setpointsname', response: setPointsNameCommand },
    { name: 'modules', response: modulesCommand },
    { name: 'module', response: moduleCommand },
    { name: 'slots', response: slotsCommand },
    { name: 'gamble', response: gambleCommand },
    { name: 'duel', response: duelCommand },
    { name: 'accept', response: acceptCommand },
    { name: 'deny', response: denyCommand },
    { name: 'raffle', response: raffleCommand },
    { name: 'sraffle', response: sraffleCommand },
    { name: 'join', response: joinCommand },
    { name: 'redeemvip', response: redeemVipCommand },
    { name: 'commands', response: commandsCommand },
    { name: 'commandlist', response: commandsCommand },
    { name: 'help', response: commandsCommand }
  ]

  const builtInNames = new Set(commandList.map(c => c.name))

  return Object.freeze(commandList)
}


/**
 * Times out a user via Twitch moderation API.
 * Used by channel point rewards.
 *
 * @param {object} context
 * @param {string} username
 * @returns {Promise<string>}
 */
const timeoutCommand = async (context, username) => {

  if (!username) return

  if (!context) throw new Error('timeoutCommand requires a context object')

    const {
      botState,
      logColor = (...args) => console.log(...args),
      obsController,
      twitchChannelUserID,
      twitchBotUserID,
      twitchBotAPIClientID
    } = context

    const uname = username.replace('@', '').toLowerCase()
    const timeoutDuration = calculateTimeoutDuration(botState, uname, 300)

    try {
      const token = await getToken('user')
      const userID = await getUser(uname)

      if (!userID) {
        logColor('red', `[TWITCH] ❌ Could not find user ID for ${uname}, skipping timeout`)
        return ''
      }

      const res = await superfetch
      .post(`${twitch.APIEndpoint}/moderation/bans`)
      .query({
        broadcaster_id: twitchChannelUserID,
        moderator_id: twitchBotUserID
      })
      .set('Authorization', `Bearer ${token}`)
      .set('Client-Id', twitchBotAPIClientID)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        data: {
          user_id: String(userID),
          duration: timeoutDuration,
          reason: `You have been timed out by ${botState.commandCaller} via channel points reward.`
        }
      }))

      if (res.status === 200) {
        logColor('cyan', `[TWITCH] 💀 ${uname} timed out by ${botState.commandCaller} via channel points.`)
        const displayText = `${uname} was timed out by ${botState.commandCaller} via channel points.`
        if (obsController?.setWitherText) await obsController.setWitherText(displayText)
        if (obsController?.slideWitherTextInAllScenes) await obsController.slideWitherTextInAllScenes()
        return ''
      }

      logColor('red', `[TWITCH] ❌ Error timing out ${uname}. Status: ${res.status} ${res.statusText}`)
      return ''

    } catch (error) {
      logColor('red', `[TWITCH] ❌ Error timing out ${uname}: ${error.message}`)
      return ''
    }
}

module.exports = Object.freeze({
  createCommands,
  timeoutCommand,
  buildShoutoutMessage
})
