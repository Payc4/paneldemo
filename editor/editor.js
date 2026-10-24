// Live editor front-end: chat on the left, live preview of the version on the right.

const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const slug = (location.pathname.match(/^\/(hpanel\d{1,3})\//) || [])[1]
const LOG_KEY = `qp-editor-chat-${slug}`
const SUGGESTIONS = [
  'Add a new first slide to the deals carousel inviting people to connect their AI tools: Claude, ChatGPT, Gemini and Meta AI',
  'Make the greeting on the home page bigger and bolder',
  'Change the "Your to-dos" title to "Recommended for you"',
  'Make the top bar a bit taller with more space around the SALE button',
]

let busy = false
let log = []
let reloadTimer = null
let connector = false

async function api(path, body) {
  const res = await fetch('/api/editor/' + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: slug, ...body }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status })
  return data
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true }, 3200)
}

// ───────────── boot ─────────────

async function boot() {
  if (!slug) { document.body.textContent = 'Open the editor from a version address, e.g. /hpanel1/edit'; return }
  document.title = `Live editor — ${slug}`
  const s = await api('state?v=' + slug).catch(e => ({ error: e.message, status: e.status }))
  if (s.error) { showGate(s.status === 404 ? `${slug} doesn't exist.` : s.error, true); return }
  if (!s.enabled) { showGate('The editor is switched off. Add SITE_PASSWORD in Coolify (as a runtime variable) and redeploy to turn it on.', true); return }
  if (!s.authed) { showGate(null, false); return }
  showEditor(s)
}

function showGate(text, off) {
  $('#gate').hidden = false
  $('#gateSlug').textContent = slug || ''
  if (text) $('#gateText').textContent = text
  $('#gateFields').hidden = off
  if (!off) $('#pw').focus()
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault()
  $('#gateErr').textContent = ''
  try {
    await api('login', { password: $('#pw').value })
    location.reload()
  } catch (err) { $('#gateErr').textContent = err.message; $('#pw').select() }
})

function showEditor(s) {
  $('#ed').hidden = false
  $('#ed').dataset.pane = 'chat'
  $('#verSel').innerHTML = s.versions.map(v => `<option value="${esc(v.slug)}" ${v.slug === slug ? 'selected' : ''}>${esc(v.slug)}${v.from && v.from !== 'template' ? ` (from ${esc(v.from)})` : ''}</option>`).join('')
  $('#openBtn').href = `/${slug}/`
  $('#aiInfo').textContent = s.ai.live ? `Edits ${slug} · ${s.ai.model}` : 'AI key missing — set ANTHROPIC_API_KEY'
  setHistory(s.history)
  $('#frame').src = `/${slug}/?preview=1&live=1`
  connector = s.connector
  try { log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]') } catch { log = [] }
  renderLog()
  if (s.busy) note('A change is still being made from another window.')
  $('#msg').focus()
}

// ───────────── chat log ─────────────

function saveLog() { try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-60))) } catch {} }

function renderLog() {
  const el = $('#log')
  if (!log.length) {
    el.innerHTML = `<div class="empty"><h2>What should change?</h2><p>Describe it in plain words. The preview updates as soon as the change is made, and you can always undo it.</p>
      <div class="sugs">${SUGGESTIONS.map(t => `<button class="sug" data-sug="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`
    return
  }
  el.innerHTML = log.map(m => `<div class="${m.role === 'user' ? 'msg-u' : m.role === 'note' ? 'msg-n' : 'msg-a' + (m.error ? ' is-err' : '')}">${esc(m.text)}</div>`).join('')
  el.scrollTop = el.scrollHeight
}
function note(text) { log.push({ role: 'note', text }); saveLog(); renderLog() }

$('#log').addEventListener('click', e => {
  const b = e.target.closest('[data-sug]')
  if (b) { $('#msg').value = b.dataset.sug; $('#msg').focus() }
})

// ───────────── preview ─────────────

// The preview reloads itself through the live-change stream. This is only a backup: if it hasn't
// reloaded within a few seconds of a change (e.g. a proxy blocked the stream), reload it once.
let lastFrameLoad = 0
$('#frame').addEventListener('load', () => { lastFrameLoad = Date.now() })
function reloadPreview(delay = 0) {
  const since = Date.now()
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    if (lastFrameLoad >= since) return
    try { $('#frame').contentWindow.location.reload() } catch { $('#frame').src = `/${slug}/?preview=1&live=1` }
  }, delay)
}

document.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('is-on', x === b))
  $('#frameWrap').classList.toggle('is-phone', b.dataset.size === 'phone')
}))
document.querySelectorAll('[data-pane]').forEach(b => b.addEventListener('click', () => {
  $('#ed').dataset.pane = b.dataset.pane
  document.querySelectorAll('[data-pane]').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)) })
}))

// ───────────── send a change ─────────────

