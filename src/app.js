/**
 * app.js
 *
 * Main application entrypoint.
 *
 * Functionality:
 *
 * - Initializes and maintains OBS Websocket connection
 * - Starts HTTP keepalive server
 * - Connects Twitch clients (ComfyJS and tmi.js)
 * - Registers and executes Twitch commands
 * - Initializes Discord bot and its slash commands
 * - Bridges Discord messages to Twitch chat
 * - Handles process-level errors and graceful shutdown
 */

// ============================================================
// System Initialization
// ============================================================
const { logColor } = require('./utils/logger')
logColor('cyan', '[SYSTEM] 👓 SurferStalker is starting...')


const { twitch, discord, obs, chat, streamer } = require('./config/env')
const { getToken } = require('./integrations/twitch/twitchAPI')
const songRequestClient = require('./integrations/player/songRequestClient')
const obsController = require('./integrations/obs/obsController')
const { createCommands } = require('./integrations/twitch/twitchCommands')
const customCommands = require('./integrations/twitch/customCommands')
const commandToggles = require('./integrations/twitch/commandToggles')
const seedCommands = require('./integrations/twitch/seedCommands')
const cannonStacks = require('./integrations/twitch/cannonStacks')
const pointsAccrual = require('./integrations/points/accrual')
const pointsStore = require('./integrations/points/pointsStore')
const overlayEmotes = require('./integrations/overlay/emotes')
const overlayTracker = require('./integrations/overlay/tracker')
const overlaySounds = require('./integrations/overlay/sounds')
const overlayActions = require('./integrations/overlay/actions')
const { registerTwitchRewards } = require('./integrations/twitch/twitchRewards')
const { startTitleMonitor } = require('./integrations/twitch/titleMonitor')
const { startChatTimers, recordChatLine } = require('./integrations/twitch/chatTimers')
const pingList = require('./config/titleUpdatePingList')
const chatBus = require('./integrations/twitch/chatBus')
const badgeResolver = require('./integrations/twitch/badgeResolver')
const emoteResolver = require('./integrations/twitch/emoteResolver')
const kickChat = require('./integrations/kick/kickChat')
process.on('unhandledRejection', (reason) => {
  logColor('red', `[SYSTEM] Unhandled Rejection: ${reason}`)
})

process.on('uncaughtException', (error) => {
  logColor('red', `[SYSTEM] Uncaught Exception: ${error?.stack || error}`)
  process.exit(1)
})

// ============================================================
// OBS Integration
// ============================================================
async function startObs() {
  try {
    await obsController.connect()
    obsController.startAutoReconnect(obs.reconnectIntervalMs)
  } catch (err) {
    logColor('red', `[SYSTEM] ❌ Fatal OBS startup error: ${err && err.message ? err.message : err}`)
    process.exit(1)
  }
}
startObs()
getToken('user')
badgeResolver.fetchBadges().catch(() => {})
emoteResolver.fetchEmotes().catch(() => {})
kickChat.start().catch(() => {})
songRequestClient.start(logColor, async (enabled) => {
  const msg = enabled
    ? 'Song requests are now enabled! Use !sr <YouTube URL> to request a song.'
    : 'Song requests are now disabled.'
  logColor(enabled ? 'green' : 'yellow', `[SYSTEM] Requests toggled: ${enabled ? 'ON' : 'OFF'} — setting !srDisabled visibility to ${!enabled}`)
  ComfyJS?.Say?.(msg)
  await obsController.setSourceVisibility('!srDisabled', !enabled)
})

// ============================================================
// HTTP Keepalive Server
// Prevents hosting environments from idling the app
// I run this app locally for now but hopefully will host it in the future
// ============================================================
const keepAlive = require('./server')
keepAlive()


// ============================================================
// Twitch Integration
// ComfyJS handles sending chat messages
// tmi.js handles message events and command parsing
// ============================================================
const ComfyJS = require('comfy.js')
const tmi = require('tmi.js')

// ============================================================
// ComfyJS (chat bot account)
// Communicates with the Twitch chat without using TwitchAPI calls
// Chat token is twitch.botOAuth and channel is twitch.channel
// ============================================================
try {
  ComfyJS.Init(twitch.channel, twitch.botOAuth)
  logColor('green', `[TWITCH] ✅ ComfyJS initialized`)
} catch (err) {
  logColor('red', `[TWITCH] ❌ ComfyJS.Init failed: ${err.message || err}`)
}

