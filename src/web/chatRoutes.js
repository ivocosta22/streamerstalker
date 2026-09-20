const { esc } = require('./layout')
const chatBus = require('../integrations/twitch/chatBus')
const badgeResolver = require('../integrations/twitch/badgeResolver')
const emoteResolver = require('../integrations/twitch/emoteResolver')
const { twitch, chat: chatConfig } = require('../config/env')

const TWITCH_ICON = '<svg style="width:18px;height:18px;vertical-align:middle;margin-right:4px" viewBox="0 0 2400 2800"><g fill="#9146ff"><path fill-rule="evenodd" d="M500,0L0,500v1800h600v500l500-500h400l900-900V0H500z M2200,1300l-400,400h-400l-350,350v-350H600V200h1600V1300z"/><rect x="1700" y="550" width="200" height="600"/><rect x="1150" y="550" width="200" height="600"/></g></svg>'
const KICK_ICON = '<svg style="width:18px;height:18px;vertical-align:middle;margin-right:4px" viewBox="0 0 64 64"><path fill="#53fc18" d="M4 6h16v16h6V14h6V6h20v16h-6v8h-6v8h6v8h6v16H32v-8h-6v-8h-6v16H4z"/></svg>'

function chatPage(page, auth) {
  return (req, res) => {
    res.send(page({
      title: 'Chat · SurferStalker',
      active: '/chat',
      heading: 'Chat',
      sub: `Twitch chat for ${esc(twitch.channelCaseSensitive)}. Messages you send appear as the bot.`,
      admin: true,
      body: CHAT_BODY,
      script: CHAT_JS
    }))
  }
}

const CHAT_BODY = `
  <div id="chat-wrap" style="display:flex;flex-direction:column;height:calc(100vh - 220px);min-height:300px">
    <div id="chat" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:12px;
      background:var(--surface);padding:12px;font-size:14px;line-height:1.6"></div>
    <form id="sendForm" style="margin-top:12px;display:flex;gap:10px">
      <input type="text" id="chatInput" placeholder="Send a message as the bot..."
        autocomplete="off" style="flex:1" />
      <button class="primary" type="submit">Send</button>
    </form>
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
      if (s.type === 'emote') return '<img src="' + escHtml(s.url) + '" alt="' + escHtml(s.name) +
        '" title="' + escHtml(s.name) + '" style="height:28px;vertical-align:middle;margin:0 2px">';
      return escHtml(s.value);
    }).join('');
  }

  function renderMsg(entry) {
    if (entry.platform === 'system') {
      var sys = document.createElement('div');
      sys.style.cssText = 'padding:4px 0;color:var(--muted);font-style:italic;font-size:13px';
      sys.textContent = entry.message;
      return sys;
    }

    var row = document.createElement('div');
    row.style.cssText = 'padding:4px 0;word-wrap:break-word';

    var html = platformBadge(entry.platform);
    if (entry.resolvedBadges) {
      entry.resolvedBadges.forEach(function (b) { html += badgeImg(b); });
    }

    var color = entry.color || '#efeff1';
    html += '<strong style="color:' + color + '">' + escHtml(entry.user) + '</strong>';
    html += '<span style="color:var(--muted)">: </span>';
    html += entry.parsedMessage ? renderSegments(entry.parsedMessage) : escHtml(entry.message);
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

  document.getElementById('sendForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('chatInput');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    fetch('/api/admin/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    }).catch(function () {});
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
    if (s.type === 'emote') return '<img class="emote" src="' + esc(s.url) + '" alt="' + esc(s.name) +
      '" title="' + esc(s.name) + '">';
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
  if (!msg) return res.status(400).json({ error: 'message is required' })
  if (msg.length > 500) return res.status(400).json({ error: 'message too long' })

  if (!chatConfig.enabled) {
    return res.status(503).json({ error: 'chat is disabled (CHAT_ENABLED=false)' })
  }

  const sent = chatBus.say(msg)
  if (!sent) return res.status(503).json({ error: 'chat connection not available' })

  res.json({ sent: true })
}

module.exports = { chatPage, chatOverlayPage, chatStream, overlayStream, chatSend }
