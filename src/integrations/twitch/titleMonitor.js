/**
 * titleMonitor.js
 *
 * Polls Twitch channel info and announces title changes in chat.
 */

const { twitch } = require('../../config/env')
const { getChannelInformation } = require('./twitchAPI')

const TITLE_POLL_INTERVAL_MS = 15_000

function normalizeTitle(title) {
  return typeof title === 'string' ? title.trim() : ''
}

function buildTitleChangeMessage(title, pingUsers) {
  const mentionList = pingUsers.map(user => `@${user}`).join(' ')

  if (!mentionList) {
    return `The stream title was changed: ${title}`
  }

  return `The stream title was changed: ${title} | Pinging: ${mentionList}`
}

function startTitleMonitor({ ComfyJS, botState, logColor, pingList }) {
  if (!ComfyJS) throw new Error('startTitleMonitor requires ComfyJS')
  if (!botState) throw new Error('startTitleMonitor requires botState')
  if (!logColor) throw new Error('startTitleMonitor requires logColor')

  let isChecking = false

  async function checkChannelTitle() {
    if (isChecking) return
    isChecking = true

    try {
      const channelInfo = await getChannelInformation(twitch.channelUserId)
      const currentTitle = normalizeTitle(channelInfo?.title)

      if (!currentTitle) return

      if (!botState.lastKnownStreamTitle) {
        botState.lastKnownStreamTitle = currentTitle
        logColor('cyan', `[TWITCH] Title monitor initialized with title: ${currentTitle}`)
        return
      }

      if (botState.lastKnownStreamTitle === currentTitle) return

      botState.lastKnownStreamTitle = currentTitle

      const message = buildTitleChangeMessage(currentTitle, pingList.getAll())
      ComfyJS.Say(message)
      logColor('green', `[TWITCH] Title change announced: ${currentTitle}`)
    } catch (error) {
      logColor('red', `[TWITCH] Title monitor error: ${error?.message || error}`)
    } finally {
      isChecking = false
    }
  }

  checkChannelTitle()
  return setInterval(checkChannelTitle, TITLE_POLL_INTERVAL_MS)
}

module.exports = Object.freeze({
  startTitleMonitor
})
