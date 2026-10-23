// Quayside panel — concept demo server. No dependencies; Node 20+.
//   PORT                 (default 3000)
//   ANTHROPIC_API_KEY    Claude key; without it the agent runs in a simple demo mode
//   ANTHROPIC_MODEL      default claude-sonnet-5-5
//   DAILY_CHAT_LIMIT     total agent messages per day across all visitors (default 1000)
//   STATS_KEY            password for /stats?key=... (if unset, /stats is open)

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAccount, personas, publicState, quote } from './lib/commerce.js'
import { agentInfo, runTurn } from './lib/agent.js'
import { record, reset as resetStats, statsHtml, validPlacement } from './lib/stats.js'

const PORT = Number(process.env.PORT || 3000)
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url))

// Cache-busting: index.html links styles.css and app.js with a content hash (?v=…), so a browser
// never pairs a new page with an old stylesheet or script after a deploy.
const ASSET_VERSIONS = {}
async function versionedIndex() {
  let html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
  for (const name of ['styles.css', 'app.js']) {
    ASSET_VERSIONS[name] ??= createHash('sha256').update(await readFile(join(PUBLIC, name))).digest('hex').slice(0, 10)
    html = html.replaceAll(`"/${name}"`, `"/${name}?v=${ASSET_VERSIONS[name]}"`)
  }
  return html
}
const DAILY_LIMIT = Number(process.env.DAILY_CHAT_LIMIT || 1000)
const PER_IP = { max: 25, windowMs: 10 * 60 * 1000 }
const SESSION_TTL = 6 * 3600 * 1000
const MAX_SESSIONS = 2000
const MAX_MESSAGE = 1000

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }

// ───────────────────────── sessions & limits ─────────────────────────

const sessions = new Map()
function getSession(id, persona) {
  if (!/^[0-9a-f-]{36}$/.test(String(id || ''))) return null
  let s = sessions.get(id)
  if (!s || (persona && personas[persona] && s.persona !== persona)) {
    const p = personas[persona] ? persona : (s?.persona || 'laura')
    s = { persona: p, account: newAccount(p), messages: [], pending: new Map(), activity: [], usage: { input: 0, output: 0 } }
    sessions.set(id, s)
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
  }
  s.seen = Date.now()
  return s
}
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL
  for (const [id, s] of sessions) if (s.seen < cutoff) sessions.delete(id)
}, 10 * 60 * 1000).unref()

const ipHits = new Map()
let day = new Date().toDateString()
let todayCount = 0
function allowChat(ip) {
  const now = Date.now()
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); todayCount = 0 }
  if (todayCount >= DAILY_LIMIT) return 'The demo has reached its message limit for today. Please try again tomorrow.'
  const hits = (ipHits.get(ip) || []).filter(t => now - t < PER_IP.windowMs)
  if (hits.length >= PER_IP.max) return 'You\'re sending messages quickly — please wait a few minutes.'
  hits.push(now)
  ipHits.set(ip, hits)
  todayCount++
  return null
}

// ───────────────────────── http helpers ─────────────────────────

const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(data)
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > 16 * 1024) throw Object.assign(new Error('Request too large'), { status: 413 })
    chunks.push(c)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
}

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
}

let actionSeq = 0
const newActionId = () => 'a' + (++actionSeq).toString(36) + randomUUID().slice(0, 6)

// ───────────────────────── routes ─────────────────────────

