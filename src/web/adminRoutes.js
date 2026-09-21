/**
 * adminRoutes.js
 *
 * Authenticated control panel: module settings, command toggles, custom
 * commands, the economy, a live log tail, and the song request player.
 *
 * Every mutation requires a JSON content type. Combined with the SameSite=Lax
 * session cookie that blocks cross-site form posts, which is the CSRF exposure
 * that matters once this server is reachable from the internet.
 */

const express = require('express')
const { page, esc } = require('./layout')
const auth = require('./auth')
const { documentedNames } = require('./commandDocs')
const { getHistory, subscribe, logColor } = require('../utils/logger')
const points = require('../integrations/points/pointsStore')
const modules = require('../integrations/points/modules')
const customCommands = require('../integrations/twitch/customCommands')
const commandToggles = require('../integrations/twitch/commandToggles')
const sounds = require('../integrations/overlay/sounds')
const overlayActions = require('../integrations/overlay/actions')
const player = require('../integrations/player/songRequestClient')
const chatTimers = require('../integrations/twitch/chatTimers')
const settings = require('../config/settings')
const { streamer, twitch } = require('../config/env')

const BUILT_IN = documentedNames().sort()

function wantsJson(req, res) {
  if ((req.headers['content-type'] || '').includes('application/json')) return true
  res.status(415).json({ error: 'expected application/json' })
  return false
}

// ---------------------------------------------------------------- login page

function loginBody(error) {
  const note = error
    ? `<div class="card" style="border-color:rgba(248,113,113,.45);margin-bottom:16px;color:var(--bad)">${esc(error)}</div>`
    : ''

  return `${note}<div class="card" style="max-width:380px">
    <form method="post" action="/login">
      <div class="field">
        <label for="pw">Admin password</label>
        <input type="password" id="pw" name="password" autocomplete="current-password" autofocus required />
      </div>
      <button class="primary" type="submit" style="width:100%">Log in</button>
    </form>
  </div>`
}

function disabledBody() {
  return `<div class="card" style="max-width:560px">
    <p>The control panel is switched off because no admin password is configured.</p>
    <p class="muted" style="margin-top:10px">
      Set <code>WEB_ADMIN_PASSWORD</code> in the bot's <code>.env</code> file and restart to enable it.
      Until then only the public pages are reachable, which is the safe default for a server exposed to the internet.
    </p>
  </div>`
}

// ---------------------------------------------------------------- dashboard

