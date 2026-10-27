// Hostinger panel — concept demo front-end. Renders everything from /api/state
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
const PREVIEW = new URLSearchParams(location.search).has('preview') // live-editor preview: don't count stats
// ?live=1: reload by itself whenever this version is edited (live editor or the claude.ai connector)
if (new URLSearchParams(location.search).has('live') && window.EventSource) {
  const slug = (location.pathname.match(/^\/(hpanel\d{1,3})\//) || [])[1]
  if (slug) {
    let t
    const es = new EventSource('/api/changes?v=' + slug)
    es.addEventListener('change', () => { clearTimeout(t); t = setTimeout(() => location.reload(), 600) })
  }
}
function track(type, placement) {
  if (!placement || PREVIEW) return
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
  renderNotif()
  renderAccount()
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
  emails: 'Emails', services: 'More services', 'marketing/email': 'Email marketing', 'marketing/ads': 'Google Ads', vps: 'VPS', ecommerce: 'Ecommerce', gpu: 'GPU', api: 'API', router: 'AI Router',
  'apps/openclaw': 'OpenClaw', 'apps/hermes': 'Hermes Agent', 'apps/n8n': 'n8n', 'apps/paperclip': 'Paperclip',
}
const WEB_FILTERS = {
  wordpress: { label: 'WordPress', test: p => /wordpress/i.test(p) },
  builder: { label: 'AI Builder', test: p => /builder/i.test(p) },
  apps: { label: 'Web Apps', test: p => /node|app|react|next|python/i.test(p) },
  php: { label: 'PHP/HTML', test: p => /php|html|static/i.test(p) },
}
const ROUTES = new Set(['home', 'websites', ...Object.keys(WEB_FILTERS).map(k => 'websites/' + k), 'domains/search', 'domains/transfer', 'domains/dns', 'domains/contacts', 'emails', 'services', 'marketing/email', 'marketing/ads', 'vps', 'ecommerce', 'gpu', 'api', 'router', 'apps/openclaw', 'apps/hermes', 'apps/n8n', 'apps/paperclip'])

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
  document.querySelectorAll('.side .nav[data-route]:not(.nav-tree__btn):not([data-no-active])').forEach(b => b.classList.toggle('is-active', !agent && b.dataset.route === r))
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
  document.title = view === 'agent' ? 'Hostinger — Agent' : `Hostinger — ${PAGE_TITLES[r] || 'Websites'}`
  syncNav()
  if (home || !app.data) return
  const [section, sub] = r.split('/')
  $('#page').innerHTML = section === 'websites' ? pageWebsites(sub)
    : section === 'emails' ? pageEmails()
    : section === 'services' ? pageServices()
    : r === 'marketing/email' ? pageEmailMarketing()
    : r === 'marketing/ads' ? pageAds()
    : section === 'vps' ? pageVps()
    : section === 'ecommerce' ? pageEcommerce()
    : section === 'gpu' ? pageGpu()
    : section === 'api' ? pageApi()
    : section === 'router' ? pageRouter()
    : section === 'apps' ? pageAiApps(sub)
    : sub === 'search' ? pageDomainSearch()
    : sub === 'transfer' ? pageTransfer()
    : sub === 'dns' ? pageDns()
    : pageContacts()
  if (section === 'websites') renderWebGrid()
  if (section === 'services') renderServices()
  if (section === 'api' && app.api.tab === 'connect') playApiDemo()
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
      <h2>Transfer your domain to Hostinger</h2>
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
      <div class="dns-info__text"><h2>Manage your DNS records at Hostinger</h2><p>Manage your DNS records at Hostinger. Connect an external domain to a site or transfer a domain to Hostinger.</p></div>
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

// ── shared bits for the product pages ──

const ICON2 = {
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  fwd: '<path d="M14 5l7 6-7 6v-4c-6 0-9 2-11 5 1-6 4-9.5 11-10z"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
  expand: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  tick: '<path d="m5 12 5 5 9-10"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  pct: '<circle cx="12" cy="12" r="9"/><path d="M9 15l6-6M9.5 9.5h.01M14.5 14.5h.01"/>',
  nodes: '<circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.5 12h2M14.5 12l2.5-4.5M14.5 12l2.5 4.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  lockS: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
}
const QMARK = (size = 26) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#673DE6"/><path transform="translate(6.58 6.5) scale(.5)" fill-rule="evenodd" clip-rule="evenodd" d="M2.00025 14.046V0.000497794L9.08916 3.78046V10.1086L18.4735 10.1132L25.6774 14.046H2.00025ZM20.3925 8.95058V0L27.6725 3.6859V13.1797L20.3925 8.95058ZM20.3924 26.1177V19.8441L10.9358 19.8375C10.9446 19.8793 3.6123 15.8418 3.6123 15.8418L27.6725 15.9547V30L20.3924 26.1177ZM2 26.1177L2.00025 16.9393L9.08916 21.0683V29.8033L2 26.1177Z" fill="#fff"/></svg>`

// ── Emails ──

const MAIL_PLANS = [
  {
    free: true, title: 'Claim your free email',
    limits: [['db', '1 GB', 'storage per mailbox'], ['fwd', '1', 'Forwarding Rule'], ['at', '1', 'email alias'], ['x', '', 'Expandable mailbox storage']],
    ai: [[1, 'Agentic Email', true], [0, 'AI mailbox assistant'], [0, 'AI powered email search'], [0, 'Smart AI replies and message drafts'], [0, 'Instant AI email summaries']],
    benefits: [[0, 'Read Receipts'], [0, 'No Hostinger signature in Webmail'], [0, 'Encrypted storage'], [0, 'Advanced spam, malware, and phishing protection']],
    cta: '<button class="btn-soft">Start free</button>',
  },
  {
    title: 'Starter Business Email', save: 'Save 87%', was: '€2,99', price: '€0,39', note: 'Price per mailbox for a 48-month subscription',
    limits: [['db', '5 GB', 'storage per mailbox'], ['fwd', '5', 'forwarding rules'], ['at', '5', 'email aliases'], ['expand', '', 'Expandable mailbox storage']],
    ai: [[1, 'Agentic Email', true], [0, 'AI mailbox assistant'], [0, 'AI powered email search'], [0, 'Smart AI replies and message drafts'], [0, 'Instant AI email summaries']],
    benefits: [[0, 'Read Receipts'], [1, 'No Hostinger signature in Webmail'], [1, 'Encrypted storage'], [1, 'Advanced spam, malware, and phishing protection']],
    cta: '<button class="btn btn-primary btn-sm">See all plans</button>',
  },
]

function pageEmails() {
  const yes = I(ICON2.check, 18, 1.8), no = I(ICON2.x, 18, 2)
  const plan = p => `<div class="mail-plan ${p.free ? '' : 'mail-plan--paid'}">
    ${p.free ? `<span class="mail-plan__logo">${QMARK(26)}</span><h2>${esc(p.title)}</h2>`
      : `<h2>${esc(p.title)}</h2><div class="mail-plan__save"><span class="save-pill">${p.save}</span><s>${p.was}</s></div>
         <div class="mail-plan__price"><b>${p.price}</b>/mo</div><p class="mail-plan__note">${p.note}</p>`}
    <ul class="feat">${p.limits.map(([ic, n, t]) => `<li class="${ic === 'x' ? 'is-no' : ''}">${I(ICON2[ic], 18, 1.7)}<span class="u">${n ? `<b>${n}</b> ` : ''}${t}</span></li>`).join('')}</ul>
    <h3>AI tools</h3>
    <ul class="feat">${p.ai.map(([ok, t, beta]) => `<li class="${ok ? 'is-yes' : 'is-no'}">${ok ? yes : no}<span>${t}</span>${beta ? '<span class="beta-pill">Beta</span>' : ''}</li>`).join('')}</ul>
    <h3>Benefits:</h3>
    <ul class="feat">${p.benefits.map(([ok, t]) => `<li class="${ok ? 'is-yes' : 'is-no'}">${ok ? yes : no}<span class="u">${t}</span></li>`).join('')}</ul>
    <div class="mail-plan__cta">${p.cta}</div>
  </div>`
  return `<div class="pg pg--mid">
    <h1 class="pg-title">Emails</h1>
    <section class="pg-card mail-plans">${MAIL_PLANS.map(plan).join('')}</section>
  </div>`
}

// ── More services ──

const SERVICE_CATS = ['All', 'Hosting & VPS', 'Websites', 'Domains', 'Email & marketing', 'AI & automation', 'Other']
const SERVICES = [
  { cat: 'Websites', title: 'Hostinger Ecommerce', text: 'Manage products and sell effortlessly across multiple sales channels all with zero transaction fees and built-in AI tools.', art: 'store', route: 'websites' },
  { cat: 'Email & marketing', title: 'Business Email', badge: 'Save up to 87%', text: 'Build your brand with a professional email address, like you@yourdomain.com.', art: 'mail', route: 'emails' },
  { cat: 'Email & marketing', title: 'Hostinger Reach', ai: true, badge: 'Save up to 67%', text: 'Create inbox-ready newsletters with an AI-powered email marketing tool.', art: 'reach', route: 'marketing/email' },
  { cat: 'Hosting & VPS', title: 'VPS hosting', badge: 'Save up to 70%', text: 'Full power, flexibility and speed with your own virtual private server.', art: 'vps', route: 'vps' },
  { cat: 'Domains', title: 'Domain names', badge: 'Up to 99% off', text: 'Find the perfect name for your brand, with free WHOIS privacy.', art: 'domain', route: 'domains/search' },
  { cat: 'AI & automation', title: 'Self-hosted n8n', badge: 'Save up to 70%', text: 'No-code AI workflows with unlimited runs on your own server.', art: 'n8n', route: 'apps/n8n' },
  { cat: 'Email & marketing', title: 'Google Ads', text: 'Show up on Search, YouTube and Gmail and bring more people to your business.', art: 'ads', route: 'marketing/ads' },
  { cat: 'AI & automation', title: 'AI agents', ai: true, text: 'A team of AI agents for sales, marketing and SEO that works around the clock.', art: 'agents', view: 'agent' },
  { cat: 'Other', title: 'SSL certificates', text: 'Keep visitors safe and show the padlock in every browser.', art: 'ssl' },
]

function serviceArt(kind) {
  const wrap = (bg, inner) => `<div class="svc-art" style="background:${bg}">${inner}</div>`
  if (kind === 'store') return wrap('linear-gradient(135deg,#2A3346,#5B6C86)', `
    <div class="svc-store"><div class="svc-store__card"><div class="svc-store__img"></div><b>Navy cap</b><span>€59</span><i>${I(ICON2.bag, 14, 2)}</i></div>
    <svg class="svc-store__cap" viewBox="0 0 120 80" aria-hidden="true"><path d="M14 52c0-26 20-40 44-40s38 16 38 40z" fill="#1E2A4A"/><path d="M58 12v40M30 22c8 6 10 18 10 30M86 22c-8 6-10 18-10 30" stroke="#33426B" stroke-width="2" fill="none"/><path d="M8 54c30-6 70-6 104 4-6 8-20 10-34 8-22-3-48-4-70-12z" fill="#16203A"/><circle cx="58" cy="12" r="3" fill="#33426B"/></svg>
    <div class="svc-store__chart"><b>€15,347</b><span>+11%</span><svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 26C20 24 30 18 45 20s30-10 55-16" fill="none" stroke="#2BB673" stroke-width="2"/></svg></div></div>`)
  if (kind === 'mail') return wrap('linear-gradient(135deg,#6F4BF0,#9C82FF)', `
    <div class="svc-mail"><div class="svc-mail__bar">${QMARK(14)}<b>HOSTINGER</b><span>| Mail</span><strong>Inbox</strong></div>
    <div class="svc-mail__btn">${I('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 12, 2)} New message</div><div class="svc-mail__pills"><i></i><i></i><i></i></div><div class="svc-mail__row"></div></div>`)
  if (kind === 'reach') return wrap('linear-gradient(135deg,#B9A8FF,#E3DBFF)', `
    <div class="svc-reach"><div class="svc-reach__tile"><svg viewBox="0 0 40 40" width="56" height="56" aria-hidden="true">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<rect x="18" y="4" width="4" height="10" rx="2" fill="#1D1E20" transform="rotate(${a} 20 20)"/>`).join('')}</svg></div>
    <svg class="svc-reach__cursor" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M5 3v17l5-5 3 7 3-1.4-3-6.6h7z" fill="#2B2350" stroke="#fff" stroke-width="1.2"/></svg>
    <span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span></div>`)
  const tile = (ic, bg) => wrap(bg, `<div class="svc-generic"><span class="svc-generic__tile">${I(ic, 34, 1.7)}</span><span class="spark s1"></span><span class="spark s2"></span></div>`)
  return {
    vps: tile(ICON2.server, 'linear-gradient(135deg,#1B1240,#3A1F8C)'),
    domain: tile(ICON2.globe, 'linear-gradient(135deg,#8C6CF7,#C9B8FF)'),
    n8n: tile(ICON2.nodes, 'linear-gradient(135deg,#22134F,#5130B8)'),
    ads: tile(ICON2.target, 'linear-gradient(135deg,#E8E2FF,#B9A8FF)'),
    agents: tile(ICON2.bot, 'linear-gradient(135deg,#673DE6,#B66DFF)'),
    ssl: tile(ICON2.lockS, 'linear-gradient(135deg,#DDF5E6,#B4E8C8)'),
  }[kind]
}

app.svc = { cat: 'All', q: '' }

function pageServices() {
  return `<div class="pg pg--mid">
    <h1 class="pg-title">More services</h1>
    <section class="pg-card svc-filter">
      <div class="chips-row" role="tablist" aria-label="Category">${SERVICE_CATS.map(c => `<button role="tab" class="cat ${app.svc.cat === c ? 'is-on' : ''}" aria-selected="${app.svc.cat === c}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <label class="svc-search"><span class="sr-only">Search services</span><input id="svcSearch" type="search" placeholder="Search" value="${esc(app.svc.q)}" autocomplete="off"></label>
    </section>
    <div id="svcBody"></div>
  </div>`
}

function renderServices() {
  const el = $('#svcBody')
  if (!el) return
  const q = app.svc.q.trim().toLowerCase()
  const all = app.svc.cat === 'All' && !q
  const list = SERVICES.filter(x => (app.svc.cat === 'All' || x.cat === app.svc.cat) && (!q || `${x.title} ${x.text}`.toLowerCase().includes(q)))
  el.innerHTML = `${all ? `
    <section class="promo svc-banner" aria-label="Featured deal">
      <div class="promo__body">
        <div><p class="promo__headline svc-banner__title">Grow your business with a team of AI agents</p>
        <p class="svc-banner__sub">From strategy and SEO to marketing and sales – pick an agent, describe what you need, and watch it get done in seconds.</p></div>
        <div class="promo__row"><button class="promo__cta" data-view="agent">Claim deal</button>
          <div class="promo__price"><div class="promo__was"><s>€9,99</s><span class="save">Save €40,19</span></div><div class="promo__now">€6,64<span>/mo</span></div></div></div>
      </div>
      <div class="promo__art" aria-hidden="true">${PROMO_ART}</div>
    </section>
    <div class="svc-duo">
      <article class="svc-deal"><span class="svc-deal__icon">${I(ICON2.nodes, 18, 2)}</span>
        <p>Hours of work done in seconds? Automate any business task with your own AI agent, live in 1 click</p>
        <div class="svc-deal__row"><div><div class="promo__was"><s>€18,99</s><span class="save">Save €148,19</span></div><div class="svc-deal__now">€6,64 <span>/mo</span></div></div>
        <button class="btn-dark" data-route="vps">Claim deal</button></div></article>
      <article class="svc-deal"><span class="svc-deal__icon">${I(ICON2.globe, 18, 2)}</span>
        <p>Register a .com domain for 3 years – and get your first year for just €0,01</p>
        <div class="svc-deal__row"><div><div class="promo__was"><s>€16,99</s><span class="save">99% off</span></div><div class="svc-deal__now">€0,01 <span>/1st yr</span></div></div>
        <button class="btn-dark" data-route="domains/search">Search domains</button></div></article>
    </div>` : ''}
    ${list.length ? `<div class="svc-grid">${list.map(x => `<article class="svc-card">
      <div class="svc-card__img">${serviceArt(x.art)}${x.badge ? `<span class="svc-card__badge">${esc(x.badge)}</span>` : ''}</div>
      <div class="svc-card__body"><h2>${esc(x.title)}${x.ai ? `<span class="ai-pill">${I(ICON.sparkle, 11, 2)} AI</span>` : ''}</h2><p>${esc(x.text)}</p></div>
      <button class="btn-outline" ${x.route ? `data-route="${x.route}"` : x.view ? `data-view="${x.view}"` : ''}>Explore offer</button>
    </article>`).join('')}</div>` : '<p class="web-empty">No services match your search.</p>'}`
}

// ── Email marketing ──

function pageEmailMarketing() {
  return `<div class="pg pg--mid">
    <section class="em-hero">
      <div class="em-hero__text">
        <h1>Launch AI email marketing campaigns in minutes</h1>
        <p>Email marketing tool for building, customizing, sending, and tracking professional email campaigns.</p>
        <button class="btn btn-primary">Explore plans</button>
        <span class="em-hero__guarantee">${I(ICON2.shield, 17, 1.7)}30-day money-back guarantee</span>
      </div>
      <div class="em-hero__art" aria-hidden="true">
        <div class="em-app"><div class="em-app__brand">${QMARK(12)}<b>HOSTINGER</b> | Reach</div><div class="em-app__side"><i></i><i></i><i></i><i></i><i></i><i></i></div><b class="em-app__title">Campaigns</b><div class="em-app__ghost"></div></div>
        <div class="em-mail"><span class="em-mail__from">dr.summer</span><div class="em-mail__hero"><b>Welcome to the family.</b>
          <svg viewBox="0 0 160 120" aria-hidden="true"><circle cx="58" cy="52" r="22" fill="#F2C8A8"/><path d="M34 50c0-22 44-28 48 0-8-8-30-10-48 0z" fill="#3A2416"/><path d="M20 120c4-34 20-46 38-46s34 12 38 46z" fill="#C8372D"/><circle cx="108" cy="48" r="20" fill="#E8B48E"/><path d="M90 42c4-16 32-18 36 0-10-6-24-6-36 0z" fill="#B88A5E"/><path d="M72 120c4-32 18-44 36-44s32 12 36 44z" fill="#2E6B4A"/></svg></div>
          <span class="em-mail__cta">Here's 10% OFF</span></div>
        <div class="em-chip em-chip--trigger">${I(ICON2.fwd, 12, 2)}<span><small>Trigger</small>All new subscribers</span></div>
        <div class="em-chip em-chip--subs"><small>${I('<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 20a5 5 0 0 0-4-5"/>', 12, 2)} Subscribers</small><b>+462</b><span>+53%</span><svg viewBox="0 0 100 34" preserveAspectRatio="none"><path d="M0 32C25 30 40 22 55 18S80 6 100 2" fill="none" stroke="#B9A8FF" stroke-width="2"/></svg></div>
        <div class="em-prompt">Create a welcome message with -10% off for our new subscribers<span>${I(ICON.chevR, 12, 2.5)}</span></div>
      </div>
    </section>
    <div class="em-feats">
      <article class="em-feat"><div class="em-feat__art">
        <div class="em-flow"><div class="em-flow__trigger">${I(ICON2.fwd, 12, 2)}<span><small>Trigger</small>All new subscribers</span></div><i class="em-flow__plus">+</i>
        <div class="em-flow__mail"><small>${I(ICON2.mail, 11, 2)} Send email</small><b>Welcome new subscribe…</b><div class="em-flow__img"><span>Welcome</span></div></div></div>
        ${CURSOR}</div>
        <h2>Automate without work</h2><p>Welcome new subscribers, run drip campaigns, send abandoned cart emails and more.</p></article>
      <article class="em-feat"><div class="em-feat__art">
        <div class="em-promo"><b>${I('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', 12, 2)} Limited-Time Automation Promo</b><div class="em-promo__img"><span>Mega Savings</span>
        <svg viewBox="0 0 120 70" aria-hidden="true"><path d="M20 50c0-22 14-34 34-34s30 14 30 34z" fill="#2F4A36"/><path d="M14 52c26-6 58-6 86 4-6 6-16 8-28 6-18-2-40-2-58-10z" fill="#24382A"/><path d="M84 40c10-4 24-2 32 6" stroke="#F2C8A8" stroke-width="8" stroke-linecap="round" fill="none"/></svg>
        <i>GRAB THE OFFER</i></div></div>${CURSOR}</div>
        <h2>Weekly campaign ideas</h2><p>AI studies your business to suggest ready-to-go campaign ideas every week.</p></article>
      <article class="em-feat"><div class="em-feat__art">
        <div class="em-inbox"><b>Tom from Bloom-ing</b><span>Fresh Deals are inside!</span></div>
        <div class="em-subjects"><small>AI suggested subject lines</small><span>Refresh your season</span><span class="is-on">Fresh Deals are inside!</span><span>Bright offers, big savings!</span><span>A fresh start</span></div>${CURSOR}</div>
        <h2>Subject lines written for you</h2><p>Proven subject lines matched to your content. Just pick your favorite.</p></article>
    </div>
    <section class="pg-card em-wa">
      <div class="em-wa__text"><h2>Go beyond email with WhatsApp</h2><p>Connect your WhatsApp Business account and send offers to your customers where they already chat.</p><button class="btn-soft">Connect WhatsApp</button></div>
      <div class="em-wa__art" aria-hidden="true"><div class="em-phone"><div class="em-phone__img"></div><div class="em-bubble">🌿 New arrivals are in! Get 15% off this week only.</div><div class="em-bubble em-bubble--me">Ordering two!</div></div></div>
    </section>
  </div>`
}
const CURSOR = `<svg class="em-cursor" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M5 3v17l5-5 3 7 3-1.4-3-6.6h7z" fill="#2B2350" stroke="#fff" stroke-width="1.2"/></svg>`

// ── Google Ads ──

function pageAds() {
  const step = (n, chipIcon, chip, title, text) => `<article class="ads-step"><div class="ads-step__top"><span class="ads-step__n">${n}</span><span class="ads-step__chip">${I(chipIcon, 13, 1.8)}${chip}</span></div><h3>${title}</h3><p>${text}</p></article>`
  return `<div class="pg pg--mid">
    <h1 class="pg-title">Google Ads</h1>
    <section class="ads-hero">
      <div class="ads-hero__text"><h2>Grow your business faster with Google Ads</h2>
        <p>Get more customers with Google Ads from Hostinger. Your ads will show on Google Search, YouTube, Gmail, Display, and Discover, bringing more people straight to your business.</p>
        <button class="btn btn-primary">Get started</button></div>
      <div class="ads-hero__art" aria-hidden="true">
        <span class="ads-hero__tile">${I(ICON2.target, 30, 1.8)}<small>Ads</small></span>
        <div class="ads-hero__card"><b>Google Ads campaign</b><small>By Hostinger</small>
          <ul>${['Show up high in Google', 'Grow site traffic instantly', 'Pay only for real clicks', 'Pause your ads anytime'].map(t => `<li>${I(ICON2.tick, 14, 2.4)}${t}</li>`).join('')}</ul></div>
        <span class="ads-hero__chip"><i>${I(ICON2.trend, 13, 2.2)}</i>+ 30% clicks</span>
      </div>
    </section>
    <section class="ads-offer"><span class="ads-offer__icon">${I(ICON2.pct, 22, 1.8)}</span><p>Reach your 60-day spend target and get it back in Google Ads credit. Test ideas without burning your budget!</p><button class="ads-offer__link">Learn more</button><button class="ads-offer__btn">Claim offer</button></section>
    <section class="pg-card ads-how">
      <div class="ads-how__head"><h2>How it works</h2><button class="btn-outline btn-outline--sm">Learn more ${I(ICON2.ext, 13, 2)}</button></div>
      <div class="ads-steps">
        ${step(1, ICON2.clock, 'One-click', 'Connect your Google Ads account', "Connect an existing Google Ads account, or we'll create one for you.")}
        ${step(2, ICON2.clock, 'Few minutes', 'Tell us about your business', 'Answer a few questions about your budget, audience, and goals.')}
        ${step(3, ICON2.trend, 'Track here', 'Launch your ad and track results', 'Google reviews and launches your ad within 1 business day. Track results in Hostinger.')}
      </div>
    </section>
  </div>`
}

// ── VPS ──

function vpsArt(kind) {
  if (kind === 'speed') return `<svg viewBox="0 0 260 150" aria-hidden="true"><path d="M60 0v150M200 0v150M0 40h260M0 110h260" stroke="#fff" stroke-opacity=".06"/>
    <circle cx="130" cy="72" r="46" fill="none" stroke="#2A1E5C" stroke-width="7"/><path d="M95 104A46 46 0 1 1 168 98" fill="none" stroke="#21C08B" stroke-width="7" stroke-linecap="round"/>
    <path d="M136 42l-20 36h14l-6 30 22-40h-15z" fill="#8C6CF7"/><rect x="104" y="116" width="52" height="20" rx="6" fill="#1A1238" stroke="#4B3A8C"/>
    <circle cx="116" cy="126" r="4" fill="none" stroke="#fff" stroke-width="1.4"/><text x="124" y="130" font-family="Geist, system-ui, sans-serif" font-size="9" fill="#fff">1 Gb/s</text></svg>`
  if (kind === 'game') return `<svg viewBox="0 0 260 150" aria-hidden="true"><path d="M30 40l4 4M226 30v8M222 34h8" stroke="#B9A4FF" stroke-width="2"/>
    <g transform="rotate(-8 90 80)"><rect x="56" y="52" width="70" height="70" fill="#7A52E8"/><rect x="56" y="52" width="70" height="20" fill="#9B7BFF"/><rect x="70" y="80" width="14" height="14" fill="#4A2BA8"/><rect x="98" y="80" width="14" height="14" fill="#4A2BA8"/><rect x="84" y="100" width="14" height="10" fill="#2E1A6E"/></g>
    <g transform="rotate(10 180 80)"><rect x="140" y="64" width="84" height="44" rx="22" fill="#E9E4FF"/><rect x="156" y="82" width="18" height="6" rx="2" fill="#2B2350"/><rect x="162" y="76" width="6" height="18" rx="2" fill="#2B2350"/><circle cx="198" cy="80" r="5" fill="#8C6CF7"/><circle cx="208" cy="90" r="5" fill="#21C08B"/></g>
    <rect x="34" y="28" width="12" height="12" fill="#9B7BFF" transform="rotate(20 40 34)"/><rect x="216" y="118" width="10" height="10" fill="#7A52E8"/></svg>`
  if (kind === 'apps') return `<svg viewBox="0 0 260 150" aria-hidden="true"><path d="M0 30h260M0 60h260M0 90h260M0 120h260M40 0v150M80 0v150M120 0v150M160 0v150M200 0v150M240 0v150" stroke="#fff" stroke-opacity=".05"/>
    <rect x="40" y="38" width="190" height="112" rx="8" fill="#14102A" stroke="#3A2D72"/><rect x="66" y="24" width="96" height="22" rx="5" fill="#14102A" stroke="#4B3A8C"/>
    <rect x="74" y="31" width="9" height="9" rx="2" fill="#8C6CF7"/><text x="88" y="39" font-family="Geist, system-ui, sans-serif" font-size="8" fill="#fff">App manager</text>
    <text x="52" y="66" font-family="Geist, system-ui, sans-serif" font-size="8" fill="#fff">Projects</text><rect x="178" y="58" width="36" height="10" rx="3" fill="#673DE6"/>
    <rect x="52" y="76" width="166" height="1" fill="#2A2150"/>${[0, 1, 2].map(i => `<rect x="52" y="${84 + i * 16}" width="${60 - i * 10}" height="5" rx="2.5" fill="#4B3A8C"/><rect x="140" y="${84 + i * 16}" width="28" height="6" rx="3" fill="#1E5C45"/><rect x="190" y="${84 + i * 16}" width="22" height="5" rx="2.5" fill="#3A2D72"/>`).join('')}
    <rect x="212" y="94" width="22" height="22" rx="5" fill="#1A1238" stroke="#5B4AA8"/><path d="M223 99v12M217 105h12" stroke="#fff" stroke-width="1.6"/></svg>`
  return `<svg viewBox="0 0 260 150" aria-hidden="true"><path d="M50 22v8M46 26h8M220 90v8M216 94h8" stroke="#B9A4FF" stroke-width="2"/>
    <rect x="70" y="40" width="140" height="44" rx="6" fill="#1A1238" stroke="#5B4AA8"/><circle cx="92" cy="62" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="104" cy="62" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="118" cy="56" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="118" cy="68" r="4" fill="none" stroke="#fff" stroke-width="2"/><path d="M96 62h4M108 62l6-5M108 62l6 5" stroke="#fff" stroke-width="2"/><rect x="136" y="61" width="58" height="2" fill="#5B4AA8"/>
    <rect x="80" y="84" width="6" height="20" fill="#2A1E5C"/><rect x="194" y="84" width="6" height="20" fill="#2A1E5C"/>
    <rect x="70" y="104" width="140" height="44" rx="6" fill="#14102A" stroke="#3A2D72"/><rect x="88" y="122" width="10" height="4" rx="2" fill="#21C08B"/><rect x="104" y="122" width="10" height="4" rx="2" fill="#8C6CF7"/><rect x="136" y="123" width="58" height="2" fill="#3A2D72"/></svg>`
}

function pageVps() {
  const card = (art, title, text, primary, more = true) => `<article class="vps-card">
    <div class="vps-card__img">${vpsArt(art)}<span class="svc-card__badge">Save up to 70%</span></div>
    <h2>${title}</h2><p>${text}</p>
    <div class="vps-card__actions">${more ? `<button class="btn btn-primary btn-sm">${primary}</button><button class="vps-more">Learn more ${I(ICON2.ext, 13, 2)}</button>` : `<button class="btn btn-primary btn-sm vps-wide">${primary}</button>`}</div>
  </article>`
  return `<div class="pg pg--mid vps-page">
    <h1 class="pg-title">VPS</h1>
    <section class="pg-card vps-wrap">
      ${card('speed', 'VPS hosting', 'Enjoy full power, flexibility, and speed with your own virtual private server.', 'Set up VPS')}
      ${card('game', 'Game Panel', 'Host your favorite games with powerful processors and full customization.', 'Set up Game Panel')}
      ${card('apps', 'Application catalog', 'Deploy popular apps like OpenClaw, Paperclip, Hermes agent and more.', 'See catalog', false)}
      ${card('n8n', 'Self hosting n8n', 'Self-hosted n8n delivers no-code AI workflows with unlimited runs.', 'Set up n8n')}
    </section>
  </div>`
}

// ── notifications & account panels ──

app.readAll = false
function unreadCount() { return app.readAll ? 0 : (app.data?.nba || []).length }

function renderNotif() {
  const list = app.data.nba
  const n = unreadCount()
  $('#bellCount').hidden = !n
  $('#bellCount').textContent = n
  $('#markRead').hidden = !n
  $('#notifList').innerHTML = list.length ? list.map(x => {
    const kind = Object.keys(todoIcons).find(k => x.id.startsWith(k)) || 'credits'
    return `<div class="notif">
      <span class="todo__icon t-${esc(x.tone)} no-dot" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${todoIcons[kind]}</svg></span>
      <div class="notif__text">
        <div class="notif__title">${app.readAll ? '' : '<i class="notif__dot" aria-label="Unread"></i>'}${esc(x.title)}</div>
        <div class="notif__desc">${esc(x.reason)}</div>
        <button class="btn btn-ghost btn-sm" data-propose="${attrJson(x.action)}" data-placement="bell:${esc(x.id.split('-')[0])}">${esc(x.price ? x.cta : (x.cta.startsWith('Claim') ? 'Claim' : x.cta))}</button>
      </div>
      <button class="kebab" data-ask="${esc(`Tell me more about this: ${x.title}`)}" aria-label="More about ${esc(x.title)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>
    </div>`
  }).join('') : '<p class="notif__empty">You\'re all caught up.</p>'
}

function renderAccount() {
  const c = app.data.customer
  $('#acctName').textContent = [c.firstName, c.lastName].filter(Boolean).join(' ')
  $('#acctEmail').textContent = c.email || ''
  $('#acctCredits').textContent = app.data.usage.aiCredits
}

function togglePop(id, open) {
  const pop = $(id)
  const btn = id === '#notifPop' ? $('#bellBtn') : $('#avatar')
  open ??= pop.hidden
  document.querySelectorAll('.pop').forEach(p => { p.hidden = true })
  $('#bellBtn').setAttribute('aria-expanded', 'false'); $('#avatar').setAttribute('aria-expanded', 'false')
  pop.hidden = !open
  btn.setAttribute('aria-expanded', String(open))
}
function closePops() { document.querySelectorAll('.pop').forEach(p => { p.hidden = true }); $('#bellBtn').setAttribute('aria-expanded', 'false'); $('#avatar').setAttribute('aria-expanded', 'false') }

function bindPops() {
  $('#bellBtn').addEventListener('click', e => { e.stopPropagation(); togglePop('#notifPop') })
  $('#avatar').addEventListener('click', e => { e.stopPropagation(); togglePop('#acctPop') })
  $('#markRead').addEventListener('click', () => { app.readAll = true; document.body.classList.add('read-all'); renderNotif() })
  document.addEventListener('click', e => {
    if (e.target.closest('.pop')) {
      if (e.target.closest('[data-propose],[data-ask]')) closePops()
      return
    }
    closePops()
  })
  $('#acctPop').addEventListener('click', e => {
    const t = e.target.closest('[data-theme]')
    if (!t) return
    $('#acctPop').querySelectorAll('[data-theme]').forEach(b => { const on = b === t; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)) })
  })
  $('#page').addEventListener('click', e => {
    const c = e.target.closest('[data-cat]')
    if (c) { app.svc.cat = c.dataset.cat; $('#page').querySelectorAll('[data-cat]').forEach(b => { const on = b === c; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)) }); renderServices() }
  })
  $('#page').addEventListener('input', e => { if (e.target.id === 'svcSearch') { app.svc.q = e.target.value; renderServices() } })
}

