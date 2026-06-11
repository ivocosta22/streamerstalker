/**
 * obsController.js
 *
 * OBS WebSocket controller responsible for:
 *
 * - Managing OBS WebSocket connection lifecycle
 * - Automatically reconnecting on connection loss
 * - Loading and managing scene data
 *
 * Functionality:
 *
 * - Controls Camera states (wide / normal)
 * - Updates and animates text sources
 * - Manages microphone mute timers
 *
 * This module encapsulates all OBS-related functionality
 * and exposes a singleton controller instance.
 */
const OBSWebSocket = require('obs-websocket-js').default
const { obs: obsConfig } = require('../../config/env')
const { logColor } = require('../../utils/logger')

// ============================================================
// OBS Controller Class
// Manages connection state and OBS operations
// ============================================================
class OBSController {
  constructor() {
    // OBS WebSocket client instance
    this.obs = new OBSWebSocket()

    // Connection state flags
    this.connected = false
    this.connecting = false

    // Interval / timer handles
    this.reconnectInterval = null
    this.timerUpdateInterval = null

    // Cached scene list
    this.OBS_SCENES = []

    // Camera configuration
    this.WIDE_CAM_SCALE_THRESHOLD = 1.2

    // Automatic revert delay for wide camera (from env, with safe fallback)
    this.REVERT_DELAY_MS = Number(obsConfig.revertDelayMs) || 10 * 60 * 1000

    this.isWideCamActive = false
    this.revertTimeout = null
    this.micMuteTimeout = null
    this.witherSlideTimeout = null

    // Handle unexpected connection loss
    this.obs.on('ConnectionClosed', () => {
      this.connected = false
      logColor('red', '[OBS] ❌ OBS connection lost')
    })
  }

  /**
   * Establishes connection to OBS WebSocket server.
   *
   * Prevents duplicate connections and loads scene data.
   *
   * @param {(message: string) => void} [callback]
   */
  async connect(callback) {
    if (this.connected) {
      callback?.('OBS is already connected.')
      return
    }

    if (this.connecting) {
      callback?.('OBS is currently connecting...')
      return
    }

    this.connecting = true

    try {
      await this.obs.connect(obsConfig.url, obsConfig.password)

      this.connected = true
      await this.loadScenes()

      logColor('green', '[OBS] ✅ Connected to OBS WebSocket')
      callback?.('OBS successfully reconnected!')
    } catch (err) {
      this.connected = false
      logColor('red', `[OBS] ❌ Failed to connect: ${err?.message || err}`)
      callback?.(`OBS failed to connect: ${err?.message || err}`)
    } finally {
      this.connecting = false
    }
  }

  getStatus() {
    if (this.connected) return '🟢 OBS is connected'
    if (this.connecting) return '🟡 OBS is currently connecting...'
    return '🔴 OBS is not connected'
  }

  isConnected() {
    return this.connected
  }

  /**
   * Starts automatic reconnect loop.
   *
   * Attempts reconnection at specified interval if disconnected.
   *
   * @param {number} intervalMs
   */
  startAutoReconnect(intervalMs) {
    if (this.reconnectInterval) return

    this.reconnectInterval = setInterval(async () => {
      if (!this.connected && !this.connecting) {
        logColor('yellow', '[OBS] 🔄 Attempting auto-reconnect...')
        await this.connect()
      }
    }, intervalMs)
  }