const DASHBOARD_JS = `
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
  t.style.borderColor = bad ? 'var(--bad)' : 'var(--good)';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.style.opacity = '0'; }, 3200);
}

// Confirmation right where the pointer already is — the corner toast is easy
// to miss when you are looking at the field you just edited.
function flash(el) {
  el.style.transition = 'border-color .15s';
  el.style.borderColor = 'var(--good)';
  clearTimeout(el._flash);
  el._flash = setTimeout(function () { el.style.borderColor = ''; }, 1200);
}

async function api(method, path, body) {
  var res = await fetch(path, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

async function load() {
  state = await api('GET', '/api/admin/state');
  render();
}

function labelFor(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, function (c) { return c.toUpperCase(); });
}

function renderModules() {
  var wrap = document.getElementById('modules');
  wrap.textContent = '';

  state.modules.forEach(function (mod) {
    var fields = Object.keys(mod.config)
      .filter(function (k) { return k !== 'enabled'; })
      .map(function (key) {
        var input = h('input', { type: 'number', min: '0', value: mod.config[key] });
        var save = function () {
          var patch = {};
          patch[key] = input.value;
          api('POST', '/api/admin/modules/' + mod.name, patch)
            .then(function (res) {
              mod.config[key] = res.config[key];
              input.value = res.config[key];
              flash(input);
              toast(labelFor(key) + ' saved — ' + mod.name + ' is now ' + res.config[key]);
            })
            .catch(function (e) { toast(e.message, true); });
        };
        input.addEventListener('change', save);
        // A number field only fires "change" on blur, so someone who edits and
        // then clicks straight onto another control can miss that it saved.
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
        return h('div', { class: 'field', style: 'flex:1 1 150px;margin-bottom:0' }, [
          h('label', { text: labelFor(key) }),
          input
        ]);
      });

    var toggle = h('button', {
      class: mod.config.enabled ? 'primary' : '',
      text: mod.config.enabled ? 'On' : 'Off',
      onclick: function () {
        api('POST', '/api/admin/modules/' + mod.name, { enabled: !mod.config.enabled })
          .then(function () { mod.config.enabled = !mod.config.enabled; renderModules(); toast(mod.name + ' ' + (mod.config.enabled ? 'enabled' : 'disabled')); })
          .catch(function (e) { toast(e.message, true); });
      }
    });

    wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:12px' }, [
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:14px' }, [
        h('div', { style: 'font-weight:700;font-size:15px', text: mod.name }),
        toggle
      ]),
      h('div', { class: 'row', style: 'gap:12px;align-items:flex-end' }, fields)
    ]));
  });
}

function renderCommands() {
  var tbody = document.getElementById('commands');
  var filter = document.getElementById('cmdFilter').value.toLowerCase();
  tbody.textContent = '';

  state.commands
    .filter(function (c) { return !filter || c.name.indexOf(filter) !== -1; })
    .forEach(function (cmd) {
      var btn = h('button', {
        class: cmd.disabled ? 'danger' : '',
        text: cmd.disabled ? 'Disabled' : 'Enabled',
        onclick: function () {
          api('POST', '/api/admin/commands/' + cmd.name, { disabled: !cmd.disabled })
            .then(function () { cmd.disabled = !cmd.disabled; renderCommands(); })
            .catch(function (e) { toast(e.message, true); });
        }
      });
      if (cmd.protected) { btn.disabled = true; btn.textContent = 'Locked'; }

      var nameCell = [h('span', { class: 'cmd', text: '!' + cmd.name })];

      tbody.appendChild(h('tr', {}, [
        h('td', {}, nameCell),
        h('td', { style: 'text-align:right;width:1%' }, [btn])
      ]));
    });
}

function renderCustom() {
  var tbody = document.getElementById('custom');
  tbody.textContent = '';

  if (!state.custom.length) {
    tbody.appendChild(h('tr', {}, [h('td', { class: 'muted', text: 'No custom commands yet.' })]));
    return;
  }

  state.custom.forEach(function (cmd) {
    var input = h('input', { type: 'text', value: cmd.response });
    tbody.appendChild(h('tr', {}, [
      h('td', { style: 'width:1%' }, [h('span', { class: 'cmd', text: '!' + cmd.name })]),
      h('td', {}, [input]),
      h('td', { style: 'width:1%;white-space:nowrap' }, [
        h('button', {
          text: 'Save',
          onclick: function () {
            api('PUT', '/api/admin/custom/' + cmd.name, { response: input.value })
              .then(function () { cmd.response = input.value; toast('!' + cmd.name + ' saved'); })
              .catch(function (e) { toast(e.message, true); });
          }
        }),
        h('button', {
          class: 'danger',
          style: 'margin-left:6px',
          text: 'Delete',
          onclick: function () {
            if (!confirm('Delete !' + cmd.name + '?')) return;
            api('DELETE', '/api/admin/custom/' + cmd.name)
              .then(load).then(function () { toast('!' + cmd.name + ' deleted'); })
              .catch(function (e) { toast(e.message, true); });
          }
        })
      ])
    ]));
  });
}

function timerCard(timer) {
  var fields = [
    ['Online every (min)', 'onlineIntervalMinutes'],
    ['Offline every (min)', 'offlineIntervalMinutes'],
    ['Chat lines needed', 'chatLinesRequired']
  ].map(function (pair) {
    var input = h('input', { type: 'number', min: '0', value: timer[pair[1]] });
    input.addEventListener('change', function () { timer[pair[1]] = Number(input.value); });
    return h('div', { class: 'field', style: 'flex:1 1 130px;margin:0' }, [
      h('label', { text: pair[0] }), input
    ]);
  });

  var name = h('input', { type: 'text', value: timer.name });
  name.addEventListener('change', function () { timer.name = name.value; });

  var messages = h('textarea', { rows: '3' });
  messages.value = timer.messages.join('\\n');
  messages.addEventListener('change', function () {
    timer.messages = messages.value.split('\\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
  });

  var toggle = h('button', {
    class: timer.enabled ? 'primary' : '',
    text: timer.enabled ? 'On' : 'Off',
    onclick: function () { timer.enabled = !timer.enabled; renderTimers(); }
  });

  var targetSelect = h('select');
  ['both', 'twitch', 'kick'].forEach(function (v) {
    var opt = h('option', { value: v, text: v.charAt(0).toUpperCase() + v.slice(1) });
    if ((timer.target || 'both') === v) opt.selected = true;
    targetSelect.appendChild(opt);
  });
  targetSelect.addEventListener('change', function () { timer.target = targetSelect.value; });

  return h('div', { class: 'card', style: 'margin-bottom:12px' }, [
    h('div', { class: 'row', style: 'gap:10px;margin-bottom:12px' }, [
      h('div', { class: 'field', style: 'flex:1 1 180px;margin:0' }, [
        h('label', { text: 'Name' }), name
      ]),
      h('div', { class: 'field', style: 'flex:0 0 auto;margin:0' }, [
        h('label', { text: 'Target' }), targetSelect
      ]),
      toggle,
      h('button', {
        class: 'danger',
        text: 'Delete',
        onclick: function () {
          if (!confirm('Delete the "' + timer.name + '" timer?')) return;
          state.timers.splice(state.timers.indexOf(timer), 1);
          renderTimers();
        }
      })
    ]),
    h('div', { class: 'row', style: 'gap:10px;align-items:flex-end;margin-bottom:12px' }, fields),
    h('div', { class: 'field', style: 'margin:0' }, [
      h('label', { text: 'Messages (one per line, picked in turn)' }), messages
    ])
  ]);
}

function renderTimers() {
  var wrap = document.getElementById('timers');
  wrap.textContent = '';
  if (!state.timers.length) {
    wrap.appendChild(h('div', { class: 'card' }, [h('div', { class: 'empty', text: 'No timers yet.' })]));
    return;
  }
  state.timers.forEach(function (t) { wrap.appendChild(timerCard(t)); });
}

function render() {
  document.getElementById('currency').value = state.currency;
  document.getElementById('timeTemplate').value = state.timeTemplate;
  // Blank when the .env value is in use, so the fallback option stays selected.
  document.getElementById('timezone').value =
    state.timezone === state.envTimezone ? '' : state.timezone;
  renderModules();
  renderCommands();
  renderCustom();
  renderTimers();
}

document.addEventListener('DOMContentLoaded', function () {
  load().catch(function (e) { toast(e.message, true); });

  document.getElementById('cmdFilter').addEventListener('input', renderCommands);

  document.getElementById('addCustom').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('newName').value.trim().replace(/^!/, '');
    var response = document.getElementById('newResponse').value.trim();
    api('PUT', '/api/admin/custom/' + encodeURIComponent(name), { response: response })
      .then(load)
      .then(function () {
        document.getElementById('newName').value = '';
        document.getElementById('newResponse').value = '';
        toast('!' + name + ' added');
      })
      .catch(function (err) { toast(err.message, true); });
  });

  document.getElementById('saveCurrency').addEventListener('click', function () {
    var el = document.getElementById('currency');
    api('POST', '/api/admin/currency', { name: el.value })
      .then(load).then(function () { flash(el); toast('Currency renamed'); })
      .catch(function (e) { toast(e.message, true); });
  });

  document.getElementById('saveTime').addEventListener('click', function () {
    var el = document.getElementById('timeTemplate');
    var tz = document.getElementById('timezone');
    api('POST', '/api/admin/settings', { timeTemplate: el.value, timezone: tz.value })
      .then(function (r) { flash(el); flash(tz); toast('!time now says: ' + r.preview); })
      .catch(function (e) { toast(e.message, true); });
  });

  document.getElementById('addTimer').addEventListener('click', function () {
    state.timers.push({
      name: 'New timer', enabled: true, target: 'both', onlineIntervalMinutes: 15,
      offlineIntervalMinutes: 30, chatLinesRequired: 0, messages: ['Edit me']
    });
    renderTimers();
  });

  document.getElementById('saveTimers').addEventListener('click', function () {
    // Commit any field still focused before reading the model.
    if (document.activeElement) document.activeElement.blur();
    api('POST', '/api/admin/timers', { timers: state.timers })
      .then(function (r) { state.timers = r.timers; renderTimers(); toast(r.timers.length + ' timers saved'); })
      .catch(function (e) { toast(e.message, true); });
  });

  document.getElementById('balanceForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('POST', '/api/admin/points', {
      user: document.getElementById('balUser').value.trim(),
      mode: document.getElementById('balMode').value,
      amount: document.getElementById('balAmount').value
    })
      .then(function (r) { toast(r.user + ' now has ' + r.balance); })
      .catch(function (err) { toast(err.message, true); });
  });

});
`

