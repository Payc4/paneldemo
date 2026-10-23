// Quayside panel — concept demo front-end. Renders everything from /api/state
// and reports views/clicks to /api/event for the /stats page.

const $ = sel => document.querySelector(sel)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const eur = n => '€' + Number(n).toFixed(2)
const num = n => Number(n).toLocaleString('en-GB')
const attrJson = o => esc(JSON.stringify(o))

const PROMO_ART = `<svg viewBox="0 0 230 150" fill="none">
  <defs>
    <linearGradient id="paPanel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EDE7FF"/><stop offset="1" stop-color="#CDBEFF"/></linearGradient>
    <linearGradient id="paBadge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9B7BFF"/><stop offset="1" stop-color="#5A2FE0"/></linearGradient>
  </defs>
  <g transform="rotate(-5 115 75)">
    <rect x="34" y="18" width="150" height="100" rx="10" fill="#fff" fill-opacity=".92"/>
    <rect x="40" y="24" width="138" height="88" rx="7" fill="url(#paPanel)"/>
    <circle cx="70" cy="56" r="15" fill="#fff" fill-opacity=".85"/>
    <circle cx="70" cy="52" r="5.5" fill="#8C6CF7"/><path d="M60.5 65a9.5 9.5 0 0 1 19 0" fill="#8C6CF7"/>
    <rect x="94" y="42" width="66" height="6" rx="3" fill="#fff"/><rect x="94" y="54" width="48" height="6" rx="3" fill="#fff" fill-opacity=".75"/>
    <rect x="52" y="82" width="10" height="20" rx="2" fill="#8C6CF7" fill-opacity=".55"/><rect x="66" y="76" width="10" height="26" rx="2" fill="#8C6CF7" fill-opacity=".75"/><rect x="80" y="70" width="10" height="32" rx="2" fill="#673DE6"/>
    <path d="M102 98l14-10 12 6 20-16" stroke="#673DE6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <rect x="166" y="2" width="34" height="34" rx="10" fill="url(#paBadge)"/>
  <path d="M183 9v5M183 24v5M173 19h5M188 19h5M176 12l3 3M187 23l3 3M176 26l3-3M187 15l3-3" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="30" cy="30" r="12" fill="#E5383B"/>
  <text x="30" y="34.5" text-anchor="middle" font-family="Geist, system-ui, sans-serif" font-size="13" font-weight="700" fill="#fff">%</text>
  <rect x="70" y="112" width="122" height="22" rx="7" fill="#fff" stroke="#DCD3FF"/>
  <circle cx="82" cy="123" r="5" fill="#EFEAFF"/><path d="M80 123l1.5 1.5L84.5 121" stroke="#673DE6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="92" y="120" width="88" height="5" rx="2.5" fill="#D9D6E3"/>
  <path d="M96 128l0 15 4-4 3 6 3-1.5-3-6 5.5-.5z" fill="#1D1E20" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>
</svg>`

const app = { session: null, data: null, agent: null, activity: [], busy: false, showAllTodos: false, promoIndex: 0, promoHidden: false }

// ───────────────────────── tracking ─────────────────────────

const seen = new Set()
let queue = []
function track(type, placement) {
  if (!placement) return
  if (type === 'view') {
    if (seen.has(placement)) return
    seen.add(placement)
  }
  queue.push({ type, placement })
  if (queue.length >= 20) flush()
}
function flush() {
  if (!queue.length || !app.session) return
  const body = JSON.stringify({ session: app.session, events: queue })
  queue = []
  if (!navigator.sendBeacon?.('/api/event', new Blob([body], { type: 'application/json' }))) {
    fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }
}
setInterval(flush, 3000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })

// ───────────────────────── boot ─────────────────────────

// crypto.randomUUID only exists on https pages; build a v4 UUID by hand on plain http.
function uuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID()
  const b = new Uint8Array(16)
  if (window.crypto?.getRandomValues) crypto.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function sessionId() {
  try {
    let id = localStorage.getItem('qp-session')
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) { id = uuid(); localStorage.setItem('qp-session', id) }
    return id
  } catch {
    return uuid()
  }
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: app.session, ...body }) } : undefined)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong.')
  return data
}

async function boot() {
  app.session = sessionId()
  const persona = new URLSearchParams(location.search).get('persona') || ''
  const d = await api(`/api/state?session=${app.session}${persona ? '&persona=' + encodeURIComponent(persona) : ''}`)
  apply(d)
  bindUi()
  loadChats()
  const first = parseRoute(location.hash)
  if (first === 'agent') { renderPage(); setView('agent', { push: false, focus: false }) } else go(first, { push: false })
  track('view', 'page')
  track('view', 'sale-banner')
  track('view', 'refer')
  tickCountdown()
  setInterval(tickCountdown, 30000)
  setInterval(() => { if (!app.promoHover && !document.hidden) movePromo(1) }, 8000)
}

function apply(d) {
  if (d.state) app.data = d.state
  if (d.agent) app.agent = d.agent
  if (d.activity) app.activity = d.activity
  if (app.promoIndex >= (app.data.promos || []).length) app.promoIndex = 0
  render()
}

// ───────────────────────── rendering ─────────────────────────

function render() {
  const s = app.data
  $('#greeting').textContent = `Hi, ${s.customer.firstName}! How can I help you today?`
  $('#avatar').setAttribute('aria-label', `Account: ${s.customer.firstName}`)
  $('#avatar').title = s.customer.firstName
  const urgent = s.nba.filter(n => n.tone === 'urgent').length
  $('#bellCount').hidden = !urgent
  $('#bellCount').textContent = urgent
  $('#personaSel').innerHTML = s.personas.map(p => `<option value="${esc(p.id)}" ${p.id === s.persona ? 'selected' : ''}>${esc(p.label)}</option>`).join('')
  $('#agentInfo').textContent = app.agent?.live ? `Knows your account, prices and limits · ${app.agent.model}` : 'Knows your account, prices and limits · demo mode'
  renderChips()
  renderSuggestions()
  renderPromo()
  renderTodos()
  renderSites()
  renderPlan()
  renderRenewals()
  if (app.page && app.page !== 'home') renderPage()
}

function renderChips() {
  const s = app.data
  const chips = []
  const store = s.sites.find(x => x.orders30d)
  const temp = s.sites.find(x => x.temp)
  if (s.sites.some(x => x.status === 'draft')) chips.push('How do I get my site live?')
  if (store && store.speedMobile < 70) chips.push(`Why is ${store.name} slow?`)
  if (temp) chips.push(`Connect a domain to ${temp.name}`)
  if (s.plan.renewsInDays <= 30 && !s.plan.autoRenew) chips.push('What happens if my plan expires?')
  if (s.usage.storageGb.used / s.usage.storageGb.limit > 0.7) chips.push('Do I need a bigger plan?')
  if (s.freebies.freeEmail) chips.push('Set up business email')
  chips.push('What should I do first?')
  $('#chips').innerHTML = chips.slice(0, 4).map(c => `<button class="chip" type="button" data-ask="${esc(c)}" data-track="chip">${esc(c)}</button>`).join('')
}