  /**
   * Stops auto-reconnect interval (useful during shutdown/tests)
   */
  stopAutoReconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval)
      this.reconnectInterval = null
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Loads all available scenes from OBS.
   *
   * Caches scene names for later operations.
   */
  async loadScenes() {
    if (!this.connected) return

    try {
      const { scenes } = await this.obs.call('GetSceneList')
      this.OBS_SCENES = scenes.map(scene => scene.sceneName)
      logColor('green', `[OBS] ✅ Loaded ${this.OBS_SCENES.length} scenes dynamically`)
    } catch (err) {
      logColor('red', `[OBS] ❌ Failed to load scenes: ${err?.message || err}`)
    }
  }

  async getSceneItem(sceneName, sourceName) {
    const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName })
    return sceneItems.find(item => item.sourceName === sourceName)
  }

  // ============================================================
  // Wither - Custom GDI text control after command execution
  // ============================================================
  async setWitherText(text, sourceName = 'WitherText') {
    if (!this.connected) return

    try {
      await this.obs.call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: { text }
      })

      logColor('cyan', `[OBS] ✏️ Wither text updated`)
    } catch (err) {
      logColor('red', `[OBS] Failed to update wither text: ${err?.message || err}`)
    }
  }

  /**
   * Animates WitherText source sliding in and out across all scenes.
   *
   * Updates text content, makes source visible,
   * performs slide animation, then hides source.
   *
   * @param {string} text
   * @param {string} [sourceName]
   */
  async slideWitherTextInAllScenes(text, sourceName = 'WitherText') {
    if (!this.connected) return

    const START_Y = -300 // Start off-screen
    const FINAL_Y = 89.7353 // Final Y position
    const X = 1280 // Fixed X position
    const STEP = 20 // Pixels per frame
    const INTERVAL = 16 // ms per frame (~60fps)
    const DISPLAY_DURATION = 5000 // 5 seconds visible

    // Update text first
    await this.setWitherText(text, sourceName)

    for (const sceneName of this.OBS_SCENES) {
      try {
        const item = await this.getSceneItem(sceneName, sourceName)
        if (!item) continue

        // Ensure the source is visible
        await this.obs.call('SetSceneItemEnabled', {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: true
        })

        // Get current transform (use as base for animation)
        const { sceneItemTransform } = await this.obs.call('GetSceneItemTransform', {
          sceneName,
          sceneItemId: item.sceneItemId
        })

        let currentY = START_Y

        // slide in
        const slideIn = async () => {
          currentY += STEP
          if (currentY > FINAL_Y) currentY = FINAL_Y

          const newTransform = { ...sceneItemTransform, positionX: X, positionY: currentY }
          await this.obs.call('SetSceneItemTransform', {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemTransform: newTransform
          })

          if (currentY < FINAL_Y) {
            setTimeout(() => slideIn(), INTERVAL)
          } else {
            setTimeout(() => slideOut(), DISPLAY_DURATION)
          }
        }

        const slideOut = async () => {
          currentY = FINAL_Y
          const slideStep = 20

          const animateOut = async () => {
            currentY -= slideStep
            if (currentY < START_Y) currentY = START_Y

            const newTransform = { ...sceneItemTransform, positionX: X, positionY: currentY }
            await this.obs.call('SetSceneItemTransform', {
              sceneName,
              sceneItemId: item.sceneItemId,
              sceneItemTransform: newTransform
            })

            if (currentY > START_Y) {
              setTimeout(() => animateOut(), INTERVAL)
            } else {
              // Hide after moving out
              await this.obs.call('SetSceneItemEnabled', {
                sceneName,
                sceneItemId: item.sceneItemId,
                sceneItemEnabled: false
              })
            }
          }

          animateOut()
        }

        // Start the animation
        slideIn()
      } catch (err) {
        logColor('red', `[OBS] Failed sliding wither text in scene "${sceneName}": ${err?.message || err}`)
      }
    }
  }

  async setSourceVisibility(sourceName, enabled) {
    if (!this.connected) {
      logColor('yellow', `[OBS] ⚠️ Cannot set "${sourceName}" visibility — not connected`)
      return
    }
    if (this.OBS_SCENES.length === 0) {
      logColor('yellow', `[OBS] ⚠️ Cannot set "${sourceName}" visibility — no scenes loaded`)
      return
    }
    let found = false
    for (const sceneName of this.OBS_SCENES) {
      try {
        const item = await this.getSceneItem(sceneName, sourceName)
        if (!item) continue
        found = true
        await this.obs.call('SetSceneItemEnabled', {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: enabled
        })
      } catch (err) {
        logColor('red', `[OBS] Failed to set "${sourceName}" visibility in "${sceneName}": ${err?.message || err}`)
      }
    }
    if (!found) {
      logColor('yellow', `[OBS] ⚠️ Source "${sourceName}" not found in any scene`)
    }
  }

  // ============================================================
  // Camera Control
  // ============================================================
  async getCameraItems(sceneName) {
    const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName })
    return sceneItems.filter(item => item.sourceName === 'Camera')
  }

  async isWideCamera(sceneName, sceneItemId) {
    const { sceneItemTransform } = await this.obs.call('GetSceneItemTransform', {
      sceneName,
      sceneItemId
    })

    return (
      sceneItemTransform.scaleX > this.WIDE_CAM_SCALE_THRESHOLD ||
      sceneItemTransform.scaleY > this.WIDE_CAM_SCALE_THRESHOLD
    )
  }

  async switchCamera(sceneName, enableWide) {
    const cameraItems = await this.getCameraItems(sceneName)

    for (const item of cameraItems) {
      const wide = await this.isWideCamera(sceneName, item.sceneItemId)

      await this.obs.call('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: enableWide ? wide : !wide
      })
    }
  }

  /**
   * Activates wide camera across all scenes.
   *
   * Automatically reverts after configured delay.
   */
  async activateWideCam() {
    if (this.isWideCamActive) {
      logColor('yellow', '[OBS] ⚠️ Wide cam already active')
      return
    }

    this.isWideCamActive = true

    for (const scene of this.OBS_SCENES) {
      await this.switchCamera(scene, true)
    }

    logColor('cyan', '[OBS] 📸 Wide camera activated')

    if (this.revertTimeout) clearTimeout(this.revertTimeout)
    this.revertTimeout = setTimeout(() => this.revertToNormalCam(), this.REVERT_DELAY_MS)
  }

  /**
   * Restores normal camera state across all scenes.
   */
  async revertToNormalCam() {
    for (const scene of this.OBS_SCENES) {
      await this.switchCamera(scene, false)
    }

    this.isWideCamActive = false
    this.revertTimeout = null

    logColor('cyan', '[OBS] 🔄 Reverted to normal camera')
  }

  // ============================================================
  // Microphone Control
  // ============================================================
  /**
   * Mutes microphone for specified duration.
   *
   * Displays countdown timer in OBS scenes
   * and automatically unmutes when timer expires.
   *
   * @param {number} durationMs
   * @param {string} [timerSourceName]
   */
  async muteMicForDuration(durationMs, timerSourceName = 'MicTimer') {
    if (!this.obs) return

    try {
      await this.obs.call('SetInputMute', {
        inputName: 'Mic/Aux',
        inputMuted: true
      })

      logColor('yellow', '[OBS] 🎙️ Mic muted')

      const endTime = Date.now() + durationMs
      for (const scene of this.OBS_SCENES) {
        try {
          const item = await this.getSceneItem(scene, timerSourceName)
          if (item) {
            await this.obs.call('SetSceneItemEnabled', {
              sceneName: scene,
              sceneItemId: item.sceneItemId,
              sceneItemEnabled: true
            })
          }
        } catch {}
      }

      if (this.micMuteTimeout) clearTimeout(this.micMuteTimeout)
      if (this.timerUpdateInterval) clearInterval(this.timerUpdateInterval)

      // Update timer text every second
      this.timerUpdateInterval = setInterval(async () => {
        const remainingMs = endTime - Date.now()
        if (remainingMs <= 0) {
          // Stop updates when time elapsed (will be handled by micMuteTimeout)
          clearInterval(this.timerUpdateInterval)
          this.timerUpdateInterval = null
          return
        }

        const minutes = Math.floor(remainingMs / 60000)
        const seconds = Math.floor((remainingMs % 60000) / 1000)
        const text = `Streamer is muted:\n${minutes.toString().padStart(2, '0')}:${seconds
          .toString()
          .padStart(2, '0')}`

        for (const scene of this.OBS_SCENES) {
          try {
            const item = await this.getSceneItem(scene, timerSourceName)
            if (item) {
              await this.obs.call('SetInputSettings', {
                inputName: timerSourceName,
                inputSettings: { text }
              })
            }
          } catch {}
        }
      }, 1000)

      // Timer to unmute mic and hide timer
      this.micMuteTimeout = setTimeout(async () => {
        try {
          // Stop updating timer
          if (this.timerUpdateInterval) clearInterval(this.timerUpdateInterval)
          this.timerUpdateInterval = null

          // Unmute mic
          await this.obs.call('SetInputMute', {
            inputName: 'Mic/Aux',
            inputMuted: false
          })
          logColor('green', '[OBS] 🎙️ Mic unmuted')

          // Hide timer source
          for (const scene of this.OBS_SCENES) {
            try {
              const item = await this.getSceneItem(scene, timerSourceName)
              if (item) {
                await this.obs.call('SetSceneItemEnabled', {
                  sceneName: scene,
                  sceneItemId: item.sceneItemId,
                  sceneItemEnabled: false
                })
              }
            } catch {}
          }

          this.micMuteTimeout = null
        } catch (err) {
          logColor('red', `[OBS] Failed to unmute mic: ${err?.message || err}`)
        }
      }, durationMs)
    } catch (err) {
      logColor('red', `[OBS] Failed to mute mic: ${err?.message || err}`)
    }
  }
}

module.exports = new OBSController()