// Rendered server-side: the browser has no list of IANA zones to offer, and a
// select guarantees whatever comes back is one the runtime actually accepts.
function timezoneOptions() {
  return [`<option value="">Use .env (${esc(streamer.timezone)})</option>`]
    .concat(settings.availableTimezones().map(z => `<option value="${esc(z)}">${esc(z)}</option>`))
    .join('')
}

function dashboardBody() {
  return `<div id="toast" style="position:fixed;bottom:22px;right:22px;background:var(--surface);
      border:1px solid var(--border);padding:11px 17px;border-radius:9px;opacity:0;
      transition:opacity .25s;z-index:50;font-size:13.5px;font-weight:600"></div>

    <h2>Modules</h2>
    <div id="modules"></div>

    <h2>Economy</h2>
    <div class="card">
      <div class="row" style="gap:12px;align-items:flex-end;margin-bottom:18px">
        <div class="field" style="flex:1 1 200px;margin:0">
          <label for="currency">Currency name</label>
          <input type="text" id="currency" />
        </div>
        <button id="saveCurrency">Rename</button>
      </div>
      <form id="balanceForm" class="row" style="gap:12px;align-items:flex-end">
        <div class="field" style="flex:1 1 160px;margin:0">
          <label for="balUser">Chatter</label>
          <input type="text" id="balUser" placeholder="username" required />
        </div>
        <div class="field" style="flex:0 0 120px;margin:0">
          <label for="balMode">Action</label>
          <select id="balMode" style="font:inherit;font-size:14px;padding:9px 12px;border-radius:8px;
            border:1px solid var(--border);background:var(--bg);color:var(--text);width:100%">
            <option value="add">Give</option>
            <option value="remove">Remove</option>
            <option value="set">Set to</option>
          </select>
        </div>
        <div class="field" style="flex:0 0 130px;margin:0">
          <label for="balAmount">Amount</label>
          <input type="number" id="balAmount" min="0" value="100" required />
        </div>
        <button class="primary" type="submit">Apply</button>
      </form>
    </div>

    <div class="sub" style="margin-top:10px">
      To remove a chatter from the ledger entirely, use the
      <a href="/leaderboard">leaderboard</a> — it has a Remove button on every row
      while you are logged in.
    </div>

    <h2>Messages</h2>
    <div class="card">
      <div class="row" style="gap:12px;align-items:flex-end;margin-bottom:10px">
        <div class="field" style="flex:1 1 320px;margin:0">
          <label for="timeTemplate">What !time says</label>
          <input type="text" id="timeTemplate" />
        </div>
        <div class="field" style="flex:0 1 230px;margin:0">
          <label for="timezone">Timezone</label>
          <select id="timezone">${timezoneOptions()}</select>
        </div>
      </div>
      <div class="row" style="justify-content:space-between">
        <span class="muted" style="font-size:12.5px">
          Placeholders: <code>{time}</code>, <code>{streamer}</code>, <code>{timezone}</code>
        </span>
        <button id="saveTime">Save</button>
      </div>
    </div>

    <h2>Chat timers</h2>
    <div class="card" style="margin-bottom:12px">
      <span class="muted" style="font-size:12.5px">
        One timer fires at most every 5 minutes, and the one that has waited longest goes next.
        A timer is skipped while chat is quieter than its "chat lines needed" over the last 5 minutes —
        set that to 0 to let it fire regardless.
      </span>
    </div>
    <div id="timers"></div>
    <div class="row" style="margin-bottom:22px">
      <button id="addTimer">Add timer</button>
      <button id="saveTimers" class="primary">Save timers</button>
    </div>

    <h2>Custom commands</h2>
    <div class="card" style="padding:0;margin-bottom:12px">
      <div class="scroll"><table><tbody id="custom"></tbody></table></div>
    </div>
    <form id="addCustom" class="card row" style="gap:10px;align-items:flex-end">
      <div class="field" style="flex:0 0 190px;margin:0">
        <label for="newName">New command</label>
        <input type="text" id="newName" placeholder="mycommand" required />
      </div>
      <div class="field" style="flex:1 1 260px;margin:0">
        <label for="newResponse">Response</label>
        <input type="text" id="newResponse" placeholder="What the bot says" required />
      </div>
      <button class="primary" type="submit">Add</button>
    </form>

    <h2>Built-in commands</h2>
    <div class="field" style="max-width:300px">
      <input type="text" id="cmdFilter" placeholder="Filter commands..." />
    </div>
    <div class="card" style="padding:0">
      <div class="scroll"><table><tbody id="commands"></tbody></table></div>
    </div>`
}

