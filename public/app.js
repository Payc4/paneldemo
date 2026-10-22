// Quayside panel — concept demo front-end. Renders everything from /api/state.

const $ = sel => document.querySelector(sel)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const eur = n => '€' + Number(n).toFixed(2)
const num = n => Number(n).toLocaleString('en-GB')

const app = { session: null, data: null, agent: null, activity: [], busy: false, showAllNba: false }

// ───────────────────────── boot ─────────────────────────

function sessionId() {
  try {
    let id = localStorage.getItem('qp-session')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('qp-session', id) }
    return id
  } catch {
    return crypto.randomUUID()
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
}

function apply(d) {
  if (d.state) app.data = d.state
  if (d.agent) app.agent = d.agent
  if (d.activity) app.activity = d.activity
  render()
}

// ───────────────────────── rendering ─────────────────────────

function render() {
  const s = app.data
  const h = new Date().getHours()
  $('#greeting').textContent = `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${s.customer.firstName}`
  const live = s.sites.filter(x => x.status === 'online').length
  const urgent = s.nba.filter(n => n.tone === 'urgent').length
  $('#summary').innerHTML = `${live} of ${s.sites.length} website${s.sites.length === 1 ? '' : 's'} live · ${esc(s.plan.name)} until ${esc(s.plan.renewsOn)}`
    + (urgent ? ` · <strong style="color:var(--warn)">${urgent} need${urgent === 1 ? 's' : ''} attention</strong>` : '')
  $('#avatar').textContent = s.customer.firstName[0]
  const bell = $('#bellCount')
  bell.hidden = !urgent
  bell.textContent = urgent

  $('#personaSel').innerHTML = s.personas.map(p => `<option value="${esc(p.id)}" ${p.id === s.persona ? 'selected' : ''}>${esc(p.label)}</option>`).join('')
  $('#agentInfo').textContent = app.agent?.live ? `Knows your account, prices and limits · ${app.agent.model}` : 'Knows your account, prices and limits · demo mode'

  renderChips()
  renderNba()
  renderSites()
  renderPlan()
  renderRenewals()
  renderActivity()
}

function renderChips() {
  const s = app.data
  const chips = []
  const store = s.sites.find(x => x.orders30d)
  const temp = s.sites.find(x => x.temp)
  const draft = s.sites.find(x => x.status === 'draft')
  if (draft) chips.push('How do I get my site live?')
  if (store && store.speedMobile < 70) chips.push(`Why is ${store.name} slow on mobile?`)
  if (temp) chips.push(`Find a domain for ${temp.name}`)
  if (s.plan.renewsInDays <= 30 && !s.plan.autoRenew) chips.push('What happens if my plan expires?')
  if (s.usage.storageGb.used / s.usage.storageGb.limit > 0.7) chips.push('Do I need a bigger plan?')
  if (s.freebies.freeEmail) chips.push('Set up a professional email address')
  chips.push('What should I do first?')
  $('#chips').innerHTML = chips.slice(0, 4).map(c => `<button class="chip" type="button" data-ask="${esc(c)}">${esc(c)}</button>`).join('')
}

const toneTag = { urgent: ['bad', 'Needs attention'], important: ['warn', 'Recommended'], gift: ['ok', 'Included free'], neutral: ['info', 'Tip'] }

function renderNba() {
  const list = app.data.nba
  const shown = app.showAllNba ? list : list.slice(0, 3)
  $('#nba').innerHTML = shown.length ? shown.map(n => {
    const [cls, label] = toneTag[n.tone] || toneTag.neutral
    return `<article class="card rec">
      <span class="pill ${cls} rec__tag">${label}</span>
      <h3>${esc(n.title)}</h3>
      <p>${esc(n.reason)}</p>
      <div class="rec__foot">
        <button class="btn btn-primary" data-propose='${esc(JSON.stringify(n.action))}'>${esc(n.cta)}</button>
        ${n.secondary ? `<button class="link rec__alt" data-propose='${esc(JSON.stringify(n.secondary.action))}'>${esc(n.secondary.label)}</button>` : ''}
        <button class="link rec__alt" data-ask="${esc('Tell me more: ' + n.title)}">Ask why</button>
      </div>
    </article>`
  }).join('') : `<div class="card pad muted">You're all set — nothing needs your attention right now.</div>`
  const more = $('#nbaMore')
  more.hidden = list.length <= 3
  more.textContent = app.showAllNba ? 'Show less' : `Show all ${list.length}`
}