function renderPromo() {
  const list = app.data.promos || []
  $('#promoWrap').hidden = app.promoHidden || !list.length
  if (!list.length || app.promoHidden) return
  const p = list[app.promoIndex]
  $('#promo').innerHTML = `
    <div class="promo__body">
      <p class="promo__headline">${esc(p.headline)}</p>
      <div class="promo__row">
        <button class="promo__cta" data-propose="${attrJson(p.action)}" data-placement="promo:${esc(p.id)}">Claim deal</button>
        <div class="promo__price">
          <div class="promo__was"><s>${esc(p.was)}</s><span class="save">Save ${esc(p.save)}</span></div>
          <div class="promo__now">${esc(p.now)}<span>${esc(p.nowUnit)}</span></div>
        </div>
      </div>
    </div>
    <div class="promo__art" aria-hidden="true">${PROMO_ART}</div>
    <button class="promo__dismiss" id="promoDismiss" aria-label="Hide deals" data-track="promo:dismiss">✕</button>`
  $('#promoDots').innerHTML = list.map((x, i) => `<button class="dot ${i === app.promoIndex ? 'is-on' : ''}" data-dot="${i}" aria-label="Deal ${i + 1}"></button>`).join('')
  track('view', 'promo:' + p.id)
}

function movePromo(step) {
  const n = (app.data?.promos || []).length
  if (!n || app.promoHidden) return
  app.promoIndex = (app.promoIndex + step + n) % n
  renderPromo()
}

const todoIcons = {
  publish: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  renew: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  domain: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  upgrade: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  cdn: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  marketing: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6"/>',
  credits: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
}

function renderTodos() {
  const list = app.data.nba
  $('#todoCount').textContent = list.length
  $('#todoCount').hidden = !list.length
  const shown = app.showAllTodos ? list : list.slice(0, 3)
  $('#todos').innerHTML = shown.length ? shown.map(n => {
    const kind = Object.keys(todoIcons).find(k => n.id.startsWith(k)) || 'credits'
    track('view', 'todo:' + n.id.split('-')[0])
    return `<div class="todo">
      <span class="todo__icon t-${esc(n.tone)}" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${todoIcons[kind]}</svg></span>
      <div class="todo__text">
        <div class="todo__title">${esc(n.title)}</div>
        <div class="todo__desc">${esc(n.reason)}</div>
        ${n.secondary ? `<button class="link small" data-propose="${attrJson(n.secondary.action)}" data-placement="todo:${esc(n.id.split('-')[0])}-alt">${esc(n.secondary.label)}</button>` : ''}
      </div>
      <div class="todo__side">
        ${n.priceText && !n.price ? `<span class="todo__price">${esc(n.priceText)}</span>` : ''}
        <button class="btn btn-ghost btn-sm" data-propose="${attrJson(n.action)}" data-placement="todo:${esc(n.id.split('-')[0])}">${esc(n.price ? n.cta : (n.cta.startsWith('Claim') ? 'Claim' : n.cta))}</button>
        <button class="kebab" data-ask="${esc(`Tell me more about this: ${n.title}`)}" data-track="todo:more" aria-label="More about ${esc(n.title)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>
      </div>
    </div>`
  }).join('') + (list.length > 3 ? `<button class="link small more" id="todoMore">${app.showAllTodos ? 'Show less' : `Show more (${list.length - 3})`}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${app.showAllTodos ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}"/></svg></button>` : '')
    : '<div class="todo"><div class="todo__text"><div class="todo__title">You\'re all set</div><div class="todo__desc">Nothing needs your attention right now.</div></div></div>'
}

function speedClass(v) { return v >= 85 ? 'speed-good' : v >= 65 ? 'speed-mid' : 'speed-bad' }