ComfyJS.onConnected = () => logColor('green', `[TWITCH] ✅ Connected to ComfyJS`)
chatBus.setSay((msg) => ComfyJS.Say(msg))

if (!chat.enabled) {
  ComfyJS.Say = (msg) => logColor('yellow', `[TWITCH] 🔇 Chat disabled — suppressed: ${msg}`)
  logColor('yellow', '[TWITCH] ⚠️ CHAT_ENABLED=false — all outgoing chat messages are suppressed')
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================
// Shared Bot Runtime State
// Injected into command handlers for cross-command coordination
// ============================================================
const userCooldown = require('./state/userCooldown')
const botState = require('./state/botState')

seedCommands.run({ kickChannelUrl: streamer.kickChannelUrl, logColor })

const rewardStore = require('./integrations/twitch/rewardStore')
const envRewards = require('./config/env').twitchChannelPointsRewards
if (envRewards) rewardStore.seedFromEnv(envRewards, logColor)

const commands = createCommands({
  ComfyJS,
  obsController,
  twitchChannel: twitch.channel,
  twitchChannelCaseSensitive: twitch.channelCaseSensitive,
  twitchChannelUserID: twitch.channelUserId,
  twitchBotUserID: twitch.botUserId,
  twitchBotAPIClientID: twitch.botClientId,
  userCooldown,
  botState,
  pingList,
  logColor
})

registerTwitchRewards({ ComfyJS, botState, obsController, logColor })
startTitleMonitor({ ComfyJS, botState, logColor, pingList })
pointsAccrual.start({ logColor })
overlayEmotes.start()
let _discordClient = null

startChatTimers({
  say: (msg) => ComfyJS.Say(msg),
  broadcasterId: twitch.channelUserId,
  moderatorId: twitch.botUserId,
  pingList,
  onGoLive: async (streamInfo) => {
    try {
      if (!_discordClient) return
      const channel = _discordClient.channels.cache.get(discord.goLiveChannelId)
      if (!channel) return
      const name = twitch.channelCaseSensitive
      const title = streamInfo?.title || 'Untitled stream'
      const category = streamInfo?.game_name || 'Something cool'
      const viewers = streamInfo?.viewer_count ?? 0
      const thumbnail = streamInfo?.thumbnail_url
        ?.replace('{width}', '440')
        ?.replace('{height}', '248')

      const embed = new EmbedBuilder()
        .setColor(0x9146FF)
        .setAuthor({ name: `${name} is now live on Twitch!`, url: `https://twitch.tv/${twitch.channel}` })
        .setTitle(title)
        .setURL(`https://twitch.tv/${twitch.channel}`)
        .addFields(
          { name: 'Category', value: category, inline: true },
          { name: 'Viewers', value: String(viewers), inline: true }
        )

      if (thumbnail) embed.setImage(thumbnail)

      await channel.send({
        content: `Hey @everyone! ${name} is now live on Twitch and Kick. Check it out!\nhttps://twitch.tv/${twitch.channel}\n${streamer.kickChannelUrl}`,
        embeds: [embed],
        allowedMentions: { parse: ['everyone'] }
      })
      logColor('green', '[DISCORD] Sent go-live notification')
    } catch (err) {
      logColor('red', `[DISCORD] Failed to send go-live notification: ${err?.message || err}`)
    }
  },
  logColor
})
ComfyJS.onRaid = async (user, viewers) => {
  try {
    const raider = user?.trim()
    if (!raider) return

    logColor('yellow', `[TWITCH] Raid received from ${raider} with ${viewers ?? 'unknown'} viewer(s).`)
    ComfyJS.Say(`!so ${raider}`)
  } catch (error) {
    logColor('red', `[TWITCH] Raid shoutout error: ${error?.message || error}`)
  }
}

// ============================================================
// Secondary Twitch IRC client
// Responsible for receiving chat messages and executing commands
// ============================================================
const twitchChatClient = new tmi.Client({
  identity: {
    username: twitch.botUsername,
    password: twitch.botOAuth
  },
  channels: [twitch.channel]
})

twitchChatClient.on('connected', (addr, port) => {
  botState.startTime = Date.now()
  logColor('green', `[TWITCH] ✅ tmi.js connected to ${addr}:${port}`)
})

// ============================================================
// onMessageHandler
// Updates state.commandCaller
// Ignores messages from self / the bot account
// Detects commands using the prefix provided in the .env file
// Finds matching command via commands[] and executes it
// ============================================================
twitchChatClient.on('message', async (target, context, msg, self) => {
  const displayName = context['display-name'] || context.username || 'unknown'
  botState.commandCaller = displayName
  botState.commandCallerUserId = context['user-id'] || null
  botState.isMod = !!context.mod
  botState.isBroadcaster = (context.username || '').toLowerCase() === twitch.channel.toLowerCase()

  if (self || botState.commandCaller === twitch.botUsername) return

  chatBus.push(context, msg)

  // Ignores StreamElements messages but still logs them
  if (botState.commandCaller === 'StreamElements') {
    logColor('default', `[TWITCH] ${botState.commandCaller}: ${msg}`)
    return
  }

  logColor('default', `[TWITCH] ${botState.commandCaller}: ${msg}`)
  recordChatLine()
  pointsAccrual.recordActivity(displayName)

  const message = msg.trim()

  // Emote combos and pyramids are driven by ordinary chat, so this has to see
  // every message — including non-commands, which are what break a combo.
  try {
    overlayTracker.processMessage({
      user: displayName,
      message,
      say: (line) => { if (chat.enabled) twitchChatClient.say(target, line) }
    })
  } catch (err) {
    logColor('red', `[SYSTEM] Tracker error: ${err?.message || err}`)
  }

  // Cannon "-10" trigger (not a command, plain chat message)
  if (message === '-10') {
    const stacks = cannonStacks.removeStacks(10)
    const response = `Surfer lagged Kappa and lost a total of ${stacks} stacks LULE`
    if (chat.enabled) twitchChatClient.say(target, response)
    return
  }

  if (!message.startsWith(twitch.prefix)) return

  const parts = message.slice(twitch.prefix.length).trim().split(/\s+/)
  const commandName = parts.shift()
  const args = parts
  logColor('yellow', `[TWITCH] ⚠️ Command Detected: ${commandName} ${args.join(' ')}`)

  const lookup = commandName.toLowerCase()
  let matchedCommand = commands.find(c => c.name.toLowerCase() === lookup)

  // The balance command follows whatever the currency is currently named, so
  // !setpointsname Coins makes !coins work. !points always stays available.
  if (!matchedCommand) {
    const alias = pointsStore.getCurrencyAlias()
    if (alias && lookup === alias) {
      matchedCommand = commands.find(c => c.name === 'points')
    }
  }

  // Both names are checked so disabling "points" also kills its currency alias.
  if (matchedCommand &&
      (commandToggles.isDisabled(lookup) || commandToggles.isDisabled(matchedCommand.name))) {
    logColor('yellow', `[TWITCH] Ignored ${commandName} — command is disabled`)
    if (chat.enabled) {
      twitchChatClient.say(target, `@${displayName} !${lookup} is turned off right now.`)
    }
    return
  }

  // Any file in sounds/ is playable as its own command, so !eww works
  // alongside !playsound eww without needing to be registered.
  if (!matchedCommand && overlaySounds.has(lookup)) {
    const soundResponse = overlayActions.playSound(displayName, lookup)
    if (soundResponse && chat.enabled) twitchChatClient.say(target, soundResponse)
    logColor('green', `[TWITCH] ✅ Played sound ${lookup}`)
    return
  }

  // Check custom commands if no built-in match
  if (!matchedCommand) {
    const customResponse = customCommands.get(lookup)
    if (customResponse) {
      if (chat.enabled) twitchChatClient.say(target, customResponse)
      logColor('green', `[TWITCH] ✅ Executed custom command ${commandName}`)
      return
    }
    logColor('red', `[TWITCH] ❌ Unknown command ${commandName}`)
    return
  }

  try {
    const response = typeof matchedCommand.response === 'function'
      ? await matchedCommand.response(...args)
      : matchedCommand.response

    if (response && chat.enabled) twitchChatClient.say(target, response)
    logColor('green', `[TWITCH] ✅ Executed ${commandName} command`)
  } catch (err) {
    logColor('red', `[TWITCH] ❌ Error executing ${commandName}: ${err?.message || err}`)
  }
})

// ============================================================
// Connect Twitch IRC client
// Required for receiving chat events and processing commands
// ============================================================
twitchChatClient.connect().catch(err => {
  const msg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err))
  logColor('red', `[TWITCH] ❌ tmi.js connection failed: ${msg}`)
})


