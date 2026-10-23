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
  renderPromo()
  renderTodos()
  renderSites()
  renderPlan()
  renderRenewals()
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

// ───────────────────────── chat ─────────────────────────

function scrollChat() { const c = $('#chat'); c.scrollTop = c.scrollHeight }

async function ask(text) {
  text = text.trim()
  if (!text || app.busy) return
  app.busy = true
  $('#sendBtn').disabled = true
  const input = $('#askInput')
  input.value = ''
  autosize()

  $('#chatbox').hidden = false
  const chat = $('#chat')
  chat.insertAdjacentHTML('beforeend', `<div class="msg-user">${esc(text)}</div>`)
  const bot = document.createElement('div')
  bot.className = 'msg-bot'
  bot.innerHTML = '<div class="status"><span class="dots"><i></i><i></i><i></i></span><span>Thinking</span></div><div class="md"></div>'
  chat.appendChild(bot)
  scrollChat()
  $('#chatbox').scrollIntoView({ behavior: 'smooth', block: 'nearest' })

  const md = bot.querySelector('.md')
  const status = bot.querySelector('.status')
  let raw = ''
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ session: app.session, message: text }) })
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
    status.hidden = true
    if (!raw.trim()) md.innerHTML = '<p class="muted">(No reply.)</p>'
    else showRating()
  } catch (e) {
    status.hidden = true
    bot.classList.add('is-error')
    md.textContent = e.message
    if (!input.value) input.value = text
  } finally {
    app.busy = false
    $('#sendBtn').disabled = false
    scrollChat()
  }
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

function autosize() {
  const el = $('#askInput')
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
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

function focusAgent() {
  toggleMenu(false)
  window.scrollTo({ top: 0, behavior: 'smooth' })
  setTimeout(() => $('#askInput').focus(), 250)
}

function bindUi() {
  document.addEventListener('click', e => {
    const tracked = e.target.closest('[data-track]')
    if (tracked) track('click', tracked.dataset.track)

    const t = e.target.closest('[data-ask],[data-propose],[data-decide],[data-demo],[data-dot],[data-focus-agent],#todoMore,#promoDismiss')
    if (!t) return
    if (t.dataset.ask) { toggleMenu(false); ask(t.dataset.ask) }
    else if (t.dataset.propose) propose(JSON.parse(t.dataset.propose), t.dataset.placement || 'other')
    else if (t.dataset.decide) decide(t.closest('.offer'), t.dataset.decide)
    else if (t.dataset.dot !== undefined) { app.promoIndex = Number(t.dataset.dot); renderPromo() }
    else if (t.hasAttribute('data-focus-agent')) focusAgent()
    else if (t.id === 'todoMore') { app.showAllTodos = !app.showAllTodos; renderTodos() }
    else if (t.id === 'promoDismiss') { app.promoHidden = true; renderPromo(); toast('Deals hidden for this visit') }
    else if (t.hasAttribute('data-demo')) { toggleMenu(false); toast('Only the Home page is part of this concept demo.') }
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
  $('#clearChat').addEventListener('click', () => { $('#chat').innerHTML = ''; $('#chatbox').hidden = true })
  $('#agentBtn').addEventListener('click', focusAgent)
  $('#bellBtn').addEventListener('click', () => $('#todos').scrollIntoView({ behavior: 'smooth', block: 'center' }))
  $('#referBtn').addEventListener('click', () => toast('Your referral link was copied — earn up to €200 per friend (demo)'))
  $('#saleBtn').addEventListener('click', () => {
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
    $('#chat').innerHTML = ''; $('#chatbox').hidden = true
    app.showAllTodos = false
    app.promoIndex = 0
    apply(d)
    toast(`Now viewing as ${app.data.customer.firstName}`)
  })
  $('#resetBtn').addEventListener('click', async () => {
    const d = await api('/api/reset', { persona: app.data.persona })
    $('#chat').innerHTML = ''; $('#chatbox').hidden = true
    app.promoHidden = false
    apply(d)
    toast('Demo account reset')
  })

  $('#menuBtn').addEventListener('click', () => toggleMenu(true))
  $('#scrim').addEventListener('click', () => toggleMenu(false))
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal() })
}

boot().catch(e => {
  document.querySelector('.wrap').innerHTML = `<div class="card pad">Could not load the demo: ${esc(e.message)}</div>`
})