function renderSites() {
  const s = app.data
  $('#sites').innerHTML = s.sites.map(site => {
    const nbaDomain = s.nba.find(n => n.id === 'domain-' + site.id)
    const nbaPublish = s.nba.find(n => n.id === 'publish-' + site.id)
    const wp = /wordpress/i.test(site.platform)
    const status = site.status === 'draft' ? '<span class="pill warn">Draft</span>' : site.temp ? '<span class="pill warn">Temporary domain</span>' : '<span class="pill ok">Online</span>'
    return `<article class="card site">
      <div class="site__head">
        <span class="site__logo ${wp ? 'wp' : ''}" aria-hidden="true">${wp ? 'W' : esc(site.name[0])}</span>
        <div style="min-width:0;flex:1 1 220px">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><span class="site__name">${esc(site.domain)}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--ink-2)"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${status}</div>
          <div class="site__meta">${esc(site.name)} · ${esc(site.platform)}</div>
        </div>
        <div class="site__actions">
          <button class="btn btn-ghost btn-sm" data-ask="${esc(`How is ${site.name} doing? Anything I should fix?`)}" data-track="site:manage">Manage site</button>
        </div>
      </div>
      <div class="site__stats">
        <span>Visits (30 days) <b>${num(site.visits30d)}</b>${site.visitsTrend ? ` <span style="color:var(--ok)">+${site.visitsTrend}%</span>` : ''}</span>
        ${site.orders30d ? `<span>Orders <b>${num(site.orders30d)}</b></span>` : ''}
        <span>Mobile speed <b class="${speedClass(site.speedMobile)}">${site.speedMobile}/100</b></span>
        <span>SSL <b>${site.ssl ? 'on' : 'off'}</b></span>
        <span>Backups <b>${esc(site.backups)}</b></span>
        <span>CDN <b>${site.cdn ? 'on' : 'off'}</b></span>
      </div>
      ${nbaPublish ? `<div class="site__strip warn"><span>This website is still a draft. Visitors can't see it yet.</span><button class="btn btn-primary btn-sm" data-propose="${attrJson(nbaPublish.action)}" data-placement="site:publish">Publish</button></div>` : ''}
      ${nbaDomain ? `<div class="site__strip"><span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>You're using a temporary domain. Connect your own domain so people can find your site online.</span><button class="btn btn-ghost btn-sm" data-propose="${attrJson(nbaDomain.action)}" data-placement="site:connect">Connect domain</button></div>` : ''}
      ${!nbaDomain && !nbaPublish && site.diagnostics?.length ? `<div class="site__strip"><span>${site.diagnostics.length} thing${site.diagnostics.length === 1 ? '' : 's'} to improve: ${esc(site.diagnostics.slice(0, 2).join(' · '))}</span><button class="link small" data-ask="${esc(`What should I fix on ${site.name}?`)}" data-track="site:fix">How do I fix this?</button></div>` : ''}
    </article>`
  }).join('')
}

function meter(label, used, limit, fmt, action, actionLabel, placement) {
  const p = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const cls = p >= 90 ? 'high' : p >= 75 ? 'mid' : ''
  return `<div class="meter">
    <div class="meter__top"><span>${label}</span><span>${fmt(used)} / ${fmt(limit)}</span></div>
    <div class="bar ${cls}"><div style="width:${Math.max(p, 2)}%"></div></div>
    <div class="meter__note"><span>${p}% used</span>${action && p >= 75 ? `<button class="link small" data-propose="${attrJson(action)}" data-placement="${placement}">${actionLabel}</button>` : ''}</div>
  </div>`
}

function renderPlan() {
  const s = app.data
  const up = s.plan.sku === 'plan-premium' ? { sku: 'plan-business', term_months: 12 } : s.plan.sku === 'plan-business' ? { sku: 'plan-cloud', term_months: 12 } : null
  $('#plan').innerHTML = `
    <div class="planline"><div><strong>${esc(s.plan.name)}</strong><div class="k">${eur(s.plan.monthlyPrice)}/mo · renews ${esc(s.plan.renewsOn)}</div></div>
      ${s.plan.autoRenew ? '<span class="pill ok">Auto-renew on</span>' : '<span class="pill bad">Auto-renew off</span>'}</div>
    ${meter('Websites', s.usage.websites.used, s.usage.websites.limit, x => x, up, 'Get more', 'meter:websites')}
    ${meter('Storage', s.usage.storageGb.used, s.usage.storageGb.limit, x => x + ' GB', up, 'Upgrade', 'meter:storage')}
    ${meter('Visits this month', s.usage.visits.used, s.usage.visits.limit, x => num(x), up, 'Upgrade', 'meter:visits')}
    <div class="meter"><div class="meter__top"><span>AI credits</span><span>${s.usage.aiCredits}</span></div>
      <div class="meter__note"><span>${s.usage.aiCredits < 20 ? 'Running low' : 'Used by the AI builder and agents'}</span><button class="link small" data-propose="${attrJson({ sku: 'ai-credits-100' })}" data-placement="meter:credits">Top up</button></div></div>`
}

function renderRenewals() {
  const s = app.data
  const rows = [
    `<div class="row"><div class="row__l"><div>${esc(s.plan.name)}</div><div class="k">${esc(s.plan.renewsOn)} · ${s.plan.renewsInDays} days</div></div>${s.plan.autoRenew ? '<span class="pill ok">Auto</span>' : `<button class="btn btn-ghost btn-sm" data-propose="${attrJson({ sku: 'renew-plan', term_months: 24 })}" data-placement="renewal:plan">Renew</button>`}</div>`,
    ...s.domains.map(d => `<div class="row"><div class="row__l"><div>${esc(d.name)}</div><div class="k">${esc(d.renewsOn)}</div></div>${d.autoRenew ? '<span class="pill ok">Auto</span>' : '<span class="pill warn">Manual</span>'}</div>`),
    ...s.mailboxes.map(m => `<div class="row"><div class="row__l"><div>${esc(m.address)}</div><div class="k">${esc(m.product)}</div></div><span class="pill info plain">Mailbox</span></div>`),
  ]
  $('#renewals').innerHTML = `<div class="rows">${rows.join('')}</div>`
  $('#activityWrap').hidden = !app.activity.length
  $('#activity').innerHTML = app.activity.map(a => `<li>${esc(a)}</li>`).join('')
}

function tickCountdown() {
  const end = new Date(app.data?.saleEndsAt || Date.now())
  let ms = Math.max(0, end - Date.now())
  const d = Math.floor(ms / 86400000); ms -= d * 86400000
  const h = Math.floor(ms / 3600000); ms -= h * 3600000
  const m = Math.floor(ms / 60000)
  const pad = n => String(n).padStart(2, '0')
  $('#countdown').textContent = `${pad(d)}D:${pad(h)}H:${pad(m)}M`
}

// ───────────────────────── pages (Websites, Domains) ─────────────────────────
// Visual mock-ups of the panel's inner pages. Navigation works; purchase buttons are display only.

const PAGE_TITLES = {
  home: 'Home', websites: 'Websites', 'domains/search': 'Domain search', 'domains/transfer': 'Transfer domain',
  'domains/dns': 'DNS / Nameservers', 'domains/contacts': 'Contact profiles',
}
const WEB_FILTERS = {
  wordpress: { label: 'WordPress', test: p => /wordpress/i.test(p) },
  builder: { label: 'AI Builder', test: p => /builder/i.test(p) },
  apps: { label: 'Web Apps', test: p => /node|app|react|next|python/i.test(p) },
  php: { label: 'PHP/HTML', test: p => /php|html|static/i.test(p) },
}
const ROUTES = new Set(['home', 'websites', ...Object.keys(WEB_FILTERS).map(k => 'websites/' + k), 'domains/search', 'domains/transfer', 'domains/dns', 'domains/contacts'])

app.page = 'home'
app.web = { q: '', layout: 'grid', collapsed: false, starred: new Set() }
app.dnsTab = 'records'

const I = (d, w = 18, sw = 1.75) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevU: '<path d="m6 15 6-6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  sparkle: '<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUR: '<path d="M7 17 17 7M8 7h9v9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  listBullet: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  wand: '<path d="M4 20 15 9M14 4v3M18.5 5.5l-2 2M20 10h-3"/>',
  wp: '<circle cx="12" cy="12" r="9"/><path d="M4.5 9.5 9 20M8 8h4M10 8l4 11 3.5-10M15.5 8h3"/>',
}

function parseRoute(hash) {
  const r = decodeURIComponent(String(hash || '').replace(/^#\/?/, '')) || 'home'
  if (r === 'agent') return 'agent'
  if (r === 'domains') return 'domains/search'
  return ROUTES.has(r) ? r : 'home'
}

function go(route, { push = true } = {}) {
  route = parseRoute('#' + route)
  if (route === 'agent') return setView('agent', { push })
  const pageChanged = route !== app.page
  app.page = route
  if (view === 'agent') setView('home', { push: false })
  if (push) {
    const h = route === 'home' ? location.pathname + location.search : '#' + route
    if ((route === 'home' ? '' : '#' + route) !== location.hash) history.pushState(null, '', h)
  }
  toggleMenu(false)
  renderPage()
  if (pageChanged) { window.scrollTo({ top: 0 }); track('view', 'page:' + route.replace('/', '-')) }
}

function syncNav() {
  const r = app.page
  const agent = view === 'agent'
  $('#navHome').classList.toggle('is-active', r === 'home' && !agent)
  $('#navAgent').classList.toggle('is-active', agent)
  document.querySelectorAll('.nav-tree__btn[data-section]').forEach(b => {
    const inSection = r.startsWith(b.dataset.section)
    if (inSection) {
      document.querySelectorAll('.nav-tree__btn').forEach(o => { if (o !== b) o.setAttribute('aria-expanded', 'false') })
      b.setAttribute('aria-expanded', 'true')
    } else if (b.dataset.section && b.getAttribute('aria-expanded') === 'true' && b.dataset.auto === '1') {
      b.setAttribute('aria-expanded', 'false')
    }
    b.dataset.auto = inSection ? '1' : ''
    b.classList.toggle('is-current', inSection)
  })
  document.querySelectorAll('.nav-sub__item[data-route]').forEach(b => b.classList.toggle('is-active', b.dataset.route === r))
  document.querySelectorAll('.rail__item[data-route]').forEach(b => b.classList.toggle('is-active', r.startsWith(b.dataset.route.split('/')[0]) && b.dataset.route !== 'home'))
}

function renderPage() {
  const r = app.page
  const home = r === 'home'
  $('#homePage').hidden = !home
  $('#page').hidden = home
  $('.body').classList.toggle('is-rail', r === 'domains/dns')
  document.title = view === 'agent' ? 'Quayside — Agent' : `Quayside — ${PAGE_TITLES[r] || 'Websites'}`
  syncNav()
  if (home || !app.data) return
  const [section, sub] = r.split('/')
  $('#page').innerHTML = section === 'websites' ? pageWebsites(sub)
    : sub === 'search' ? pageDomainSearch()
    : sub === 'transfer' ? pageTransfer()
    : sub === 'dns' ? pageDns()
    : pageContacts()
  if (section === 'websites') renderWebGrid()
}

const crumbs = (...parts) => `<nav class="crumbs" aria-label="Breadcrumb">
  <a href="#" data-route="home" aria-label="Home">${I(ICON.home, 17)}</a>
  ${parts.map((p, i) => `${I(ICON.chevR, 15, 2)}${i === parts.length - 1 ? `<span aria-current="page">${esc(p[0])}</span>` : `<a href="#${p[1]}" data-route="${p[1]}">${esc(p[0])}</a>`}`).join('')}
</nav>`

const isoDate = daysAgo => new Date(Date.now() - (daysAgo || 0) * 86400000).toISOString().slice(0, 10)

// ── Websites ──

function pageWebsites(sub) {
  const s = app.data
  const f = WEB_FILTERS[sub]
  const w = app.web
  return `<div class="pg">
    <div class="pg-head"><h1>${f ? esc(f.label) : 'Websites'}</h1>
      <button class="btn-soft">${I(ICON.plus, 15, 2)}Get websites plan</button></div>
    <div class="pg-card web-bar">
      <span class="web-bar__label">${f ? 'Filtered: ' + esc(f.label) : 'Shared with you'}</span>
      <label class="field-search">${I(ICON.search, 16)}<span class="sr-only">Search websites</span><input id="webSearch" type="search" placeholder="Search websites" value="${esc(w.q)}" autocomplete="off"></label>
      <button class="icon-btn" aria-label="Tags">${I(ICON.tag, 17)}</button>
      <button class="icon-btn ${w.onlyStarred ? 'is-on' : ''}" data-web="starred" aria-label="Show starred only" aria-pressed="${Boolean(w.onlyStarred)}">${I(ICON.star, 17)}</button>
      <div class="seg" role="group" aria-label="Layout">
        <button class="${w.layout === 'list' ? 'is-on' : ''}" data-web="list" aria-label="List view">${I(ICON.list, 17)}</button>
        <button class="${w.layout === 'grid' ? 'is-on' : ''}" data-web="grid" aria-label="Grid view">${I(ICON.grid, 17)}</button>
      </div>
    </div>
    <section class="pg-card web-group ${w.collapsed ? 'is-collapsed' : ''}">
      <div class="web-group__head">
        <button class="circle-btn" data-web="collapse" aria-label="${w.collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!w.collapsed}">${I(ICON.chevU, 16, 2)}</button>
        <div class="web-group__title">
          <h2>${esc(s.plan.name)}</h2>
          <div class="web-group__meta"><span class="mini-avatar">${esc((s.customer.email || s.customer.firstName)[0].toUpperCase())}</span>${esc(s.customer.email || s.customer.firstName)} <span class="dot-sep">•</span> Plan expires on ${isoDate(-s.plan.renewsInDays)}</div>
        </div>
        <div class="web-group__actions">
          <button class="btn-soft">${I(ICON.download, 15, 2)}Import site</button>
          <button class="btn btn-primary btn-sm">${I(ICON.plus, 15, 2.2)}Create site</button>
        </div>
      </div>
      <div class="web-grid ${w.layout === 'list' ? 'is-list' : ''}" id="webGrid"></div>
    </section>
  </div>`
}

function renderWebGrid() {
  const el = $('#webGrid')
  if (!el) return
  const f = WEB_FILTERS[app.page.split('/')[1]]
  const q = app.web.q.trim().toLowerCase()
  const list = app.data.sites.filter(x => (!f || f.test(x.platform)) && (!q || `${x.name} ${x.domain}`.toLowerCase().includes(q)) && (!app.web.onlyStarred || app.web.starred.has(x.id)))
  el.innerHTML = list.length ? list.map(site => {
    const builder = /builder/i.test(site.platform)
    const starred = app.web.starred.has(site.id)
    return `<article class="site-card">
      <div class="site-card__thumb">${siteThumb(site)}
        <button class="site-card__star ${starred ? 'is-on' : ''}" data-star="${esc(site.id)}" aria-label="${starred ? 'Remove from starred' : 'Star'} ${esc(site.name)}" aria-pressed="${starred}">${I(ICON.star, 15, 2)}</button>
      </div>
      <div class="site-card__body">
        <div class="site-card__name" title="${esc(site.domain)}">${esc(site.domain)}</div>
        <div class="site-card__meta">${builder ? I(ICON.sparkle, 12, 2) : ''}${esc(builder ? 'AI Builder' : site.platform.replace(/ \+.*/, ''))} <span class="dot-sep">•</span> Created ${isoDate(site.createdDaysAgo || 30)}${site.status === 'draft' ? ' <span class="pill warn plain">Draft</span>' : ''}</div>
      </div>
    </article>`
  }).join('') : `<p class="web-empty">${q || app.web.onlyStarred ? 'No websites match.' : f ? `No ${esc(f.label)} websites yet.` : 'No websites yet.'}</p>`
}

function hashHue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h }

function siteThumb(site) {
  const words = site.name.toUpperCase().split(' ')
  if (/builder/i.test(site.platform)) {
    return `<svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="150" fill="#F1EEFF"/><rect width="240" height="14" fill="#2B2350"/>
      <rect x="104" y="5" width="32" height="4" rx="2" fill="#fff" fill-opacity=".8"/>
      <path d="M70 34h100v52H70z" fill="none" stroke="#D3CBF5" stroke-width="1"/><path d="M70 60h100M120 34v52" stroke="#E2DCFA"/>
      <circle cx="103" cy="56" r="13" fill="#fff" stroke="#8C6CF7" stroke-width="2"/><path d="M96 70c2-6 12-6 14 0" stroke="#2B2350" stroke-width="2.5" fill="none"/>
      <circle cx="94" cy="76" r="7" fill="none" stroke="#2B2350" stroke-width="2"/><circle cx="114" cy="76" r="7" fill="none" stroke="#2B2350" stroke-width="2"/>
      <path d="M130 50c6 10 18 10 22 0" stroke="#673DE6" stroke-width="3" fill="none" stroke-linecap="round"/>
      <rect x="148" y="62" width="11" height="11" rx="2" fill="#673DE6" transform="rotate(25 153 67)"/><circle cx="160" cy="44" r="2" fill="#673DE6"/><circle cx="78" cy="48" r="2" fill="#673DE6"/>
      <rect x="92" y="98" width="56" height="5" rx="2.5" fill="#2B2350"/><rect x="76" y="108" width="88" height="3" rx="1.5" fill="#A9A2C8"/><rect x="84" y="114" width="72" height="3" rx="1.5" fill="#A9A2C8"/>
      <rect x="88" y="123" width="64" height="3" rx="1.5" fill="#8C6CF7"/><rect x="80" y="130" width="80" height="3" rx="1.5" fill="#8C6CF7"/>
    </svg>`
  }
  const h = hashHue(site.name)
  return `<svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="tg${esc(site.id)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 22% 30%)"/><stop offset=".55" stop-color="hsl(${(h + 20) % 360} 18% 16%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 14% 9%)"/></linearGradient>
    <radialGradient id="tl${esc(site.id)}" cx=".3" cy=".25" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="240" height="150" fill="url(#tg${esc(site.id)})"/><rect width="240" height="150" fill="url(#tl${esc(site.id)})"/>
    <ellipse cx="170" cy="118" rx="70" ry="22" fill="#000" fill-opacity=".35"/>
    <circle cx="150" cy="96" r="26" fill="hsl(${h} 30% 40%)" fill-opacity=".55"/><circle cx="196" cy="104" r="18" fill="hsl(${h} 25% 55%)" fill-opacity=".4"/>
    <rect x="8" y="7" width="22" height="4" rx="1" fill="#fff" fill-opacity=".85"/>
    <g fill="#fff" fill-opacity=".6"><rect x="140" y="8" width="12" height="2.5" rx="1"/><rect x="156" y="8" width="12" height="2.5" rx="1"/><rect x="172" y="8" width="12" height="2.5" rx="1"/><rect x="188" y="8" width="12" height="2.5" rx="1"/></g>
    <rect x="208" y="5" width="24" height="8" rx="1" fill="none" stroke="#E6C34A" stroke-width="1"/>
    <rect x="100" y="54" width="40" height="2" rx="1" fill="#E6C34A"/>
    <text x="120" y="76" text-anchor="middle" font-family="Impact, 'Arial Narrow', Geist, sans-serif" font-size="17" font-weight="800" fill="#fff" letter-spacing=".5">${esc(words.slice(0, 2).join(' '))}</text>
    ${words.length > 2 ? `<text x="120" y="95" text-anchor="middle" font-family="Impact, 'Arial Narrow', Geist, sans-serif" font-size="17" font-weight="800" fill="#fff">${esc(words.slice(2, 4).join(' '))}</text>` : ''}
    <rect x="98" y="${words.length > 2 ? 104 : 86}" width="44" height="9" rx="1" fill="none" stroke="#fff" stroke-opacity=".7"/>
  </svg>`
}

// ── Domains: search ──

const TLD_TILES = [
  { tld: '.com', was: '€16,99', now: '€0,01', info: true },
  { tld: '.net', was: '€16,99', now: '€11,99' },
  { tld: '.io', was: '€65,99', now: '€27,99' },
  { tld: '.org', was: '€16,99', now: '€8,99' },
  { tld: '.online', was: '€33,99', now: '€0,99' },
  { tld: '.shop', was: '€37,99', now: '€0,99' },
]

function pageDomainSearch() {
  return `<div class="pg pg--narrow">
    <section class="dom-hero">
      <h1>Search for a domain name</h1>
      <form class="dom-search" id="domForm" role="search">
        ${I(ICON.search, 19)}
        <label for="domInput" class="sr-only">Domain name</label>
        <input id="domInput" type="search" placeholder="Type a domain or describe your idea" autocomplete="off" spellcheck="false">
        <button type="button" class="dom-search__ai" aria-label="Get name ideas">${I('<circle cx="10" cy="10" r="6"/><path d="m19 19-4.5-4.5M18 3v4M16 5h4"/>', 17, 2)}</button>
        <button type="submit" class="dom-search__go" aria-label="Search">${I(ICON.arrowR, 15, 2)}</button>
      </form>
      <div class="tlds">
        ${TLD_TILES.map(t => `<button type="button" class="tld" data-tld="${t.tld}">
          <span class="tld__name">${t.tld}</span>${t.info ? `<span class="tld__info" aria-hidden="true">${I(ICON.info, 15, 1.6)}</span>` : ''}
          <s>${t.was}</s><b>${t.now}</b></button>`).join('')}
      </div>
    </section>
    <div class="dom-cards">
      <article class="dom-card dom-card--violet">
        <span class="dom-card__badge" aria-hidden="true">%</span>
        <h2>Get 1 month of free Unlimited hosting with your domain</h2>
        <p>*Register a .tech, .org, .net, .io, or .ai domain for 2+ years – and turn it into a website in minutes</p>
      </article>
      <article class="dom-card dom-card--photo">
        ${STATS_ART}
        <div class="dom-card__stats"><b>9M+</b><span>domains registered</span><b>400+</b><span>domain extensions</span></div>
      </article>
      <a class="dom-card dom-card--deep" href="#domains/transfer" data-route="domains/transfer">
        <span class="dom-card__arrow" aria-hidden="true">${I(ICON.arrowUR, 20, 2)}</span>
        <span class="dom-card__cube" aria-hidden="true">${I('<path d="M7 7h11l-3-3M17 17H6l3 3"/>', 20, 2.2)}</span>
        <h2>Domain transfer</h2>
        <p>Bring your domain over easily — .com from €9,99</p>
      </a>
    </div>
  </div>`
}

const STATS_ART = `<svg class="dom-card__art" viewBox="0 0 226 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A9BE8"/><stop offset="1" stop-color="#1D56A0"/></linearGradient>
  <linearGradient id="scrG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6F3FF"/><stop offset="1" stop-color="#E4DCFF"/></linearGradient></defs>
  <rect width="226" height="320" fill="url(#skyG)"/>
  <circle cx="196" cy="34" r="74" fill="#fff" fill-opacity=".09"/><circle cx="20" cy="140" r="60" fill="#fff" fill-opacity=".05"/>
  <g transform="translate(16 -8) scale(.84) rotate(-10 113 100)">
    <rect x="58" y="10" width="112" height="190" rx="20" fill="#16151C"/>
    <rect x="64" y="16" width="100" height="178" rx="15" fill="url(#scrG)"/>
    <rect x="98" y="22" width="32" height="6" rx="3" fill="#16151C"/>
    <rect x="72" y="38" width="84" height="16" rx="8" fill="#fff" stroke="#C9BCF7"/>
    <circle cx="81" cy="46" r="3" fill="none" stroke="#673DE6" stroke-width="1.4"/>
    <rect x="88" y="44" width="44" height="4" rx="2" fill="#2B2350"/>
    <g font-family="Geist, system-ui, sans-serif" font-size="9" font-weight="700">
      <rect x="72" y="62" width="84" height="20" rx="6" fill="#fff"/><text x="80" y="75" fill="#673DE6">.com</text><rect x="128" y="67" width="20" height="10" rx="5" fill="#DDF5E6"/>
      <rect x="72" y="86" width="84" height="20" rx="6" fill="#fff"/><text x="80" y="99" fill="#673DE6">.shop</text><rect x="128" y="91" width="20" height="10" rx="5" fill="#DDF5E6"/>
      <rect x="72" y="110" width="84" height="20" rx="6" fill="#fff"/><text x="80" y="123" fill="#673DE6">.io</text><rect x="128" y="115" width="20" height="10" rx="5" fill="#DDF5E6"/>
      <rect x="72" y="134" width="84" height="20" rx="6" fill="#fff" fill-opacity=".7"/><text x="80" y="147" fill="#673DE6" fill-opacity=".7">.online</text>
    </g>
    <rect x="72" y="164" width="84" height="18" rx="9" fill="#673DE6"/><rect x="96" y="171" width="36" height="4" rx="2" fill="#fff"/>
  </g>
  <path d="M170 48l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#fff" fill-opacity=".85"/><circle cx="40" cy="60" r="3" fill="#fff" fill-opacity=".6"/>
</svg>`

// ── Domains: transfer ──

function pageTransfer() {
  return `<div class="pg">
    ${crumbs(['Domain portfolio', 'domains/dns'], ['Transfer domain'])}
    <h1 class="pg-title">Transfer Domain</h1>
    <section class="pg-card xfer">
      <svg class="xfer__art" width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
        <circle cx="34" cy="34" r="30" fill="#F3F0FF" stroke="#C9BCF7" stroke-width="1.6"/>
        <path d="M4 34h60M34 4c-10 9-14 19-14 30s4 21 14 30M34 4c10 9 14 19 14 30" stroke="#C9BCF7" stroke-width="1.6"/>
        <rect x="36" y="38" width="34" height="26" rx="4" fill="#fff"/>
        <path d="M42 46h22l-5-5M64 56H42l5 5" stroke="#8C6CF7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h2>Transfer your domain to Quayside</h2>
      <form class="xfer__form" id="xferForm">
        <label for="xferInput" class="sr-only">Domain to transfer</label>
        <input id="xferInput" type="text" placeholder="Type the domain you want to transfer" autocomplete="off" spellcheck="false">
        <button class="btn btn-primary" type="submit">Transfer</button>
      </form>
      <p class="xfer__note"><b>Transfer your .com for €9,99.</b> The price includes domain renewal for a year.</p>
      <p class="xfer__bulk">${I(ICON.listBullet, 16, 2)}<span>Transferring more than one?</span> <button class="link small" type="button">Bulk transfer</button></p>
    </section>
    <section class="pg-card xfer-ready">
      <h2>Get your domain ready for transfer</h2>
      <div class="xfer-ready__grid">
        <div>${I(ICON.calendar, 20)}<h3>The domain can be transferred</h3><p>It's been 60+ days since its registration or latest transfer.</p></div>
        <div>${I(ICON.lock, 20)}<h3>The domain is unlocked</h3><p>Transfer lock must be off at your current provider.</p><button class="link" type="button">Here's how to unlock a domain</button></div>
        <div>${I(ICON.key, 20)}<h3>You have an authorization code</h3><p>Get a transfer (EPP) code from your current provider.</p></div>
      </div>
    </section>
  </div>`
}

// ── Domains: DNS ──

function pageDns() {
  const s = app.data
  const domain = s.domains[0]?.name || s.sites[0]?.domain || 'your-domain.com'
  const tab = app.dnsTab
  return `<div class="pg">
    ${crumbs(['Domain portfolio', 'domains/search'], ['DNS / Nameservers'])}
    <h1 class="pg-title pg-title--domain">${esc(domain)}</h1>
    <div class="tabs" role="tablist">
      <button role="tab" class="tab ${tab === 'records' ? 'is-on' : ''}" aria-selected="${tab === 'records'}" data-dns-tab="records">DNS records</button>
      <button role="tab" class="tab ${tab === 'history' ? 'is-on' : ''}" aria-selected="${tab === 'history'}" data-dns-tab="history">DNS history</button>
    </div>
    ${tab === 'records' ? `<section class="pg-card dns-info">
      <span class="dns-info__icon" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="#673DE6"/><path d="M2 13h22M13 2c-4 3-5 7-5 11s1 8 5 11M13 2c4 3 5 7 5 11s-1 8-5 11" stroke="#fff" stroke-opacity=".35" stroke-width="1.2" fill="none"/><rect x="2" y="9" width="22" height="8" rx="2" fill="#fff"/><text x="13" y="15.4" text-anchor="middle" font-family="Geist, system-ui, sans-serif" font-size="6.6" font-weight="800" fill="#2B2350">DNS</text></svg></span>
      <div class="dns-info__text"><h2>Manage your DNS records at Quayside</h2><p>Manage your DNS records at Quayside. Connect an external domain to a site or transfer a domain to Quayside.</p></div>
      <button class="btn btn-primary btn-sm">Check guide</button>
    </section>` : `<section class="pg-card dns-history"><p>No DNS changes in the last 30 days.</p></section>`}
  </div>`
}

// ── Domains: contact profiles ──

function pageContacts() {
  return `<div class="pg">
    <h1 class="pg-title">Contact profiles</h1>
    <section class="pg-card contacts-empty">
      <svg width="176" height="152" viewBox="0 0 176 152" fill="none" aria-hidden="true">
        <path d="M0 24 24 0h46l18 18L106 0h46l24 24v104l-24 24h-46l-18-18-18 18H24L0 128z" fill="#F3F1FC"/>
        <rect x="28" y="44" width="120" height="74" rx="6" fill="#fff" stroke="#8E8AA6" stroke-width="1.4"/>
        <circle cx="62" cy="81" r="18" stroke="#8E8AA6" stroke-width="1.4"/><circle cx="62" cy="76" r="6" stroke="#8E8AA6" stroke-width="1.4"/><path d="M50 93c5-8 19-8 24 0" stroke="#8E8AA6" stroke-width="1.4"/>
        <path d="M92 72h40M92 81h40M92 90h24" stroke="#B9B5CC" stroke-width="1.4"/>
        <circle cx="130" cy="112" r="24" fill="#fff" stroke="#2B2350" stroke-width="1.6"/><path d="M130 100v24M118 112h24" stroke="#2B2350" stroke-width="1.6"/>
      </svg>
      <h2>Add your first contact profile</h2>
      <p>Contact profiles store your details for domain registration. Set one as default so your domains register automatically.</p>
      <button class="btn btn-primary">Add contact profile</button>
    </section>
  </div>`
}

function bindPages() {
  const main = $('#page')
  main.addEventListener('input', e => {
    if (e.target.id === 'webSearch') { app.web.q = e.target.value; renderWebGrid() }
  })
  main.addEventListener('submit', e => e.preventDefault())
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-web],[data-star],[data-dns-tab],[data-tld]')
    if (!b) return
    if (b.dataset.star) {
      const id = b.dataset.star
      app.web.starred.has(id) ? app.web.starred.delete(id) : app.web.starred.add(id)
      try { localStorage.setItem('qp-starred', JSON.stringify([...app.web.starred])) } catch {}
      return renderWebGrid()
    }
    if (b.dataset.dnsTab) { app.dnsTab = b.dataset.dnsTab; return renderPage() }
    if (b.dataset.tld) {
      const input = $('#domInput')
      const base = input.value.trim().replace(/\.[a-z]+$/i, '')
      input.value = base ? base + b.dataset.tld : ''
      if (!base) input.placeholder = `Type a name to check ${b.dataset.tld}`
      return input.focus()
    }
    const a = b.dataset.web
    if (a === 'list' || a === 'grid') { app.web.layout = a; return renderPage() }
    if (a === 'starred') { app.web.onlyStarred = !app.web.onlyStarred; return renderPage() }
    if (a === 'collapse') { app.web.collapsed = !app.web.collapsed; return renderPage() }
  })
  try { app.web.starred = new Set(JSON.parse(localStorage.getItem('qp-starred') || '[]')) } catch {}
}

// ───────────────────────── offer cards ─────────────────────────

function offerHtml(card, id) {
  return `<div class="offer" data-offer="${esc(id)}">
    <h3 id="modalTitle">${esc(card.title)}</h3>
    ${card.subtitle ? `<p class="offer__sub">${esc(card.subtitle)}</p>` : ''}
    <ul class="offer__lines">${card.lines.map(l => `<li><span>${esc(l.label)}</span><span>${esc(l.value)}</span></li>`).join('')}</ul>
    <div class="offer__due"><span>Due today</span><strong>${card.dueToday ? eur(card.dueToday) : 'Free'}</strong></div>
    ${card.then ? `<p class="offer__then">${esc(card.then)}</p>` : ''}
    ${card.bullets?.length ? `<ul class="offer__bullets">${card.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    <div class="offer__actions">
      <button class="btn btn-accent" data-decide="confirm">${esc(card.confirm)}</button>
      <button class="btn btn-ghost" data-decide="decline">Not now</button>
    </div>
  </div>`
}

async function decide(offerEl, decision) {
  const id = offerEl.dataset.offer
  offerEl.querySelectorAll('button').forEach(b => { b.disabled = true })
  const inModal = offerEl.closest('#modal')
  try {
    const d = await api('/api/action', { id, decision })
    if (d.declined) {
      offerEl.classList.add('is-declined')
      offerEl.querySelector('.offer__actions').innerHTML = '<span class="muted small">Not now — no changes made.</span>'
      if (inModal) closeModal()
      return
    }
    offerEl.classList.add('is-done')
    offerEl.querySelector('.offer__actions').innerHTML = `<div class="offer__result">✓ ${esc(d.summary)}</div>`
    apply(d)
    toast(d.summary)
    if (inModal) setTimeout(closeModal, 900)
  } catch (e) {
    offerEl.querySelector('.offer__actions').innerHTML = `<span class="small" style="color:var(--bad)">${esc(e.message)}</span>`
  }
}

async function propose(action, placement) {
  track('click', placement)
  try {
    const d = await api('/api/propose', { action, placement })
    $('#modalBody').innerHTML = offerHtml(d.card, d.id)
    $('#modal').hidden = false
    $('#modal [data-decide="confirm"]').focus()
  } catch (e) {
    toast(e.message)
  }
}

function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = '' }

// ───────────────────────── agent chats ─────────────────────────
// Each chat has its own id; the server keeps a separate history per chat id.
// The list (titles + rendered transcript) is kept in this browser so it survives a reload.

const CHATS_KEY = 'qp-chats'
app.chats = []
app.chatId = newChatId()

function newChatId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

function loadChats() {
  try {
    const d = JSON.parse(localStorage.getItem(CHATS_KEY) || 'null')
    if (d && d.session === app.session && d.persona === app.data.persona && Array.isArray(d.chats)) app.chats = d.chats.slice(0, 20)
  } catch { /* storage unavailable */ }
  renderChatList()
}

function saveChats() {
  const chat = $('#chat')
  if (chat.children.length) {
    const html = chat.innerHTML
    const entry = app.chats.find(c => c.id === app.chatId)
    if (entry) entry.html = html
  }
  try {
    let chats = app.chats
    for (;;) {
      const json = JSON.stringify({ session: app.session, persona: app.data.persona, chats })
      if (json.length < 400000 || chats.length <= 1) { localStorage.setItem(CHATS_KEY, json); break }
      chats = chats.slice(0, -1)
    }
  } catch { /* storage full or blocked */ }
  renderChatList()
}

function renderChatList() {
  const list = $('#agChats')
  list.innerHTML = app.chats.length
    ? app.chats.map(c => `<button class="ag-chat ${c.id === app.chatId ? 'is-on' : ''}" data-chat="${esc(c.id)}" title="${esc(c.title)}">${esc(c.title)}</button>`).join('')
    : '<p class="ag-chats__empty">No chats yet</p>'
}

function showChat(html) {
  $('#chat').innerHTML = html || ''
  $('#agentApp').classList.toggle('has-msgs', Boolean(html))
  renderChatList()
  scrollChat()
}

function newChat() {
  if (app.busy) return
  saveChats()
  app.chatId = newChatId()
  showChat('')
  closeAgentSide()
  $('#agInput').focus()
}

function openChat(id) {
  if (app.busy || id === app.chatId) return closeAgentSide()
  saveChats()
  const c = app.chats.find(x => x.id === id)
  if (!c) return
  app.chatId = id
  showChat(c.html)
  closeAgentSide()
}

function resetChats() {
  app.chats = []
  app.chatId = newChatId()
  showChat('')
  saveChats()
}

const SUGGESTIONS = [
  { cls: 's-tag', icon: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/><path d="M19 3v4M17 5h4"/>' },
  { cls: 's-mail', icon: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="m4 8 8 5 8-5"/>' },
  { cls: 's-pen', icon: '<path d="M16 3l5 5L8 21H3v-5z"/>' },
  { cls: 's-mega', icon: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6"/>' },
]

function renderSuggestions() {
  const s = app.data
  const store = s.sites.find(x => x.orders30d)
  const texts = [
    store ? 'Get your store ready for Black Friday' : 'Get my website ready for more visitors',
    'Write my next newsletter',
    "I'm out of blog ideas",
    'Write a week of social posts',
  ]
  $('#agSugs').innerHTML = texts.map((t, i) => `<button class="ag-sug" data-ask="${esc(t)}" data-track="agent:suggestion">
    <span class="ag-sug__i ${SUGGESTIONS[i].cls}" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SUGGESTIONS[i].icon}</svg></span>${esc(t)}</button>`).join('')
  $('#agHello').textContent = `Ready when you are, ${s.customer.firstName}`
}

// ───────────────────────── chat ─────────────────────────

function scrollChat() { const el = $('#agScroll'); if (el) el.scrollTop = el.scrollHeight }

function setBusy(on) {
  app.busy = on
  $('#sendBtn').disabled = on
  syncSend()
}

function syncSend() { $('#agSend').disabled = app.busy || !$('#agInput').value.trim() }

async function ask(text) {
  text = text.trim()
  if (!text || app.busy) return
  setView('agent', { focus: false })
  setBusy(true)
  $('#askInput').value = ''
  $('#agInput').value = ''
  autosize($('#askInput')); autosize($('#agInput')); syncSend()

  if (!app.chats.some(c => c.id === app.chatId)) {
    app.chats.unshift({ id: app.chatId, title: text.slice(0, 80), html: '' })
    if (app.chats.length > 20) app.chats.length = 20
  }
  $('#agentApp').classList.add('has-msgs')
  renderChatList()

  const chat = $('#chat')
  chat.insertAdjacentHTML('beforeend', `<div class="msg-user">${esc(text)}</div>`)
  const bot = document.createElement('div')
  bot.className = 'msg-bot'
  bot.innerHTML = '<div class="status"><span class="dots"><i></i><i></i><i></i></span><span>Thinking</span></div><div class="md"></div>'
  chat.appendChild(bot)
  scrollChat()

  const md = bot.querySelector('.md')
  const status = bot.querySelector('.status')
  let raw = ''
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ session: app.session, chat: app.chatId, message: text }) })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('event-stream')) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Something went wrong.')
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const ev = (chunk.match(/^event: (.*)$/m) || [])[1]
        const dataLine = (chunk.match(/^data: (.*)$/m) || [])[1]
        if (!ev || !dataLine) continue
        const data = JSON.parse(dataLine)
        if (ev === 'delta') { raw += data.text; status.hidden = true; md.innerHTML = markdown(raw); scrollChat() }
        else if (ev === 'status') { status.hidden = false; status.lastElementChild.textContent = data.text }
        else if (ev === 'action') { chat.insertAdjacentHTML('beforeend', offerHtml(data.card, data.id)); scrollChat() }
        else if (ev === 'error') throw new Error(data.message)
      }
    }
    status.remove()
    if (!raw.trim()) md.innerHTML = '<p class="muted">(No reply.)</p>'
    else showRating()
  } catch (e) {
    status.remove()
    bot.classList.add('is-error')
    md.textContent = e.message
    if (!$('#agInput').value) { $('#agInput').value = text; autosize($('#agInput')) }
  } finally {
    setBusy(false)
    saveChats()
    scrollChat()
  }
}