// ============================================================
// Discord Integration
// Handles slash commands and message bridging
// ============================================================
const { Client, GatewayIntentBits, Partials, ActivityType, PermissionsBitField, EmbedBuilder } = require('discord.js')

const discordClient = _discordClient = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
})

discordClient.once('clientReady', () => {
  try {
    discordClient.user.setActivity('👀 Watching SurferKiller', { type: ActivityType.Watching })
    logColor('green', `[DISCORD] ✅ Logged in as ${discordClient.user.tag}`)
  } catch (err) {
    logColor('red', `[DISCORD] ❌ Error in ready handler: ${err?.message || err}`)
  }
})

// ============================================================
// Discord Slash Command Handler
// Executes registered slash commands
// ============================================================
discordClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  const name = interaction.commandName

  try {
    if (name === 'ping') {
      await interaction.reply(`Pong. I'm not ded :)`)
      return
    }

    if (name === 'coinflip') {
      const result = Math.random() < 0.5 ? 'Flip Flop! You got Heads' : 'Flip Flop! You got Tails'
      await interaction.reply(result)
      return
    }

    if (name === 'rank') {
      await interaction.deferReply()
      const { getAllRanks, lookupRank } = require('./integrations/riot/riotAPI')
      const username = interaction.options.getString('username')
      const reply = username ? await lookupRank(username) : await getAllRanks()
      await interaction.editReply(reply)
      return
    }

    if (name === 'say') {
      // Restrict who can use 'say' — requires the 'Manage Messages' permission OR Administrator for now
      const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages) || interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)

      if (!hasPermission) {
        await interaction.reply({ content: 'Insufficient permissions to use this command.', ephemeral: true })
        return
      }

      const channelId = interaction.options.get('channel').value
      const message = interaction.options.get('message').value

      if (!channelId || !message) {
        await interaction.reply({ content: 'Invalid channel or message provided.', ephemeral: true })
        return
      }

      const targetChannel = discordClient.channels.cache.get(channelId)

      if (!targetChannel) {
        await interaction.reply({ content: 'Channel not found in cache. Make sure I have access to it.', ephemeral: true })
        return
      }

      await targetChannel.send(message)
      await interaction.reply({ content: 'Message sent.', ephemeral: true })
      return
    }
  } catch (err) {
    logColor('red', `[DISCORD] ❌ Interaction error (${name}): ${err?.message || err}`)
    try { await interaction.reply({ content: 'An error occurred executing that command.', ephemeral: true }) } catch {}
  }
})

