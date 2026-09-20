const { twitch } = require('../../config/env')
const { timeoutCommand } = require('./twitchCommands')
const songRequestClient = require('../player/songRequestClient')
const rewardStore = require('./rewardStore')

function registerTwitchRewards({ ComfyJS, botState, obsController, logColor }) {
  if (!ComfyJS) throw new Error('registerTwitchRewards requires ComfyJS')
  if (!botState) throw new Error('registerTwitchRewards requires botState')
  if (!obsController) throw new Error('registerTwitchRewards requires obsController')
  if (!logColor) throw new Error('registerTwitchRewards requires logColor')

  const rewardCommandContext = Object.freeze({
    obsController,
    twitchChannelUserID: twitch.channelUserId,
    twitchBotUserID: twitch.botUserId,
    twitchBotAPIClientID: twitch.botClientId,
    botState,
    logColor
  })

  ComfyJS.onChat = async (user, message, flags, self, extra) => {
    if (self) return

    const rewardId = extra?.customRewardId
    if (!flags?.customReward || !rewardId) return

    const reward = rewardStore.findByRewardId(rewardId)
    if (!reward) return

    try {
      logColor('yellow', `[TWITCH] ⚠️ Channel Points Reward: ${reward.name} from ${user}`)

      if (reward.action === 'songRequest') {
        const { result, title, position } = await songRequestClient.enqueue(message?.trim(), user)
        if (result === 'queued') {
          const pos = position ? `at position #${position}` : 'to the queue'
          ComfyJS.Say(`@${user} added "${title}" ${pos} - ${message?.trim()}`)
        } else if (result === 'invalid_url') {
          ComfyJS.Say(`@${user} that doesn't look like a valid YouTube link. Please redeem again with a YouTube URL.`)
        } else if (result === 'requests_disabled') {
          ComfyJS.Say(`@${user} song requests are currently disabled. Try again later!`)
        } else {
          ComfyJS.Say(`@${user} the song request player isn't running right now. Please try again later!`)
        }
        return
      }

      if (reward.action === 'timeout') {
        if (!message?.trim()) return
        rewardCommandContext.botState.commandCaller = user
        await timeoutCommand(rewardCommandContext, message)
        return
      }

      if (reward.action === 'wideCam') {
        await obsController.activateWideCam()
        return
      }

      if (reward.action === 'mute') {
        const minutes = reward.params?.durationMinutes || 5
        await obsController.muteMicForDuration(minutes * 60 * 1000)
        return
      }

    } catch (error) {
      logColor('red', `[TWITCH] ❌ Channel Points Reward error: ${error?.message || error}`)
    }
  }
}

module.exports = Object.freeze({ registerTwitchRewards })