// ---------------------------------------------------------------- logs

const LOGS_JS = `
var box = document.getElementById('log');
var pinned = true;
var COLORS = { red: '#f87171', green: '#00b884', yellow: '#f5b942', cyan: '#4fd1e5', default: '#adadb8' };

function line(entry) {
  var row = document.createElement('div');
  row.style.cssText = 'padding:2px 0;white-space:pre-wrap;word-break:break-word';

  var time = document.createElement('span');
  time.style.color = '#6b6b75';
  time.textContent = entry.time.split(' ')[1] + ' ';
  row.appendChild(time);

  if (entry.tag) {
    var tag = document.createElement('span');
    tag.style.cssText = 'color:#c9a6ff;font-weight:600';
    tag.textContent = '[' + entry.tag + '] ';
    row.appendChild(tag);
  }

  var text = document.createElement('span');
  text.style.color = COLORS[entry.color] || COLORS.default;
  text.textContent = entry.text;
  row.appendChild(text);

  box.appendChild(row);
  while (box.childElementCount > 600) box.removeChild(box.firstChild);
  if (pinned) box.scrollTop = box.scrollHeight;
}

box.addEventListener('scroll', function () {
  pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
});

document.getElementById('clear').addEventListener('click', function () { box.textContent = ''; });

var stream = new EventSource('/api/admin/logs/stream');
stream.onmessage = function (msg) {
  try { line(JSON.parse(msg.data)); } catch (e) {}
};
stream.onerror = function () {
  document.getElementById('conn').textContent = 'reconnecting...';
};
stream.onopen = function () {
  document.getElementById('conn').textContent = 'live';
};
`

