/**
 * publicRoutes.js
 *
 * Read-only pages that are safe to expose to the internet. These exist to hold
 * the things that do not fit in a Twitch message — the full command list, the
 * whole leaderboard, every sound — so chat commands can answer with a link.
 */

const express = require('express')
const { page, esc } = require('./layout')
const { PASSIVE, byCategory } = require('./commandDocs')
const points = require('../integrations/points/pointsStore')
const modules = require('../integrations/points/modules')
const customCommands = require('../integrations/twitch/customCommands')
const commandToggles = require('../integrations/twitch/commandToggles')
const cannonStacks = require('../integrations/twitch/cannonStacks')
const sounds = require('../integrations/overlay/sounds')
const emotes = require('../integrations/overlay/emotes')
const bus = require('../integrations/overlay/bus')
const botState = require('../state/botState')

const PERM_CHIP = {
  mods: '<span class="chip mods">mods</span>',
  broadcaster: '<span class="chip mods">broadcaster</span>',
  all: ''
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${s}s`
}

// ---------------------------------------------------------------- commands

function commandsBody() {
  const disabled = new Set(commandToggles.list())

  const groups = byCategory().map(({ cat, entries, note }) => {
    const rows = entries.map(entry => {
      const off = disabled.has(entry.name)
      const aliases = (entry.aliases || []).length
        ? `<div class="muted" style="font-size:12px;margin-top:4px">also ${entry.aliases.map(a => `!${esc(a)}`).join(', ')}</div>`
        : ''
      return `<tr${off ? ' style="opacity:.42"' : ''}>
        <td><span class="cmd">${esc(entry.usage)}</span>${aliases}</td>
        <td>${esc(entry.desc)}</td>
        <td style="text-align:right">${off ? '<span class="chip off">off</span>' : PERM_CHIP[entry.perm]}</td>
      </tr>`
    }).join('')

    const caption = note
      ? `<div class="muted" style="font-size:13px;margin:-6px 0 12px;max-width:70ch">${esc(note)}</div>`
      : ''

    return `<h2>${esc(cat)}</h2>${caption}
      <div class="card" style="padding:0"><div class="scroll"><table><tbody>${rows}</tbody></table></div></div>`
  }).join('')

  const custom = Object.entries(customCommands.getAll())
  const customSection = custom.length
    ? `<h2>Custom commands</h2>
       <div class="card" style="padding:0"><div class="scroll"><table><tbody>${
         custom.sort((a, b) => a[0].localeCompare(b[0])).map(([name, response]) =>
           `<tr><td style="width:1%"><span class="cmd">!${esc(name)}</span></td><td>${esc(response)}</td></tr>`
         ).join('')
       }</tbody></table></div></div>`
    : ''

  const passive = `<h2>Happens on its own</h2>
    <div class="tiles">${PASSIVE.map(p => `
      <div class="tile" style="grid-column:span 1">
        <div style="font-weight:700;margin-bottom:6px">${esc(p.title)}</div>
        <div class="muted" style="font-size:13px;line-height:1.5">${esc(p.desc)}</div>
      </div>`).join('')}</div>`

  return groups + customSection + passive
}

// ---------------------------------------------------------------- leaderboard

function removeButton(key, name) {
  return `<td style="width:1%">
    <button type="button" class="danger" data-remove="${esc(key)}" data-name="${esc(name)}">Remove</button>
  </td>`
}

function leaderboardBody(isAdmin) {
  const currency = points.getCurrencyName()
  const top = points.leaderboard(100)

  if (top.length === 0 && !isAdmin) {
    return `<div class="card"><div class="empty">Nobody has earned any ${esc(currency)} yet.</div></div>`
  }

  const medal = (i) => (i === 0 ? ' g' : i === 1 ? ' s' : i === 2 ? ' b' : '')
  const rows = top.map((entry, i) => `<tr>
      <td class="rank${medal(i)}">#${i + 1}</td>
      <td>${esc(entry.name)}</td>
      <td class="amount">${esc(points.format(entry.amount))}</td>
      ${isAdmin ? removeButton(entry.key, entry.name) : ''}
    </tr>`).join('')

  const total = top.reduce((sum, e) => sum + e.amount, 0)

  const board = top.length === 0
    ? `<div class="card"><div class="empty">Nobody has earned any ${esc(currency)} yet.</div></div>`
    : `<div class="card" style="padding:0"><div class="scroll"><table>
        <thead><tr><th>Rank</th><th>Chatter</th><th style="text-align:right">${esc(currency)}</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
      <div class="sub" style="margin-top:14px">${top.length} ranked &middot; ${esc(points.format(total))} ${esc(currency)} in circulation</div>`

  if (!isAdmin) return board

  // Entries the public board filters out still sit in the ledger, so an admin
  // needs a way to reach them — otherwise a stray name can never be cleared.
  const ranked = new Set(top.map(e => e.key))
  const hidden = points.allBalances().filter(b => !ranked.has(b.key))

  const hiddenSection = hidden.length === 0 ? '' : `
    <h2>Not shown publicly</h2>
    <div class="card" style="padding:0"><div class="scroll"><table>
      <tbody>${hidden.map(b => `<tr>
        <td>${esc(b.name)}</td>
        <td class="amount">${esc(points.format(b.amount))}</td>
        ${removeButton(b.key, b.name)}
      </tr>`).join('')}</tbody>
    </table></div></div>
    <div class="sub" style="margin-top:10px">
      Zero balances, plus the broadcaster and bot accounts, which are always excluded.
    </div>`

  return board + hiddenSection
}

const LEADERBOARD_ADMIN_JS = `
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn) return;
    var name = btn.dataset.name;
    if (!confirm('Remove ' + name + ' from the ledger entirely?')) return;

    btn.disabled = true;
    fetch('/api/admin/points/' + encodeURIComponent(btn.dataset.remove), { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) throw new Error('could not remove ' + name);
        var row = btn.closest('tr');
        row.parentNode.removeChild(row);
      })
      .catch(function (err) {
        btn.disabled = false;
        alert(err.message);
      });
  });
