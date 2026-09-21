/**
 * playerRoutes.js
 *
 * Web control surface for the song request player.
 *
 * The bot does not own the queue — the Electron player does. Everything here
 * reads the bot's mirror of the player's state and relays control frames back
 * over the same WebSocket, so the web page and the Electron sidebar are two
 * views of one source of truth.
 */

const { esc } = require('./layout')
const { logColor } = require('../utils/logger')

const CONTROLS = new Set([
  'skip', 'pause', 'volume', 'clearQueue', 'removeFromQueue', 'toggleRequests', 'setBackupPlaylist'
])

const PLAYER_JS = `
var state = null;

function h(tag, attrs, kids) {
  var el = document.createElement(tag);
  for (var k in (attrs || {})) {
    if (k === 'class') el.className = attrs[k];
    else if (k === 'text') el.textContent = attrs[k];
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
    else el.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(function (kid) { if (kid) el.appendChild(kid); });
  return el;
}

function toast(msg, bad) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.style.color = bad ? 'var(--bad)' : 'var(--good)';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.style.opacity = '0'; }, 2600);
}

function control(action, value) {
  return fetch('/api/admin/player/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, value: value })
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'failed'); });
  }).catch(function (e) { toast(e.message, true); });
}

function renderNowPlaying() {
  var box = document.getElementById('now');
  box.textContent = '';

  if (!state.connected) {
    box.appendChild(h('div', { class: 'empty', text: 'The player app is not running.' }));
    return;
  }
  if (!state.current) {
    box.appendChild(h('div', { class: 'empty', text: 'Nothing is playing.' }));
    return;
  }

  box.appendChild(h('div', { style: 'font-weight:700;font-size:16px;margin-bottom:4px', text: state.current.title }));
  box.appendChild(h('div', { class: 'muted', style: 'font-size:13px' , text:
    (state.backupMode ? 'From the backup playlist' : 'Requested by ' + (state.current.requester || 'unknown')) }));
}

function renderQueue() {
  var tbody = document.getElementById('queue');
  tbody.textContent = '';

  if (!state.queue.length) {
    tbody.appendChild(h('tr', {}, [h('td', { class: 'muted', text: 'The queue is empty.' })]));
    return;
  }

  state.queue.forEach(function (track, i) {
    tbody.appendChild(h('tr', {}, [
      h('td', { class: 'rank', text: '#' + (i + 1) }),
      h('td', {}, [
        h('div', { text: track.title }),
        h('div', { class: 'muted', style: 'font-size:12px', text: 'by ' + (track.requester || 'unknown') })
      ]),
      h('td', { style: 'width:1%' }, [
        h('button', {
          class: 'danger',
          text: 'Remove',
          onclick: function () { control('removeFromQueue', i); }
        })
      ])
    ]));
  });
}

function render() {
  document.getElementById('conn').textContent = state.connected ? 'connected' : 'player offline';
  document.getElementById('conn').className = 'chip ' + (state.connected ? 'on' : 'off');

  document.getElementById('stale').hidden = !(state.connected && state.legacy);

  document.getElementById('pause').textContent = state.isPaused ? 'Resume' : 'Pause';
  document.getElementById('requests').textContent = state.requestsEnabled ? 'Requests on' : 'Requests off';
  document.getElementById('requests').className = state.requestsEnabled ? 'primary' : 'danger';

  var vol = document.getElementById('vol');
  if (document.activeElement !== vol) vol.value = state.volume;
  document.getElementById('volNum').textContent = state.volume + '%';

  var backup = document.getElementById('backup');
  if (document.activeElement !== backup) backup.value = state.backupPlaylistUrl || '';

  ['pause', 'skipBtn', 'clear', 'requests'].forEach(function (id) {
    document.getElementById(id).disabled = !state.connected;
  });

  renderNowPlaying();
  renderQueue();
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('skipBtn').addEventListener('click', function () { control('skip'); });
  document.getElementById('pause').addEventListener('click', function () { control('pause'); });
  document.getElementById('requests').addEventListener('click', function () { control('toggleRequests'); });
  document.getElementById('clear').addEventListener('click', function () {
    if (confirm('Clear the whole queue?')) control('clearQueue');
  });

  var vol = document.getElementById('vol');
  vol.addEventListener('input', function () { document.getElementById('volNum').textContent = vol.value + '%'; });
  vol.addEventListener('change', function () { control('volume', Number(vol.value)); });

  document.getElementById('saveBackup').addEventListener('click', function () {
    control('setBackupPlaylist', document.getElementById('backup').value.trim())
      .then(function () { toast('Backup playlist updated'); });
  });

  document.getElementById('requestForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('requestInput');
    fetch('/api/admin/player/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: input.value.trim() })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) throw new Error(d.error);
        input.value = '';
        toast('Queued: ' + d.title);
      })
      .catch(function (err) { toast(err.message, true); });
  });

  var stream = new EventSource('/api/admin/player/stream');
  stream.onmessage = function (msg) {
    try { state = JSON.parse(msg.data); render(); } catch (e) {}
  };
});
`

