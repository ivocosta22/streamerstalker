const { esc } = require('./layout')
const chatBus = require('../integrations/twitch/chatBus')
const badgeResolver = require('../integrations/twitch/badgeResolver')
const emoteResolver = require('../integrations/twitch/emoteResolver')
const { twitch, kick, chat: chatConfig } = require('../config/env')
const { getToken } = require('../integrations/twitch/twitchAPI')
const kickAuth = require('../integrations/kick/kickAuth')

const TWITCH_ICON = '<svg style="width:18px;height:18px;vertical-align:middle;margin-right:4px" viewBox="0 0 2400 2800"><g fill="#9146ff"><path fill-rule="evenodd" d="M500,0L0,500v1800h600v500l500-500h400l900-900V0H500z M2200,1300l-400,400h-400l-350,350v-350H600V200h1600V1300z"/><rect x="1700" y="550" width="200" height="600"/><rect x="1150" y="550" width="200" height="600"/></g></svg>'
const KICK_ICON = '<svg style="width:18px;height:18px;vertical-align:middle;margin-right:4px" viewBox="0 0 64 64"><path fill="#53fc18" d="M4 6h16v16h6V14h6V6h20v16h-6v8h-6v8h6v8h6v16H32v-8h-6v-8h-6v16H4z"/></svg>'

function chatPage(page, auth) {
  return (req, res) => {
    res.send(page({
      title: 'Chat · SurferStalker',
      active: '/chat',
      heading: 'Chat',
      sub: `Chat for ${esc(twitch.channelCaseSensitive)}. Messages you send appear as the bot.`,
      admin: true,
      body: CHAT_BODY,
      script: CHAT_JS
    }))
  }
}

const MOD_STYLE = `
  .chat-line{position:relative;padding:4px 0;word-wrap:break-word}
  .chat-line:hover{background:var(--surface-2);border-radius:4px}
  .mod-btns{display:none;position:absolute;right:4px;top:50%;transform:translateY(-50%);
    gap:3px;background:var(--surface);padding:2px 4px;border-radius:6px;border:1px solid var(--border);z-index:2}
  .chat-line:hover .mod-btns{display:inline-flex}
  .mod-btn{font:inherit;font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;
    border:1px solid var(--border);background:var(--surface-2);color:var(--muted);cursor:pointer;white-space:nowrap}
  .mod-btn:hover{border-color:var(--accent);color:var(--text)}
  .mod-btn.ban{color:var(--bad)}
  .mod-btn.ban:hover{border-color:var(--bad);background:rgba(248,113,113,.13)}
  .mod-btn.del{color:var(--warn)}
  .mod-btn.del:hover{border-color:var(--warn)}
`

const CHAT_BODY = `
  <style>${MOD_STYLE}</style>
  <div id="chat-wrap" style="display:flex;flex-direction:column;height:calc(100vh - 270px);min-height:300px">
    <div id="chat" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:12px;
      background:var(--surface);padding:12px;font-size:14px;line-height:1.6"></div>
    <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <form class="send-form" data-platform="twitch" style="flex:1 1 280px;display:flex;gap:8px;align-items:center">
        <span style="display:flex;align-items:center;gap:4px;color:#9146ff;font-weight:600;font-size:13px;white-space:nowrap">${TWITCH_ICON} Twitch</span>
        <input type="text" placeholder="Send to Twitch..." autocomplete="off" style="flex:1" />
        <button class="primary" type="submit" style="background:#9146ff">Send</button>
      </form>
      <form class="send-form" data-platform="kick" style="flex:1 1 280px;display:flex;gap:8px;align-items:center">
        <span style="display:flex;align-items:center;gap:4px;color:#53fc18;font-weight:600;font-size:13px;white-space:nowrap">${KICK_ICON} Kick</span>
        <input type="text" placeholder="Send to Kick..." autocomplete="off" style="flex:1" />
        <button class="primary" type="submit" style="background:#53fc18;color:#000">Send</button>
      </form>
      <button type="button" id="popout" title="Pop out chat" style="padding:6px 10px;font-size:12px">⧉ Pop out</button>
    </div>
  </div>
`