// ───────────────────────── voice input ─────────────────────────

let recog = null
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return toast('Voice input isn\'t supported in this browser.')
  if (recog) { recog.stop(); return }
  recog = new SR()
  recog.lang = navigator.language || 'en-GB'
  recog.interimResults = true
  const input = $('#agInput')
  const before = input.value ? input.value.trimEnd() + ' ' : ''
  recog.onresult = e => {
    input.value = before + [...e.results].map(r => r[0].transcript).join('')
    autosize(input); syncSend()
  }
  recog.onend = () => { recog = null; $('#agMic').classList.remove('is-rec') }
  recog.onerror = e => { if (e.error === 'not-allowed') toast('Microphone access was blocked.') }
  $('#agMic').classList.add('is-rec')
  track('click', 'agent:mic')
  recog.start()
}

function markdown(src) {
  const inline = s => esc(s.trim()).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/g, '$1<em>$2</em>')
  const text = src.replace(/\r\n?/g, '\n').replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, '**$1**').replace(/^(\s*)\*\s+/gm, '$1- ').trim()
  const out = []
  for (const block of text.split(/\n\s*\n/)) {
    let para = [], list = null, items = []
    const flushList = () => { if (items.length) out.push(`<${list}>${items.map(i => `<li>${i}</li>`).join('')}</${list}>`); items = []; list = null }
    const flushPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = [] }
    for (const line of block.split('\n')) {
      let m
      if ((m = line.match(/^\s*[-•]\s+(.*)$/))) { flushPara(); if (list !== 'ul') { flushList(); list = 'ul' } items.push(inline(m[1])) }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (list !== 'ol') { flushList(); list = 'ol' } items.push(inline(m[1])) }
      else { flushList(); para.push(inline(line)) }
    }
    flushList(); flushPara()
  }
  return out.join('')
}

