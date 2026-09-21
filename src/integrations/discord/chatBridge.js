const { logColor } = require('../../utils/logger')
const { twitch, discord } = require('../../config/env')
const chatBus = require('../twitch/chatBus')
const { getToken } = require('../twitch/twitchAPI')

const avatarCache = new Map()
const AVATAR_TTL = 60 * 60 * 1000
const KICK_AVATAR = 'https://kick.com/img/kick-logo.svg'

let webhook = null
let unsubscribe = null

async function fetchTwitchAvatar(username) {
  const key = username.toLowerCase()
  const cached = avatarCache.get(key)
  if (cached && Date.now() - cached.ts < AVATAR_TTL) return cached.url

  try {
    const token = await getToken('app')
    if (!token) return null

    const res = await fetch(`${twitch.APIEndpoint}/users?login=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': twitch.botClientId }
    })
    if (!res.ok) return null

    const data = await res.json()
    const url = data.data?.[0]?.profile_image_url || null
    if (url) avatarCache.set(key, { url, ts: Date.now() })
    return url
  } catch {
    return null
  }
}

async function start(discordClient) {
  if (!discord.communicationChannelId) return

  const channel = await discordClient.channels.fetch(discord.communicationChannelId).catch(() => null)
  if (!channel) {
    logColor('yellow', '[DISCORD] Chat bridge channel not found — bridge disabled')
    return
  }

  try {
    const hooks = await channel.fetchWebhooks()
    webhook = hooks.find(h => h.owner?.id === discordClient.user.id)
    if (!webhook) {
      webhook = await channel.createWebhook({ name: 'StreamerStalker Chat' })
    }
    logColor('green', '[DISCORD] Chat bridge webhook ready')
  } catch (err) {
    logColor('yellow', `[DISCORD] Cannot manage webhooks — grant the bot "Manage Webhooks" permission. Bridge disabled. (${err.message})`)
    return
  }

  // Discord → Twitch + Kick
  discordClient.on('messageCreate', async (message) => {
    if (message.channelId !== discord.communicationChannelId) return
    if (message.author.bot || message.webhookId) return

    let content = message.content
    if (!content) return

    const mentions = content.match(/<@!?(\d+)>/g)
    if (mentions) {
      for (const mention of mentions) {
        const userId = mention.match(/\d+/)[0]
        try {
          const user = await discordClient.users.fetch(userId)
          content = content.replace(mention, `@${user.username}`)
        } catch {}
      }
    }

    const text = `[Discord] ${message.author.displayName}: ${content}`
    chatBus.say(text)
    chatBus.kickSay(text)
  })

  // Twitch / Kick → Discord (via webhook for per-user avatars)
  const botName = twitch.botUsername.toLowerCase()

  unsubscribe = chatBus.subscribe(async (entry) => {
    if (!webhook) return
    if (entry.platform !== 'twitch' && entry.platform !== 'kick') return
    if (entry.user.toLowerCase() === botName) return

    const platform = entry.platform === 'twitch' ? 'Twitch' : 'Kick'
    const username = `${entry.user} [${platform}]`

    let avatarURL = null
    if (entry.platform === 'twitch') {
      avatarURL = await fetchTwitchAvatar(entry.user)
    } else {
      avatarURL = KICK_AVATAR
    }

    try {
      await webhook.send({
        content: entry.message,
        username,
        avatarURL: avatarURL || undefined
      })
    } catch (err) {
      logColor('red', `[DISCORD] Bridge send failed: ${err.message}`)
    }
  })

  logColor('green', '[DISCORD] Chat bridge active (Twitch + Kick ↔ Discord)')
}

function stop() {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}

module.exports = { start, stop }