const CHAT_JS = `
  var box = document.getElementById('chat');
  var pinned = true;
  var TWITCH_ICON = '${TWITCH_ICON.replace(/'/g, "\\'")}';
  var KICK_ICON = '${KICK_ICON.replace(/'/g, "\\'")}';

  function badgeImg(b) {
    if (!b) return '';
    if (b.svg) return b.svg;
    if (b.label) {
      return '<span title="' + escHtml(b.label) + '" style="display:inline-block;font-size:10px;font-weight:700;' +
        'text-transform:uppercase;letter-spacing:.4px;padding:1px 5px;border-radius:4px;margin-right:4px;' +
        'vertical-align:middle;background:' + escHtml(b.color) + '22;color:' + escHtml(b.color) +
        ';border:1px solid ' + escHtml(b.color) + '55">' + escHtml(b.label) + '</span>';
    }
    if (!b.url1x) return '';
    return '<img src="' + escHtml(b.url2x) + '" alt="' + escHtml(b.title || b.set) + '" title="' + escHtml(b.title || b.set) +
      '" style="width:18px;height:18px;vertical-align:middle;margin-right:3px">';
  }

  function platformBadge(platform) {
    if (platform === 'twitch') return TWITCH_ICON;
    if (platform === 'kick') return KICK_ICON;
    return '';
  }

  function renderSegments(segs) {
    if (!segs || !segs.length) return '';
    return segs.map(function (s) {
      if (s.type === 'emote') {
        if (s.zeroWidth) return '<img src="' + escHtml(s.url) + '" alt="' + escHtml(s.name) +
          '" title="' + escHtml(s.name) + '" style="height:28px;vertical-align:middle;margin-left:-28px;position:relative;z-index:1">';
        return '<img src="' + escHtml(s.url) + '" alt="' + escHtml(s.name) +
          '" title="' + escHtml(s.name) + '" style="height:28px;vertical-align:middle;margin:0 2px">';
      }
      return escHtml(s.value);
    }).join('');
  }

  function modBtns(entry) {
    if (!entry.userId || entry.broadcaster) return '';
    return '<span class="mod-btns">' +
      '<button class="mod-btn" data-action="timeout" data-dur="1" title="Timeout 1s">1s</button>' +
      '<button class="mod-btn" data-action="timeout" data-dur="300" title="Timeout 5m">5m</button>' +
      '<button class="mod-btn" data-action="timeout" data-dur="86400" title="Timeout 1d">1d</button>' +
      '<button class="mod-btn ban" data-action="ban" title="Ban">Ban</button>' +
      '<button class="mod-btn del" data-action="delete" title="Delete message">✕</button>' +
      '</span>';
  }

  function renderMsg(entry) {
    if (entry.platform === 'system') {
      var sys = document.createElement('div');
      sys.style.cssText = 'padding:4px 0;color:var(--muted);font-style:italic;font-size:13px';
      sys.textContent = entry.message;
      return sys;
    }

    var row = document.createElement('div');
    row.className = 'chat-line';
    row.dataset.platform = entry.platform || '';
    row.dataset.userId = entry.userId || '';
    row.dataset.msgId = entry.id || '';
    row.dataset.username = entry.user || '';

    var html = platformBadge(entry.platform);
    if (entry.resolvedBadges) {
      entry.resolvedBadges.forEach(function (b) { html += badgeImg(b); });
    }

    var color = entry.color || '#efeff1';
    html += '<strong style="color:' + color + '">' + escHtml(entry.user) + '</strong>';
    html += '<span style="color:var(--muted)">: </span>';
    html += entry.parsedMessage ? renderSegments(entry.parsedMessage) : escHtml(entry.message);
    html += modBtns(entry);
    row.innerHTML = html;
    return row;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function addMsg(entry) {
    box.appendChild(renderMsg(entry));
    while (box.childElementCount > 500) box.removeChild(box.firstChild);
    if (pinned) box.scrollTop = box.scrollHeight;
  }

  box.addEventListener('scroll', function () {
    pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  });

  var stream = new EventSource('/api/admin/chat/stream');
  stream.onmessage = function (msg) {
    try { addMsg(JSON.parse(msg.data)); } catch (e) {}
  };

  document.querySelectorAll('.send-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="text"]');
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      var platform = form.getAttribute('data-platform');
      fetch('/api/admin/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, platform: platform })
      }).catch(function () {});
    });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.mod-btn');
    if (!btn) return;
    var line = btn.closest('.chat-line');
    if (!line) return;
    var action = btn.dataset.action;
    var platform = line.dataset.platform;
    var userId = line.dataset.userId;
    var msgId = line.dataset.msgId;
    var username = line.dataset.username;
    if (action === 'ban' && !confirm('Ban ' + username + ' on ' + platform + '?')) return;
    var body = { action: action, platform: platform, userId: userId };
    if (action === 'timeout') body.duration = Number(btn.dataset.dur);
    if (action === 'delete') body.messageId = msgId;
    btn.disabled = true;
    btn.style.opacity = '0.4';
    fetch('/api/admin/mod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'failed'); });
      btn.textContent = '✓';
      btn.style.color = 'var(--good)';
    }).catch(function (err) {
      btn.textContent = '✗';
      btn.style.color = 'var(--bad)';
      btn.title = err.message;
    });
  });

  var popBtn = document.getElementById('popout');
  if (popBtn) popBtn.addEventListener('click', function () {
    window.open('/chatpop', 'SSChat', 'width=440,height=820,menubar=no,toolbar=no,location=no,status=no');
  });
`