`

// ---------------------------------------------------------------- sounds

function soundsBody() {
  const list = sounds.list()
  if (list.length === 0) {
    return `<div class="card"><div class="empty">No sounds are installed yet.</div></div>`
  }

  const enabled = modules.isEnabled('sounds')
  const note = enabled ? '' :
    `<div class="card" style="margin-bottom:16px;border-color:rgba(248,113,113,.4)">
       <span class="chip off">disabled</span>
       <span class="muted" style="margin-left:8px">The sounds module is currently switched off, so these will not play.</span>
     </div>`

  const items = list.map(name => `<tr>
      <td style="width:1%"><span class="cmd">!${esc(name)}</span></td>
      <td class="muted">!playsound ${esc(name)}</td>
      <td style="text-align:right;width:1%">
        <button type="button" data-sound="${esc(name)}">Preview</button>
      </td>
    </tr>`).join('')

  return `${note}<div class="card" style="margin-bottom:12px">
      <div class="row" style="gap:12px">
        <label for="previewVol" style="margin:0;white-space:nowrap">Preview volume</label>
        <input type="range" id="previewVol" min="0" max="100" value="80"
               style="flex:1 1 180px;accent-color:var(--accent)" />
        <span id="previewVolNum" class="muted" style="width:44px;font-variant-numeric:tabular-nums">80%</span>
        <button type="button" id="stopPreview">Stop</button>
      </div>
    </div>
    <div class="card" style="padding:0"><div class="scroll"><table>
      <thead><tr><th>Command</th><th>Long form</th><th></th></tr></thead>
      <tbody>${items}</tbody>
    </table></div></div>
    <div class="sub" style="margin-top:14px">
      ${list.length} sound${list.length === 1 ? '' : 's'} &middot;
      Previews play in your browser only — they do not trigger the stream overlay.
    </div>`
}

const SOUND_PREVIEW_JS = `
  var playing = null;
  var slider = document.getElementById('previewVol');
  var label = document.getElementById('previewVolNum');

  // Remembered per browser. Wrapped because storage throws in private windows.
  try {
    var saved = localStorage.getItem('ss-preview-volume');
    if (saved !== null) slider.value = saved;
  } catch (e) {}

  function level() { return Number(slider.value) / 100; }

  function syncLabel() {
    label.textContent = slider.value + '%';
    if (playing) playing.volume = level();
  }
  syncLabel();

  slider.addEventListener('input', syncLabel);
  slider.addEventListener('change', function () {
    try { localStorage.setItem('ss-preview-volume', slider.value); } catch (e) {}
  });

  document.getElementById('stopPreview').addEventListener('click', function () {
    if (playing) { playing.pause(); playing = null; }
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-sound]');
    if (!btn) return;
    if (playing) { playing.pause(); playing = null; }
    playing = new Audio('/api/sound/' + encodeURIComponent(btn.dataset.sound));
    playing.volume = level();
    playing.play().catch(function () { btn.textContent = 'Blocked'; });
  });