function autosize(el = $('#askInput')) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, el.id === 'agInput' ? 200 : 160) + 'px'
}

// ───────────────────────── rating card ─────────────────────────

let rated = false
function showRating() {
  if (rated || !$('#rate').hidden) return
  setTimeout(() => { if (!rated) { $('#rate').hidden = false; track('view', 'feedback') } }, 1500)
}

// ───────────────────────── ui wiring ─────────────────────────

let toastTimer
function toast(msg) {
  const t = $('#toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 3200)
}

function toggleMenu(open) {
  $('#side').classList.toggle('is-open', open)
  $('#scrim').hidden = !open
}

// ───────────────────────── views: Home / Agent workspace ─────────────────────────

let view = 'home'
let lastFocus = null
function setView(v, { focus = true, push = true } = {}) {
  v = v === 'agent' ? 'agent' : 'home'
  toggleMenu(false)
  const changed = v !== view
  view = v
  const open = v === 'agent'
  if (open && changed) lastFocus = document.activeElement
  $('#agentApp').hidden = !open
  document.documentElement.classList.toggle('agent-open', open)
  $('#agentBtn').classList.toggle('is-on', open)
  syncNav()
  document.title = open ? 'Quayside — Agent' : `Quayside — ${PAGE_TITLES[app.page] || 'Websites'}`
  const pageHash = app.page === 'home' ? '' : '#' + app.page
  if (push && location.hash !== (open ? '#agent' : pageHash)) history.pushState(null, '', open ? '#agent' : (pageHash || location.pathname + location.search))
  if (changed && open) { track('view', 'agent-page'); scrollChat() }
  if (changed && !open) { closeAgentSide(); lastFocus?.focus?.() }
  if (open && focus) setTimeout(() => $('#agInput').focus(), 60)
}

const narrow = () => matchMedia('(max-width: 899.98px)').matches
function toggleAgentSide() {
  const ag = $('#agentApp')
  if (narrow()) { const on = !ag.classList.contains('side-open'); ag.classList.toggle('side-open', on); $('#agScrim').hidden = !on }
  else ag.classList.toggle('side-hidden')
}
function closeAgentSide() { $('#agentApp').classList.remove('side-open'); $('#agScrim').hidden = true }

function bindUi() {
  document.addEventListener('click', e => {
    const tracked = e.target.closest('[data-track]')
    if (tracked) track('click', tracked.dataset.track)

    const t = e.target.closest('[data-ask],[data-propose],[data-decide],[data-demo],[data-dot],[data-view],[data-route],[data-chat],#todoMore,#promoDismiss')
    if (!t) return
    if (t.dataset.ask) { toggleMenu(false); ask(t.dataset.ask) }
    else if (t.dataset.propose) propose(JSON.parse(t.dataset.propose), t.dataset.placement || 'other')
    else if (t.dataset.decide) decide(t.closest('.offer'), t.dataset.decide)
    else if (t.dataset.dot !== undefined) { app.promoIndex = Number(t.dataset.dot); renderPromo() }
    else if (t.dataset.view) { e.preventDefault(); setView(t.dataset.view) }
    else if (t.dataset.route) { e.preventDefault(); go(t.dataset.route) }
    else if (t.dataset.chat) openChat(t.dataset.chat)
    else if (t.id === 'todoMore') { app.showAllTodos = !app.showAllTodos; renderTodos() }
    else if (t.id === 'promoDismiss') { app.promoHidden = true; renderPromo(); toast('Deals hidden for this visit') }
    else if (t.hasAttribute('data-demo')) toggleMenu(false)
  })

  $('#askForm').addEventListener('submit', e => { e.preventDefault(); ask($('#askInput').value) })
  $('#askInput').addEventListener('input', autosize)
  $('#askInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask($('#askInput').value) }
  })
  document.querySelectorAll('.nav-group').forEach(g => g.addEventListener('click', () => {
    g.setAttribute('aria-expanded', g.getAttribute('aria-expanded') === 'false' ? 'true' : 'false')
  }))
  $('#rateStars').addEventListener('click', e => {
    const b = e.target.closest('[data-rate]')
    if (!b) return
    rated = true
    track('click', 'feedback:' + b.dataset.rate)
    $('#rate').hidden = true
    toast('Thanks for the feedback!')
  })
  $('#rateClose').addEventListener('click', () => { rated = true; $('#rate').hidden = true; track('click', 'feedback:close') })
  $('#agForm').addEventListener('submit', e => { e.preventDefault(); ask($('#agInput').value) })
  $('#agInput').addEventListener('input', () => { autosize($('#agInput')); syncSend() })
  $('#agInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask($('#agInput').value) }
  })
  $('#agNew').addEventListener('click', newChat)
  $('#agClose').addEventListener('click', () => setView('home'))
  $('#agSideToggle').addEventListener('click', toggleAgentSide)
  $('#agScrim').addEventListener('click', closeAgentSide)
  $('#agChatsToggle').addEventListener('click', e => {
    const b = e.currentTarget
    b.setAttribute('aria-expanded', b.getAttribute('aria-expanded') === 'false' ? 'true' : 'false')
  })
  $('#agBannerX').addEventListener('click', () => { $('#agBanner').hidden = true; track('click', 'agent:banner-close') })
  $('#agFeedback').addEventListener('click', () => { rated = false; $('#rate').hidden = false; track('click', 'agent:feedback') })
  $('#agPlus').addEventListener('click', () => $('#agInput').focus())
  $('#agMic').addEventListener('click', toggleMic)
  $('#agentBtn').addEventListener('click', () => setView('agent'))
  $('#askPlus').addEventListener('click', () => $('#askInput').focus())
  window.addEventListener('popstate', () => { const r = parseRoute(location.hash); if (r === 'agent') setView('agent', { push: false, focus: false }); else go(r, { push: false }) })
  document.querySelectorAll('.nav-tree__btn').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.route) return
    const open = btn.getAttribute('aria-expanded') !== 'true'
    document.querySelectorAll('.nav-tree__btn').forEach(o => o.setAttribute('aria-expanded', 'false'))
    btn.setAttribute('aria-expanded', String(open))
  }))
  $('#bellBtn').addEventListener('click', () => { go('home'); $('#todos').scrollIntoView({ behavior: 'smooth', block: 'center' }) })
  const refer = () => {
    navigator.clipboard?.writeText(`${location.origin}/?ref=${app.session.slice(0, 8)}`).catch(() => {})
    toast('Your referral link was copied — earn up to €200 per friend')
  }
  $('#referBtn').addEventListener('click', refer)
  $('#navRefer').addEventListener('click', refer)
  bindPages()
  $('#saleBtn').addEventListener('click', () => {
    go('home')
    const w = $('#promoWrap')
    if (app.promoHidden) { app.promoHidden = false; renderPromo() }
    w.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const p = $('#promo'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash')
  })
  $('#promoPrev').addEventListener('click', () => movePromo(-1))
  $('#promoNext').addEventListener('click', () => movePromo(1))
  $('#promo').addEventListener('mouseenter', () => { app.promoHover = true })
  $('#promo').addEventListener('mouseleave', () => { app.promoHover = false })

  $('#personaSel').addEventListener('change', async e => {
    const d = await api('/api/reset', { persona: e.target.value })
    app.showAllTodos = false
    app.promoIndex = 0
    apply(d)
    resetChats()
    toast(`Now viewing as ${app.data.customer.firstName}`)
  })
  $('#resetBtn').addEventListener('click', async () => {
    const d = await api('/api/reset', { persona: app.data.persona })
    app.promoHidden = false
    apply(d)
    resetChats()
    toast('Demo account reset')
  })

  $('#menuBtn').addEventListener('click', () => toggleMenu(true))
  $('#scrim').addEventListener('click', () => toggleMenu(false))
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal() })
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (!$('#modal').hidden) closeModal()
    else if ($('#agentApp').classList.contains('side-open')) closeAgentSide()
    else if (view === 'agent') setView('home')
  })
}

boot().catch(e => {
  document.querySelector('.wrap').innerHTML = `<div class="card pad">Could not load the demo: ${esc(e.message)}</div>`
})