// OBS overlay page — standalone HTML, no layout wrapper, transparent background
function chatOverlayPage(_req, res) {
  res.send(OVERLAY_HTML)
}

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Chat Overlay</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: transparent;
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 16px;
    overflow: hidden;
  }
  #chat {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 12px;
  }
  .msg {
    padding: 4px 10px;
    margin-bottom: 2px;
    background: rgba(0, 0, 0, 0.55);
    border-radius: 6px;
    line-height: 1.5;
    word-wrap: break-word;
    animation: fadeIn 0.25s ease-out;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }
  .msg .badge {
    width: 20px;
    height: 20px;
    vertical-align: middle;
    margin-right: 3px;
  }
  .msg .kbadge {
    width: 20px;
    height: 20px;
  }
  .msg .emote {
    height: 28px;
    vertical-align: middle;
    margin: 0 2px;
  }
  .msg .emote.zw {
    margin-left: -28px;
    position: relative;
    z-index: 1;
  }
  .msg .tbadge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .4px;
    padding: 1px 5px;
    border-radius: 4px;
    margin-right: 4px;
    vertical-align: middle;
    border: 1px solid;
    text-shadow: none;
  }
  .msg .picon {
    width: 18px;
    height: 18px;
    vertical-align: middle;
    margin-right: 4px;
  }
  .msg .name { font-weight: 700; }
  .msg .colon { color: rgba(255,255,255,0.6); }
  .msg .text { color: #fff; }
  .sys {
    padding: 3px 10px;
    margin-bottom: 2px;
    color: rgba(255,255,255,0.5);
    font-style: italic;
    font-size: 14px;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
<div id="chat"></div>
<script>
var box = document.getElementById('chat');
var MAX = 30;
var TWITCH_SVG = '<svg class="picon" viewBox="0 0 2400 2800"><g fill="#9146ff"><path fill-rule="evenodd" d="M500,0L0,500v1800h600v500l500-500h400l900-900V0H500z M2200,1300l-400,400h-400l-350,350v-350H600V200h1600V1300z"/><rect x="1700" y="550" width="200" height="600"/><rect x="1150" y="550" width="200" height="600"/></g></svg>';
var KICK_SVG = '<svg class="picon" viewBox="0 0 64 64"><path fill="#53fc18" d="M4 6h16v16h6V14h6V6h20v16h-6v8h-6v8h6v8h6v16H32v-8h-6v-8h-6v16H4z"/></svg>';

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function badgeHtml(badges) {
  if (!badges || !badges.length) return '';
  return badges.map(function (b) {
    if (b.svg) return b.svg;
    if (b.label) {
      return '<span class="tbadge" style="background:' + esc(b.color) + '33;color:' + esc(b.color) +
        ';border-color:' + esc(b.color) + '66">' + esc(b.label) + '</span>';
    }
    if (!b.url2x && !b.url1x) return '';
    return '<img class="badge" src="' + esc(b.url2x || b.url1x) + '" alt="' + esc(b.title || b.set) +
      '" title="' + esc(b.title || b.set) + '">';
  }).join('');
}

function platformHtml(p) {
  if (p === 'twitch') return TWITCH_SVG;
  if (p === 'kick') return KICK_SVG;
  return '';
}

function renderSegments(segs) {
  if (!segs || !segs.length) return '';
  return segs.map(function (s) {
    if (s.type === 'emote') {
      if (s.zeroWidth) return '<img class="emote zw" src="' + esc(s.url) + '" alt="' + esc(s.name) +
        '" title="' + esc(s.name) + '">';
      return '<img class="emote" src="' + esc(s.url) + '" alt="' + esc(s.name) +
        '" title="' + esc(s.name) + '">';
    }
    return esc(s.value);
  }).join('');
}

function addMsg(entry) {
  if (entry.platform === 'system') {
    var sys = document.createElement('div');
    sys.className = 'sys';
    sys.textContent = entry.message;
    box.appendChild(sys);
  } else {
    var el = document.createElement('div');
    el.className = 'msg';
    var color = entry.color || '#fff';
    var msgHtml = entry.parsedMessage ? renderSegments(entry.parsedMessage) : esc(entry.message);
    el.innerHTML = platformHtml(entry.platform) +
      badgeHtml(entry.resolvedBadges) +
      '<span class="name" style="color:' + esc(color) + '">' + esc(entry.user) + '</span>' +
      '<span class="colon">: </span>' +
      '<span class="text">' + msgHtml + '</span>';
    box.appendChild(el);
  }
  while (box.childElementCount > MAX) box.removeChild(box.firstChild);
}

var stream = new EventSource('/api/chat/overlay/stream');
stream.onmessage = function (msg) {
  try { addMsg(JSON.parse(msg.data)); } catch (e) {}
};
</script>
</body>
</html>`

// Non-Twitch platforms resolve their own badges and emotes at push time.
function enrich(entry) {
  return {
    ...entry,
    resolvedBadges: entry.resolvedBadges || badgeResolver.resolve(entry.badges),
    parsedMessage: entry.parsedMessage || emoteResolver.parseMessage(entry.message, entry.emotes)
  }
}

// SSE stream for the admin chat page (requires auth)
function chatStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  if (res.flushHeaders) res.flushHeaders()
  res.setTimeout(0)
  res.write('retry: 3000\n\n')

  for (const entry of chatBus.getHistory()) {
    res.write(`data: ${JSON.stringify(enrich(entry))}\n\n`)
  }

  const unsubscribe = chatBus.subscribe((entry) => {
    try { res.write(`data: ${JSON.stringify(enrich(entry))}\n\n`) } catch {}
  })
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch {}
  }, 25000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

// SSE stream for the OBS overlay (no auth — OBS can't log in)
function overlayStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  if (res.flushHeaders) res.flushHeaders()
  res.setTimeout(0)
  res.write('retry: 3000\n\n')

  const recent = chatBus.getHistory().slice(-30)
  for (const entry of recent) {
    res.write(`data: ${JSON.stringify(enrich(entry))}\n\n`)
  }

  const unsubscribe = chatBus.subscribe((entry) => {
    try { res.write(`data: ${JSON.stringify(enrich(entry))}\n\n`) } catch {}
  })
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch {}
  }, 25000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

// Send a message as the bot
function chatSend(req, res) {
  const msg = String(req.body?.message ?? '').trim()
  const platform = String(req.body?.platform ?? 'twitch')
  if (!msg) return res.status(400).json({ error: 'message is required' })
  if (msg.length > 500) return res.status(400).json({ error: 'message too long' })

  if (platform === 'kick') {
    const sent = chatBus.kickSay(msg)
    if (!sent) return res.status(503).json({ error: 'Kick chat not available — check authorization' })
    return res.json({ sent: true })
  }

  if (!chatConfig.enabled) {
    return res.status(503).json({ error: 'chat is disabled (CHAT_ENABLED=false)' })
  }

  const sent = chatBus.say(msg)
  if (!sent) return res.status(503).json({ error: 'Twitch chat connection not available' })

  res.json({ sent: true })
}

// ---------------------------------------------------------------- moderation

async function twitchMod(action, { userId, messageId, duration }) {
  const token = await getToken('user')
  const headers = {
    Authorization: `Bearer ${token}`,
    'Client-Id': twitch.botClientId,
    'Content-Type': 'application/json'
  }

  if (action === 'delete') {
    const params = new URLSearchParams({
      broadcaster_id: twitch.channelUserId,
      moderator_id: twitch.botUserId,
      message_id: messageId
    })
    const res = await fetch(`${twitch.APIEndpoint}/moderation/chat?${params}`, { method: 'DELETE', headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Twitch delete failed (${res.status}): ${text}`)
    }
    return
  }

  const data = { user_id: String(userId) }
  if (action === 'timeout') data.duration = Number(duration)

  const params = new URLSearchParams({
    broadcaster_id: twitch.channelUserId,
    moderator_id: twitch.botUserId
  })
  const res = await fetch(`${twitch.APIEndpoint}/moderation/bans?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitch ${action} failed (${res.status}): ${text}`)
  }
}