function logsBody() {
  return `<div class="row" style="justify-content:space-between;margin-bottom:12px">
      <span class="chip on" id="conn">connecting...</span>
      <button id="clear">Clear view</button>
    </div>
    <div id="log" class="card" style="height:66vh;overflow-y:auto;font-family:'JetBrains Mono',
      'Cascadia Code',Consolas,monospace;font-size:12.5px;line-height:1.55"></div>`
}

// ---------------------------------------------------------------- router

function createAdminRouter() {
  const router = express.Router()
  router.use(express.json({ limit: '64kb' }))
  router.use(express.urlencoded({ extended: false, limit: '16kb' }))

  // ---- login / logout ----

  router.get('/login', (req, res) => {
    if (!auth.isAdminEnabled()) {
      return res.status(404).send(page({
        title: 'Control panel unavailable · StreamerStalker',
        heading: 'Control panel unavailable',
        body: disabledBody()
      }))
    }
    if (auth.isAuthed(req)) return res.redirect('/dashboard')
    res.send(page({ title: 'Log in · StreamerStalker', heading: 'Log in', body: loginBody('') }))
  })

  router.post('/login', (req, res) => {
    if (!auth.isAdminEnabled()) return res.status(404).send('Not Found')

    const locked = auth.lockoutRemaining(req)
    if (locked > 0) {
      const mins = Math.ceil(locked / 60000)
      return res.status(429).send(page({
        title: 'Log in · StreamerStalker',
        heading: 'Log in',
        body: loginBody(`Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
      }))
    }

    if (!auth.passwordMatches(req.body?.password)) {
      auth.recordFailure(req)
      logColor('yellow', `[SYSTEM] Failed admin login from ${req.ip}`)
      return res.status(401).send(page({
        title: 'Log in · StreamerStalker',
        heading: 'Log in',
        body: loginBody('Wrong password.')
      }))
    }

    auth.clearFailures(req)
    auth.setSession(req, res)
    logColor('green', `[SYSTEM] Admin logged in from ${req.ip}`)
    res.redirect('/dashboard')
  })

  router.get('/logout', (_req, res) => {
    auth.clearSession(res)
    res.redirect('/')
  })

  // ---- pages ----

  router.get('/dashboard', auth.requireAdmin, (_req, res) => {
    res.send(page({
      title: 'Dashboard · StreamerStalker',
      active: '/dashboard',
      heading: 'Dashboard',
      sub: 'Changes apply immediately — no restart needed.',
      admin: true,
      body: dashboardBody(),
      script: DASHBOARD_JS
    }))
  })

  router.get('/logs', auth.requireAdmin, (_req, res) => {
    res.send(page({
      title: 'Logs · StreamerStalker',
      active: '/logs',
      heading: 'Logs',
      sub: 'Live tail of everything the bot prints.',
      admin: true,
      body: logsBody(),
      script: LOGS_JS
    }))
  })

  // ---- state ----

  router.get('/api/admin/state', auth.requireAdmin, (_req, res) => {
    res.json({
      currency: points.getCurrencyName(),
      soundVolume: overlayActions.getVolume(),
      timeTemplate: settings.get('timeTemplate'),
      timezone: settings.timezone(),
      envTimezone: streamer.timezone,
      timers: chatTimers.getTimers(),
      modules: modules.getAll(),
      commands: BUILT_IN.map(name => ({
        name,
        disabled: commandToggles.isDisabled(name),
        protected: commandToggles.isProtected(name)
      })),
      custom: Object.entries(customCommands.getAll())
        .map(([name, response]) => ({ name, response }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      sounds: sounds.list()
    })
  })

  // ---- mutations ----

  router.post('/api/admin/modules/:name', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return
    const updated = modules.setConfig(req.params.name, req.body)
    if (!updated) return res.status(404).json({ error: 'unknown module' })
    logColor('green', `[SYSTEM] Module ${req.params.name} updated from the dashboard`)
    res.json({ name: req.params.name, config: updated })
  })

  router.post('/api/admin/commands/:name', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return
    const name = String(req.params.name).toLowerCase()
    if (!BUILT_IN.includes(name)) return res.status(404).json({ error: 'unknown command' })

    if (req.body?.disabled) {
      const result = commandToggles.disable(name)
      if (result === 'protected') return res.status(409).json({ error: 'that command cannot be disabled' })
    } else {
      commandToggles.enable(name)
    }
    logColor('green', `[SYSTEM] !${name} ${req.body?.disabled ? 'disabled' : 'enabled'} from the dashboard`)
    res.json({ name, disabled: commandToggles.isDisabled(name) })
  })

  router.put('/api/admin/custom/:name', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return
    const name = String(req.params.name || '').toLowerCase().replace(/^!/, '').trim()
    const response = String(req.body?.response ?? '').trim()

    if (!/^[a-z0-9_-]{1,30}$/.test(name)) {
      return res.status(400).json({ error: 'name must be 1-30 characters: letters, numbers, _ or -' })
    }
    if (!response) return res.status(400).json({ error: 'response cannot be empty' })
    if (response.length > 450) return res.status(400).json({ error: 'response is too long for a chat message' })

    const existing = customCommands.get(name)
    if (!existing) {
      if (BUILT_IN.includes(name)) return res.status(409).json({ error: `!${name} is a built-in command` })
      if (sounds.has(name)) return res.status(409).json({ error: `!${name} is a sound` })
      if (name === points.getCurrencyAlias()) return res.status(409).json({ error: `!${name} is the currency alias` })
      customCommands.add(name, response)
    } else {
      customCommands.edit(name, response)
    }

    logColor('green', `[SYSTEM] Custom command !${name} ${existing ? 'edited' : 'added'} from the dashboard`)
    res.json({ name, response })
  })

  router.delete('/api/admin/custom/:name', auth.requireAdmin, (req, res) => {
    const name = String(req.params.name || '').toLowerCase()
    if (!customCommands.remove(name)) return res.status(404).json({ error: 'no such custom command' })
    logColor('green', `[SYSTEM] Custom command !${name} deleted from the dashboard`)
    res.json({ name, deleted: true })
  })

  router.post('/api/admin/currency', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return
    const name = String(req.body?.name ?? '').trim()
    if (!name || name.length > 30) return res.status(400).json({ error: 'name must be 1-30 characters' })
    points.setCurrencyName(name)
    logColor('green', `[SYSTEM] Currency renamed to "${name}" from the dashboard`)
    res.json({ name, alias: points.getCurrencyAlias() })
  })

  router.post('/api/admin/soundvolume', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return
    const volume = Math.floor(Number(req.body?.volume))
    if (!Number.isFinite(volume) || volume < 0 || volume > 100) {
      return res.status(400).json({ error: 'volume must be 0-100' })
    }
    overlayActions.setVolume(volume)
    logColor('green', `[SYSTEM] Sound volume set to ${volume}% from the dashboard`)
    res.json({ volume })
  })

  router.post('/api/admin/settings', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return

    const template = String(req.body?.timeTemplate ?? '').trim()
    if (!template) return res.status(400).json({ error: 'the message cannot be empty' })
    if (template.length > 400) return res.status(400).json({ error: 'that is too long for a chat message' })

    // Empty is meaningful: it clears the override and falls back to .env.
    const zone = String(req.body?.timezone ?? '').trim()
    if (zone && !settings.isValidTimezone(zone)) {
      return res.status(400).json({ error: `"${zone}" is not a timezone this system knows` })
    }

    settings.set('timeTemplate', template)
    settings.set('timezone', zone)
    logColor('green', `[SYSTEM] !time updated from the dashboard (timezone ${settings.timezone()})`)

    // Echoing the real rendered message is the quickest way to spot a typo'd
    // placeholder or a timezone that is not the one you meant.
    res.json({
      timeTemplate: template,
      timezone: settings.timezone(),
      preview: settings.renderTime(twitch.channelCaseSensitive)
    })
  })

  router.post('/api/admin/timers', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return
    const result = chatTimers.saveTimers(req.body?.timers)
    if (!result.ok) return res.status(400).json({ error: result.error })
    logColor('green', `[SYSTEM] ${result.timers.length} chat timer(s) saved from the dashboard`)
    res.json({ timers: result.timers })
  })

  router.delete('/api/admin/points/:user', auth.requireAdmin, (req, res) => {
    const user = String(req.params.user || '').replace(/^@/, '')
    if (!points.forget(user)) return res.status(404).json({ error: 'no such chatter' })
    logColor('green', `[SYSTEM] Removed ${user} from the ledger via the dashboard`)
    res.json({ user, removed: true })
  })

  router.post('/api/admin/points', auth.requireAdmin, (req, res) => {
    if (!wantsJson(req, res)) return
    const user = String(req.body?.user ?? '').replace(/^@/, '').trim()
    const amount = Math.floor(Number(req.body?.amount))
    const mode = String(req.body?.mode ?? 'add')

    if (!user) return res.status(400).json({ error: 'no chatter given' })
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'amount must be 0 or more' })
    if (!['add', 'remove', 'set'].includes(mode)) return res.status(400).json({ error: 'unknown action' })

    const balance = mode === 'add' ? points.addPoints(user, amount)
      : mode === 'remove' ? points.removePoints(user, amount)
      : points.setBalance(user, amount)

    logColor('green', `[SYSTEM] ${mode} ${amount} ${points.getCurrencyName()} for ${user} from the dashboard`)
    res.json({ user, balance: points.format(balance) })
  })

  // ---- log stream ----

  router.get('/api/admin/logs/stream', auth.requireAdmin, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    if (res.flushHeaders) res.flushHeaders()
    res.setTimeout(0)
    res.write('retry: 3000\n\n')

    for (const entry of getHistory()) res.write(`data: ${JSON.stringify(entry)}\n\n`)

    const unsubscribe = subscribe((entry) => {
      try { res.write(`data: ${JSON.stringify(entry)}\n\n`) } catch {}
    })
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n') } catch {}
    }, 25000)

    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  // ---- player (page + API live in playerRoutes) ----

  require('./playerRoutes')(router, { auth, page, player })

  return router
}

module.exports = createAdminRouter