`

// ---------------------------------------------------------------- stats

function statsBody() {
  const currency = points.getCurrencyName()
  const all = points.leaderboard(100000)
  const circulating = all.reduce((sum, e) => sum + e.amount, 0)
  const customCount = Object.keys(customCommands.getAll()).length

  const tiles = [
    ['Uptime', botState.startTime ? duration(Date.now() - botState.startTime) : '—'],
    ['Emotes loaded', emotes.count().toLocaleString('en-US')],
    ['Sounds', sounds.list().length],
    ['Custom commands', customCount],
    [`${currency} in circulation`, points.format(circulating)],
    ['Chatters with a balance', all.length],
    ['Cannon stacks', cannonStacks.getStacks().toLocaleString('en-US')],
    ['Overlays connected', bus.clientCount()]
  ].map(([label, value]) =>
    `<div class="tile"><div class="n">${esc(value)}</div><div class="l">${esc(label)}</div></div>`
  ).join('')

  const moduleRows = modules.list().map(m => `<tr>
      <td>${esc(m.name)}</td>
      <td style="text-align:right"><span class="chip ${m.enabled ? 'on' : 'off'}">${m.enabled ? 'on' : 'off'}</span></td>
    </tr>`).join('')

  const disabled = commandToggles.list()
  const disabledSection = disabled.length
    ? `<h2>Disabled commands</h2><div class="card">${
        disabled.map(n => `<span class="cmd" style="margin-right:12px">!${esc(n)}</span>`).join('')
      }</div>`
    : ''

  return `<div class="tiles">${tiles}</div>
    <h2>Modules</h2>
    <div class="card" style="padding:0"><div class="scroll"><table><tbody>${moduleRows}</tbody></table></div></div>
    ${disabledSection}`
}

// ---------------------------------------------------------------- landing

function landingBody() {
  const currency = points.getCurrencyName()
  const cards = [
    ['/commands', 'Commands', 'Everything you can type in chat, what it does, and who can use it.'],
    ['/leaderboard', 'Leaderboard', `Who has the most ${currency}.`],
    ['/sounds', 'Sounds', 'Every sound that can be played on stream, with previews.'],
    ['/stats', 'Stats', 'What the bot is doing right now.']
  ].map(([href, title, desc]) => `
    <a class="tile" href="${href}" style="display:block">
      <div style="font-weight:700;font-size:16px">${esc(title)}</div>
      <div class="muted" style="font-size:13px;margin-top:5px;line-height:1.5">${esc(desc)}</div>
    </a>`).join('')

  return `<div class="tiles">${cards}</div>`
}

// ---------------------------------------------------------------- router

function createPublicRouter({ admin = () => false } = {}) {
  const router = express.Router()
  const render = (req, opts) => page({ ...opts, admin: admin(req) })

  router.get('/', (req, res) => {
    res.send(render(req, {
      title: 'SurferStalker',
      heading: 'SurferStalker',
      sub: 'Twitch bot for SurferKiller. Pick a page.',
      body: landingBody()
    }))
  })

  router.get('/health', (_req, res) => res.status(200).send('OK'))

  router.get('/commands', (req, res) => {
    res.send(render(req, {
      title: 'Commands · SurferStalker',
      active: '/commands',
      heading: 'Commands',
      sub: 'Type these in Twitch chat. Numbers shown are defaults and can be tuned.',
      body: commandsBody()
    }))
  })

  router.get('/leaderboard', (req, res) => {
    const isAdmin = admin(req)
    res.send(render(req, {
      title: 'Leaderboard · SurferStalker',
      active: '/leaderboard',
      heading: 'Leaderboard',
      sub: isAdmin
        ? `Top 100 by ${points.getCurrencyName()}. You are logged in, so you can remove entries.`
        : `Top 100 by ${points.getCurrencyName()}.`,
      body: leaderboardBody(isAdmin),
      script: isAdmin ? LEADERBOARD_ADMIN_JS : ''
    }))
  })

  router.get('/sounds', (req, res) => {
    res.send(render(req, {
      title: 'Sounds · SurferStalker',
      active: '/sounds',
      heading: 'Sounds',
      sub: 'Each of these works as its own chat command.',
      body: soundsBody(),
      script: SOUND_PREVIEW_JS
    }))
  })

  router.get('/stats', (req, res) => {
    res.send(render(req, {
      title: 'Stats · SurferStalker',
      active: '/stats',
      heading: 'Stats',
      sub: 'Live numbers from the running bot.',
      body: statsBody()
    }))
  })

  // Sound preview for the sounds page. Mirrors the overlay's allowlist guard:
  // only names the scanner actually found can resolve to a file on disk.
  router.get('/api/sound/:name', (req, res) => {
    const file = sounds.fileFor(req.params.name)
    if (!file) return res.status(404).json({ error: 'unknown sound' })
    res.sendFile(require('path').join(sounds.directory(), file))
  })

  router.get('/api/leaderboard', (_req, res) => {
    res.json({ currency: points.getCurrencyName(), entries: points.leaderboard(100) })
  })

  router.get('/api/stats', (_req, res) => {
    const all = points.leaderboard(100000)
    res.json({
      uptimeMs: botState.startTime ? Date.now() - botState.startTime : null,
      emotesLoaded: emotes.count(),
      sounds: sounds.list().length,
      customCommands: Object.keys(customCommands.getAll()).length,
      currency: points.getCurrencyName(),
      circulating: all.reduce((sum, e) => sum + e.amount, 0),
      chattersWithBalance: all.length,
      cannonStacks: cannonStacks.getStacks(),
      overlaysConnected: bus.clientCount(),
      modules: modules.list(),
      disabledCommands: commandToggles.list()
    })
  })

  return router
}

module.exports = createPublicRouter