async function handle(req, res) {
  const url = new URL(req.url, 'http://x')

  if (url.pathname === '/healthz') return send(res, 200, 'ok')

  if (url.pathname === '/stats' && req.method === 'GET') {
    const key = process.env.STATS_KEY || ''
    if (key && url.searchParams.get('key') !== key) return send(res, 403, 'Add ?key=… (STATS_KEY) to view the statistics.')
    if (url.searchParams.get('reset') === '1') resetStats()
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store', 'x-robots-tag': 'noindex' })
    return res.end(statsHtml(key))
  }

  if (url.pathname === '/api/event' && req.method === 'POST') {
    const body = await readJson(req)
    if (!/^[0-9a-f-]{36}$/.test(String(body.session || ''))) return send(res, 400, { error: 'Bad session' })
    const events = Array.isArray(body.events) ? body.events.slice(0, 40) : [body]
    for (const e of events) record(body.session, String(e.type || ''), String(e.placement || ''))
    return send(res, 204, '')
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const s = getSession(url.searchParams.get('session'), url.searchParams.get('persona'))
    if (!s) return send(res, 400, { error: 'Bad session' })
    return send(res, 200, { state: publicState(s.account, s.persona), agent: agentInfo(), activity: s.activity })
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    const body = await readJson(req)
    if (!/^[0-9a-f-]{36}$/.test(String(body.session || ''))) return send(res, 400, { error: 'Bad session' })
    sessions.delete(body.session)
    const s = getSession(body.session, body.persona)
    return send(res, 200, { state: publicState(s.account, s.persona), agent: agentInfo(), activity: [] })
  }

  if (url.pathname === '/api/propose' && req.method === 'POST') {
    const body = await readJson(req)
    const s = getSession(body.session)
    if (!s) return send(res, 400, { error: 'Bad session' })
    const q = quote(s.account, body.action || {})
    if (q.error) return send(res, 422, { error: q.error })
    const id = newActionId()
    const placement = validPlacement(body.placement) ? body.placement : 'other'
    s.pending.set(id, { params: body.action, placement, at: Date.now() })
    record(body.session, 'propose', placement)
    return send(res, 200, { id, card: q.card })
  }

  if (url.pathname === '/api/action' && req.method === 'POST') {
    const body = await readJson(req)
    const s = getSession(body.session)
    if (!s) return send(res, 400, { error: 'Bad session' })
    const pending = s.pending.get(String(body.id || ''))
    if (!pending) return send(res, 404, { error: 'This offer has expired. Ask again for a fresh one.' })
    s.pending.delete(body.id)
    if (body.decision !== 'confirm') {
      record(body.session, 'decline', pending.placement || 'other')
      s.activity.push(`Declined: ${pending.params.sku}`)
      return send(res, 200, { ok: true, declined: true })
    }
    // Re-price against the current account: things may have changed since the card was shown.
    const q = quote(s.account, pending.params)
    if (q.error) return send(res, 409, { error: q.error })
    const summary = q.apply(s.account)
    record(body.session, 'confirm', pending.placement || 'other', { revenue: q.card.dueToday || 0 })
    s.activity.push(summary)
    return send(res, 200, { ok: true, summary, state: publicState(s.account, s.persona), activity: s.activity })
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const body = await readJson(req)
    const s = getSession(body.session)
    if (!s) return send(res, 400, { error: 'Bad session' })
    const text = String(body.message || '').trim()
    if (!text) return send(res, 400, { error: 'Type a message first.' })
    if (text.length > MAX_MESSAGE) return send(res, 400, { error: `Please keep messages under ${MAX_MESSAGE} characters.` })
    const blocked = allowChat(clientIp(req))
    if (blocked) return send(res, 429, { error: blocked })
    record(body.session, 'message', 'agent')

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' })
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    // Each chat in the Agent workspace keeps its own conversation history.
    const chatId = /^[a-z0-9-]{1,40}$/i.test(String(body.chat || '')) ? body.chat : 'main'
    s.chats ??= new Map()
    s.messages = s.chats.get(chatId) || []
    try {
      await runTurn(s, text, emit, newActionId, (type, placement) => record(body.session, type, placement))
    } catch (e) {
      console.error('agent error', e.status || '', e.message)
      s.messages.pop() // drop the unanswered user message
      const msg = e.status === 401 ? 'The AI key was rejected (check ANTHROPIC_API_KEY).'
        : e.status === 429 ? 'The AI is busy or the spending limit was reached. Try again shortly.'
        : e.status === 404 ? 'The AI model name was not recognised (check ANTHROPIC_MODEL).'
        : 'The assistant hit a problem. Please try again.'
      emit('error', { message: msg })
    } finally {
      s.chats.delete(chatId)
      s.chats.set(chatId, s.messages)
      while (s.chats.size > 20) s.chats.delete(s.chats.keys().next().value)
    }
    return res.end()
  }

  // Static files
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed')
  let path = decodeURIComponent(url.pathname)
  if (path === '/') path = '/index.html'
  const file = normalize(join(PUBLIC, path))
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden')
  try {
    const st = await stat(file)
    if (!st.isFile()) throw new Error('not a file')
    const data = path === '/index.html' ? await versionedIndex() : await readFile(file)
    const versioned = url.searchParams.get('v') && url.searchParams.get('v') === ASSET_VERSIONS[path.slice(1)]
    const cache = path === '/index.html' ? 'no-cache' : versioned ? 'public, max-age=31536000, immutable' : /\.(css|js)$/.test(path) ? 'no-cache' : 'public, max-age=300'
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': cache, ...securityHeaders })
    return res.end(req.method === 'HEAD' ? undefined : data)
  } catch {
    const data = await versionedIndex()
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache', ...securityHeaders })
    return res.end(data)
  }
}

createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error(e)
    if (!res.headersSent) send(res, e.status || 500, { error: e.status === 413 ? e.message : 'Server error' })
    else res.end()
  })
}).listen(PORT, () => console.log(`Panel demo on http://localhost:${PORT} — agent: ${agentInfo().model}`))