function speedClass(v) { return v >= 85 ? 'good' : v >= 65 ? 'mid' : 'badv' }

function renderSites() {
  $('#sites').innerHTML = app.data.sites.map(s => {
    const status = s.status === 'draft' ? '<span class="pill warn">Draft</span>' : s.temp ? '<span class="pill warn">Temporary address</span>' : '<span class="pill ok">Online</span>'
    return `<article class="card">
      <div class="site__head">
        <span class="site__logo" aria-hidden="true">${esc(s.name[0])}</span>
        <div style="flex:1 1 220px;min-width:0">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><span class="site__name">${esc(s.name)}</span>${status}</div>
          <div class="site__addr">${esc(s.domain)} · ${esc(s.platform)}</div>
        </div>
        <button class="btn btn-ghost" data-ask="${esc(`How is ${s.name} doing?`)}">Ask about this site</button>
      </div>
      <div class="site__grid">
        <div><div class="k">Visits · 30 days</div><div class="v">${num(s.visits30d)}</div>${s.visitsTrend ? `<div class="trend">+${s.visitsTrend}% vs last month</div>` : ''}</div>
        ${s.orders30d ? `<div><div class="k">Orders · 30 days</div><div class="v">${num(s.orders30d)}</div></div>` : ''}
        <div><div class="k">Mobile speed</div><div class="v ${speedClass(s.speedMobile)}">${s.speedMobile}<span class="k">/100</span></div></div>
        <div><div class="k">Protection</div><div class="v ${s.ssl ? 'good' : 'badv'}">${s.ssl ? 'SSL on' : 'No SSL'}</div><div class="k">${esc(s.backups[0].toUpperCase() + s.backups.slice(1))} backups · CDN ${s.cdn ? 'on' : 'off'}</div></div>
        <div><div class="k">Storage</div><div class="v">${s.storageGb} GB</div></div>
      </div>
      ${s.diagnostics?.length ? `<div class="findings"><ul>${s.diagnostics.map(d => `<li>${esc(d)}</li>`).join('')}</ul><button class="link small" data-ask="${esc(`What should I fix on ${s.name}?`)}">How do I fix this?</button></div>` : ''}
    </article>`
  }).join('')
}

function meter(label, used, limit, fmt, action, actionLabel) {
  const p = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const cls = p >= 90 ? 'high' : p >= 75 ? 'mid' : ''
  return `<div class="meter">
    <div class="meter__top"><span>${label}</span><span>${fmt(used)} / ${fmt(limit)}</span></div>
    <div class="bar ${cls}"><div style="width:${Math.max(p, 2)}%"></div></div>
    <div class="meter__note"><span>${p}% used</span>${action && p >= 75 ? `<button class="link small" data-propose='${esc(JSON.stringify(action))}'>${actionLabel}</button>` : ''}</div>
  </div>`
}

function renderPlan() {
  const s = app.data
  const up = s.plan.sku === 'plan-premium' ? { sku: 'plan-business', term_months: 12 } : s.plan.sku === 'plan-business' ? { sku: 'plan-cloud', term_months: 12 } : null
  $('#plan').innerHTML = `
    <div class="planline"><div><strong>${esc(s.plan.name)}</strong><div class="k">${eur(s.plan.monthlyPrice)}/mo · renews ${esc(s.plan.renewsOn)}</div></div>
      ${s.plan.autoRenew ? '<span class="pill ok">Auto-renew on</span>' : '<span class="pill bad">Auto-renew off</span>'}</div>
    ${meter('Websites', s.usage.websites.used, s.usage.websites.limit, x => x, up, 'Get more')}
    ${meter('Storage', s.usage.storageGb.used, s.usage.storageGb.limit, x => x + ' GB', up, 'Upgrade')}
    ${meter('Visits this month', s.usage.visits.used, s.usage.visits.limit, x => num(x), up, 'Upgrade')}
    <div class="meter"><div class="meter__top"><span>AI credits</span><span>${s.usage.aiCredits}</span></div>
      <div class="meter__note"><span>${s.usage.aiCredits < 20 ? 'Running low' : 'Used by the AI builder and agents'}</span><button class="link small" data-propose='${esc(JSON.stringify({ sku: 'ai-credits-100' }))}'>Top up</button></div></div>`
}

