# StreamerStalker Deployment Guide

**The DEPLOYMENT file below was made with the assistance of AI.**

This document explains how to set up your own instance of **StreamerStalker** from scratch — the Twitch/Discord bot plus the Electron-based song request player.

It is intentionally exhaustive. Read whichever sections apply to you and skip the rest.

---

## Table of Contents

1. [What is StreamerStalker?](#what-is-streamerstalker)
2. [Repository layout](#repository-layout)
3. [System requirements](#system-requirements)
4. [Prerequisites — accounts and external services](#prerequisites--accounts-and-external-services)
5. [Step-by-step setup](#step-by-step-setup)
   - [Windows](#windows)
   - [Linux (Ubuntu/Debian)](#linux-ubuntudebian)
   - [macOS](#macos)
   - [Raspberry Pi](#raspberry-pi)
6. [Configuring the `.env` file](#configuring-the-env-file)
7. [First-time Twitch OAuth authorization](#first-time-twitch-oauth-authorization)
8. [Discord setup](#discord-setup)
9. [OBS setup](#obs-setup)
10. [Running the bot](#running-the-bot)
11. [The song request player](#the-song-request-player)
12. [Configuration files you can edit](#configuration-files-you-can-edit)
13. [Available chat commands](#available-chat-commands)
14. [Channel point rewards](#channel-point-rewards)
15. [Troubleshooting](#troubleshooting)

---

## What is StreamerStalker?

StreamerStalker is a personal Twitch + Discord automation bot built in Node.js. It bundles several pieces that talk to each other:

- **The bot** (`src/`) — a Node.js process that connects to Twitch chat (via [comfy.js](https://github.com/instafluff/ComfyJS) and [tmi.js](https://github.com/tmijs/tmi.js)), Discord (via [discord.js](https://discord.js.org/)), and OBS (via [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js)).
- **The song request player** (`player/`) — an Electron desktop app that opens a YouTube view in a side panel. Viewers request songs with `!sr <YouTube URL>` and they auto-play in order. A backup playlist plays during idle moments.
- **Configuration & state** (`src/config/`, `src/state/`) — environment validation, persistent token storage, chat timers, ping list.

The bot and the player communicate over a local WebSocket (`ws://localhost:9001`), so the player must be running on the same machine as the bot for song requests to work. Everything else (Twitch/Discord/OBS) works fine even if the player is closed.

---

## Repository layout

```
StreamerStalker/
├── src/                          # The Node.js bot
│   ├── app.js                    # Main entry point — wires every integration together
│   ├── server.js                 # Tiny HTTP keepalive server (port from SERVER_PORT)
│   ├── config/
│   │   ├── env.js                # Loads & validates .env
│   │   ├── timers.json           # Chat timer definitions (editable, hot-reloaded)
│   │   ├── pingList.json         # Users who get pinged on title change / go-live
│   │   ├── titleUpdatePingList.js  # Ping list module (read/write API)
│   │   └── tokens/
│   │       └── twitch-user-tokens.json   # Auto-managed OAuth tokens (gitignored)
│   ├── integrations/
│   │   ├── twitch/               # Twitch API, chat commands, rewards, title monitor, timers
│   │   ├── discord/              # Discord slash command registration script
│   │   ├── obs/                  # OBS WebSocket controller
│   │   └── player/               # WebSocket client that talks to the Electron player
│   ├── state/                    # Shared runtime state (cooldowns, bot state)
│   └── utils/                    # Logger
├── player/                       # The Electron song request player
│   ├── main.js                   # Main process (player window + WS server)
│   ├── preload.js                # Electron preload bridge
│   ├── renderer/                 # UI (HTML/CSS/JS) for the player sidebar
│   ├── assets/                   # App icon
│   └── package.json              # Player has its own dependencies & build config
├── .env.example                  # Template — copy to .env and fill in
├── package.json                  # Bot dependencies
└── README.md
```

---

## System requirements

- **Node.js 18+** (Node 20 LTS recommended). The bot uses native `fetch`, which requires Node 18.
- **npm** (bundled with Node).
- **Git** to clone the repo.
- For the player: a machine with a desktop environment (the player is an Electron GUI). Windows, macOS, or Linux with X11/Wayland. **The player will not run headlessly on a Pi without a display.**
- For OBS features: [OBS Studio](https://obsproject.com/) 28+ (which includes obs-websocket v5 built-in).

The bot itself is headless and runs anywhere Node 18+ runs — including a Raspberry Pi. Only the player needs a desktop.

---

## Prerequisites — accounts and external services

Before you run anything, you need:

1. **A Twitch account for the streamer** (the channel the bot moderates).
2. **A separate Twitch account for the bot** (recommended — gives "bot" badge and keeps chat clean).
3. **A registered Twitch application** at [dev.twitch.tv/console](https://dev.twitch.tv/console/apps) to get a Client ID and Client Secret.
4. **A Discord bot application** at [discord.com/developers/applications](https://discord.com/developers/applications) — see [Discord setup](#discord-setup) below.
5. **OBS Studio** with WebSocket enabled (Tools → WebSocket Server Settings), if you want OBS features.
6. *(Optional)* Channel point rewards already created on your Twitch dashboard — you'll paste their UUIDs into `.env`.

---

## Step-by-step setup

### Windows

1. Install [Node.js LTS](https://nodejs.org/) (use the `.msi` installer; it adds Node to your PATH).
2. Install [Git for Windows](https://git-scm.com/download/win).
3. Open **PowerShell** and clone the repo:
   ```powershell
   git clone https://github.com/ivocosta22/streamerstalker.git
   cd streamerstalker
   ```
4. If your PowerShell blocks scripts, run once per session:
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope Process
   ```
5. Install dependencies (bot + player):
   ```powershell
   npm install
   cd player
   npm install
   cd ..
   ```
6. Copy the environment template and fill it in:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   See [Configuring the `.env` file](#configuring-the-env-file).

7. Start the bot:
   ```powershell
   npm start
   ```

8. To start the player (in a separate terminal):
   ```powershell
   cd player
   npm start
   ```

### Linux (Ubuntu/Debian)

1. Install Node.js 20 from NodeSource:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```
2. Clone and install:
   ```bash
   git clone https://github.com/ivocosta22/streamerstalker.git
   cd streamerstalker
   npm install
   cd player && npm install && cd ..
   ```
3. Copy and edit the env file:
   ```bash
   cp .env.example .env
   nano .env
   ```
4. Start the bot:
   ```bash
   npm start
   ```
5. For the player, you need a desktop environment. On a headless server, skip the player and song requests will simply be disabled.

### macOS

1. Install Node via Homebrew:
   ```bash
   brew install node@20 git
   ```
2. Clone and install:
   ```bash
   git clone https://github.com/ivocosta22/streamerstalker.git
   cd streamerstalker
   npm install
   cd player && npm install && cd ..
   ```
3. Copy and edit env:
   ```bash
   cp .env.example .env
   open -e .env
   ```
4. Start the bot:
   ```bash
   npm start
   ```
5. Start the player in a separate terminal:
   ```bash
   cd player
   npm start
   ```

### Raspberry Pi

The Pi can comfortably run the **bot** 24/7. The player is generally not practical on a Pi (Electron + YouTube is heavy and most setups won't have OBS on the same box anyway).

1. Use a 64-bit Pi OS (Bookworm or newer) on a Pi 4/5 with at least 2 GB RAM.
2. Install Node 20:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```
3. Clone and install just the bot:
   ```bash
   git clone https://github.com/ivocosta22/streamerstalker.git
   cd streamerstalker
   npm install
   cp .env.example .env
   nano .env
   ```
4. To keep it running after you log out, use `systemd` (recommended) or `pm2`:

   **systemd** — create `/etc/systemd/system/streamerstalker.service`:
   ```ini
   [Unit]
   Description=StreamerStalker bot
   After=network.target

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/streamerstalker
   ExecStart=/usr/bin/node src/app.js
   Restart=on-failure
   RestartSec=5
   StandardInput=null

   [Install]
   WantedBy=multi-user.target
   ```
   Then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now streamerstalker
   sudo journalctl -u streamerstalker -f
   ```

   Note: `StandardInput=null` is important because the bot has a terminal-input feature (you can type into the running process to send messages to chat). Under systemd it has no terminal, so we explicitly close stdin.

5. **OBS features will not work** unless OBS is reachable from the Pi (you'd need to point `OBS_WS_URL` at the machine actually running OBS, and OBS WebSocket would need to be exposed on the LAN). For most people this means: leave OBS variables filled in but treat OBS errors in the log as non-fatal.

---

## Configuring the `.env` file

The file is loaded once at startup by [src/config/env.js](src/config/env.js). Every variable in the example is required — the bot will crash on launch with a clear error if anything is missing.

Below is each variable, what it does, and where to find the value.

### Twitch — core

| Variable | Description |
|---|---|
| `TWITCH_COMMAND_PREFIX` | The character a chat message must start with to be parsed as a command. Conventional: `!`. |
| `TWITCH_CHANNEL` | The lowercase Twitch login of the streamer's channel. Example: `surferkillerhd`. |
| `TWITCH_CHANNEL_CASE_SENSITIVE` | The display name with original casing. Example: `SurferKillerHD`. Used in announcements/messages. |
| `TWITCH_CHANNEL_USERID` | The numeric Twitch user ID of the streamer. Look it up at [streamweasels.com/tools/convert-twitch-username-to-user-id/](https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/). |
| `TWITCH_BOT_USERNAME` | Lowercase login of the bot account. |
| `TWITCH_BOT_USERID` | Numeric user ID of the bot account. |
| `TWITCH_BOT_OAUTH` | Chat OAuth token for the bot account, with the `oauth:` prefix. Generate via [twitchtokengenerator.com](https://twitchtokengenerator.com/) or [twitchapps.com/tmi](https://twitchapps.com/tmi/). |
| `TWITCH_BOT_API_CLIENTID` | Client ID of your registered Twitch application. |
| `TWITCH_BOT_API_CLIENT_SECRET` | Client Secret of the same application. |
| `TWITCH_BOT_AUTHORIZATION_LINK` | Full Twitch OAuth authorize URL with required scopes. See below. |
| `TWITCH_API_ENDPOINT` | `https://api.twitch.tv/helix` (don't change). |
| `TWITCH_USER_TOKEN_ENDPOINT` | `https://id.twitch.tv/oauth2/token` (don't change). |
| `CHAT_ENABLED` | `true` or `false`. When `false`, the bot still listens but won't send any chat messages — useful for development. |

### Streamer info

| Variable | Description |
|---|---|
| `KICK_CHANNEL_URL` | Full URL of the streamer's Kick channel. Used by the `!kick` command and the go-live Discord announcement. Example: `https://kick.com/yourname`. |
| `STREAMER_TIMEZONE` | IANA timezone string used by the `!time` command. Examples: `Europe/Lisbon`, `America/New_York`, `Asia/Tokyo`. Full list: [IANA tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). |

#### Building `TWITCH_BOT_AUTHORIZATION_LINK`

Use this template, replacing `YOUR_CLIENT_ID`:

```
https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3000&scope=channel:read:redemptions%20moderation:read%20channel:moderate%20user:write:chat%20moderator:manage:banned_users%20moderator:manage:announcements
```

The required scopes are:

- `channel:read:redemptions` — read channel point reward redemptions
- `moderation:read` — read moderation actions
- `channel:moderate` — perform moderator actions
- `user:write:chat` — send chat as the bot
- `moderator:manage:banned_users` — issue timeouts
- `moderator:manage:announcements` — post highlighted announcements (used by raid `!so` and go-live)

In your Twitch app settings, make sure `http://localhost:3000` is added as an OAuth Redirect URL.

### Twitch — channel point rewards

Each `TWITCH_CHANNEL_POINTS_REWARD_*` variable is the **UUID** of an existing channel point reward you created in your Twitch creator dashboard. To find a UUID:

1. Make sure the bot is connected and you have channel point rewards configured.
2. The simplest way: redeem the reward once with the bot running with `[TWITCH] ⚠️ Channel Points Reward` debug logging, and check the log. Alternatively, query the Helix `channel_points/custom_rewards` endpoint.

| Variable | Purpose |
|---|---|
| `TWITCH_CHANNEL_POINTS_REWARD_SONG_REQUEST` | Triggers a song request — the redemption message must be a YouTube URL. |
| `TWITCH_CHANNEL_POINTS_REWARD_TIMEOUT` | Timeout reward — redemption message is the username to time out. |
| `TWITCH_CHANNEL_POINTS_REWARD_WIDE_CAM` | Activates the OBS "wide cam" preset for a configurable duration. |
| `TWITCH_CHANNEL_POINTS_REWARD_MUTE_5MIN` | Mutes the streamer's mic for 5 minutes (with countdown overlay). |
| `TWITCH_CHANNEL_POINTS_REWARD_MUTE_10MIN` | Same but for 10 minutes. |

If you don't have all these rewards, you can still set the variables to any UUID — the bot will just never match them. But each variable **must be present**, or `env.js` will refuse to start.

### Discord

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from the Discord developer portal. |
| `DISCORD_BOT_ID` | Application ID of your Discord bot. |
| `DISCORD_SERVER_ID` | The Discord server (guild) ID where slash commands are registered. |
| `DISCORD_TWITCH_CHANNEL_COMMUNICATION_ID` | Channel ID in that server. Messages posted there are bridged into Twitch chat. |
| `DISCORD_GO_LIVE_CHANNEL_ID` | Channel ID where the go-live `@everyone` announcement is posted when the stream starts. |

### OBS

| Variable | Description |
|---|---|
| `OBS_WS_URL` | WebSocket URL. Default for local OBS: `ws://127.0.0.1:4455`. |
| `OBS_WS_PASSWORD` | Password set in OBS → Tools → WebSocket Server Settings. |
| `OBS_AUTO_RECONNECT_TIME` | Milliseconds between reconnect attempts. `300000` = 5 minutes. |
| `OBS_REVERT_DELAY_MS` | How long the wide-cam reward stays active before reverting. `600000` = 10 minutes. |

### Server

| Variable | Description |
|---|---|
| `SERVER_PORT` | Port for the tiny HTTP keepalive server. `3000` is fine. Also used as the Twitch OAuth `redirect_uri`. |

---

## First-time Twitch OAuth authorization

The bot stores its Twitch **user** tokens (for sending announcements, issuing timeouts, etc.) in [src/config/tokens/twitch-user-tokens.json](src/config/tokens/twitch-user-tokens.json). This file is **gitignored** and created automatically on first authorization.

On the very first run, the bot will detect there's no token and prompt:

```
[TWITCH] ❌ Your refresh token is invalid or missing.
[TWITCH] ⚠️ Please visit the following URL to authorize your app and get a new code:
https://id.twitch.tv/oauth2/authorize?... (the URL from TWITCH_BOT_AUTHORIZATION_LINK)
[TWITCH] 📝 Enter the authorization code from the URL:
```

Steps:

1. Open the URL in a browser **while logged into the bot's Twitch account** (not the streamer's).
2. Approve the requested permissions.
3. Twitch will redirect to `http://localhost:3000?code=XXXXX&...`. The page will look broken — that's expected.
4. Copy the `code` value from the URL bar.
5. Paste it into the terminal where the bot is waiting and press Enter.

The bot will exchange the code for an access + refresh token, save them, and continue. After this you should never need to re-authorize unless the refresh token is revoked.

> **Important:** the directory `src/config/tokens/` must exist before the bot writes to it. The repository ships with this folder already present, but if you ever delete it, recreate it before running.

---

## Discord setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → name it.
2. **Bot** tab → Add Bot. Copy the token into `DISCORD_BOT_TOKEN`.
3. Enable the following **Privileged Gateway Intents** on the Bot page:
   - ✅ MESSAGE CONTENT INTENT (needed for the Discord → Twitch chat bridge)
4. Copy the **Application ID** from the General Information page into `DISCORD_BOT_ID`.
5. **OAuth2 → URL Generator**: select scopes `bot` and `applications.commands`, and bot permissions including at least: Send Messages, Read Message History, Use Slash Commands, Mention Everyone (if you want the go-live ping to work).
6. Use the generated URL to invite the bot to your server.
7. In Discord, enable Developer Mode (User Settings → Advanced) and copy:
   - The **Server ID** → `DISCORD_SERVER_ID`
   - The **Channel ID** where Discord ↔ Twitch bridging should happen → `DISCORD_TWITCH_CHANNEL_COMMUNICATION_ID`
   - The **Channel ID** where go-live announcements should be posted → `DISCORD_GO_LIVE_CHANNEL_ID`
8. Register slash commands once:
   ```bash
   node src/integrations/discord/register-commands.js
   ```
   Guild commands appear instantly. Re-run this script any time you change command definitions.

### Go-live Discord announcement

When the stream goes live (detected by polling the Twitch Streams API every 60 seconds), the bot posts a message mentioning `@everyone` to the Discord channel set in `DISCORD_GO_LIVE_CHANNEL_ID`.

The bot needs the **Mention Everyone** permission in that channel for the ping to actually notify users.

---

## OBS setup

1. OBS Studio 28+ has WebSocket built in. Tools → WebSocket Server Settings.
2. Enable WebSocket Server, set a strong password, copy it into `OBS_WS_PASSWORD`.
3. Default port is `4455`. If you change it, update `OBS_WS_URL` accordingly.
4. The bot expects certain OBS source names to exist (you can rename them in code, but out of the box):
   - **`WitherText`** — a Text (GDI+) source used by the `!wither` command animation.
   - **`MicTimer`** — a Text (GDI+) source showing the mute countdown overlay.
   - **`!srDisabled`** — a Text (GDI+) source toggled when song requests are disabled from the player.
   - **`Camera`** — the source(s) representing the camera; the wide-cam reward toggles between scaled and unscaled instances.

If these don't exist OBS will simply log errors for those operations — the bot will keep running.

---

## Running the bot

```bash
npm start
```

What this does:

- Loads `.env` and validates every variable.
- Connects to OBS and begins an auto-reconnect loop.
- Loads or refreshes the Twitch user token (interactive on first run — see [First-time Twitch OAuth authorization](#first-time-twitch-oauth-authorization)).
- Connects the song request WebSocket client (it will keep retrying until the Electron player launches).
- Starts the HTTP keepalive server on `SERVER_PORT`.
- Connects ComfyJS (outgoing chat) and tmi.js (incoming chat).
- Loads chat timers from [src/config/timers.json](src/config/timers.json) and starts the live-status poller.
- Logs into Discord.
- Opens a terminal chat bridge: anything you type in the running terminal is sent to Twitch chat as the bot. (Disabled automatically under systemd / non-TTY.)

The terminal output is colour-coded by integration (`[TWITCH]`, `[DISCORD]`, `[OBS]`, `[PLAYER]`, `[TIMERS]`, `[SYSTEM]`).

---

## The song request player

The player is a separate Electron app in `player/`. It serves two purposes:

1. **A YouTube player** that plays queued songs in order.
2. **A WebSocket server on `ws://localhost:9001`** that the bot connects to. The bot sends enqueue / skip / status messages; the player sends back queue position and current-track updates.

### Architecture

```
┌─────────────────┐         WS (localhost:9001)         ┌──────────────────────────┐
│   Bot (Node)    │  ◄──────────────────────────────►   │  Electron Player         │
│                 │     enqueue / skip / status         │  - YouTube view          │
│  songRequest    │                                     │  - Sidebar UI            │
│    Client.js    │                                     │  - WS server (`ws`)      │
└─────────────────┘                                     └──────────────────────────┘
```

If the player isn't running, song requests gracefully return `player_offline` to chat. The bot will reconnect automatically when the player launches.

### Running from source

```bash
cd player
npm install   # first time only
npm start
```

### Building the player into an `.exe` (Windows)

```bash
cd player
npm run build
```

Output lands in `player/dist/`:

- `SurferStalker Player Setup x.x.x.exe` — NSIS one-click installer.
- `SurferStalker Player x.x.x.exe` — portable single-file executable.

For macOS / Linux builds, add the appropriate `mac` / `linux` targets to `player/package.json` under `build` and consult the [electron-builder docs](https://www.electron.build/).

### Player features

- **Queue:** songs added via `!sr` (or channel point reward, or manual SR) play in order.
- **Manual SR:** there's a text field in the player sidebar where you can paste any YouTube URL to inject a song into the queue without going through chat.
- **Backup playlist:** when the queue is empty, the player can fall back to a YouTube playlist URL set in the sidebar. The dot next to "Backup Playlist" turns orange while it's active.
- **Volume slider, pause, skip, clear queue.**
- **Requests toggle:** a button in the sidebar enables/disables song requests globally. When toggled:
  - The bot announces it in Twitch chat.
  - The OBS source `!srDisabled` is shown (off) or hidden (on) across all scenes.
- **Persistent settings:** the player saves volume, backup playlist URL, and request-enabled state to its user data directory.

### Player WebSocket protocol

If you ever need to talk to the player directly:

- **Bot → Player:** `{ url, requester, title }` to enqueue. `{ type: "skip" }` to skip the current track.
- **Player → Bot:** `{ type: "status", requestsEnabled, current: { title, url, requester } | null }`. Plus an ack with `{ ok, position }` for each enqueue.

---

## Configuration files you can edit

### `src/config/timers.json`

Defines recurring chat messages similar to StreamElements timers. **Edits are picked up live** via `fs.watch` — no restart needed.

```json
[
  {
    "name": "Wither",
    "enabled": true,
    "onlineIntervalMinutes": 10,
    "offlineIntervalMinutes": 30,
    "chatLinesRequired": 10,
    "messages": [
      "You can timeout people if they're not being nice. Type !wither [username]"
    ]
  }
]
```

- `enabled`: set to `false` to disable a timer without deleting it.
- `onlineIntervalMinutes` / `offlineIntervalMinutes`: how often to fire while the stream is live vs offline.
- `chatLinesRequired`: minimum chat lines in the last 5 minutes before the timer is allowed to fire. Prevents spamming an empty chat.
- `messages`: array. The timer cycles through them.

### `src/config/pingList.json`

A JSON array of lowercase Twitch usernames. These users get `@`-mentioned at the end of title-change and go-live announcements.

```json
["ninou2", "alotofchickens"]
```

Users can self-manage their entry with `!pingme` (toggle in/out). The file is rewritten automatically when that command is used.

---

## Available chat commands

All commands use the prefix from `TWITCH_COMMAND_PREFIX` (typically `!`).

| Command | Description |
|---|---|
| `!ping` | Bot replies — quick liveness check. |
| `!wither <user>` | Timeout-roulette command (stacking durations per user). |
| `!kick` | Returns the streamer's Kick channel link. |
| `!playlist` | Returns the music playlist link. |
| `!games` / `!gamelist` / `!gameslist` | Returns a games list. |
| `!time` | Returns the streamer's local time. |
| `!videos` | Returns video/clips link. |
| `!playsound` (and aliases `!sound`, `!sounds`, `!soundlist`, `!soundboard`, `!soundclips`) | Returns the soundboard URL. |
| `!lurk` / `!unlurk` | Lurk announcements. |
| `!discord` | Returns the Discord invite. |
| `!penta` / `!pentakill` / `!pentas` | Returns the penta-kill clip links. |
| `!sr <YouTube URL>` | Add a song to the queue (player must be running). |
| `!skip` | Skip the current song (mods/streamer only). |
| `!song` | Show the currently playing song. Works for both queued songs and backup playlist tracks. |
| `!so <user>` | Shoutout — sends a blue announcement using the Twitch Helix announcements endpoint. Also fired automatically on raid. |
| `!trihard` / `!sick` / `!tuck` | Misc reactions. |
| `!game` / `!category` | Shows the current category. |
| `!title` | Shows the current stream title. |
| `!obsreconnect` / `!obsstatus` | Streamer-only — manage the OBS WebSocket connection. |
| `!pingme` | Toggles the caller in/out of the ping list (`pingList.json`). |

---

## Channel point rewards

When a viewer redeems one of the configured rewards, the bot reacts as follows:

- **Song request:** message text must be a YouTube URL. Behaves like `!sr`.
- **Timeout:** message text must be an `@username`. Issues a timeout (with stacking duration if repeated).
- **Wide cam:** activates the wide camera in OBS. Auto-reverts after `OBS_REVERT_DELAY_MS`.
- **Mute 5min / Mute 10min:** mutes the `Mic/Aux` input in OBS for the duration, with a live countdown overlay on the `MicTimer` source.

If the reward UUID in `.env` doesn't match anything you've actually created on Twitch, nothing happens — that's fine.

---

## Customizing the bot to your stream

`.env` covers the deployment knobs (tokens, IDs, URLs, timezone). Everything else that's specific to **your** stream — overlay source names, chat command responses, scene-specific behavior — lives directly in the code. The bot was originally written for one person's setup, so expect to edit a few files before it fits yours.

### OBS source names

The OBS controller assumes specific source names exist in your scenes. Create sources matching these names, or rename the strings in the code to match what you already have. Defaults (these are the names used in the original setup):

| Source name | Type | Where it's referenced | What it does |
|---|---|---|---|
| `WitherText` | Text (GDI+) | [src/integrations/obs/obsController.js](src/integrations/obs/obsController.js) (`setWitherText`, `slideWitherTextInAllScenes`) | Animated overlay shown when `!wither` succeeds. Slides in from the top, holds for 5s, slides out. |
| `MicTimer` | Text (GDI+) | [src/integrations/obs/obsController.js](src/integrations/obs/obsController.js) (`muteMicForDuration`) | Countdown overlay shown during the mute-5min / mute-10min channel point rewards. |
| `!srDisabled` | Text (GDI+) | [src/app.js](src/app.js) (`setSourceVisibility` call in the requests-toggled callback) | Shown when song requests are disabled from the player UI, hidden when re-enabled. |
| `Mic/Aux` | Audio input | [src/integrations/obs/obsController.js](src/integrations/obs/obsController.js) (`muteMicForDuration`) | The mic input that gets muted by the mute rewards. Rename if your mic is called something else. |
| `Camera` | Source (any type) | [src/integrations/obs/obsController.js](src/integrations/obs/obsController.js) (`getCameraItems`, `switchCamera`) | The wide-cam reward toggles between two `Camera` sources in each scene — one scaled "wide" and one normal. The controller uses scale > 1.2 to identify the wide variant. |

If a source doesn't exist, the corresponding feature will simply log an error and keep going. The bot won't crash.

### Twitch command responses

Most chat command responses are hardcoded strings in [src/integrations/twitch/twitchCommands.js](src/integrations/twitch/twitchCommands.js). Open that file and edit the return values to match your channel:

- `kickCommand` — now reads from `KICK_CHANNEL_URL` in `.env`.
- `timeCommand` — now reads the timezone from `STREAMER_TIMEZONE` in `.env`.
- `playlistCommand` — playlist URLs.
- `gamesCommand` — link to your games-list spreadsheet.
- `videosCommand` — link to your video-suggestions doc.
- `playSoundCommand` (and aliases) — link to your soundboard doc.
- `discordCommand` — your Discord invite.
- `pentaCommand` — clip links for `!penta` / `!pentakill` / `!pentas`.
- `lurkCommand` / `unlurkCommand` — wording when viewers lurk.
- `trihardCommand` / `sickCommand` / `tuckCommand` — flavor responses.
- `buildShoutoutMessage` (top of the file) — the shoutout template used by `!so` and auto-fired on raid.

Each command is a small arrow function near the top of `createCommands`, so editing one is usually a one-line change. You can also delete commands you don't want by removing them from the registered array at the bottom of the file.

### Discord slash commands

The slash command definitions live in [src/integrations/discord/register-commands.js](src/integrations/discord/register-commands.js). Add/remove entries there, then re-run:

```bash
node src/integrations/discord/register-commands.js
```

### Channel point reward behavior

The five rewards in [src/integrations/twitch/twitchRewards.js](src/integrations/twitch/twitchRewards.js) are hardcoded to specific behaviors (song request, timeout, wide cam, mute 5min, mute 10min). If you want different rewards, edit that file and pair them with new UUIDs in `.env`.

---

## Troubleshooting

**`Missing required environment variable: X`** — your `.env` is missing variable `X`. Copy from `.env.example`.

**`[TWITCH] ❌ Your refresh token is invalid or missing.`** — first-run authorization, or your refresh token expired/was revoked. Follow the prompt to re-authorize. See [First-time Twitch OAuth authorization](#first-time-twitch-oauth-authorization).

**`[OBS] ❌ Failed to connect`** — OBS isn't running, the WebSocket server is disabled, the URL/port is wrong, or the password is wrong. The bot will keep retrying every `OBS_AUTO_RECONNECT_TIME` ms.

**`[PLAYER] ⚠️ Player disconnected — will retry`** — the Electron player is closed. Start it with `cd player && npm start` (or run the built `.exe`).

**`@user the song request player isn't running right now.`** — same as above, but visible to viewers.

**Discord slash commands don't show up** — re-run `node src/integrations/discord/register-commands.js`. Guild commands take effect immediately; if you registered globally they can take up to an hour.

**The bot starts and immediately exits** — almost always an env-validation error. Read the very first lines of output carefully.

**`!so` raid shoutout posts twice** — historical issue, fixed. The shoutout is now sent only as one blue announcement. If you still see two, you have an older copy of `src/app.js` or `src/integrations/twitch/twitchCommands.js`.

**Stream live announcement never fires** — the live poll runs every 60 seconds. Check the logs for `[TIMERS] Sent go-live announcement`. If you don't see it shortly after going live, verify `TWITCH_CHANNEL_USERID` is correct.

**Player builds but the `.exe` won't open YouTube videos** — make sure the build wasn't run with a stale Electron version. `rm -rf player/node_modules player/dist && cd player && npm install && npm run build`.

**Running on a headless Linux server fails on `ComfyJS.Init`** — that's unrelated to headless; ComfyJS doesn't need a display. Check that `TWITCH_BOT_OAUTH` actually starts with `oauth:`.

---

## License

See [LICENSE](LICENSE) in the repo root.