function playerBody() {
  return `<div id="toast" style="position:fixed;bottom:22px;right:22px;background:var(--surface);
      border:1px solid var(--border);padding:11px 17px;border-radius:9px;opacity:0;
      transition:opacity .25s;z-index:50;font-size:13.5px;font-weight:600"></div>

    <div class="row" style="justify-content:space-between;margin-bottom:16px">
      <span class="chip" id="conn">connecting...</span>
    </div>

    <div class="card" id="stale" hidden
         style="margin-bottom:12px;border-color:rgba(245,185,66,.45)">
      <strong style="color:var(--warn)">The player app is out of date.</strong>
      <div class="muted" style="font-size:13px;margin-top:6px;line-height:1.5">
        It is running a build from before this page existed, so the queue stays empty and the
        controls below do nothing. Close the player and start it from source
        (<code>npm start</code> inside <code>player/</code>), or rebuild the installer with
        <code>npm run build</code>. Requesting songs still works either way.
      </div>
    </div>

    <div class="card" id="now" style="margin-bottom:12px;min-height:76px"></div>

    <div class="card" style="margin-bottom:22px">
      <div class="row" style="gap:10px;margin-bottom:16px">
        <button id="pause">Pause</button>
        <button id="skipBtn">Skip</button>
        <button id="requests">Requests</button>
        <button id="clear" class="danger">Clear queue</button>
      </div>
      <div class="row" style="gap:12px">
        <label for="vol" style="margin:0">Volume</label>
        <input type="range" id="vol" min="0" max="100" style="flex:1 1 200px;accent-color:var(--accent)" />
        <span id="volNum" class="muted" style="width:44px;font-variant-numeric:tabular-nums">—</span>
      </div>
    </div>

    <h2>Request a song</h2>
    <form id="requestForm" class="card row" style="gap:10px;align-items:flex-end;margin-bottom:22px">
      <div class="field" style="flex:1 1 300px;margin:0">
        <label for="requestInput">YouTube link or song name</label>
        <input type="text" id="requestInput" placeholder="Paste a link or type a song name" required />
      </div>
      <button class="primary" type="submit">Queue it</button>
    </form>

    <h2>Queue</h2>
    <div class="card" style="padding:0;margin-bottom:22px">
      <div class="scroll"><table><tbody id="queue"></tbody></table></div>
    </div>

    <h2>Backup playlist</h2>
    <div class="card row" style="gap:10px;align-items:flex-end">
      <div class="field" style="flex:1 1 300px;margin:0">
        <label for="backup">Plays when the queue runs dry</label>
        <input type="url" id="backup" placeholder="https://www.youtube.com/playlist?list=..." />
      </div>
      <button id="saveBackup">Save &amp; switch</button>
    </div>`
}

/**
 * Mounts the player page and API onto the admin router.
 *
 * @param {import('express').Router} router
 * @param {{auth: object, page: Function, player: object}} deps
 */
module.exports = function mountPlayerRoutes(router, { auth, page, player }) {
  router.get('/player', auth.requireAdmin, (_req, res) => {
    res.send(page({
      title: 'Player · StreamerStalker',
      active: '/player',
      heading: 'Player',
      sub: 'Queue and playback for song requests. Mirrors the player app.',
      admin: true,
      body: playerBody(),
      script: PLAYER_JS
    }))
  })

  router.get('/api/admin/player/state', auth.requireAdmin, (_req, res) => {
    res.json(player.getState())
  })

  router.get('/api/admin/player/stream', auth.requireAdmin, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    if (res.flushHeaders) res.flushHeaders()
    res.setTimeout(0)
    res.write('retry: 3000\n\n')

    const send = (state) => {
      try { res.write(`data: ${JSON.stringify(state)}\n\n`) } catch {}
    }
    send(player.getState())

    const unsubscribe = player.onStateChange(send)
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n') } catch {}
    }, 25000)

    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  router.post('/api/admin/player/control', auth.requireAdmin, (req, res) => {
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      return res.status(415).json({ error: 'expected application/json' })
    }

    const action = String(req.body?.action ?? '')
    if (!CONTROLS.has(action)) return res.status(400).json({ error: 'unknown action' })

    if (!player.control(action, req.body?.value)) {
      return res.status(503).json({ error: 'the player app is not running' })
    }

    logColor('cyan', `[SYSTEM] Player control: ${action}`)
    res.json({ ok: true, action })
  })

  router.post('/api/admin/player/request', auth.requireAdmin, async (req, res) => {
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      return res.status(415).json({ error: 'expected application/json' })
    }

    const input = String(req.body?.input ?? '').trim()
    if (!input) return res.status(400).json({ error: 'nothing to queue' })

    const { result, title, position } = await player.enqueue(input, 'Web')
    if (result === 'player_offline')     return res.status(503).json({ error: 'the player app is not running' })
    if (result === 'requests_disabled')  return res.status(409).json({ error: 'song requests are turned off' })
    if (result === 'no_results')         return res.status(404).json({ error: `nothing found for "${esc(input)}"` })

    logColor('green', `[SYSTEM] Queued "${title}" from the web player`)
    res.json({ title, position })
  })
}