// ============================================================
// Discord → Twitch Bridge
// Forwards messages from configured Discord channel(s) into Twitch chat
// Mentions are resolved to readable usernames
// ============================================================
discordClient.on('messageCreate', async (message) => {
  if (message.channelId !== discord.communicationChannelId) return

  let content = message.content
  const mentions = content.match(/<@!?(\d+)>/g)
  if (mentions) {
    for (const mention of mentions) {
      const userId = mention.match(/\d+/)[0]
      try {
        const user = await discordClient.users.fetch(userId)
        content = content.replace(mention, `@${user.username}`)
      } catch (err) {
        logColor('red', `[DISCORD] ❌ Failed to fetch user ${userId}: ${err?.message || err}`)
      }
    }
  }
  ComfyJS.Say(`[DISCORD] ${message.author.username}: ${content}`)
})

// ============================================================
// Authenticates and starts the Discord client
// ============================================================
discordClient.login(discord.botToken).catch(err => {
  logColor('red', `[DISCORD] ❌ Login failed: ${err && err.message ? err.message : err}`)
})

// ============================================================
// Graceful Shutdown Handler
// Ensures all external connections close cleanly
// ============================================================
process.on('SIGINT', async () => {
  logColor('yellow', '[SYSTEM] ⚠️ Shutdown signal received')

  try {
    await twitchChatClient.disconnect()
    logColor('green', '[SYSTEM] ✅ Twitch disconnected')
  } catch {}

  try {
    await discordClient.destroy()
    logColor('green', '[SYSTEM] ✅ Discord disconnected')
  } catch {}

  try { kickChat.stop() } catch {}

  logColor('yellow', '[SYSTEM] ✅ Shutdown complete')
  process.exit(0)
})