async function kickMod(action, { userId, duration }) {
  const token = await kickAuth.getAccessToken()
  if (!token) throw new Error('Kick not authorized — re-authorize with the startup link')

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }

  if (action === 'delete') {
    throw new Error('Message deletion is not available on Kick')
  }

  const body = { banned_user_id: Number(userId) }
  if (action === 'timeout') {
    body.duration = Math.max(1, Math.ceil(Number(duration) / 60))
  }

  const res = await fetch(`https://api.kick.com/public/v1/channels/${kick.broadcasterUserId}/bans`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kick ${action} failed (${res.status}): ${text}`)
  }
}

function chatModAction(req, res) {
  const { action, platform, userId, messageId, duration } = req.body || {}

  if (!action || !platform) {
    return res.status(400).json({ error: 'action and platform are required' })
  }
  if ((action === 'timeout' || action === 'ban') && !userId) {
    return res.status(400).json({ error: 'userId is required for ' + action })
  }
  if (action === 'delete' && !messageId) {
    return res.status(400).json({ error: 'messageId is required for delete' })
  }

  const handler = platform === 'kick' ? kickMod : twitchMod
  handler(action, { userId, messageId, duration })
    .then(() => res.json({ ok: true }))
    .catch((err) => res.status(502).json({ error: err.message }))
}

// ---------------------------------------------------------------- chatpop

const CHATPOP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>SurferStalker Chat</title>
<link rel="manifest" href="/chatpop/manifest.json">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0e0e10; --surface: #18181b; --surface-2: #1f1f23; --border: #2f2f35;
    --text: #efeff1; --muted: #adadb8; --accent: #9146ff; --good: #00b884;
    --warn: #f5b942; --bad: #f87171;
  }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.55 'Inter','Segoe UI',system-ui,-apple-system,sans-serif;
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  }
  a { color: var(--accent); text-decoration: none; }
  .top-bar {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 10px 14px; display: flex; align-items: center; gap: 10px;
    font-weight: 700; font-size: 15px; flex-shrink: 0; min-width: 0; overflow: hidden;
  }
  .top-bar span { color: var(--accent); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); margin-left: auto; }
  .dot.off { background: var(--bad); }
  #chat {
    flex: 1; overflow-y: auto; padding: 10px 12px; font-size: 14px; line-height: 1.6;
  }
  #send-area {
    border-top: 1px solid var(--border); background: var(--surface);
    padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; min-width: 0;
  }
  .send-form { display: flex; gap: 6px; align-items: center; min-width: 0; }
  .send-form .plabel {
    display: flex; align-items: center; gap: 4px; font-weight: 600; font-size: 12px;
    white-space: nowrap; flex-shrink: 0;
  }
  .send-form input[type=text] {
    flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 6px;
    border: 1px solid var(--border); background: var(--bg); color: var(--text);
  }
  .send-form input:focus { outline: none; border-color: var(--accent); }
  .send-form button {
    font: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px;
    border-radius: 6px; border: none; cursor: pointer; color: #fff; flex-shrink: 0;
  }
  ${MOD_STYLE}
</style>
</head>
<body>
<div class="top-bar">
  Surfer<span>Stalker</span> Chat
  <div class="dot" id="dot"></div>
</div>
<div id="chat"></div>
<div id="send-area">
  <form class="send-form" data-platform="twitch">
    <span class="plabel" style="color:#9146ff">${TWITCH_ICON} TTV</span>
    <input type="text" placeholder="Send to Twitch..." autocomplete="off" />
    <button type="submit" style="background:#9146ff">Send</button>
  </form>
  <form class="send-form" data-platform="kick">
    <span class="plabel" style="color:#53fc18">${KICK_ICON} Kick</span>
    <input type="text" placeholder="Send to Kick..." autocomplete="off" />
    <button type="submit" style="background:#53fc18;color:#000">Send</button>
  </form>
</div>
<script>
var box = document.getElementById('chat');
var dot = document.getElementById('dot');
var pinned = true;
var TWITCH_ICON = '${TWITCH_ICON.replace(/'/g, "\\'")}';
var KICK_ICON = '${KICK_ICON.replace(/'/g, "\\'")}';

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function badgeImg(b) {
  if (!b) return '';
  if (b.svg) return b.svg;
  if (b.label) {
    return '<span title="' + escHtml(b.label) + '" style="display:inline-block;font-size:10px;font-weight:700;' +
      'text-transform:uppercase;letter-spacing:.4px;padding:1px 5px;border-radius:4px;margin-right:4px;' +
      'vertical-align:middle;background:' + escHtml(b.color) + '22;color:' + escHtml(b.color) +
      ';border:1px solid ' + escHtml(b.color) + '55">' + escHtml(b.label) + '</span>';
  }
  if (!b.url1x) return '';
  return '<img src="' + escHtml(b.url2x) + '" alt="' + escHtml(b.title || b.set) + '" title="' + escHtml(b.title || b.set) +
    '" style="width:18px;height:18px;vertical-align:middle;margin-right:3px">';
}

function platformBadge(p) {
  if (p === 'twitch') return TWITCH_ICON;
  if (p === 'kick') return KICK_ICON;
  return '';
}

function renderSegments(segs) {
  if (!segs || !segs.length) return '';
  return segs.map(function (s) {
    if (s.type === 'emote') {
      if (s.zeroWidth) return '<img src="' + escHtml(s.url) + '" alt="' + escHtml(s.name) +
        '" title="' + escHtml(s.name) + '" style="height:28px;vertical-align:middle;margin-left:-28px;position:relative;z-index:1">';
      return '<img src="' + escHtml(s.url) + '" alt="' + escHtml(s.name) +
        '" title="' + escHtml(s.name) + '" style="height:28px;vertical-align:middle;margin:0 2px">';
    }
    return escHtml(s.value);
  }).join('');
}

function modBtns(entry) {
  if (!entry.userId || entry.broadcaster) return '';
  return '<span class="mod-btns">' +
    '<button class="mod-btn" data-action="timeout" data-dur="1" title="Timeout 1s">1s</button>' +
    '<button class="mod-btn" data-action="timeout" data-dur="300" title="Timeout 5m">5m</button>' +
    '<button class="mod-btn" data-action="timeout" data-dur="86400" title="Timeout 1d">1d</button>' +
    '<button class="mod-btn ban" data-action="ban" title="Ban">Ban</button>' +
    '<button class="mod-btn del" data-action="delete" title="Delete message">&#x2715;</button>' +
    '</span>';
}

function renderMsg(entry) {
  if (entry.platform === 'system') {
    var sys = document.createElement('div');
    sys.style.cssText = 'padding:4px 0;color:var(--muted);font-style:italic;font-size:13px';
    sys.textContent = entry.message;
    return sys;
  }
  var row = document.createElement('div');
  row.className = 'chat-line';
  row.dataset.platform = entry.platform || '';
  row.dataset.userId = entry.userId || '';
  row.dataset.msgId = entry.id || '';
  row.dataset.username = entry.user || '';
  var html = platformBadge(entry.platform);
  if (entry.resolvedBadges) entry.resolvedBadges.forEach(function (b) { html += badgeImg(b); });
  var color = entry.color || '#efeff1';
  html += '<strong style="color:' + color + '">' + escHtml(entry.user) + '</strong>';
  html += '<span style="color:var(--muted)">: </span>';
  html += entry.parsedMessage ? renderSegments(entry.parsedMessage) : escHtml(entry.message);
  html += modBtns(entry);
  row.innerHTML = html;
  return row;
}

function addMsg(entry) {
  box.appendChild(renderMsg(entry));
  while (box.childElementCount > 500) box.removeChild(box.firstChild);
  if (pinned) box.scrollTop = box.scrollHeight;
}

box.addEventListener('scroll', function () {
  pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
});

var stream = new EventSource('/api/admin/chat/stream');
stream.onopen = function () { dot.className = 'dot'; };
stream.onerror = function () { dot.className = 'dot off'; };
stream.onmessage = function (msg) {
  try { addMsg(JSON.parse(msg.data)); } catch (e) {}
};

document.querySelectorAll('.send-form').forEach(function (form) {
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = form.querySelector('input[type="text"]');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    fetch('/api/admin/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, platform: form.dataset.platform })
    }).catch(function () {});
  });
});

document.addEventListener('click', function (e) {
  var btn = e.target.closest('.mod-btn');
  if (!btn) return;
  var line = btn.closest('.chat-line');
  if (!line) return;
  var action = btn.dataset.action;
  var platform = line.dataset.platform;
  var userId = line.dataset.userId;
  var msgId = line.dataset.msgId;
  var username = line.dataset.username;
  if (action === 'ban' && !confirm('Ban ' + username + ' on ' + platform + '?')) return;
  var body = { action: action, platform: platform, userId: userId };
  if (action === 'timeout') body.duration = Number(btn.dataset.dur);
  if (action === 'delete') body.messageId = msgId;
  btn.disabled = true;
  btn.style.opacity = '0.4';
  fetch('/api/admin/mod', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (res) {
    if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'failed'); });
    btn.textContent = '\\u2713';
    btn.style.color = 'var(--good)';
  }).catch(function (err) {
    btn.textContent = '\\u2717';
    btn.style.color = 'var(--bad)';
    btn.title = err.message;
  });
});
</script>
</body>
</html>`

function chatPopPage(req, res) {
  res.send(CHATPOP_HTML)
}

function chatPopManifest(_req, res) {
  res.json({
    name: 'SurferStalker Chat',
    short_name: 'SS Chat',
    start_url: '/chatpop',
    display: 'standalone',
    background_color: '#0e0e10',
    theme_color: '#9146ff',
    icons: [{
      src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#9146ff"/><text x="32" y="44" font-size="32" font-weight="bold" text-anchor="middle" fill="#fff" font-family="sans-serif">SS</text></svg>'),
      sizes: '512x512',
      type: 'image/svg+xml'
    }]
  })
}

module.exports = { chatPage, chatOverlayPage, chatStream, overlayStream, chatSend, chatModAction, chatPopPage, chatPopManifest }
