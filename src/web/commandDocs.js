/**
 * commandDocs.js
 *
 * Human-readable documentation for every built-in command.
 *
 * Entries are grouped by primary name with aliases folded in, so the page shows
 * one row per feature instead of six rows for six spellings of the same thing.
 * A test cross-checks this against the live command list, so a command added
 * without docs (or docs for a command that no longer exists) fails the build.
 */

/** @typedef {'all'|'mods'|'broadcaster'} Perm */

const CUSTOM_BUILT = 'Custom Built-in'

const CATEGORIES = [
  'Points & Economy',
  'Games',
  'Sounds & Overlay',
  'Music',
  'Stream Info',
  'Fun',
  CUSTOM_BUILT,
  'Command Management',
  'Admin'
]

/** Shown under the heading on the commands page. */
const CATEGORY_NOTES = {
  [CUSTOM_BUILT]: 'Built for this channel specifically rather than shipped with the bot. They switch on and off exactly like any other built-in command.'
}

/** @type {Array<{name:string, aliases?:string[], cat:string, usage:string, desc:string, perm:Perm}>} */
const DOCS = [
  // ---- Points & Economy ----
  {
    name: 'points', aliases: ['balance'], cat: 'Points & Economy',
    usage: '!points [user]',
    desc: 'Shows your balance, or someone else\'s if you name them. The currency can be renamed, and the new name also works as its own command — rename it to "Coins" and !coins does the same thing.',
    perm: 'all'
  },
  {
    name: 'leaderboard', aliases: ['top'], cat: 'Points & Economy',
    usage: '!leaderboard',
    desc: 'The richest chatters. The full list lives on the leaderboard page.',
    perm: 'all'
  },
  {
    name: 'redeemvip', cat: 'Points & Economy',
    usage: '!redeemvip',
    desc: 'Spends 100,000 to make you a VIP. The points only leave your balance once Twitch confirms the VIP was granted — if it fails, you keep them.',
    perm: 'all'
  },
  {
    name: 'givepoints', cat: 'Points & Economy',
    usage: '!givepoints <user> <amount>',
    desc: 'Adds to someone\'s balance out of thin air.',
    perm: 'mods'
  },
  {
    name: 'removepoints', cat: 'Points & Economy',
    usage: '!removepoints <user> <amount>',
    desc: 'Takes points off someone\'s balance. Stops at zero rather than going negative.',
    perm: 'mods'
  },
  {
    name: 'setpoints', cat: 'Points & Economy',
    usage: '!setpoints <user> <amount>',
    desc: 'Sets a balance to an exact number, ignoring whatever was there before.',
    perm: 'mods'
  },
  {
    name: 'setpointsname', cat: 'Points & Economy',
    usage: '!setpointsname <name>',
    desc: 'Renames the currency. The name also becomes a command alias for !points automatically.',
    perm: 'mods'
  },

  // ---- Games ----
  {
    name: 'slots', cat: 'Games',
    usage: '!slots <amount>',
    desc: 'Spins three reels for the amount you bet. Three matching emotes pays 10x, a pair pays 2x, anything else loses the bet. Accepts a number, a percentage, or "all".',
    perm: 'all'
  },
  {
    name: 'gamble', cat: 'Games',
    usage: '!gamble <amount>',
    desc: 'A coin flip. Win and your bet doubles, lose and it\'s gone. Accepts a number, a percentage, or "all".',
    perm: 'all'
  },
  {
    name: 'duel', cat: 'Games',
    usage: '!duel <user> <amount>',
    desc: 'Challenges someone to a winner-takes-all duel. They have to accept before anything moves, and both balances are checked again at that moment.',
    perm: 'all'
  },
  {
    name: 'accept', cat: 'Games',
    usage: '!accept',
    desc: 'Accepts a duel someone sent you.',
    perm: 'all'
  },
  {
    name: 'deny', cat: 'Games',
    usage: '!deny',
    desc: 'Declines a duel someone sent you.',
    perm: 'all'
  },
  {
    name: 'join', cat: 'Games',
    usage: '!join',
    desc: 'Enters the raffle that is currently open. Entries are silent so a busy raffle does not flood chat.',
    perm: 'all'
  },
  {
    name: 'raffle', cat: 'Games',
    usage: '!raffle [pot]',
    desc: 'Opens a raffle for 60 seconds. More entrants means more winners — up to five — and the pot is split between them.',
    perm: 'mods'
  },
  {
    name: 'sraffle', cat: 'Games',
    usage: '!sraffle [pot]',
    desc: 'Same as !raffle, but exactly one winner takes the whole pot no matter how many people enter.',
    perm: 'mods'
  },

  // ---- Sounds & Overlay ----
  {
    name: 'playsound', cat: 'Sounds & Overlay',
    usage: '!playsound <name>',
    desc: 'Plays a sound on the overlay. Every sound also works as its own command, so !playsound bruh and !bruh do the same thing. One minute of cooldown per person.',
    perm: 'all'
  },
  {
    name: 'playsoundlist',
    aliases: ['sound', 'sounds', 'soundlist', 'soundboard', 'soundclips'],
    cat: 'Sounds & Overlay',
    usage: '!playsoundlist',
    desc: 'Lists every sound you can play. The sounds page has the full browsable list.',
    perm: 'all'
  },
  {
    name: 'showemote', cat: 'Sounds & Overlay',
    usage: '!showemote <emote>',
    desc: 'Pops an emote onto the stream in a random spot. Works with Twitch, 7TV, BTTV and FFZ emotes.',
    perm: 'all'
  },
  {
    name: 'soundvol', cat: 'Sounds & Overlay',
    usage: '!soundvol [0-100]',
    desc: 'Sets how loud sounds play on the overlay. Without a number it just reports the current level.',
    perm: 'broadcaster'
  },

  // ---- Music ----
  {
    name: 'sr', cat: 'Music',
    usage: '!sr <url or song name>',
    desc: 'Requests a song. Takes a YouTube link, or plain words — it searches YouTube and queues the first result.',
    perm: 'all'
  },
  {
    name: 'song', cat: 'Music',
    usage: '!song',
    desc: 'Shows what is playing right now and who requested it.',
    perm: 'all'
  },
  {
    name: 'skip', cat: 'Music',
    usage: '!skip',
    desc: 'Skips the current song. Shared cooldown so it cannot be spammed.',
    perm: 'all'
  },
  {
    name: 'playlist', cat: 'Music',
    usage: '!playlist',
    desc: 'Links the backup playlist that plays when nobody has requested anything.',
    perm: 'all'
  },

  // ---- Stream Info ----
  {
    name: 'game', aliases: ['category'], cat: 'Stream Info',
    usage: '!game',
    desc: 'The category the stream is currently set to.',
    perm: 'all'
  },
  {
    name: 'title', cat: 'Stream Info',
    usage: '!title',
    desc: 'The current stream title.',
    perm: 'all'
  },
  {
    name: 'time', cat: 'Stream Info',
    usage: '!time',
    desc: 'The streamer\'s local time. The wording is editable from the dashboard.',
    perm: 'all'
  },
  {
    name: 'so', cat: 'Stream Info',
    usage: '!so <user>',
    desc: 'Posts a shoutout announcement for another streamer, including what they last played.',
    perm: 'all'
  },
  {
    name: 'commands', aliases: ['commandlist', 'help'], cat: 'Stream Info',
    usage: '!commands',
    desc: 'Links this page, where every command is listed in full.',
    perm: 'all'
  },
  {
    name: 'ping', cat: 'Stream Info',
    usage: '!ping',
    desc: 'Confirms the bot is alive and says how long it has been running.',
    perm: 'all'
  },
  {
    name: 'pingme', cat: 'Stream Info',
    usage: '!pingme',
    desc: 'Toggles whether you get pinged when the title changes or the stream goes live.',
    perm: 'all'
  },
  {
    name: 'videos', cat: 'Stream Info',
    usage: '!videos',
    desc: 'Where to submit videos for the streamer to watch.',
    perm: 'all'
  },

  // ---- Fun ----
  {
    name: 'vanish', cat: 'Fun',
    usage: '!vanish',
    desc: 'Times you out for one second, which clears your messages from chat.',
    perm: 'all'
  },
  {
    name: 'tuck', cat: 'Fun',
    usage: '!tuck <user>',
    desc: 'Tucks someone into bed.',
    perm: 'all'
  },
  {
    name: 'lurk', cat: 'Fun',
    usage: '!lurk',
    desc: 'Announces that you are going into lurk mode.',
    perm: 'all'
  },
  {
    name: 'unlurk', cat: 'Fun',
    usage: '!unlurk',
    desc: 'Announces that you are back.',
    perm: 'all'
  },
  // ---- Custom Built-in ----
  // Written for this channel rather than shipped with the bot. Kept in their own
  // category so a public build can drop them without touching anything else.
  {
    name: 'cannon', cat: CUSTOM_BUILT,
    usage: '!cannon',
    desc: 'Docks ten cannon stacks and reports the running total, which is deeply negative. Typing "-10" on its own does the same thing.',
    perm: 'all'
  },
  {
    name: 'rank', cat: CUSTOM_BUILT,
    usage: '!rank [Name#Tag]',
    desc: 'League of Legends solo queue rank. Shows streamer accounts if no name given.',
    perm: 'all'
  },
  {
    name: 'wither', cat: CUSTOM_BUILT,
    usage: '!wither <user>',
    desc: 'Times someone out for a minute, stacking longer each time you get them. Five minute cooldown per person.',
    perm: 'all'
  },

  // ---- Command Management ----
  {
    name: 'addcommand', cat: 'Command Management',
    usage: '!addcommand <name> <response>',
    desc: 'Creates a custom command. Names that clash with a built-in, a sound, or the currency alias are refused.',
    perm: 'mods'
  },
  {
    name: 'changecommand', cat: 'Command Management',
    usage: '!changecommand <name> <response>',
    desc: 'Rewrites what an existing custom command says.',
    perm: 'mods'
  },
  {
    name: 'deletecommand', cat: 'Command Management',
    usage: '!deletecommand <name>',
    desc: 'Deletes a custom command for good.',
    perm: 'mods'
  },
  {
    name: 'disablecommand', cat: 'Command Management',
    usage: '!disablecommand <name>',
    desc: 'Turns off a built-in command. It then behaves as if it never existed — no reply at all. The three toggle commands themselves cannot be disabled.',
    perm: 'mods'
  },
  {
    name: 'enablecommand', cat: 'Command Management',
    usage: '!enablecommand <name>',
    desc: 'Turns a disabled command back on.',
    perm: 'mods'
  },
  {
    name: 'disabledcommands', cat: 'Command Management',
    usage: '!disabledcommands',
    desc: 'Lists everything currently switched off.',
    perm: 'all'
  },

  // ---- Admin ----
  {
    name: 'modules', cat: 'Admin',
    usage: '!modules',
    desc: 'Shows which feature modules are on or off.',
    perm: 'all'
  },
  {
    name: 'module', cat: 'Admin',
    usage: '!module <enable|disable> <name>',
    desc: 'Switches a whole feature module on or off — slots, gamble, duel, raffle, accrual, emotes, pyramids or sounds.',
    perm: 'mods'
  },
  {
    name: 'obsreconnect', cat: 'Admin',
    usage: '!obsreconnect',
    desc: 'Reconnects the bot to OBS.',
    perm: 'broadcaster'
  },
  {
    name: 'obsstatus', cat: 'Admin',
    usage: '!obsstatus',
    desc: 'Reports the OBS connection state.',
    perm: 'broadcaster'
  }
]