function renderRenewals() {
  const s = app.data
  const rows = [
    `<div class="row"><div class="row__l"><div>${esc(s.plan.name)}</div><div class="k">${esc(s.plan.renewsOn)} · ${s.plan.renewsInDays} days</div></div>${s.plan.autoRenew ? '<span class="pill ok">Auto</span>' : `<button class="btn btn-ghost" style="min-height:32px;padding:0 12px;font-size:13px" data-propose='${esc(JSON.stringify({ sku: 'renew-plan', term_months: 24 }))}'>Renew</button>`}</div>`,
    ...s.domains.map(d => `<div class="row"><div class="row__l"><div>${esc(d.name)}</div><div class="k">${esc(d.renewsOn)}</div></div>${d.autoRenew ? '<span class="pill ok">Auto</span>' : '<span class="pill warn">Manual</span>'}</div>`),
    ...s.mailboxes.map(m => `<div class="row"><div class="row__l"><div>${esc(m.address)}</div><div class="k">${esc(m.product)}</div></div><span class="pill info plain">Mailbox</span></div>`),
  ]
  $('#renewals').innerHTML = `<div class="rows">${rows.join('')}</div>`
}

function renderActivity() {
  $('#activityCard').hidden = !app.activity.length
  $('#activity').innerHTML = app.activity.map(a => `<li>${esc(a)}</li>`).join('')
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
  try {
    const d = await api('/api/action', { id, decision })
    const inModal = offerEl.closest('#modal')
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

async function propose(action) {
  try {
    const d = await api('/api/propose', { action })
    $('#modalBody').innerHTML = offerHtml(d.card, d.id)
    $('#modal').hidden = false
    $('#modal [data-decide="confirm"]').focus()
  } catch (e) {
    toast(e.message)
  }
}

function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = '' }

// ───────────────────────── chat ─────────────────────────

function chatEl() { const c = $('#chat'); c.hidden = false; $('#clearChat').hidden = false; return c }
function scrollChat() { const c = $('#chat'); c.scrollTop = c.scrollHeight }

async function ask(text) {
  text = text.trim()
  if (!text || app.busy) return
  app.busy = true
  $('#sendBtn').disabled = true
  const input = $('#askInput')
  input.value = ''
  autosize()

  const chat = chatEl()
  chat.insertAdjacentHTML('beforeend', `<div class="msg-user">${esc(text)}</div>`)
  const bot = document.createElement('div')
  bot.className = 'msg-bot'
  bot.innerHTML = '<div class="status"><span class="dots"><i></i><i></i><i></i></span><span>Thinking</span></div><div class="md"></div>'
  chat.appendChild(bot)
  scrollChat()
  $('.agent').scrollIntoView({ behavior: 'smooth', block: 'start' })

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

function bindUi() {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ask],[data-propose],[data-decide],[data-demo]')
    if (!t) return
    if (t.dataset.ask) { ask(t.dataset.ask); toggleMenu(false) }
    else if (t.dataset.propose) propose(JSON.parse(t.dataset.propose))
    else if (t.dataset.decide) decide(t.closest('.offer'), t.dataset.decide)
    else if (t.hasAttribute('data-demo')) { toast('Only the Home page is part of this concept demo.'); toggleMenu(false) }
  })

  $('#askForm').addEventListener('submit', e => { e.preventDefault(); ask($('#askInput').value) })
  $('#askInput').addEventListener('input', autosize)
  $('#askInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask($('#askInput').value) }
  })
  $('#cmdBtn').addEventListener('click', () => { $('#askInput').focus(); $('.agent').scrollIntoView({ behavior: 'smooth', block: 'start' }) })
  $('#clearChat').addEventListener('click', () => { $('#chat').innerHTML = ''; $('#chat').hidden = true; $('#clearChat').hidden = true })
  $('#nbaMore').addEventListener('click', () => { app.showAllNba = !app.showAllNba; renderNba() })
  $('#bellBtn').addEventListener('click', () => document.querySelector('#nba').scrollIntoView({ behavior: 'smooth', block: 'center' }))

  $('#personaSel').addEventListener('change', async e => {
    const d = await api('/api/reset', { persona: e.target.value })
    $('#chat').innerHTML = ''; $('#chat').hidden = true; $('#clearChat').hidden = true
    app.showAllNba = false
    apply(d)
    toast(`Now viewing as ${app.data.customer.firstName}`)
  })
  $('#resetBtn').addEventListener('click', async () => {
    const d = await api('/api/reset', { persona: app.data.persona })
    $('#chat').innerHTML = ''; $('#chat').hidden = true; $('#clearChat').hidden = true
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
