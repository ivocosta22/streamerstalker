/**
 * register-commands.js
 *
 * Registers Discord slash commands for the bot.
 *
 * This script deploys guild-specific slash commands using Discord REST API.
 *
 * Usage:
 *   node src/integrations/discord/register-commands.js
 *
 * Notes:
 * - Guild commands update instantly
 * - Global commands may take up to 1 hour
 *
 * This script should be run manually when commands change.
 */

require('dotenv').config()
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js')
const { discord } = require('../../config/env')

const commands = [
    {
        name: 'ping',
        description: 'Ping to check if ded or not',
    },
    {
        name: 'say',
        description: 'Send a message to a specified channel',
        options: [
            {
                name: 'channel',
                description: 'Channel to send the message to',
                type: ApplicationCommandOptionType.Channel,
                required: true,
            },
            {
                name: 'message',
                description: 'Message content',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ]
    },
    {
        name: 'coinflip',
        description: 'Flip a coin (heads or tails)',
    },
]

async function registerCommands() {

  if (!discord.botToken || !discord.botId || !discord.serverId) {
    throw new Error('Missing Discord configuration values')
  }

  const rest = new REST({ version: '10' })
  rest.setToken(discord.botToken)

  try {

    console.log('Registering slash commands...')

    await rest.put(
      Routes.applicationGuildCommands(
        discord.botId,
        discord.serverId
      ),
      { body: commands }
    )

    console.log('Slash commands registered successfully')

  } catch (error) {

    console.error(`Failed to register slash commands: ${error.message}`)
    process.exit(1)

  }
}

registerCommands()