/** Automatic features that have no command to type. */
const PASSIVE = [
  {
    title: 'Points for chatting',
    desc: 'Anyone who has spoken in the last 15 minutes is paid automatically every 5 minutes. Lurking silently does not earn anything — say something and you are in.'
  },
  {
    title: 'Emote streaks',
    desc: 'When people post the same single emote over and over, the overlay shows a running counter from 2 upwards. Once the streak breaks, the bot posts the final count in chat.'
  },
  {
    title: 'Emote pyramids',
    desc: 'Build a pyramid out of one emote and the bot notices. Small ones get mocked, big ones get genuine respect.'
  },
  {
    title: 'Sound commands',
    desc: 'Every file in the sounds folder becomes its own command automatically. Drop a file in and it works within about ten seconds — no restart needed.'
  }
]

/** Every name this file documents, primaries and aliases together. */
function documentedNames() {
  const names = []
  for (const entry of DOCS) {
    names.push(entry.name, ...(entry.aliases || []))
  }
  return names
}

/** Docs grouped into display order, skipping categories with nothing in them. */
function byCategory() {
  return CATEGORIES
    .map(cat => ({ cat, entries: DOCS.filter(d => d.cat === cat), note: CATEGORY_NOTES[cat] || '' }))
    .filter(group => group.entries.length > 0)
}

/** Channel-specific command names, aliases included. */
function customBuiltNames() {
  const names = []
  for (const entry of DOCS) {
    if (entry.cat !== CUSTOM_BUILT) continue
    names.push(entry.name, ...(entry.aliases || []))
  }
  return names
}

module.exports = {
  DOCS, PASSIVE, CATEGORIES, CATEGORY_NOTES, CUSTOM_BUILT,
  documentedNames, byCategory, customBuiltNames
}
