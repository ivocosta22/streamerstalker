/**
 * layout.js
 *
 * Shared HTML shell and theme for every web page the bot serves.
 * Pages return body markup; this wraps it with the nav, styling and footer.
 */

const PUBLIC_NAV = [
  { href: '/commands', label: 'Commands' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/sounds', label: 'Sounds' },
  { href: '/stats', label: 'Stats' }
]

const ADMIN_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/chat', label: 'Chat' },
  { href: '/player', label: 'Player' },
  { href: '/logs', label: 'Logs' }
]

/** Escapes text destined for HTML. Every value that came from chat goes through this. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0e0e10;
    --surface: #18181b;
    --surface-2: #1f1f23;
    --border: #2f2f35;
    --text: #efeff1;
    --muted: #adadb8;
    --accent: #9146ff;
    --accent-soft: rgba(145, 70, 255, .16);
    --good: #00b884;
    --warn: #f5b942;
    --bad: #f87171;
  }

  html { -webkit-text-size-adjust: 100%; }

  body {
    background: var(--bg);
    color: var(--text);
    font: 15px/1.55 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ---- Header ---- */
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .bar {
    max-width: 1100px;
    margin: 0 auto;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    gap: 22px;
    flex-wrap: wrap;
  }

  .brand {
    font-weight: 800;
    font-size: 17px;
    color: var(--text);
    letter-spacing: -.2px;
    white-space: nowrap;
  }
  .brand:hover { text-decoration: none; }
  .brand span { color: var(--accent); }

  nav { display: flex; gap: 4px; flex-wrap: wrap; }

  nav a {
    color: var(--muted);
    padding: 7px 13px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
  }
  nav a:hover { background: var(--surface-2); color: var(--text); text-decoration: none; }
  nav a.on { background: var(--accent-soft); color: #c9a6ff; }
  nav .sep { width: 1px; background: var(--border); margin: 4px 8px; }

  /* ---- Page ---- */
  main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 56px; width: 100%; flex: 1; }

  h1 { font-size: 27px; font-weight: 800; letter-spacing: -.4px; }
  .sub { color: var(--muted); margin-top: 6px; font-size: 14px; }
  .page-head { margin-bottom: 26px; }

  h2 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .9px;
    color: var(--muted);
    margin: 32px 0 12px;
  }
  h2:first-child { margin-top: 0; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
  }

  /* ---- Tables ---- */
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .7px;
    color: var(--muted);
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td { padding: 11px 14px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--surface-2); }

  /* ---- Bits ---- */
  code, .cmd {
    font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
    font-size: 13px;
  }
  .cmd { color: #c9a6ff; font-weight: 600; white-space: nowrap; }

  .chip {
    display: inline-block;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .6px;
    padding: 3px 8px;
    border-radius: 5px;
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    white-space: nowrap;
  }
  .chip.mods { background: rgba(245,185,66,.13); color: var(--warn); border-color: rgba(245,185,66,.3); }
  .chip.on { background: rgba(0,184,132,.13); color: var(--good); border-color: rgba(0,184,132,.3); }
  .chip.off { background: rgba(248,113,113,.13); color: var(--bad); border-color: rgba(248,113,113,.3); }

  .platform-pills { display: inline-flex; gap: 3px; align-items: center; }

  .muted { color: var(--muted); }
  .empty { color: var(--muted); text-align: center; padding: 44px 20px; }

  /* ---- Stat tiles ---- */
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 12px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .tile .n { font-size: 26px; font-weight: 800; letter-spacing: -.6px; }
  .tile .l { font-size: 11px; text-transform: uppercase; letter-spacing: .7px; color: var(--muted); margin-top: 3px; }

  /* ---- Leaderboard rank ---- */
  .rank { font-weight: 800; color: var(--muted); width: 54px; }
  .rank.g { color: #ffd700; }
  .rank.s { color: #c0c0c0; }
  .rank.b { color: #cd7f32; }
  .amount { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* ---- Forms / buttons ---- */
  button, .btn {
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 15px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  button:hover, .btn:hover { border-color: var(--accent); text-decoration: none; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.danger { color: var(--bad); }
  button:disabled { opacity: .45; cursor: not-allowed; }

  input[type=text], input[type=password], input[type=number], input[type=url], textarea, select {
    font: inherit;
    font-size: 14px;
    padding: 9px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    width: 100%;
  }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 70px; line-height: 1.5; }

  label { font-size: 12px; font-weight: 600; color: var(--muted); display: block; margin-bottom: 5px; }
  .field { margin-bottom: 14px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

  footer {
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 12.5px;
    padding: 18px 20px;
    text-align: center;
  }

  @media (max-width: 620px) {
    .bar { gap: 12px; padding: 12px 16px; }
    main { padding: 24px 16px 44px; }
    h1 { font-size: 22px; }
    nav a { padding: 6px 10px; font-size: 13px; }
    nav .sep { display: none; }
    th, td { padding: 9px 11px; }
  }
`

/**
 * Wraps page markup in the full HTML document.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body      markup for <main>
 * @param {string} [opts.active]  nav href to highlight
 * @param {string} [opts.heading] page <h1>; omit to render body alone
 * @param {string} [opts.sub]     text under the heading
 * @param {boolean} [opts.admin]  show the admin nav links
 * @param {string} [opts.head]    extra markup for <head>
 * @param {string} [opts.script]  inline JS appended before </body>
 */
function page({ title, body, active = '', heading = '', sub = '', admin = false, head = '', script = '' }) {
  const link = (item) =>
    `<a href="${item.href}"${item.href === active ? ' class="on"' : ''}>${esc(item.label)}</a>`

  const nav = [
    ...PUBLIC_NAV.map(link),
    ...(admin ? ['<div class="sep"></div>', ...ADMIN_NAV.map(link)] : [])
  ].join('')

  const header = heading
    ? `<div class="page-head"><h1>${esc(heading)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${esc(title)}</title>
<style>${STYLE}</style>
${head}
</head>
<body>
<header>
  <div class="bar">
    <a class="brand" href="/">Surfer<span>Stalker</span></a>
    <nav>${nav}</nav>
  </div>
</header>
<main>${header}${body}</main>
<footer>SurferStalker${admin ? ' &middot; <a href="/logout">Log out</a>' : ''}</footer>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`
}

module.exports = { page, esc, PUBLIC_NAV, ADMIN_NAV }