// ── Ecommerce ──

app.ecomTerm = 12
function pageEcommerce() {
  const feats = [
    [ICON.tag, 'Sell anything you want', 'Physical and digital products, subscriptions, gift cards, and more.'],
    ['<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><path d="M13.5 16.75h6.5M16.75 13.5V20"/>', 'Unlimited products, unlimited channels', 'Sell everywhere your customers are.'],
    ['<path d="M9 3h6l-1.5 4h-3zM6 21h12a2 2 0 0 0 2-2c0-5-3.5-10-8-10S4 14 4 19a2 2 0 0 0 2 2z"/><path d="M12 12v6M10 16.5c0 .8.9 1.5 2 1.5s2-.7 2-1.5-.9-1.3-2-1.5-2-.7-2-1.5.9-1.5 2-1.5 2 .7 2 1.5"/>', '0% transaction fees', 'Keep everything you earn.'],
    ['<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>', '100+ secure ways to get paid', 'Apple Pay, Google Pay, Stripe, PayPal and more.'],
    [ICON.wand, 'AI product tools', 'Create and manage products faster with AI.'],
    ['<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 'Share a link, start selling instantly', 'Share a payment link on social media, WhatsApp, or in a DM.'],
    [ICON.grid, 'One dashboard', 'Inventory, orders, customers, discounts, taxes, and analytics.'],
  ]
  const t = app.ecomTerm
  return `<div class="pg ecom">
    <h1 class="ecom__title">Everything you need to sell online, in one plan</h1>
    <ul class="ecom__badges">
      <li>${I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>', 15, 1.8)}0% transaction fees</li>
      <li>${I(ICON2.shield, 15, 1.8)}30-day money-back guarantee</li>
      <li>${I('<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/>', 15, 1.8)}24/7 support</li>
    </ul>
    <div class="ecom__grid">
      <ul class="ecom__feats">${feats.map(([ic, h, p]) => `<li>${I(ic, 21, 1.6)}<div><h3>${h}</h3><p>${p}</p></div></li>`).join('')}</ul>
      <div class="ecom__buy">
        <div class="ecom__opts" role="radiogroup" aria-label="Billing period">
          <div class="ecom__popular">Most popular</div>
          <button role="radio" aria-checked="${t === 12}" class="ecom__opt ${t === 12 ? 'is-on' : ''}" data-term="12">
            <span class="radio"></span><b>12 months</b>
            <span class="ecom__price"><span class="ecom__was"><s>€10,99</s><em>55% OFF</em></span><span><strong>€4,99</strong> /mo</span></span>
          </button>
          <button role="radio" aria-checked="${t === 1}" class="ecom__opt ecom__opt--plain ${t === 1 ? 'is-on' : ''}" data-term="1">
            <span class="radio"></span><b>1 month</b>
            <span class="ecom__price"><span><strong>€10,99</strong> /mo</span></span>
          </button>
        </div>
        <button class="ecom__choose">Choose plan</button>
        <p class="ecom__fine">Renews at €7,99/mo. Prices exclude applicable taxes. Unlimited features are subject to our Fair Usage Policy.</p>
      </div>
    </div>
  </div>`
}

// ── Agent workspace: sub-pages ──

app.agentView = 'chat'
const AG_TITLES = { files: 'Files', skills: 'Skills', projects: 'Projects', apps: 'Apps', jobs: 'Jobs' }

function agentShow(v) {
  app.agentView = AG_TITLES[v] ? v : 'chat'
  const chat = app.agentView === 'chat'
  $('#agPanel').hidden = chat
  $('#agScroll').hidden = !chat
  document.querySelector('.ag-bottom').hidden = !chat
  document.querySelectorAll('#agentApp [data-agview]').forEach(b => b.classList.toggle('is-on', b.dataset.agview === app.agentView))
  if (!chat) { $('#agPanel').innerHTML = AG_PAGES[app.agentView](); track('view', 'agent:' + app.agentView) }
  closeAgentSide()
}

const AG_PAGES = {
  files: () => `<div class="agp">
    <h1>Files</h1><p class="agp__sub">Files created and shared in your chats</p>
    <label class="agp__search">${I(ICON.search, 15)}<span class="sr-only">Search files</span><input type="search" placeholder="Search files..."></label>
    <div class="agp__tabsrow"><div class="agp__tabs" role="tablist">
      <button role="tab" class="is-on" aria-selected="true">All 0</button><button role="tab" aria-selected="false">Files 0</button><button role="tab" aria-selected="false">Media 0</button></div>
      <div class="agp__layout"><button class="is-on" aria-label="List view">${I(ICON.list, 16)}</button><button aria-label="Grid view">${I(ICON.grid, 16)}</button></div></div>
    <div class="agp__empty">${I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 38, 1.4)}<p>No files yet.</p></div>
  </div>`,

  skills: () => {
    const groups = [
      ['FOR YOU', 'c-orange', [['Based on AI Memory', ICON.sparkle, 'free']]],
      ['CUSTOM', 'c-violet', [['Your skills', ICON.wand, 'plus']]],
      ['ANALYZE', 'c-blue', [['Business Advisor', ICON2.check], ['SEO Consultant', ICON2.trend], ['Legal Advisor', ICON2.shield]]],
      ['CREATE', 'c-violet', [['Creative Writer', '<path d="M16 3l5 5L8 21H3v-5z"/>'], ['Customer Comms', '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>']]],
      ['GROW', 'c-green', [['Marketing Planner', '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6"/>'], ['Sales & Outreach', '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="12" cy="6" r="2"/><path d="M12 8v3M7 16l4-5M17 16l-4-5"/>']]],
    ]
    return `<div class="agp agp--wide">
      <h1>What would you like help with?</h1><p class="agp__sub">Pick a specialist, then the part of the job.</p>
      <label class="agp__search agp__search--full">${I(ICON.search, 16)}<span class="sr-only">Search skills</span><input type="search" id="skillSearch" placeholder="Search skills"></label>
      <div class="skill-groups">${groups.map(([g, c, items]) => `<div class="skill-group ${c}" style="flex:${items.length}"><span class="skill-group__label">${g}</span><div class="skill-group__items">
        ${items.map(([n, ic, tag]) => `<button class="skill-tile" ${tag === 'free' ? 'data-agmodal="memory"' : ''}>${!tag ? `<span class="skill-tile__lock" aria-label="Plus">${I(ICON2.lockS, 13, 1.8)}</span>` : ''}<span class="skill-tile__icon">${I(ic, 18, 1.8)}</span>
          <span class="skill-tile__name">${n}${tag === 'free' ? ' <em class="free">FREE</em>' : tag === 'plus' ? ` <em class="plus">${I(ICON2.lockS, 10, 2)}Plus</em> <em class="cnt">0/50</em>` : ''}</span></button>`).join('')}
      </div></div>`).join('')}</div>
      <div class="skill-list" id="skillList">${SKILLS.map(([h, p]) => skillRow(h, p)).join('')}</div>
    </div>`
  },

  projects: () => `<div class="agp agp--wide">
    <h1>Projects</h1><p class="agp__sub">Group chats with shared instructions.</p>
    <section class="proj">
      <div class="proj__head"><b>Projects</b><span class="proj__tag">Example projects</span><span class="proj__plus">${I(ICON2.lockS, 11, 2)}Plus</span></div>
      <div class="proj__body">
        <ul class="proj__blur" aria-hidden="true">${['Online store launch', 'Marketing strategies', 'Blog and SEO', 'Brand voice'].map((t, i) => `<li><i></i><span><b>${t}</b><small>${[6, 4, 12, 3][i]} chats · Instructions set</small></span></li>`).join('')}</ul>
        <div class="proj__upsell">
          <div class="proj__upsell-head"><span>${I('<path d="M3 9a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M7 7V6a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v7"/>', 18, 1.7)}</span><div><b>Keep every project in its own space</b><small>Projects are included in Agent Plus</small></div></div>
          <ul><li>${I(ICON2.tick, 13, 2.4)}Group related chats in one place</li><li>${I(ICON2.tick, 13, 2.4)}Set instructions once, every chat follows them</li></ul>
          <div class="proj__actions"><button class="btn btn-primary btn-sm">Upgrade to Agent Plus</button><button class="link small">Learn more</button></div>
        </div>
      </div>
    </section>
  </div>`,

  apps: () => {
    const tab = app.appsTab || 'popular'
    return `<div class="agp agp--wide">
      <h1>Connections</h1><p class="agp__sub">Connect the apps you use so Hostinger Agent can act on your behalf.</p>
      <div class="conn-plus"><span class="conn-plus__icon">${I(ICON2.lockS, 18, 1.7)}</span><div><b>App connections are included in Agent Plus</b><small>Your agent can read, write and take action in the tools you already use.</small></div><button class="btn btn-primary btn-sm">Upgrade to Agent Plus</button></div>
      <div class="conn-bar"><div class="seg seg--text" role="tablist">${[['popular', 'Popular'], ['all', 'All'], ['mcp', 'Custom MCP']].map(([k, l]) => `<button role="tab" class="${tab === k ? 'is-on' : ''}" aria-selected="${tab === k}" data-apptab="${k}">${l}</button>`).join('')}</div>
        <label class="agp__search conn-search">${I(ICON.search, 16)}<span class="sr-only">Search apps</span><input type="search" id="appSearch" placeholder="Search apps" value="${esc(app.appQ || '')}"></label></div>
      <div id="appList">${appListHtml()}</div>
    </div>`
  },
}

const SKILLS = [
  ['Pricing and renewal costs', 'Check what a plan costs to buy now and what it renews at'],
  ['Referrals and Partner Program', 'Check your referral rewards, commissions and Partner Program status'],
  ['Renew a service', 'Renew your existing plan or domain before it expires'],
  ['Unrecognized charge', 'Trace a Hostinger charge on your statement and find out what it was for'],
  ['Find the right plan', 'Get a plan recommendation for what you are building, with a payment link'],
  ['AI Builder agentic mode', 'Get help with an app you are building by prompting Hostinger AI Builder'],
  ['AI Builder manual mode', 'Get help editing your site in the Hostinger AI Builder editor'],
  ['Builder store', 'Fix payments, shipping or orders on a Hostinger store.'],
  ['Change a mistyped domain', 'Swap a domain you registered by mistake for the name you meant'],
  ['Set up domain forwarding', 'Point one of your domains at another, checked before it goes live'],
  ['Domain move between accounts', 'Move a Hostinger domain to another Hostinger account.'],
  ['Domain not resolving', 'Find out why your domain does not load or points to the wrong place'],
  ['Email mailbox management', 'Change existing mailboxes, passwords, forwards and aliases.'],
  ['Email not sending or arriving', 'Diagnose delivery problems with email on your Hostinger domain'],
  ['Email setup and client', 'Set up email on a domain and connect a mail app.'],
]
const skillRow = (h, p) => `<button class="skill-row" data-ask="${esc(`Help me with: ${h}. ${p}.`)}" data-skill="${esc((h + ' ' + p).toLowerCase())}"><span><b>${esc(h)}</b><small>${esc(p)}</small></span>${I(ICON.chevR, 16, 2)}</button>`

const APPS = [
  ['Hostinger Mail', '#673DE6', 'Read, search and send email from your Hostinger mailboxes.', [], true],
  ['Gmail', '#D93025', 'Read, search and send email, and act on new messages as they arrive.', ['New email received', 'Email with label added']],
  ['Slack', '#4A154B', 'Post messages, read channels and threads, and react to new activity in your workspace.', ['New message in channel', 'You were mentioned']],
  ['Google Calendar', '#1A73E8', 'Create events, check availability and get reminders before meetings.', ['Event starting soon', 'New event created']],
  ['Notion', '#1D1E20', 'Search, create and update pages and databases in your workspace.', ['Page updated', 'New database item']],
  ['Google Drive', '#188038', 'Find, read and organise files and folders, and share them with others.', ['New file in folder', 'File updated']],
  ['GitHub', '#24292F', 'Work with repositories, issues and pull requests.', ['New issue opened', 'Pull request merged']],
  ['Linear', '#5E6AD2', 'Create and update issues, and keep track of projects and cycles.', ['Issue created', 'Issue status changed']],
  ['HubSpot', '#E8590C', 'Manage contacts, deals and marketing emails in your CRM.', ['New contact', 'Deal stage changed']],
  ['Stripe', '#635BFF', 'Look up payments, customers and subscriptions.', ['Payment succeeded', 'Subscription cancelled']],
  ['Outlook', '#0F6CBD', 'Read and send email and manage your calendar.', ['New email received', 'Event starting soon']],
]
const APP_SECTIONS = [['Featured', APPS.slice(0, 10).map(a => a[0])], ['Communication', ['Hostinger Mail', 'Gmail', 'Outlook', 'Slack']]]
app.openTriggers = new Set()

function appCard(name) {
  const [n, color, desc, triggers, own] = APPS.find(a => a[0] === name)
  const key = n.toLowerCase().replace(/\W+/g, '-')
  const open = app.openTriggers.has(key)
  return `<div class="conn-app">
    <span class="conn-app__logo" style="background:${color}">${own ? QMARK(36) : esc(n.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>
    <div class="conn-app__text"><b>${esc(n)}</b><p>${esc(desc)}</p>
      ${triggers.length ? `<button class="conn-app__trig" data-trig="${key}" aria-expanded="${open}">${I(ICON.sparkle, 13, 2)}Triggers${I('<path d="m6 9 6 6 6-6"/>', 13, 2)}</button>${open ? `<ul class="conn-app__triggers">${triggers.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}` : ''}</div>
    <button class="conn-app__btn">${I(ICON2.lockS, 13, 1.8)}Connect</button>
  </div>`
}

function appListHtml() {
  const tab = app.appsTab || 'popular'
  const q = (app.appQ || '').trim().toLowerCase()
  if (tab === 'mcp') return `<section class="conn-mcp"><b>Add a custom MCP server</b><p>Connect any tool that speaks the Model Context Protocol by pasting its server URL.</p>
    <div class="conn-mcp__row"><input type="url" placeholder="https://your-server.example/mcp" aria-label="MCP server URL"><button class="btn btn-primary btn-sm">${I(ICON2.lockS, 13, 2)} Add server</button></div></section>`
  const match = n => !q || `${n} ${APPS.find(a => a[0] === n)[2]}`.toLowerCase().includes(q)
  const sections = tab === 'all' || q ? [[q ? 'Results' : 'All apps', APPS.map(a => a[0])]] : APP_SECTIONS
  const html = sections.map(([title, names]) => {
    const list = names.filter(match)
    return list.length ? `<h2 class="conn-title">${title}</h2><div class="conn-grid">${list.map(appCard).join('')}</div>` : ''
  }).join('')
  return html || '<p class="agp__none">No apps match your search.</p>'
}

// ── Agent pop-ups: memory, WhatsApp, mobile ──

const COUNTRIES = [['NL', '+31'], ['LT', '+370'], ['LV', '+371'], ['EE', '+372'], ['PL', '+48'], ['DE', '+49'], ['GB', '+44'], ['UA', '+380'], ['US', '+1']]
const AG_MODALS = {
  memory: () => `<button class="ag-modal__x" data-agclose aria-label="Close">${I(ICON2.x, 18, 2)}</button>
    <h2 class="ag-modal__title">Let Hostinger Agent remember your setup</h2>
    <ul class="mem-list">
      <li>${I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>', 18, 1.8)}<div><b>No repeating yourself</b><small>Pick up right where you left off.</small></div></li>
      <li>${I('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', 18, 1.8)}<div><b>Problems caught early</b><small>Hostinger Agent flags issues in your setup before you ask.</small></div></li>
      <li>${I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/>', 18, 1.8)}<div><b>Personalised advice</b><small>Answers built on your goals, not generic ones.</small></div></li>
    </ul>
    <button class="btn btn-primary ag-modal__wide" data-memory="on">Turn on AI memory</button>
    <button class="ag-modal__later" data-agclose>Maybe later</button>
    <p class="ag-modal__fine">Hostinger Agent remembers useful details from your onboarding, conversations (e.g. with Hostinger Agent, Hostinger AI Builder), and activity across Hostinger, so every interaction feels tailored to you. <button class="link small" type="button">Privacy Policy</button></p>`,

  whatsapp: () => `<button class="ag-modal__x" data-agclose aria-label="Close">${I(ICON2.x, 18, 2)}</button>
    <span class="wa-label">${I('<path d="M4 20l1.4-4A8 8 0 1 1 8 18.6z"/>', 12, 2.2)}WHATSAPP</span>
    <h2 class="ag-modal__title ag-modal__title--sm">Take Hostinger Agent with you</h2>
    <ul class="wa-checks"><li>${I(ICON2.tick, 12, 2.6)}Instant replies, 24/7</li><li>${I(ICON2.tick, 12, 2.6)}Websites &amp; domains on the go</li><li>${I(ICON2.tick, 12, 2.6)}Job results as they finish</li></ul>
    <form class="wa-form" id="waForm">
      <label for="waNumber"><b>Your WhatsApp number</b></label>
      <div class="wa-field">
        <select id="waCountry" aria-label="Country code">${COUNTRIES.map(([c, d]) => `<option value="${d}">${c} ${d}</option>`).join('')}</select>
        <input id="waNumber" type="tel" inputmode="tel" placeholder="415 555 0132" autocomplete="tel-national">
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
      </div>
      <p class="wa-help" id="waHelp">So Hostinger Agent knows it's you when you message.</p>
    </form>`,

  mobile: () => `<button class="ag-modal__x" data-agclose aria-label="Close">${I(ICON2.x, 18, 2)}</button>
    <h2 class="ag-modal__title">Hostinger Agent, in your pocket</h2>
    <p class="ag-modal__lead">Join the waitlist and be among the first to try the Hostinger Agent app on your phone.</p>
    <b class="mob-h">What's planned</b>
    <ul class="mob-plan">
      <li><span class="c-violet">${I(ICON2.trend, 17, 1.8)}</span><div><b>Insights that matter</b><small>Get the updates that matter to your business, the moment they happen.</small></div></li>
      <li><span class="c-green">${I('<circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h11L21 7H6.5"/>', 17, 1.8)}</span><div><b>Your store, anywhere</b><small>Manage orders, products and customers from wherever you are.</small></div></li>
      <li><span class="c-orange">${I('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1.5 6-1 6-1s.5 3-1 6l-6 6-5-5z"/><path d="M9 10 5 9l-2 2 4 1M14 15l1 4-2 2-1-4"/><circle cx="15.5" cy="8.5" r="1.5"/>', 17, 1.8)}</span><div><b>Build and run your business on the go</b><small>Start a new website or business and keep it running, all from your phone.</small></div></li>
    </ul>
    <b class="mob-h">Your phone</b>
    <div class="mob-os" role="radiogroup" aria-label="Your phone">
      <button role="radio" aria-checked="false" data-os="iOS">${I('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>', 17, 1.8)}iOS</button>
      <button role="radio" aria-checked="false" data-os="Android">${I('<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M6 6h12M6 18h12"/>', 17, 1.8)}Android</button>
    </div>
    <button class="btn ag-modal__wide mob-join" id="mobJoin" disabled>Join waitlist</button>
    <button class="ag-modal__later" data-agclose>Not interested</button>`,
}

function showAgModal(kind) {
  $('#agModalBox').innerHTML = AG_MODALS[kind]()
  $('#agModalBox').setAttribute('aria-label', { memory: 'AI memory', whatsapp: 'WhatsApp', mobile: 'Mobile app' }[kind])
  $('#agModal').hidden = false
  track('view', 'agent:modal-' + kind)
  setTimeout(() => ($('#agModalBox').querySelector('input, .btn-primary') || $('#agModalBox').querySelector('button'))?.focus(), 30)
}
function closeAgModal() { $('#agModal').hidden = true; $('#agModalBox').innerHTML = '' }

function maybeAskMemory() {
  try { if (localStorage.getItem('qp-memory')) return } catch { return }
  setTimeout(() => { if (view === 'agent' && $('#agModal').hidden) showAgModal('memory') }, 350)
}
function setMemoryAnswer(v) { try { localStorage.setItem('qp-memory', v) } catch {} }

function bindAgentExtras() {
  const ag = $('#agentApp')
  $('#agChannels').addEventListener('click', () => {
    const open = $('#agChannels').getAttribute('aria-expanded') !== 'true'
    $('#agChannels').setAttribute('aria-expanded', String(open))
    $('#agChanSub').hidden = !open
  })
  ag.addEventListener('click', e => {
    const v = e.target.closest('[data-agview]')
    if (v) return agentShow(v.dataset.agview)
    const m = e.target.closest('[data-agmodal]')
    if (m) return showAgModal(m.dataset.agmodal)
    if (e.target.id === 'agModal') { if ($('#agModalBox').querySelector('.mem-list')) setMemoryAnswer('later'); return closeAgModal() }
    if (e.target.closest('[data-agclose]')) { if ($('#agModalBox').querySelector('.mem-list')) setMemoryAnswer('later'); return closeAgModal() }
    if (e.target.closest('[data-memory]')) { setMemoryAnswer('on'); closeAgModal(); return toast('AI memory is on') }
    const os = e.target.closest('[data-os]')
    if (os) {
      $('#agModalBox').querySelectorAll('[data-os]').forEach(b => { const on = b === os; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)) })
      $('#mobJoin').disabled = false; $('#mobJoin').classList.add('btn-primary'); $('#mobJoin').dataset.chosen = os.dataset.os
      return
    }
    if (e.target.closest('#mobJoin')) { const osName = $('#mobJoin').dataset.chosen; closeAgModal(); track('click', 'agent:waitlist'); return toast(`You're on the waitlist for the ${osName} app`) }
    const tab = e.target.closest('[data-apptab]')
    if (tab) { app.appsTab = tab.dataset.apptab; return agentShow('apps') }
    const trig = e.target.closest('[data-trig]')
    if (trig) { const k = trig.dataset.trig; app.openTriggers.has(k) ? app.openTriggers.delete(k) : app.openTriggers.add(k); $('#appList').innerHTML = appListHtml(); return }
    if (e.target.closest('[data-refer]')) $('#referBtn').click()
  })
  ag.addEventListener('submit', e => {
    if (e.target.id !== 'waForm') return
    e.preventDefault()
    const num = $('#waNumber').value.replace(/[^\d]/g, '')
    if (num.length < 6) { $('#waHelp').textContent = 'Enter your phone number without the country code.'; $('#waHelp').classList.add('is-error'); return $('#waNumber').focus() }
    const full = `${$('#waCountry').value} ${$('#waNumber').value.trim()}`
    closeAgModal(); track('click', 'agent:whatsapp-saved')
    toast(`Saved ${full}. Message Hostinger Agent on WhatsApp any time.`)
  })
  ag.addEventListener('input', e => {
    if (e.target.id === 'skillSearch') {
      const q = e.target.value.trim().toLowerCase()
      ag.querySelectorAll('.skill-row').forEach(r => { r.hidden = q && !r.dataset.skill.includes(q) })
    }
    if (e.target.id === 'appSearch') { app.appQ = e.target.value; $('#appList').innerHTML = appListHtml() }
  })
  $('#page').addEventListener('click', e => {
    const t = e.target.closest('[data-term]')
    if (t) { app.ecomTerm = Number(t.dataset.term); renderPage() }
  })
}

// ── GPU ──

const GPUS = [
  ['B200', '192GB VRAM', '€4,02/hr', true], ['B200 (Dedicated)', '192GB VRAM', '€6,32/hr', true],
  ['RTX PRO 6000 (Server)', '96GB VRAM', '€0,58/hr', false], ['A100', '80GB VRAM', '€1,38/hr', false],
  ['L40S', '48GB VRAM', '€0,86/hr', true], ['RTX 5090', '32GB VRAM', '€0,57/hr', false], ['RTX 4090', '24GB VRAM', '€0,38/hr', false],
]
const CHIP = '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'
app.gpuPick = null

function pageGpu() {
  const feat = (ic, h, p) => `<article class="gpu-feat"><span class="gpu-feat__icon">${I(ic, 18, 1.8)}</span><h3>${h}</h3><p>${p}</p></article>`
  return `<div class="pg pg--mid gpu-page">
    <h1 class="pg-title">GPU</h1>
    <section class="gpu-hero">
      <div class="gpu-hero__text"><h2>Build and scale with GPU power</h2>
        <p>Train models, run inference, and handle demanding workloads on high-performance GPU infrastructure.</p>
        <button class="gpu-hero__btn" data-gpu-start>Get started</button></div>
      <div class="gpu-hero__art" aria-hidden="true">
        <div class="gpu-ring r1"></div><div class="gpu-ring r2"></div><div class="gpu-ring r3"></div>
        <div class="gpu-deploy">${I(CHIP, 22, 1.8)}<span>Deploy</span></div>
        <svg class="gpu-cursor" viewBox="0 0 24 24" width="54" height="54"><path d="M5 3v17l5-5 3 7 3-1.4-3-6.6h7z" fill="#fff" stroke="#14102A" stroke-width="1.2"/></svg>
      </div>
    </section>
    <div class="gpu-feats">
      ${feat(ICON.sparkle, 'Run AI projects without limits', 'Train models, run inference, and process large datasets with dedicated GPU resources. Scale on demand without managing hardware.')}
      ${feat('<circle cx="12" cy="12" r="9"/><path d="M12 12l4-4M7 15a6 6 0 0 1 10 0"/>', 'Launch GPU instances in seconds', 'Create and start GPU instances from Hostinger in a few clicks. Skip lengthy setup and get your workloads running faster.')}
      ${feat('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', 'Power demanding workloads', 'Handle rendering, large AI models, and parallel processing tasks with dedicated GPU performance built for compute-heavy workloads.')}
    </div>
    <div class="gpu-head" id="gpuList"><h2>Choose GPU instance</h2>
      <div class="gpu-credit"><span>Credit balance</span><b>0</b><button class="btn-dark" data-route="router">Top up</button></div></div>
    <section class="pg-card gpu-list">${GPUS.map(([n, v, p, ok], i) => `<div class="gpu-row ${app.gpuPick === i ? 'is-on' : ''}">
      <span class="gpu-row__logo">${I(CHIP, 18, 1.8)}</span>
      <div class="gpu-row__text"><b>${n}</b><small>${v} • From ${p}</small></div>
      ${ok ? `<button class="gpu-row__btn" data-gpu="${i}">${app.gpuPick === i ? 'Selected' : 'Select'}</button>` : '<button class="gpu-row__btn" disabled title="Currently unavailable">Select</button>'}
    </div>`).join('')}</section>
  </div>`
}

// ── API ──

const API_TOOLS = {
  Editors: [['Claude Code', '#D97757'], ['Cursor', '#1D1E20'], ['Codex', '#5B7CF7'], ['VS Code', '#1F8AD2'], ['Devin Desktop', '#2BB5A0'], ['Antigravity', '#4C7DF0']],
  Terminal: [['Claude Code CLI', '#D97757'], ['Gemini CLI', '#4C7DF0'], ['Codex CLI', '#5B7CF7']],
  Other: [['Any MCP client', '#673DE6'], ['REST API', '#36344D']],
}
const API_EXAMPLES = [
  ['Is coffeelab.com available?', 'Yes — **coffeelab.com** is available. Want me to register it and connect it to your site?'],
  ['Point blog.lunaclay-studio.com to my new site', "Done. I added a CNAME record for **blog** and issued a free SSL certificate. It'll be live in about 10 minutes."],
  ['Back up lunaclay-studio.com now', 'Backup started. I\'ll tell you when it finishes — usually under 5 minutes.'],
]
app.api = { tab: 'connect', tool: 'Claude Code', mode: 'one', open: { Editors: true, Terminal: false, Other: false }, tools: 'all' }
let apiDemoTimer = null

function pageApi() {
  const a = app.api
  const logo = (n, c, size = 26) => `<span class="api-logo" style="--c:${c};width:${size}px;height:${size}px">${esc(n.split(' ')[0].slice(0, 2))}</span>`
  const color = Object.values(API_TOOLS).flat().find(t => t[0] === a.tool)?.[1] || '#673DE6'
  return `<div class="pg pg--mid">
    <div class="pg-head"><h1>API</h1><button class="btn-outline btn-outline--sm">Documentation ${I(ICON2.ext, 13, 2)}</button></div>
    <p class="api-lead">Let your AI agent build sites, manage domains and more, right from your editor or terminal.</p>
    <div class="tabs api-tabs" role="tablist">
      <button role="tab" class="tab ${a.tab === 'connect' ? 'is-on' : ''}" aria-selected="${a.tab === 'connect'}" data-apitab="connect">Connect your tools</button>
      <button role="tab" class="tab ${a.tab === 'tokens' ? 'is-on' : ''}" aria-selected="${a.tab === 'tokens'}" data-apitab="tokens">API tokens <span class="tab-count">${(app.apiTokens || []).length}</span></button>
    </div>
    ${a.tab === 'tokens' ? apiTokens() : `<section class="pg-card api-box">
      <div class="api-body">
        <nav class="api-tools" aria-label="Tools">${Object.entries(API_TOOLS).map(([g, list]) => `
          <button class="api-group" data-apigroup="${g}" aria-expanded="${a.open[g]}">${g}${I(a.open[g] ? '<path d="m6 15 6-6 6 6"/>' : '<path d="m6 9 6 6 6-6"/>', 14, 2)}</button>
          ${a.open[g] ? list.map(([n, c]) => `<button class="api-tool ${a.tool === n ? 'is-on' : ''}" data-apitool="${esc(n)}">${logo(n, c)}${esc(n)}</button>`).join('') : ''}`).join('')}
        </nav>
        <div class="api-main">
          <div class="api-main__head">${logo(a.tool, color, 30)}<b>Connect ${esc(a.tool)}</b>
            <div class="seg seg--text"><button class="${a.mode === 'one' ? 'is-on' : ''}" data-apimode="one">One-click install</button><button class="${a.mode === 'manual' ? 'is-on' : ''}" data-apimode="manual">Manual setup</button></div></div>
          ${a.mode === 'one' ? `<div class="api-install"><div><b>Install</b><p>Opens ${esc(a.tool)} with a prompt that installs the Hostinger plugin.</p>
              <small>${I(ICON2.lockS, 12, 1.8)}No API key needed <span>${I('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', 12, 1.8)}macOS, Windows and Linux</span></small></div>
            <button class="btn btn-primary">Install in ${esc(a.tool)} ${I(ICON2.ext, 14, 2)}</button></div>`
          : `<div class="api-manual"><b>Add the Hostinger MCP server</b><p>Paste this into ${esc(a.tool)}'s MCP settings, then sign in when asked.</p>
              <div class="api-code"><code>{ "mcpServers": { "hostinger": { "url": "https://mcp.hostinger.com/sse" } } }</code><button class="btn-outline btn-outline--sm" data-copy='{ "mcpServers": { "hostinger": { "url": "https://mcp.hostinger.com/sse" } } }'>Copy</button></div></div>`}
          <div class="api-demo"><b>What you can do</b><p>Approve the Hostinger sign-in once, then ask your agent in plain words.</p>
            <div class="api-chat"><div class="api-chat__head"><span>${esc(a.tool)}</span><em>Example</em></div>
              <div class="api-chat__body" id="apiChat"></div>
              <div class="api-chat__input"><span>Ask your agent anything</span>${I('<path d="M12 19V5M5 12l7-7 7 7"/>', 14, 2)}</div></div></div>
        </div>
      </div>
      <button class="api-adv" data-apiadv aria-expanded="${Boolean(a.adv)}">${I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', 17, 1.6)}
        <b>Advanced options</b><span>Choose which tools your agent can use</span><em>${{ all: 'All tools on', read: 'Read-only', custom: 'Custom' }[a.tools]}</em>${I(a.adv ? '<path d="m6 15 6-6 6 6"/>' : '<path d="m6 9 6 6 6-6"/>', 14, 2)}</button>
      ${a.adv ? `<div class="api-advbox">${[['all', 'All tools on', 'Your agent can read and make changes, like registering domains or editing DNS. You approve purchases.'], ['read', 'Read-only', 'Your agent can look things up but cannot change anything.']].map(([k, h, p]) => `<button class="api-opt ${a.tools === k ? 'is-on' : ''}" data-apitools="${k}"><span class="radio"></span><span><b>${h}</b><small>${p}</small></span></button>`).join('')}</div>` : ''}
    </section>`}
  </div>`
}

function apiTokens() {
  const list = app.apiTokens || []
  return `<section class="pg-card api-tokens">
    <div class="api-tokens__head"><div><b>API tokens</b><p>Use a token to call the Hostinger API from your own scripts.</p></div><button class="btn btn-primary btn-sm" data-newtoken>Create token</button></div>
    ${list.length ? `<ul class="api-tokens__list">${list.map((t, i) => `<li><code>${esc(t.key)}</code><span>${esc(t.name)} · created ${esc(t.date)}</span><button class="link small" data-deltoken="${i}">Delete</button></li>`).join('')}</ul>` : '<p class="api-tokens__empty">No tokens yet.</p>'}
  </section>`
}

function playApiDemo() {
  clearTimeout(apiDemoTimer)
  const box = $('#apiChat')
  if (!box) return
  let i = 0
  const step = () => {
    const el = $('#apiChat')
    if (!el) return
    const [q, aText] = API_EXAMPLES[i % API_EXAMPLES.length]
    el.innerHTML = `<div class="api-q">${esc(q)}</div><div class="api-a"><span class="api-a__dots"><i></i><i></i><i></i></span></div>`
    apiDemoTimer = setTimeout(() => {
      const el2 = $('#apiChat'); if (!el2) return
      el2.querySelector('.api-a').innerHTML = markdown(aText)
      i++; apiDemoTimer = setTimeout(step, 3600)
    }, 1300)
  }
  step()
}

// ── AI Router ──

app.routerPick = 250
function pageRouter() {
  const packs = [[250, '€2,99'], [500, '€4,99'], [2000, '€17,99'], [5000, '€43,99']]
  const feats = [
    ['<path d="M10 6h11M10 12h11M10 18h11M3 6h2M4 5v4M3 12h3l-3 4h3M3 18h3"/>', 'Use every major model, one balance', 'Access ChatGPT, Claude, Gemini, and more without separate accounts or bills.'],
    ['<path d="M4 7h14l-3-3M20 17H6l3 3"/>', 'Switch models without touching your code', 'OpenAI SDK compatible, so you can change models without rewriting your app.'],
    ['<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>', 'Pay only for what you use', "Credits are metered per request, so you're never locked into a fixed monthly cost."],
    ['<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>', 'Cut costs with prompt caching', 'Repeated content is served from cache automatically, so heavy usage costs less over time.'],
    ['<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 'Connect to your AI apps instantly', 'Works automatically with OpenClaw and Hermes Agent in Hostinger. No extra keys, no extra setup.'],
    ['<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 'Track spend as you go', 'See credits used, tokens processed, and cache savings in one place, so nothing is a surprise.'],
  ]
  const card = (ic, h, p) => `<article class="gpu-feat"><span class="gpu-feat__icon">${I(ic, 18, 1.8)}</span><h3 class="light">${h}</h3><p>${p}</p></article>`
  return `<div class="pg pg--mid">
    <section class="gpu-hero rt-hero">
      <div class="gpu-hero__text"><h2>Power any AI app through one simple gateway</h2>
        <p>One AI gateway to every major AI model, powered by a single balance of AI credits.</p>
        <button class="gpu-hero__btn" data-rt-start>Get started</button></div>
      <div class="gpu-hero__art rt-art" aria-hidden="true">
        <div class="gpu-ring r1"></div><div class="gpu-ring r2"></div><div class="gpu-ring r3"></div>
        <div class="rt-key">${QMARK(64)}</div>
        <svg class="gpu-cursor rt-cursor" viewBox="0 0 24 24" width="46" height="46"><path d="M5 3v17l5-5 3 7 3-1.4-3-6.6h7z" fill="#fff" stroke="#14102A" stroke-width="1.2"/></svg>
        ${[['8%', '22%', '#3E8BF0'], ['32%', '14%', '#D97757'], ['72%', '10%', '#fff'], ['4%', '60%', '#fff'], ['86%', '40%', '#F0A030'], ['88%', '68%', '#E5383B'], ['12%', '86%', '#5B7CF7']].map(([l, t, c], i) => `<span class="rt-model" style="left:${l};top:${t};--c:${c}">${['◆', '✱', '≋', '◎', '▲', '∿', '◐'][i]}</span>`).join('')}
      </div>
    </section>
    <div class="gpu-feats">
      ${card('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>', 'One API for every model', 'Access GPT, Claude, DeepSeek, Grok and more through a single API key. Works with tools you already use.')}
      ${card('<path d="M9 3h6l-1.5 4h-3zM6 21h12a2 2 0 0 0 2-2c0-5-3.5-10-8-10S4 14 4 19a2 2 0 0 0 2 2z"/><path d="M12 12v6"/>', 'Price and performance', 'Pick the right model for each job and pay from one shared pool of AI credits, so you keep spend under control without giving up speed.')}
      ${card('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 'Built-in integration', 'Connects automatically to Hostinger AI apps like OpenClaw and Hermes Agent. No extra keys, no extra setup.')}
    </div>
    <h2 class="rt-title" id="rtPacks">Top up your credits</h2>
    <div class="ecom__grid rt-grid">
      <ul class="ecom__feats rt-feats">${feats.map(([ic, h, p]) => `<li>${I(ic, 19, 1.7)}<div><h3>${h}</h3><p>${p}</p></div></li>`).join('')}</ul>
      <div class="ecom__buy">
        <div class="ecom__opts" role="radiogroup" aria-label="Credit pack">
          <div class="ecom__popular">Recommended</div>
          ${packs.map(([n, p], i) => `<button role="radio" aria-checked="${app.routerPick === n}" class="ecom__opt rt-opt ${i ? 'ecom__opt--plain' : ''} ${app.routerPick === n ? 'is-on' : ''}" data-pack="${n}"><span class="radio"></span><b>Hostinger Credits ${n}</b><strong class="rt-price">${p}</strong></button>`).join('')}
        </div>
        <button class="btn btn-primary rt-buy">Purchase credits</button>
        <p class="ecom__fine">Prices exclude taxes</p>
      </div>
    </div>
  </div>`
}

function bindPages4() {
  const page = $('#page')
  page.addEventListener('click', e => {
    const t = e.target.closest('[data-gpu],[data-gpu-start],[data-rt-start],[data-pack],[data-apitab],[data-apitool],[data-apigroup],[data-apimode],[data-apiadv],[data-apitools],[data-copy],[data-newtoken],[data-deltoken]')
    if (!t) return
    const d = t.dataset
    if (d.gpu) { app.gpuPick = app.gpuPick === Number(d.gpu) ? null : Number(d.gpu); return renderPage() }
    if ('gpuStart' in d) return $('#gpuList')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if ('rtStart' in d) return $('#rtPacks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (d.pack) { app.routerPick = Number(d.pack); return renderPage() }
    if (d.apitab) app.api.tab = d.apitab
    else if (d.apitool) app.api.tool = d.apitool
    else if (d.apigroup) app.api.open[d.apigroup] = !app.api.open[d.apigroup]
    else if (d.apimode) app.api.mode = d.apimode
    else if ('apiadv' in d) app.api.adv = !app.api.adv
    else if (d.apitools) app.api.tools = d.apitools
    else if (d.copy) { navigator.clipboard?.writeText(d.copy).catch(() => {}); return toast('Copied') }
    else if ('newtoken' in d) {
      const key = 'qs_' + Array.from(crypto.getRandomValues?.(new Uint8Array(12)) || [], b => b.toString(16).padStart(2, '0')).join('')
      ;(app.apiTokens ||= []).push({ key: key.slice(0, 10) + '…' + key.slice(-4), name: `Token ${app.apiTokens.length + 1}`, date: new Date().toISOString().slice(0, 10) })
    } else if (d.deltoken !== undefined) app.apiTokens.splice(Number(d.deltoken), 1)
    renderPage()
  })
}

// ── Agent: Jobs ──

AG_PAGES.jobs = () => {
  const blur = (rows) => `<ul class="proj__blur" aria-hidden="true">${rows.map(([t, s]) => `<li><i></i><span><b>${t}</b><small>${s}</small></span></li>`).join('')}</ul>`
  return `<div class="agp agp--narrow">
    <h1>Jobs</h1><p class="agp__sub">Let your agent run tasks on a schedule or when something happens in your apps.</p>
    <section class="proj">
      <div class="proj__head"><b>Inbox</b><span class="proj__tag">Example results</span><span class="proj__plus">${I(ICON2.lockS, 11, 2)}Plus</span></div>
      <div class="proj__body">${blur([['Weekly SEO report', 'Completed · 3 new issues found'], ['Competitor price check', 'Completed · 2 prices changed'], ['Daily sales summary', 'Completed · €1,240 yesterday'], ['New reviews digest', 'Completed · 4 new reviews']])}
        <div class="proj__upsell jobs-upsell">
          <div class="proj__upsell-head"><span>${I(ICON2.clock, 18, 1.7)}</span><div><b>Let your agent work while you are away</b><small>Jobs are included in Agent Plus</small></div></div>
          <ul><li>${I(ICON2.tick, 13, 2.4)}Schedule any task daily, weekly or monthly</li><li>${I(ICON2.tick, 13, 2.4)}Get results in your inbox, ready to review</li></ul>
          <div class="proj__actions"><button class="btn btn-primary btn-sm">Upgrade to Agent Plus</button><button class="link small">Learn more</button></div>
        </div></div>
    </section>
    <section class="proj jobs-active">
      <div class="proj__head"><b>Active</b><span class="proj__tag">Example jobs</span><span class="proj__plus">${I(ICON2.lockS, 11, 2)}Plus</span></div>
      <div class="proj__body jobs-active__body">${blur([['Weekly SEO report', 'Every Monday at 09:00'], ['Competitor price check', 'Every day at 07:00'], ['Daily sales summary', 'Every day at 18:00']])}
        <button class="jobs-unlock">${I(ICON2.lockS, 14, 1.8)}Unlock scheduled jobs</button></div>
    </section>
  </div>`
}

// ── AI automation apps (OpenClaw, Hermes Agent, n8n, Paperclip) ──

const AI_APPS = {
  openclaw: { name: 'OpenClaw', kind: 'AI agent', color: '#E5383B', bg: '#FDECEC', icon: '<path d="M7 4c-1 3 0 5 2 6M17 4c1 3 0 5-2 6M6 12a6 6 0 0 0 12 0c0-1.5-1-2-2-2H8c-1 0-2 .5-2 2z"/><path d="M10 14h.01M14 14h.01"/>',
    text: 'Chat with an AI assistant that answers questions, searches the web, and handles tasks.',
    points: ['Handles quick tasks on the go', 'Works across chat and email channels', ['Works with ChatGPT subscription', 'Sign in with your ChatGPT Plus or Pro account instead of paying for an API key.']] },
  hermes: { name: 'Hermes Agent', kind: 'AI agent', color: '#1D1E20', bg: '#EFEFF2', icon: '<path d="M8 20v-6a4 4 0 0 1 8 0v6M6 20h12M9 10V7a3 3 0 0 1 6 0v3M5 9l3 1M19 9l-3 1"/>',
    text: 'An AI assistant that automates repetitive tasks and gets better as you use it.',
    points: ['Builds memory and improves over time', 'Handles more advanced, multi-step tasks', ['Works with ChatGPT subscription', 'Sign in with your ChatGPT Plus or Pro account instead of paying for an API key.']] },
  n8n: { name: 'n8n', kind: 'Workflow automation', color: '#E8476A', bg: '#FDEEF2', icon: '<circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.5 12h2M14.5 12l2.5-4.5M14.5 12l2.5 4.5"/>',
    text: 'Connect your apps and automate workflows without writing code.',
    points: ['Build workflows with a visual editor', 'Connect hundreds of apps and services', 'Run workflows on autopilot, 24/7'] },
  paperclip: { name: 'Paperclip', kind: 'AI agent dashboard', color: '#36344D', bg: '#F1F0F5', icon: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    text: 'A dashboard for organizing and running teams of AI agents in one place.',
    points: ['Run teams of AI coding agents', 'Give agents roles, goals, and budgets', ['Works with ChatGPT subscription', 'Sign in with your ChatGPT Plus or Pro account instead of paying for an API key.']] },
}
const appIcon = (k, size = 20) => `<span class="aa-icon" style="--c:${AI_APPS[k].color};--bg:${AI_APPS[k].bg}">${I(AI_APPS[k].icon, size, 1.9)}</span>`
const appDots = keys => `<span class="aa-dots">${keys.map(k => `<span class="aa-dot" title="${AI_APPS[k].name}" style="--c:${AI_APPS[k].color}">${I(AI_APPS[k].icon, 12, 2.2)}</span>`).join('')}</span>`
const help = tip => `<button class="aa-help" type="button" aria-label="${esc(tip)}" data-tip="${esc(tip)}">${I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17h.01"/>', 14, 1.8)}</button>`

const USE_CASES = [
  { title: 'Ecommerce & site monitoring', text: 'Your agent autonomously monitors uptime, tracks competitor pricing, and alerts you on Slack or Telegram before issues hit revenue.',
    prompt: 'Check my store and top 3 competitors every morning at 8 AM. Alert me on Telegram if any prices change, stock runs out, or page load exceeds 2s.', apps: ['openclaw', 'hermes'], scene: 'beach' },
  { title: 'Industry research & content pipeline', text: 'Your agent aggregates market insights, generates draft briefs, and files them while you sleep.',
    prompt: 'Scrape Reddit and top industry blogs daily for trending AI topics. Summarize key takeaways and draft a LinkedIn post in my voice.', apps: ['openclaw', 'hermes', 'paperclip'], scene: 'night' },
  { title: 'Lead enrichment & CRM sync', text: 'Your agent enriches incoming leads, cross-checks company data via APIs, and posts instant alerts to Slack or Telegram.',
    prompt: 'When a new lead submits a form, look up their company info, score their tech stack, and route qualified leads straight to my sales channel.', apps: ['openclaw', 'hermes', 'n8n', 'paperclip'], scene: 'city' },
  { title: 'Inbox triage & replies', text: 'Your agent sorts incoming email, drafts replies in your tone, and flags only what needs you.',
    prompt: 'Every hour, sort my inbox. Draft replies to order questions, archive newsletters, and ping me on WhatsApp for anything urgent.', apps: ['openclaw', 'hermes'], scene: 'cafe' },
  { title: 'Order & stock automation', text: 'Your workflow syncs orders, updates stock levels across channels, and reorders before you run out.',
    prompt: 'When stock for any product drops below 10, email my supplier a reorder and update the stock count in my store and spreadsheet.', apps: ['n8n', 'paperclip'], scene: 'studio' },
]
const SCENES = {
  beach: ['#8EC8F2', '#F4E6C8', '<circle cx="250" cy="50" r="26" fill="#FFF6D8"/><path d="M0 170c60-14 120-14 180-4s100 8 140-4v78H0z" fill="#3E9BC9"/><path d="M0 200c80-10 200-10 320 4v36H0z" fill="#EAD7AE"/>'],
  night: ['#1C2440', '#0E1222', '<rect x="210" y="40" width="70" height="90" rx="4" fill="#24304F"/><path d="M220 54h50M220 70h36" stroke="#5B7CF7" stroke-width="4" stroke-linecap="round" opacity=".7"/><path d="M0 190c40-24 120-30 200-10s100 20 120 18v42H0z" fill="#2A3352"/>'],
  city: ['#7FB8E8', '#D5E9F8', '<path d="M0 240V140h30v-40h26v60h24v-80h30v100h20v-50h26v70h30v-90h34v110h20v-60h28v80z" fill="#B7D3EC"/>'],
  cafe: ['#E9D6C0', '#C9A788', '<rect x="20" y="40" width="90" height="70" rx="6" fill="#F5E9DA"/><circle cx="250" cy="70" r="30" fill="#F5E9DA" opacity=".6"/><path d="M0 200h320v40H0z" fill="#8C6A4E"/>'],
  studio: ['#E6E0FF', '#C9BBFF', '<rect x="30" y="60" width="80" height="60" rx="6" fill="#fff" opacity=".7"/><rect x="200" y="40" width="90" height="110" rx="6" fill="#fff" opacity=".55"/><path d="M0 200h320v40H0z" fill="#B3A3F0"/>'],
}
function sceneArt(k, i) {
  const [a, b, extra] = SCENES[k]
  return `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="sc${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="320" height="240" fill="url(#sc${i})"/>${extra}
    <g transform="translate(118 62)"><circle cx="42" cy="30" r="22" fill="#E8B48E"/><path d="M18 28c2-20 44-24 48 0-12-8-34-8-48 0z" fill="${k === 'night' ? '#3A2A20' : '#7A5134'}"/><path d="M0 178c2-60 24-104 42-104s40 44 42 104z" fill="${k === 'night' ? '#2E3A5C' : k === 'city' ? '#E9C64A' : '#F7F5F0'}"/>
    <rect x="58" y="96" width="22" height="38" rx="5" fill="#1D1E20" transform="rotate(-14 69 115)"/></g></svg>`
}

app.aa = { app: 'openclaw', term: 24, slide: 0, faq: 0 }
const AA_TERMS = [[24, '€18,99', '76% OFF', '€4,49'], [12, '€18,99', '63% OFF', '€6,99'], [1, '€18,99', '53% OFF', '€8,99']]
const AA_FAQ = [
  ['Do I need any technical knowledge to set up an AI Automation App?', 'Not at all. AI Automation Apps are designed for people who have never touched a server in their life. Our 1-click deployment handles the entire installation — from the server environment to the application configuration. Just pick your plan, choose an application, and it\'s live within minutes. No coding, no command lines, no complicated dashboards.'],
  ['How do AI credits work, and do I need to set up external accounts?', 'Every plan includes AI credits, so your app works straight away without any other accounts. When you run low you can top up through AI Router, sign in with your ChatGPT subscription, or connect your own API key from OpenAI, Anthropic, xAI or Gemini.'],
  ['Is my data private and secure?', 'Yes. Each app runs on its own private server that only you can access. We keep the system patched and backed up for you, and your conversations and workflow data are never used to train AI models.'],
  ["What's the difference between AI Automation Apps and running applications on a VPS?", 'With a VPS you get a full server and manage everything yourself — installing, updating and securing the app. AI Automation Apps are fully managed: we install, update and monitor the app for you, and you can switch to a different app at any time.'],
  ['What can I do with an AI Automation App?', 'Monitor your store and competitors, draft content, enrich and route leads, sort your inbox, sync orders and stock, and much more. Set a task once and your agent keeps working on a schedule or whenever something happens in your apps.'],
]

function pageAiApps(key) {
  if (AI_APPS[key] && app.aa.from !== key) { app.aa.app = key; app.aa.from = key }
  const a = app.aa
  const check = I(ICON2.tick, 15, 2.4)
  const card = k => { const x = AI_APPS[k]; return `<article class="aa-card">
    <div class="aa-card__head">${appIcon(k)}<div><h2>${x.name}</h2><small>${x.kind}</small></div></div>
    <p>${x.text}</p>
    <ul class="aa-checks">${x.points.map(pt => Array.isArray(pt) ? `<li>${check}${pt[0]} ${help(pt[1])}</li>` : `<li>${check}${pt}</li>`).join('')}</ul>
    <button class="aa-btn" data-aa-start="${k}">Get started</button>
  </article>` }
  const feature = (t, tip) => `<li>${check}<span>${t}</span>${tip ? help(tip) : ''}</li>`
  return `<div class="pg pg--mid aa">
    <header class="aa-hero"><h1>Run an AI agent or automation tool.<br>No server setup needed</h1>
      <p>Pick one below and we install and run it — ready in about a minute, nothing to configure. You can reinstall with a different app later.</p></header>
    <div class="aa-grid">${Object.keys(AI_APPS).map(card).join('')}</div>

    <section class="aa-uses">
      <div class="aa-uses__head"><div><h2 class="aa-h2">Your agent works. You don't have to.</h2><p>Set a task once. Your agent keeps going, on the beach, on a hike, or while you sleep.</p></div>
        <div class="aa-arrows"><button class="round-btn" data-aa-slide="-1" aria-label="Previous" ${a.slide <= 0 ? 'disabled' : ''}>${I('<path d="m15 6-6 6 6 6"/>', 16, 2)}</button><button class="round-btn" data-aa-slide="1" aria-label="Next" ${a.slide >= USE_CASES.length - 3 ? 'disabled' : ''}>${I('<path d="m9 6 6 6-6 6"/>', 16, 2)}</button></div></div>
      <div class="aa-track"><div class="aa-rail" style="--i:${a.slide}">${USE_CASES.map((u, i) => `<article class="aa-use">
        <div class="aa-use__img">${sceneArt(u.scene, i)}<div class="aa-prompt"><span>${esc(u.prompt)}</span><i>${I('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>', 13, 2)}</i></div></div>
        <h3>${esc(u.title)}</h3><p>${esc(u.text)}</p>
        <div class="aa-rec">Recommended apps ${appDots(u.apps)}</div>
      </article>`).join('')}</div></div>
    </section>

    <section class="aa-plan" id="aaPlan">
      <h2 class="aa-h2 aa-center">One plan for any application. Change anytime</h2>
      <p class="aa-sub">Pick the application you want to install first. You can change it later from the dashboard.</p>
      <div class="aa-plan__grid">
        <div>
          <b class="aa-label">Select application</b>
          <div class="aa-pick" role="radiogroup" aria-label="Application">${Object.keys(AI_APPS).map(k => `<button role="radio" aria-checked="${a.app === k}" class="aa-pick__item ${a.app === k ? 'is-on' : ''}" data-aa-app="${k}">${appIcon(k, 16)}${AI_APPS[k].name}</button>`).join('')}</div>
          <div class="ecom__opts aa-terms" role="radiogroup" aria-label="Billing period">
            <div class="ecom__popular">Recommended</div>
            ${AA_TERMS.map(([t, was, off, now], i) => `<button role="radio" aria-checked="${a.term === t}" class="ecom__opt aa-term ${i ? 'ecom__opt--plain' : ''} ${a.term === t ? 'is-on' : ''}" data-aa-term="${t}">
              <span class="radio"></span><b>${t} ${t === 1 ? 'month' : 'months'}</b>
              <span class="ecom__price"><span class="ecom__was"><s>${was}</s><em class="aa-off">${off}</em></span><span><strong>${now}</strong> /mo</span></span></button>`).join('')}
          </div>
          <button class="ecom__choose">Choose plan</button>
          <p class="ecom__fine">Renew at €10,99/mo. Prices exclude applicable taxes.</p>
        </div>
        <div class="aa-incl">
          <h3>Setup &amp; management</h3>
          <ul>${feature('Ready out of the box', `${AI_APPS[a.app].name} is installed and configured for you in about a minute.`)}${feature('No maintenance needed')}${feature('Security managed for you', 'We keep the server patched, firewalled and backed up.')}${feature('Switch applications anytime', 'Reinstall with a different app from your dashboard whenever you like.')}</ul>
          <h3>Interface &amp; access</h3>
          <ul>${feature('Visual interface included')}${feature('CLI access included', 'Prefer the terminal? Connect over SSH any time.')}</ul>
          <h3>AI capabilities</h3>
          <ul>${feature('AI credits included')}${feature('Web search included', 'Your agent can search the web for up-to-date answers.')}${feature('Works with ChatGPT subscription', 'Sign in with your ChatGPT Plus or Pro account instead of paying for an API key.')}${feature('Works with Hostinger Connector', 'Lets your agent manage your Hostinger websites, domains and email.')}</ul>
          <div class="aa-guar"><span>${I(ICON2.shield, 15, 1.8)}30-day money-back guarantee</span><i></i><span>${I('<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/>', 15, 1.8)}24/7 support</span></div>
        </div>
      </div>
    </section>

    <section class="aa-power">
      <h2 class="aa-h2 aa-center">Power your agent your way</h2>
      <p class="aa-sub">Choose how your agent connects to AI. Use the ChatGPT subscription you already have, top up Hostinger AI credits, or bring your own key.</p>
      <div class="aa-power__grid">
        <article class="aa-pow"><div class="aa-pow__top"><span class="gpu-feat__icon">${I('<circle cx="5" cy="12" r="2"/><path d="M7 12h4l4-5h4M11 12l4 5h4M17 5l2 2-2 2M17 15l2 2-2 2"/>', 18, 1.8)}</span><em class="tag-violet">Recommended</em></div>
          <h3>AI Router</h3><p>Top up AI credits and choose from a variety of AI models. No separate accounts or providers.</p><div class="aa-rec">Works with ${appDots(['openclaw', 'hermes', 'n8n'])}</div></article>
        <article class="aa-pow"><div class="aa-pow__top"><span class="gpu-feat__icon">${I('<circle cx="12" cy="12" r="9"/><path d="M8 12a4 4 0 0 1 8 0"/>', 18, 1.8)}</span><em class="tag-green">Most affordable</em></div>
          <h3>Use your ChatGPT subscription</h3><p>Power your app with your ChatGPT Plus or Pro subscription instead of an OpenAI API key.</p><div class="aa-rec">Works with ${appDots(['openclaw', 'hermes', 'paperclip'])}</div></article>
        <article class="aa-pow"><div class="aa-pow__top"><span class="gpu-feat__icon">${I('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>', 18, 1.8)}</span></div>
          <h3>Bring your own API key</h3><p>Already have a key from OpenAI, Anthropic, xAI, or Gemini? Connect it and use your existing plan.</p><div class="aa-rec">Works with ${appDots(['openclaw', 'hermes', 'paperclip'])}</div></article>
      </div>
      <button class="aa-go" data-aa-start="${a.app}">Get started</button>
    </section>

    <section class="pg-card aa-faq">
      <h2 class="aa-h2 aa-center">AI Automation Apps FAQs</h2>
      <p class="aa-sub">Find answers to frequently asked questions about AI Automation Apps.</p>
      ${AA_FAQ.map(([q, ans], i) => `<div class="aa-q ${a.faq === i ? 'is-open' : ''}"><button class="aa-q__btn" data-aa-faq="${i}" aria-expanded="${a.faq === i}">${esc(q)}${I(a.faq === i ? '<path d="m6 15 6-6 6 6"/>' : '<path d="m6 9 6 6 6-6"/>', 16, 2)}</button>${a.faq === i ? `<p>${esc(ans)}</p>` : ''}</div>`).join('')}
    </section>
  </div>`
}

function bindAiApps() {
  $('#page').addEventListener('click', e => {
    const t = e.target.closest('[data-aa-start],[data-aa-app],[data-aa-term],[data-aa-slide],[data-aa-faq]')
    if (!t) return
    const d = t.dataset
    const keep = window.scrollY
    if (d.aaStart) { app.aa.app = d.aaStart; renderPage(); window.scrollTo({ top: keep }); return $('#aaPlan').scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    if (d.aaApp) app.aa.app = d.aaApp
    else if (d.aaTerm) app.aa.term = Number(d.aaTerm)
    else if (d.aaSlide) app.aa.slide = Math.max(0, Math.min(USE_CASES.length - 3, app.aa.slide + Number(d.aaSlide)))
    else if (d.aaFaq) app.aa.faq = app.aa.faq === Number(d.aaFaq) ? -1 : Number(d.aaFaq)
    renderPage()
    window.scrollTo({ top: keep })
  })
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
  { cls: 's-mega', icon: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6"/>' },
  { cls: 's-pen', icon: '<path d="M16 3l5 5L8 21H3v-5z"/>' },
]

function renderSuggestions() {
  const s = app.data
  const store = s.sites.find(x => x.orders30d)
  const texts = [
    store ? 'Get your store ready for Black Friday' : 'Get my website ready for more visitors',
    'Chase emails nobody answered',
    'Write a week of social posts',
    'Make my product irresistible',
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
  if (app.agentView !== 'chat') agentShow('chat')
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
  document.title = open ? 'Hostinger — Agent' : `Hostinger — ${PAGE_TITLES[app.page] || 'Websites'}`
  const pageHash = app.page === 'home' ? '' : '#' + app.page
  if (push && location.hash !== (open ? '#agent' : pageHash)) history.pushState(null, '', open ? '#agent' : (pageHash || location.pathname + location.search))
  if (changed && open) { track('view', 'agent-page'); scrollChat(); maybeAskMemory() }
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
    else if (t.dataset.view) { e.preventDefault(); setView(t.dataset.view); if (t.dataset.view === 'agent') agentShow('chat') }
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
  bindAgentExtras()
  bindPages4()
  bindAiApps()
  $('#agPlus').addEventListener('click', () => $('#agInput').focus())
  $('#agMic').addEventListener('click', toggleMic)
  $('#agentBtn').addEventListener('click', () => { setView('agent'); agentShow('chat') })
  $('#askPlus').addEventListener('click', () => $('#askInput').focus())
  window.addEventListener('popstate', () => { const r = parseRoute(location.hash); if (r === 'agent') setView('agent', { push: false, focus: false }); else go(r, { push: false }) })
  document.querySelectorAll('.nav-tree__btn').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.route) return
    const open = btn.getAttribute('aria-expanded') !== 'true'
    document.querySelectorAll('.nav-tree__btn').forEach(o => o.setAttribute('aria-expanded', 'false'))
    btn.setAttribute('aria-expanded', String(open))
  }))
  bindPops()
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
    app.readAll = false; document.body.classList.remove('read-all')
    apply(d)
    resetChats()
    toast(`Now viewing as ${app.data.customer.firstName}`)
  })
  $('#resetBtn').addEventListener('click', async () => {
    const d = await api('/api/reset', { persona: app.data.persona })
    app.promoHidden = false
    app.readAll = false; document.body.classList.remove('read-all')
    apply(d)
    resetChats()
    toast('Demo account reset')
  })

  $('#menuBtn').addEventListener('click', () => toggleMenu(true))
  $('#scrim').addEventListener('click', () => toggleMenu(false))
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal() })
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (document.querySelector('.pop:not([hidden])')) closePops()
    else if (!$('#agModal').hidden) closeAgModal()
    else if (!$('#modal').hidden) closeModal()
    else if ($('#agentApp').classList.contains('side-open')) closeAgentSide()
    else if (view === 'agent') setView('home')
  })
}

boot().catch(e => {
  document.querySelector('.wrap').innerHTML = `<div class="card pad">Could not load the demo: ${esc(e.message)}</div>`
})
