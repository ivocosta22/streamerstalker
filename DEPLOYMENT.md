# StreamerStalker Deployment Guide

---

## Table of Contents

1. [What is StreamerStalker?](#what-is-streamerstalker)
2. [Repository layout](#repository-layout)
3. [System requirements](#system-requirements)
4. [Setup](#setup)
5. [Configuring `.env`](#configuring-env)
6. [First-time Twitch OAuth](#first-time-twitch-oauth)
7. [Discord setup](#discord-setup)
8. [Kick chat setup](#kick-chat-setup)
9. [OBS setup](#obs-setup)
10. [Running the bot](#running-the-bot)
11. [The web interface](#the-web-interface)
12. [Emote support](#emote-support)
13. [The song request player](#the-song-request-player)
14. [Chat client (desktop window)](#chat-client-desktop-window)
15. [Configuration files](#configuration-files)
16. [Customizing the bot](#customizing-the-bot)
17. [Troubleshooting](#troubleshooting)

---

## What is StreamerStalker?

A Twitch + Kick + Discord bot built in Node.js. It bundles:

- **The bot** (`src/`) — connects to Twitch chat, Kick chat, Discord, and OBS. Serves a web interface with public pages and an admin control panel.
- **The song request player** (`player/`) — an Electron desktop app that plays YouTube song requests. Viewers queue songs with `!sr` and a backup playlist fills the gaps.
- **The overlay** (`src/integrations/overlay/`) — an OBS browser source for emote streaks, pyramids, and sound effects.
- **The chat overlay** (`/chat/overlay`) — an OBS browser source that merges Twitch and Kick chat into a single feed with platform icons, badges, and third-party emotes (7TV, BTTV, FFZ).
- **Points economy** (`src/integrations/points/`) — currency, gambling, duels, raffles, and a leaderboard.
- **Persistent state** (`data/`) — JSON files for balances, custom commands, module toggles, settings, and more.

The bot and player communicate over a local WebSocket (`ws://localhost:9001`). Everything except song requests works fine with the player closed.

---

## Repository layout

```
StreamerStalker/
├── src/
│   ├── app.js                    # Entry point — wires everything together
│   ├── server.js                 # Express server (overlay + web interface)
│   ├── config/
│   │   ├── env.js                # Loads & validates .env
│   │   ├── settings.js           # User-editable settings (time template, timezone)
│   │   ├── timers.json           # Chat timer definitions
│   │   ├── pingList.json         # Users pinged on title change / go-live
│   │   └── tokens/               # Auto-managed OAuth tokens (gitignored)
│   ├── integrations/
│   │   ├── twitch/               # Chat commands, rewards, timers, emotes, badges
│   │   ├── kick/                 # Kick chat listener (Pusher WebSocket)
│   │   ├── discord/              # Discord slash commands and chat bridge
│   │   ├── obs/                  # OBS WebSocket controller
│   │   ├── overlay/              # OBS browser-source overlay (emotes, sounds)
│   │   ├── player/               # WebSocket client for the Electron player
│   │   ├── points/               # Economy: currency, gamble, slots, duel, raffle
│   ├── web/                      # Web interface (public pages + admin panel)
│   ├── state/                    # Runtime state (cooldowns, uptime)
│   └── utils/                    # Logger, JSON data store
├── chat/                         # Electron chat client (separate app)
│   ├── main.js                   # Entry point — opens /chatpop in a native window
│   └── package.json
├── player/                       # Electron song request player
├── sounds/                       # Drop .mp3 files here — they become commands
├── data/                         # Persistent JSON state (gitignored)
├── chat.bat                      # Double-click to launch the chat client (gitignored)
├── .env.example                  # Template — copy to .env and fill in
└── package.json
```

---

## System requirements

- **Node.js 18+** (Node 20 LTS recommended)
- **npm** (bundled with Node)
- **Git**
- For the player: a desktop environment (Windows, macOS, or Linux with X11/Wayland)
- For OBS features: [OBS Studio](https://obsproject.com/) 28+

The bot itself is headless and runs anywhere Node 18+ runs, including a Raspberry Pi.

---

## Setup

### All platforms

1. Clone and install:
   ```bash
   git clone https://github.com/ivocosta22/streamerstalker.git
   cd streamerstalker
   npm install
   cd player && npm install && cd ..
   cd chat && npm install && cd ..
   ```
2. Copy the environment template and fill it in:
   ```bash
   cp .env.example .env
   ```
   See [Configuring `.env`](#configuring-env).

3. Start the bot:
   ```bash
   npm start
   ```

4. Start the player (separate terminal, optional):
   ```bash
   cd player
   npm start
   ```

### Platform-specific notes

**Windows** — install [Node.js LTS](https://nodejs.org/) and [Git for Windows](https://git-scm.com/download/win). Use PowerShell. If scripts are blocked, run `Set-ExecutionPolicy RemoteSigned -Scope Process`.

**macOS** — `brew install node@20 git`.

**Linux** — install Node 20 from [NodeSource](https://deb.nodesource.com/setup_20.x) or your package manager.

**Raspberry Pi** — use 64-bit Pi OS (Bookworm+) on a Pi 4/5 with 2+ GB RAM. Install just the bot (skip the player). To keep it running after logout, use systemd:

Create `/etc/systemd/system/surferstalker.service`:
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

Then: `sudo systemctl daemon-reload && sudo systemctl enable --now surferstalker`

OBS features won't work on the Pi unless `OBS_WS_URL` points to the machine actually running OBS on your LAN.

---

## Configuring `.env`

Everything is loaded at startup by `src/config/env.js`. Missing required variables crash immediately with a clear error.

### Twitch — core

| Variable | Description |
|---|---|
| `TWITCH_COMMAND_PREFIX` | Command prefix character, usually `!` |
| `TWITCH_CHANNEL` | Streamer's lowercase Twitch login |
| `TWITCH_CHANNEL_CASE_SENSITIVE` | Display name with casing, e.g. `MyStreamer` |
| `TWITCH_CHANNEL_USERID` | Streamer's numeric Twitch user ID ([lookup tool](https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/)) |
| `TWITCH_BOT_USERNAME` | Bot account's lowercase login |
| `TWITCH_BOT_USERID` | Bot account's numeric user ID |
| `TWITCH_BOT_OAUTH` | Bot's chat OAuth token with `oauth:` prefix ([generator](https://twitchtokengenerator.com/)) |
| `TWITCH_BOT_API_CLIENTID` | Client ID from your [Twitch application](https://dev.twitch.tv/console/apps) |
| `TWITCH_BOT_API_CLIENT_SECRET` | Client Secret from the same application |
| `TWITCH_BOT_AUTHORIZATION_LINK` | Full OAuth authorize URL (see below) |
| `TWITCH_API_ENDPOINT` | `https://api.twitch.tv/helix` (don't change) |
| `TWITCH_USER_TOKEN_ENDPOINT` | `https://id.twitch.tv/oauth2/token` (don't change) |
| `CHAT_ENABLED` | `true` or `false` — when false, the bot listens but won't send chat messages |

#### Building the authorization link

Replace `YOUR_CLIENT_ID` in this template:

```
https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3000&scope=channel:read:redemptions%20moderation:read%20channel:moderate%20user:write:chat%20moderator:manage:banned_users%20moderator:manage:announcements%20channel:manage:vips
```

Required scopes:
- `channel:read:redemptions` — read channel point redemptions
- `moderation:read` — read moderation actions
- `channel:moderate` — perform moderator actions
- `user:write:chat` — send chat as the bot
- `moderator:manage:banned_users` — issue timeouts
- `moderator:manage:announcements` — post announcements (shoutouts, go-live)
- `channel:manage:vips` — grant VIP via `!redeemvip`

Add `http://localhost:3000` as an OAuth Redirect URL in your Twitch app settings.

### Streamer info

| Variable | Description |
|---|---|
| `KICK_CHANNEL_URL` | Streamer's Kick channel URL (used by `!kick` and the go-live Discord message) |
| `KICK_CHAT_ENABLED` | `true` (default) or `false` — pull Kick chat into the chat page and OBS overlay |
| `KICK_CHATROOM_ID` | Numeric Kick chatroom ID. The bot tries to auto-detect it from `KICK_CHANNEL_URL` on boot, but Cloudflare usually blocks that call. See `.env.example` for how to find it manually. |
| `STREAMER_TIMEZONE` | IANA timezone, e.g. `Europe/Lisbon`, `America/New_York` |

### Kick API (optional — for sending messages and moderation)

| Variable | Description |
|---|---|
| `KICK_CLIENT_ID` | Client ID from the bot's Kick developer app |
| `KICK_CLIENT_SECRET` | Client secret from the same app |
| `KICK_BROADCASTER_USER_ID` | Streamer's numeric Kick user ID (not the chatroom ID). Find it in the page source of the Kick channel page. |

Leave these blank to run Kick in listen-only mode. See [Kick chat setup](#kick-chat-setup) for the full walkthrough.

### Discord

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from the [developer portal](https://discord.com/developers/applications) |
| `DISCORD_BOT_ID` | Application ID |
| `DISCORD_SERVER_ID` | Server (guild) ID |
| `DISCORD_TWITCH_CHANNEL_COMMUNICATION_ID` | Channel ID for Discord ↔ Twitch chat bridge |
| `DISCORD_GO_LIVE_CHANNEL_ID` | Channel ID for go-live `@everyone` announcements |

### OBS

| Variable | Description |
|---|---|
| `OBS_WS_URL` | WebSocket URL, default `ws://127.0.0.1:4455` |
| `OBS_WS_PASSWORD` | Password from OBS → Tools → WebSocket Server Settings |
| `OBS_AUTO_RECONNECT_TIME` | Reconnect interval in ms (default `300000` = 5 min) |
| `OBS_REVERT_DELAY_MS` | Wide-cam revert delay in ms (default `600000` = 10 min) |

### Server & web

| Variable | Description |
|---|---|
| `SERVER_PORT` | HTTP port (default `3000`). Also used as the Twitch OAuth redirect URI. |
| `WEB_ADMIN_PASSWORD` | Password for the control panel. **Leave blank to disable admin pages entirely** — safe default if the server is exposed to the internet. |
| `WEB_PUBLIC_URL` | Public base URL if behind a tunnel (e.g. `https://bot.yourdomain.com`). Makes `!commands` and `!leaderboard` post clickable links in chat. No trailing slash. |
| `WEB_PUBLIC_PAGES` | `true` (default) or `false` to turn off all public pages |
| `CHAT_HOST` | Hostname or IP of the machine running the bot (default `localhost`). Only used by the Electron chat client — set this when the bot runs on a different machine, e.g. `192.168.1.50`. |

---

## First-time Twitch OAuth

On the first run the bot will prompt:

```
[TWITCH] ❌ Your refresh token is invalid or missing.
[TWITCH] ⚠️ Please visit the following URL to authorize your app:
```

1. Open the URL **while logged into the bot's Twitch account** (not the streamer's).
2. Approve the permissions.
3. Twitch redirects to `http://localhost:3000?code=XXXXX&...` — the page will look broken, that's expected.
4. Copy the `code` value from the URL bar and paste it into the terminal.

Tokens are saved to `src/config/tokens/twitch-user-tokens.json` (gitignored). You shouldn't need to re-authorize unless the refresh token is revoked.

---

## Discord setup

1. [Create a new application](https://discord.com/developers/applications).
2. **Bot** tab → Add Bot → copy the token into `DISCORD_BOT_TOKEN`.
3. Enable **MESSAGE CONTENT INTENT** on the Bot page.
4. Copy the Application ID into `DISCORD_BOT_ID`.
5. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`, permissions: Send Messages, Read Message History, Use Slash Commands, Mention Everyone.
6. Use the generated URL to invite the bot to your server.
7. In Discord (Developer Mode on), copy the Server ID and two Channel IDs into `.env`.
8. Register slash commands:
   ```bash
   node src/integrations/discord/register-commands.js
   ```
   Re-run whenever you change definitions. Current commands: `/ping`, `/coinflip`, `/say`.

---

## Kick chat setup

Kick integration has two layers: **listening** (read chat via Pusher — no account needed) and **sending** (post messages and moderate via Kick's API — requires a Kick app).

### Listening to Kick chat

1. Set `KICK_CHAT_ENABLED=true` in `.env` (this is the default).
2. Find your chatroom ID:
   - Open your Kick channel in a browser
   - Visit `https://kick.com/api/v2/channels/<your-channel-slug>`
   - Copy the `chatroom` → `id` value
3. Set `KICK_CHATROOM_ID=<that number>` in `.env`.
4. Restart the bot. You should see `[KICK] Connected to chatroom <id>` in the logs.

The bot auto-detects the chatroom ID from `KICK_CHANNEL_URL` on boot, but Cloudflare usually blocks that lookup. If the log says the lookup failed, set the ID manually.

Kick chat messages appear in:
- `/chat` — the admin chat page, with Kick badges and emotes
- `/chat/overlay` — the OBS browser source overlay
- 7TV emotes are resolved on Kick (same channel set as Twitch), including zero-width overlay emotes. BTTV and FFZ are Twitch-only.

### Sending messages and moderating on Kick

To send chat messages as the bot and use moderation buttons (timeout/ban) on Kick users, you need a Kick API app:

1. Log into the **bot's Kick account** (not the streamer's).
2. Go to Account Settings → Developer → Create App.
3. Set the redirect URI to `http://localhost:3000/kick/callback` (must match your `SERVER_PORT`).
4. Copy the credentials into `.env`:
   ```
   KICK_CLIENT_ID=<your app's client id>
   KICK_CLIENT_SECRET=<your app's client secret>
   KICK_BROADCASTER_USER_ID=<streamer's numeric Kick user id>
   ```
5. Start the bot. It prints a Kick authorization URL at startup — open it in your browser while logged into the bot's Kick account, and approve the permissions.
6. The bot confirms `[KICK] Authorization complete` in the logs. Tokens are saved to `data/kick-tokens.json` and refresh automatically.

With Kick authorized, you can:
- Send messages from the `/chat` page using the Kick send box
- Use moderation buttons (timeout, ban) on Kick messages in `/chat` and the chat client
- The bot responds to commands from Kick chat the same as Twitch

### Points separation

Twitch and Kick users have **separate point balances**, even if they share a username. Kick users are stored with a `kick:` prefix internally. The `/leaderboard` page shows a Kick icon next to Kick users' names.

---

## OBS setup

OBS 28+ has WebSocket built in (Tools → WebSocket Server Settings).

1. Enable the WebSocket server and set a password.
2. Copy the password into `OBS_WS_PASSWORD`.

The bot expects these source names in your scenes (if they don't exist, the feature just logs an error):

| Source | Type | What it does |
|---|---|---|
| `MicTimer` | Text (GDI+) | Mute countdown overlay |
| `!srDisabled` | Text (GDI+) | Shown when song requests are off |
| `Mic/Aux` | Audio input | Muted by the mute rewards |
| `Camera` | Any | Wide-cam reward toggles between scaled/unscaled instances |

---

## Running the bot

```bash
npm start
```

On startup the bot:
- Validates `.env`
- Connects to OBS (auto-reconnects)
- Loads or refreshes the Twitch token (interactive on first run)
- Fetches and caches third-party emotes (7TV, BTTV, FFZ — global + channel, refreshed every 30 minutes)
- Starts the WebSocket client for the player (retries until the player launches)
- Starts the Express server on `SERVER_PORT` (web interface + overlay)
- Connects to Twitch chat and Discord
- Loads chat timers and starts the live-status poller
- Runs the one-time seed migration for custom commands (first run only)
- Connects to Kick chat, if `KICK_CHATROOM_ID` is set

To send a message as the bot, use the Chat page at `/chat` — there is no terminal input.

Terminal output is tagged by connection: `[TWITCH]`, `[KICK]`, `[DISCORD]`, `[OBS]`, `[PLAYER]`, and `[SYSTEM]` for everything internal (web server, overlay, points, timers, data store).

---

## The web interface

The bot serves a website on `SERVER_PORT`. It has two tiers.

### Public pages (no login)

| Page | Shows |
|---|---|
| `/` | Landing page |
| `/commands` | Every command — built-in and custom — grouped with usage and permissions. Auto-generated from the live command list, so it's always current. |
| `/leaderboard` | Top 100 by currency |
| `/sounds` | Every sound with in-browser previews |
| `/stats` | Uptime, emotes, currency in circulation, module states |
| `/chat/overlay` | Transparent chat overlay for OBS browser source — merges Twitch and Kick with platform icons, badges, and emotes |
| `/health` | `OK` — for uptime monitors |

Disable all public pages with `WEB_PUBLIC_PAGES=false`.

### Control panel (password required)

| Page | Does |
|---|---|
| `/dashboard` | Toggle modules + edit settings, enable/disable built-in commands, CRUD custom commands, rename currency, adjust balances, set sound volume, manage chat timers, configure the `!time` message and timezone |
| `/player` | Now playing, queue, skip/pause/volume, clear queue, toggle requests, set backup playlist, queue a song |
| `/chat` | Unified Twitch + Kick chat viewer with platform badges, emotes, moderation buttons, and the ability to send messages as the bot. "Pop out" button opens `/chatpop`. |
| `/chatpop` | Standalone chat page — same features as `/chat` but designed to be used as a pop-out window or installed as a desktop app (see [Chat client](#chat-client-desktop-window)) |
| `/logs` | Live tail of bot output |

**Disabled until `WEB_ADMIN_PASSWORD` is set.** Everything applies immediately — no restart needed.

The `/leaderboard` page shows Remove buttons when you're logged in as admin, so you can clean up entries from there.

### Exposing to the internet

The bot listens on localhost only. Use a tunnel to let viewers reach the public pages.

**Cloudflare Tunnel** (recommended — free, no port forwarding, no exposed IP):

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Create a tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create surferstalker
   cloudflared tunnel route dns surferstalker bot.yourdomain.com
   ```
3. Configure `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: surferstalker
   credentials-file: /home/you/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: bot.yourdomain.com
       service: http://localhost:3000
     - service: http_status:404
   ```
4. Run: `cloudflared tunnel run surferstalker` (or install as a service).
5. Set `WEB_PUBLIC_URL=https://bot.yourdomain.com` in `.env` and restart the bot.

For a quick test, `ngrok http 3000` gives a temporary URL.

### Security

- `WEB_ADMIN_PASSWORD` is the only thing between the internet and your controls. Pick a real password.
- Failed logins are rate-limited (8 attempts per IP per 15 minutes).
- Session cookie is HttpOnly, SameSite=Lax, Secure over HTTPS.
- Mutating API calls require JSON content-type (blocks cross-site form posts).
- `/overlay` stays open for OBS, but `/overlay/test` requires admin.
- `trust proxy` is on so the rate limiter sees real IPs through the tunnel.

---

## Emote support

The bot fetches and caches third-party emotes on startup (and refreshes every 30 minutes). Emotes render in `/chat`, `/chatpop`, the chat client, and the OBS overlay.

| Provider | Platforms | Types |
|---|---|---|
| **Twitch native** | Twitch only | Global, sub emotes, animated emotes — resolved from IRC tags |
| **7TV** | Twitch + Kick | Global + channel set, including **zero-width overlay emotes** (e.g. `RainTime`, `PETPET`, `cvHazmat`) — these layer on top of the previous emote |
| **BTTV** | Twitch only | Global + channel emotes |
| **FFZ** | Twitch only | Global + channel emotes |
| **Kick native** | Kick only | Kick's own `[emote:id:name]` format — resolved inline |

7TV zero-width emotes are detected via the `flags` field on the emote set entry (flag `1`). They render with negative margin to overlap the preceding emote, matching how 7TV's browser extension displays them.

---

## The song request player

The player is a separate Electron app in `player/`.

### Running from source

```bash
cd player
npm install   # first time only
npm start
```

### Building an installer (Windows)

```bash
cd player
npm run build
```

Output in `player/dist/`: an NSIS installer and a portable `.exe`.

### Features

- **Queue** — songs from `!sr` play in order
- **Search** — `!sr <words>` searches YouTube and queues the first result
- **Backup playlist** — when the queue is empty, plays from a YouTube playlist URL
- **Controls** — volume, pause, skip, clear queue in the sidebar
- **Requests toggle** — enables/disables song requests globally (announces in chat, toggles OBS source)
- **Web controls** — the `/player` page mirrors everything the desktop sidebar does, over the network

The bot pushes full player state (queue, current track, volume, pause state) to the web interface via WebSocket. The web `/player` page can control the desktop player remotely.

If the player isn't running, `!sr` replies that the player is offline and the bot auto-reconnects when it launches.

---

## Chat client (desktop window)

The chat client is a lightweight Electron wrapper around `/chatpop`. It gives you a native window with no browser chrome, resizable to any width (no browser minimum), with live Twitch + Kick chat, moderation buttons on every message, and dual send boxes.

### Setup

The chat client lives in its own `chat/` folder, like the player. Install once:

```bash
cd chat && npm install
```

On a Pi or server where you only run the bot, skip this folder entirely.

### Launching

**Double-click `chat.bat`** in the project root. To make a desktop shortcut: right-click `chat.bat` → Create shortcut → drag to Desktop or pin to taskbar.

Or from a terminal:

```bash
cd chat
npm start
```

### Building a standalone .exe

```bash
cd chat
npm run build
```

Output in `chat/dist/`: an NSIS installer and a portable `.exe`. The build bundles your `.env` and the chat icon so the `.exe` works on its own — just make sure the bot is running when you launch it.

If you move the `.exe` to another machine, copy your `.env` next to it (or into the `resources/` folder beside the exe) so it knows which host/port to connect to.

On first open you'll see the admin login page. Enter `WEB_ADMIN_PASSWORD` from `.env`. The session persists until you close the window.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+T** | Toggle always-on-top (title shows "pinned" when active) |

### Moderation buttons

Every chat message shows action buttons on hover:

| Button | Action |
|---|---|
| **1s** | Timeout 1 second (purge) |
| **5m** | Timeout 5 minutes |
| **1d** | Timeout 1 day |
| **Ban** | Permanent ban (asks for confirmation) |
| **✕** | Delete single message |

These work for both Twitch (Helix API) and Kick (public API v1). Kick does not support single-message deletion — the button will show an error for Kick messages. The same moderation buttons also appear on the `/chat` admin page in the browser.

### Connecting to a remote bot

When the bot runs on a different machine (e.g. a Raspberry Pi), set `CHAT_HOST` in `.env` on the machine that runs the chat client:

```
CHAT_HOST=192.168.1.50
```

The client connects to `http://<CHAT_HOST>:<SERVER_PORT>/chatpop`. The bot itself does not need `CHAT_HOST`. Make sure the remote machine's firewall allows connections on `SERVER_PORT`.

---

## Configuration files

### Chat timers — `data/timers.json`

Recurring chat messages. Editable from the dashboard or by hand (picked up live, no restart needed).

```json
[
  {
    "name": "Raffle",
    "enabled": true,
    "onlineIntervalMinutes": 15,
    "offlineIntervalMinutes": 30,
    "chatLinesRequired": 20,
    "messages": ["Want to win FREE STACKS?! Tell the streamer to do a raffle!"]
  }
]
```

- `chatLinesRequired` — minimum chat activity in the last 5 minutes before the timer fires (prevents spamming an empty chat)
- Timers rotate by staleness (round-robin), not randomly

### Ping list — `src/config/pingList.json`

Usernames that get `@`-mentioned on title changes and go-live. Users self-manage with `!pingme`.

### Settings — `data/settings.json`

User-editable settings like the `!time` template and timezone. Managed from the dashboard under Messages.

### Persistent state — `data/`

The `data/` directory holds all persistent JSON state: points balances, custom commands, module configs, disabled commands, migrations, settings, and the web session secret. These files are created automatically and managed by the bot — you don't normally need to edit them by hand.

---

## Customizing the bot

### Chat commands

The `/commands` page is the authoritative, always-current list of every command. It's auto-generated from the live command list.

Commands fall into three tiers:

- **Built-in** — shipped with the bot, toggled on/off from the dashboard. Defined in `src/integrations/twitch/twitchCommands.js`.
- **Custom** — user-created via `!addcommand` or the dashboard. Stored in `data/customCommands.json`.

Several commands that were originally built-in (like `!discord`, `!kick`, `!games`) have been moved to **custom commands**. On first run, the bot seeds them into `data/customCommands.json` where you can edit their responses from the dashboard or via `!changecommand` in chat.

### OBS source names

If your sources are named differently, edit the strings in `src/integrations/obs/obsController.js`. Missing sources just log an error — nothing crashes.

### Discord slash commands

Edit `src/integrations/discord/register-commands.js`, then re-run:
```bash
node src/integrations/discord/register-commands.js
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Missing required environment variable: X` | Your `.env` is missing that variable. Copy from `.env.example`. |
| `Your refresh token is invalid or missing` | First-run auth, or token was revoked. Follow the prompt. See [First-time Twitch OAuth](#first-time-twitch-oauth). |
| `[OBS] ❌ Failed to connect` | OBS isn't running, WebSocket is disabled, or URL/password is wrong. Auto-retries. |
| `[PLAYER] ⚠️ Player disconnected` | Electron player is closed. Start it or ignore if you don't need song requests. |
| Discord commands don't appear | Re-run `node src/integrations/discord/register-commands.js`. Guild commands take effect immediately. |
| Bot starts and immediately exits | Almost always an env validation error. Read the first lines of output. |
| Go-live announcement never fires | Polls every 60 seconds. Check that `TWITCH_CHANNEL_USERID` is correct. |
| Player `.exe` won't play videos | Rebuild: `rm -rf player/node_modules player/dist && cd player && npm install && npm run build` |
| Kick chat is empty but Twitch works | No error is printed for this. See [Kick chat has gone silent](#kick-chat-has-gone-silent). |

### Kick chat has gone silent

Kick has no proper API for reading chat, so the bot listens to the same real-time
service kick.com's own website uses, called Pusher. Think of tuning a radio: you need
the right station, and then the right show on it.

| | setting | value |
|---|---|---|
| station | the "app key" | `32cbd69e4b950bf97679` |
| show | the channel | `chatrooms.<your chatroom id>.v2` |

Both live in `src/integrations/kick/kickChat.js`. Get either one wrong and there is no
error message at all — the chat just sits there empty, exactly as if nobody happened to
be talking. That silence is the entire reason this section exists.

Two ways to end up there:

1. **The app key.** Search the web for Kick's Pusher key and nearly every result gives
   `eb1d5f283081a78b932c`. That key is dead — Kick moved, and Pusher now answers
   *"not in this cluster"* and drops the connection. **So the wrong answer is the one
   that is everywhere online, and the right one is not. Don't paste in a key you found
   on the internet.**

2. **The channel name.** It has to be `chatrooms.<id>.v2` — plural, with `.v2` on the
   end. The older `chatroom.<id>` (singular) is the nastier of the two: Pusher confirms
   the subscription succeeded, and then never sends a single message. Clean connection,
   no errors, dead chat.

To tell them apart, check the log for `[KICK] Connected to chatroom <id>`:

| what you see | what it means |
|---|---|
| line missing | the connection itself failed — suspect the app key |
| line present, but no messages | suspect the channel name |

A third, more ordinary cause: `KICK_CHATROOM_ID` is unset or wrong. The bot tries to
look it up from `KICK_CHANNEL_URL` on boot, but Cloudflare usually blocks that call, in
which case it logs a one-line instruction. See `.env.example` for how to find the id by
hand.

---

## License

See [LICENSE](LICENSE).