async function send(text) {
  text = text.trim()
  if (!text || busy) return
  busy = true
  setBusy(true)
  $('#msg').value = ''
  log.push({ role: 'user', text }); saveLog(); renderLog()

  const el = $('#log')
  const bubble = document.createElement('div')
  bubble.className = 'msg-a'
  bubble.innerHTML = '<span class="txt"></span><div class="status"><span class="spin"></span><span>Reading the page…</span></div>'
  el.appendChild(bubble); el.scrollTop = el.scrollHeight
  const txt = bubble.querySelector('.txt')
  const status = bubble.querySelector('.status')
  let raw = ''
  let summary = ''
  let failed = ''

  try {
    const res = await fetch('/api/editor/chat', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ version: slug, message: text }) })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('event-stream')) {
      const d = await res.json().catch(() => ({}))
      if (res.status === 401) { location.reload(); return }
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
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
        const ev = (chunk.match(/^event: (.*)$/m) || [])[1]
        const line = (chunk.match(/^data: (.*)$/m) || [])[1]
        if (!ev || !line) continue
        const data = JSON.parse(line)
        if (ev === 'delta') { raw += data.text; txt.textContent = raw.trim() }
        else if (ev === 'status') status.lastElementChild.textContent = data.text
        else if (ev === 'history') setHistory(data)
        else if (ev === 'done') { summary = data.summary; if (data.changed) reloadPreview(3000) }
        else if (ev === 'error') failed = data.message
        el.scrollTop = el.scrollHeight
      }
    }
  } catch (e) { failed = e.message }

  bubble.remove()
  if (summary) log.push({ role: 'assistant', text: summary })
  if (failed) log.push({ role: 'assistant', text: failed, error: true })
  if (!summary && !failed) log.push({ role: 'assistant', text: 'No reply — please try again.', error: true })
  saveLog(); renderLog()
  busy = false
  setBusy(false)
  $('#msg').focus()
}

function setBusy(on) {
  $('#sendBtn').disabled = on
  $('#sendBtn').textContent = on ? 'Working…' : 'Apply'
  $('.preview').classList.toggle('is-busy', on)
  for (const id of ['#undoBtn', '#redoBtn', '#saveAsBtn', '#verSel']) $(id).disabled = on || $(id).dataset.off === '1'
}

$('#form').addEventListener('submit', e => { e.preventDefault(); send($('#msg').value) })
$('#msg').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($('#msg').value) }
})

// ───────────── history & versions ─────────────

function setHistory(h) {
  const u = $('#undoBtn'), r = $('#redoBtn')
  u.dataset.off = h.undo ? '0' : '1'; r.dataset.off = h.redo ? '0' : '1'
  u.disabled = busy || !h.undo; r.disabled = busy || !h.redo
  u.title = h.undo ? `Undo: ${h.nextUndo}` : 'Nothing to undo'
  r.title = h.redo ? `Redo: ${h.nextRedo}` : 'Nothing to redo'
}

for (const [btn, action, word] of [['#undoBtn', 'undo', 'Undid'], ['#redoBtn', 'redo', 'Redid']]) {
  $(btn).addEventListener('click', async () => {
    if (busy) return
    try {
      const d = await api(action, {})
      setHistory(d.history)
      if (d.ok) { note(`${word}: ${d.label}`); reloadPreview(3000) }
    } catch (e) { toast(e.message) }
  })
}

$('#saveAsBtn').addEventListener('click', async () => {
  if (busy) return
  try {
    const d = await api('save-as', {})
    note(`Saved a copy as ${d.slug}. ${slug} stays as it is.`)
    toast(`Saved as ${d.slug} — opening its editor`)
    setTimeout(() => { location.href = `/${d.slug}/edit` }, 900)
  } catch (e) { toast(e.message) }
})

$('#verSel').addEventListener('change', e => { location.href = `/${e.target.value}/edit` })

$('#newChatBtn').addEventListener('click', async () => {
  if (busy) return
  await api('new-chat', {}).catch(() => {})
  log = []; saveLog(); renderLog(); $('#msg').focus()
})

// ───────────── claude.ai connector info ─────────────

$('#claudeBtn').addEventListener('click', () => {
  const box = $('#claudeBox')
  box.hidden = !box.hidden
  if (box.hidden) return
  $('#mcpUrl').textContent = `${location.origin}/mcp`
  $('#mcpOff').hidden = connector
  $('#mcpSteps').hidden = !connector
  $('#liveUrl').textContent = `${location.origin}/${slug}/?live=1`
  $('#liveUrl').href = `/${slug}/?live=1`
})
$('#claudeClose').addEventListener('click', () => { $('#claudeBox').hidden = true })
$('#copyMcp').addEventListener('click', () => { navigator.clipboard?.writeText(`${location.origin}/mcp`).then(() => toast('Copied')).catch(() => {}) })

$('#logoutBtn').addEventListener('click', async () => {
  await api('logout', {}).catch(() => {})
  location.reload()
})

boot()
