# SurferStalker

A Twitch + Kick + Discord bot built in Node.js with a web interface, OBS integration, song requests, and a points economy. Fully self-hosted — no StreamElements or third-party services needed.

## Features

### Chat & Commands
- **60+ built-in commands** across points, games, music, stream info, sounds, moderation, and fun
- **Custom commands** — create, edit, and delete from chat or the dashboard
- **Chat timers** — recurring messages with activity thresholds and online/offline intervals
- **Custom Built-in commands** — channel-specific commands separated from the public build

### Multi-Platform Chat
- **Twitch chat** — full command handling, moderation, and channel point rewards
- **Kick chat** — real-time listener via Pusher WebSocket, plus send and moderate via Kick API (OAuth PKCE)
- **Unified chat overlay** — merges Twitch and Kick into a single OBS browser source with platform icons
- **Chat client** — standalone Electron desktop app with moderation buttons, buildable as a portable `.exe`
- **Moderation buttons** — timeout (1s, 5m, 1d), ban, and delete on every message in `/chat`, `/chatpop`, and the chat client — works for both Twitch and Kick
- **Separate point balances** — Twitch and Kick users are tracked independently, even with the same username

### Emote Support
- **7TV** — global + channel emotes on both Twitch and Kick, including **zero-width overlay emotes** (e.g. `RainTime`, `PETPET`) that layer on top of the previous emote
- **BTTV** — global + channel emotes (Twitch only)
- **FFZ** — global + channel emotes (Twitch only)
- **Twitch native** — all emotes including animated sub emotes from other channels
- **Kick native** — Kick's own `[emote:id:name]` format resolved inline
- Emotes are cached and refreshed every 30 minutes

### Discord Integration
- **Slash commands** — `/ping`, `/coinflip`, `/say`, `/rank`
- **Chat bridge** — forwards Discord messages to Twitch chat
- **Go-live announcements** — `@everyone` notification when the stream starts

### League of Legends (`!rank`)
- Shows the streamer's solo queue rank with win rate across multiple accounts
- `!rank Name#Tag` — look up any player by Riot ID
- `/rank` — Discord slash command with optional username parameter
- Powered by the Riot Games API

### Points Economy
- Currency with customizable name
- **Gambling** — `!gamble`, `!slots` with configurable payouts
- **Duels** — `!duel` with accept/deny flow
- **Raffles** — streamer-started with `!raffle`, viewers join with `!join`
- **Leaderboard** — public page and `!leaderboard` command (shows Kick icon next to Kick users)
- **Admin tools** — give, remove, set points from chat or dashboard
- **VIP redemption** — `!redeemvip` spends points for Twitch VIP

### Song Requests
- **Electron desktop player** in `player/` — YouTube playback with queue management
- **`!sr`** — queue by URL or search by name
- **Backup playlist** — YouTube playlist URL fills gaps when the queue is empty
- **Web controls** — `/player` page mirrors the desktop sidebar over the network
- **Channel point integration** — optionally require channel points to request songs

### OBS Integration
- **WebSocket control** — toggle sources, mute audio, read scene state
- **Browser source overlay** — emote streaks, emote pyramids, sound effects
- **Channel point rewards** — wide cam toggle, mic mute with countdown, timeout animations
- **Auto-reconnect** — recovers when OBS restarts

### Sounds
- Drop `.mp3` files in `sounds/` — they become `!playsound <name>` commands automatically
- In-browser preview on the `/sounds` page
- Volume control from the dashboard

### Web Interface
- **Public pages** (no login): `/commands`, `/leaderboard`, `/sounds`, `/stats`, `/health`
- **Admin panel** (password-protected): `/dashboard`, `/player`, `/chat`, `/chatpop`, `/logs`
- **Chat page** — unified Twitch + Kick viewer with platform badges, emotes, moderation, and send-as-bot
- **Chat overlay** — `/chat/overlay` OBS browser source with transparent background
- **Live logs** — real-time bot output with color-coded tags

## Quick Start

```bash
git clone https://github.com/ivocosta22/streamerstalker.git
cd streamerstalker
npm install
cp .env.example .env    # fill in your credentials
npm start
```

Optional — song request player and chat client:

```bash
cd player && npm install && cd ..   # desktop song request player
cd chat && npm install && cd ..     # desktop chat client
```

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full setup guide covering Twitch OAuth, Discord setup, Kick chat (listening + sending), OBS configuration, Cloudflare Tunnel, Raspberry Pi deployment, and troubleshooting.

## Tech Stack

- **Runtime** — Node.js 18+
- **Chat** — [tmi.js](https://tmijs.com/) (Twitch), Pusher WebSocket (Kick), [discord.js](https://discord.js.org/) (Discord)
- **Web** — Express with SSE for real-time updates
- **OBS** — [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js)
- **Player / Chat client** — Electron (buildable as standalone `.exe` with electron-builder)
- **Storage** — flat JSON files in `data/` (no database required)
- **APIs** — Twitch Helix, Kick API v1, Riot Games, YouTube Data v3

## Repository Layout

```
SurferStalker/
├── src/
│   ├── app.js                        # Entry point
│   ├── server.js                     # Express server
│   ├── config/                       # Environment, settings, timers, tokens
│   ├── integrations/
│   │   ├── twitch/                   # Commands, rewards, timers, emotes, badges
│   │   ├── kick/                     # Chat listener, send, auth, moderation
│   │   ├── discord/                  # Slash commands and chat bridge
│   │   ├── obs/                      # OBS WebSocket controller
│   │   ├── overlay/                  # OBS browser source (emotes, sounds)
│   │   ├── player/                   # Song request WebSocket client
│   │   ├── points/                   # Economy: currency, gamble, slots, duel, raffle
│   │   └── riot/                     # Riot Games API (League rank)
│   ├── web/                          # Web interface routes and pages
│   ├── state/                        # Runtime state
│   └── utils/                        # Logger, data store
├── chat/                             # Electron chat client (separate app)
├── player/                           # Electron song request player (separate app)
├── sounds/                           # Drop .mp3 files here — they become commands
├── data/                             # Persistent state (gitignored)
├── .env.example                      # Configuration template
└── DEPLOYMENT.md                     # Full setup and deployment guide
```

## Configuration

All configuration lives in `.env`. Copy `.env.example` and fill in your credentials. See [DEPLOYMENT.md](DEPLOYMENT.md) for a full breakdown of every variable.

Key optional features:
- **Kick chat** — set `KICK_CHATROOM_ID` to listen; add `KICK_CLIENT_ID` + `KICK_CLIENT_SECRET` + `KICK_BROADCASTER_USER_ID` to send and moderate
- **League rank** — set `RIOT_API_KEY` (get one at [developer.riotgames.com](https://developer.riotgames.com))
- **Admin panel** — set `WEB_ADMIN_PASSWORD` to enable
- **Public URL** — set `WEB_PUBLIC_URL` for clickable links in chat (e.g. via Cloudflare Tunnel)

## Raspberry Pi

The bot runs headless on a Pi 4/5 (64-bit Pi OS, 2+ GB RAM). Skip the player and chat client folders — those run on your desktop. Use systemd for auto-start on boot. Full instructions in [DEPLOYMENT.md](DEPLOYMENT.md).

## License

See [LICENSE](LICENSE).
