// Quayside panel — concept demo server. No dependencies; Node 20+.
//   PORT                 (default 3000)
//   ANTHROPIC_API_KEY    Claude key; without it the agent runs in a simple demo mode
//   ANTHROPIC_MODEL      default claude-sonnet-5-5
//   DAILY_CHAT_LIMIT     total agent messages per day across all visitors (default 1000)
//   STATS_KEY            password for /stats?key=... (if unset, /stats is open)
//   EDITOR_PASSWORD      password for the live editor at /hpanelN/edit (editor is off when unset)
//   EDITOR_MODEL         model for the live editor (default: ANTHROPIC_MODEL, else claude-sonnet-5-5)
//   EDITOR_DAILY_LIMIT   editor requests per day (default 300)
//   MCP_TOKEN            secret for the claude.ai connector at /mcp (connector is off when unset)
//   VERSIONS_DIR         where prototype versions are stored (default ./versions — keep it on a persistent volume)

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAccount, personas, publicState, quote } from './lib/commerce.js'
import { agentInfo, runTurn } from './lib/agent.js'
import { record, reset as resetStats, statsHtml, validPlacement } from './lib/stats.js'
import * as versions from './lib/versions.js'
import { runEdit, resetConversation, editorInfo } from './lib/editor.js'
import { handleMcp, mcpEnabled } from './lib/mcp.js'

const PORT = Number(process.env.PORT || 3000)
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url))
const EDITOR_DIR = fileURLToPath(new URL('./editor/', import.meta.url))
await versions.init()

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

async function readJson(req, max = 16 * 1024) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > max) throw Object.assign(new Error('Request too large'), { status: 413 })
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

// ───────────────────────── versions & editor helpers ─────────────────────────

const fileHashes = new Map() // key -> { mtime, hash }
async function contentHash(key, read, mtime) {
  const hit = fileHashes.get(key)
  if (hit && hit.mtime === mtime) return hit.hash
  const hash = createHash('sha256').update(await read()).digest('hex').slice(0, 10)
  fileHashes.set(key, { mtime, hash })
  return hash
}
const versionDir = slug => join(process.env.VERSIONS_DIR || fileURLToPath(new URL('./versions/', import.meta.url)), slug)
async function versionAsset(slug, name) {
  const st = await stat(join(versionDir(slug), name))
  return contentHash(slug + '/' + name, () => versions.readVersionFile(slug, name), st.mtimeMs)
}
async function versionIndex(slug) {
  let html = await versions.readVersionFile(slug, 'index.html')
  for (const name of ['styles.css', 'app.js']) html = html.replaceAll(`"/${name}"`, `"${name}?v=${await versionAsset(slug, name)}"`)
  return html
}
async function editorIndex() {
  let html = await readFile(join(EDITOR_DIR, 'index.html'), 'utf8')
  for (const name of ['editor.css', 'editor.js']) {
    const st = await stat(join(EDITOR_DIR, name))
    html = html.replaceAll(`"/editor-assets/${name}"`, `"/editor-assets/${name}?v=${await contentHash('editor/' + name, () => readFile(join(EDITOR_DIR, name)), st.mtimeMs)}"`)
  }
  return html
}
const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end() }

const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || ''
const EDITOR_DAILY = Number(process.env.EDITOR_DAILY_LIMIT || 300)
const editorToken = () => createHmac('sha256', EDITOR_PASSWORD).update('quayside-editor-v1').digest('hex')
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]))
function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
const isEditor = req => Boolean(EDITOR_PASSWORD) && sameSecret(cookies(req).qp_editor || '', editorToken())
const loginHits = new Map()
let editDay = new Date().toDateString(), editCount = 0
const editing = new Set()

let actionSeq = 0
const newActionId = () => 'a' + (++actionSeq).toString(36) + randomUUID().slice(0, 6)

// ───────────────────────── routes ─────────────────────────

async function handle(req, res) {
  const url = new URL(req.url, 'http://x')

  if (url.pathname === '/healthz') return send(res, 200, 'ok')

  // ── prototype versions: /hpanelN/ (page), /hpanelN/edit (live editor) ──
  if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) return redirect(res, '/hpanel1/' + url.search)
  const vmatch = url.pathname.match(/^\/(hpanel\d{1,3})(\/.*)?$/i)
  if (vmatch && (req.method === 'GET' || req.method === 'HEAD')) {
    const slug = vmatch[1].toLowerCase()
    const rest = vmatch[2] || ''
    if (vmatch[1] !== slug) return redirect(res, '/' + slug + rest + url.search)
    if (!(await versions.exists(slug))) return send(res, 404, 'This version does not exist.')
    if (!rest) return redirect(res, `/${slug}/${url.search}`)
    if (rest === '/') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache', ...securityHeaders })
      return res.end(req.method === 'HEAD' ? undefined : await versionIndex(slug))
    }
    const asset = rest.slice(1)
    if (asset === 'styles.css' || asset === 'app.js') {
      const versioned = url.searchParams.get('v') && url.searchParams.get('v') === await versionAsset(slug, asset)
      res.writeHead(200, { 'content-type': MIME[extname(asset)], 'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache', ...securityHeaders })
      return res.end(req.method === 'HEAD' ? undefined : await versions.readVersionFile(slug, asset))
    }
    if (rest === '/edit' || rest === '/edit/') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache', ...securityHeaders })
      return res.end(req.method === 'HEAD' ? undefined : await editorIndex())
    }
    return send(res, 404, 'Not found')
  }
  if (url.pathname.startsWith('/editor-assets/') && req.method === 'GET') {
    const name = url.pathname.slice('/editor-assets/'.length)
    if (!['editor.css', 'editor.js'].includes(name)) return send(res, 404, 'Not found')
    res.writeHead(200, { 'content-type': MIME[extname(name)], 'cache-control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache', ...securityHeaders })
    return res.end(await readFile(join(EDITOR_DIR, name)))
  }

  // ── claude.ai connector (remote MCP, Streamable HTTP) ──
  // Auth: "Authorization: Bearer <MCP_TOKEN>" header, or the token as the last path segment (/mcp/<token>).
  const mcpMatch = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/)
  if (mcpMatch) {
    if (!mcpEnabled()) return send(res, 503, { error: 'The claude.ai connector is switched off. Set MCP_TOKEN in Coolify to turn it on.' })
    const given = mcpMatch[1] ? decodeURIComponent(mcpMatch[1]) : String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!sameSecret(given, process.env.MCP_TOKEN)) {
      return send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: wrong or missing connector token.' } }, { 'www-authenticate': 'Bearer realm="quayside"' })
    }
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST.' } }, { allow: 'POST' })
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0]
    const out = await handleMcp(await readJson(req, 2 * 1024 * 1024), `${proto}://${req.headers.host}`)
    if (out.status === 202) { res.writeHead(202); return res.end() }
    return send(res, out.status, out.body)
  }

  // ── live reload for open previews (/hpanelN/?live=1) ──
  if (url.pathname === '/api/changes' && req.method === 'GET') {
    const slug = url.searchParams.get('v')
    if (!versions.validSlug(slug)) return send(res, 400, { error: 'Bad version' })
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' })
    res.write(': connected\n\n')
    const onChange = changed => { if (changed === slug) res.write(`event: change\ndata: {}\n\n`) }
    versions.changes.on('change', onChange)
    const ping = setInterval(() => res.write(': ping\n\n'), 25000)
    req.on('close', () => { clearInterval(ping); versions.changes.off('change', onChange) })
    return
  }

  // ── live editor API (password protected) ──
  if (url.pathname.startsWith('/api/editor/')) {
    const action = url.pathname.slice('/api/editor/'.length)
    if (action === 'login' && req.method === 'POST') {
      if (!EDITOR_PASSWORD) return send(res, 503, { error: 'The editor is switched off. Set EDITOR_PASSWORD in Coolify to turn it on.' })
      const ip = clientIp(req), now = Date.now()
      const hits = (loginHits.get(ip) || []).filter(t => now - t < 15 * 60 * 1000)
      if (hits.length >= 10) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' })
      hits.push(now); loginHits.set(ip, hits)
      const body = await readJson(req)
      if (!sameSecret(body.password || '', EDITOR_PASSWORD)) return send(res, 401, { error: 'Wrong password.' })
      const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : ''
      return send(res, 200, { ok: true }, { 'set-cookie': `qp_editor=${editorToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${secure}` })
    }
    if (action === 'logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'set-cookie': 'qp_editor=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' })
    if (action === 'state' && req.method === 'GET') {
      const slug = url.searchParams.get('v')
      if (!isEditor(req)) return send(res, 200, { authed: false, enabled: Boolean(EDITOR_PASSWORD) })
      if (!(await versions.exists(slug))) return send(res, 404, { error: 'This version does not exist.' })
      return send(res, 200, { authed: true, enabled: true, versions: await versions.listVersions(), history: await versions.historyInfo(slug), busy: editing.has(slug), ai: editorInfo(), connector: mcpEnabled() })
    }
    if (!isEditor(req)) return send(res, 401, { error: 'Please log in again.' })
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
    const body = await readJson(req)
    const slug = String(body.version || '')
    if (!(await versions.exists(slug))) return send(res, 404, { error: 'This version does not exist.' })
    if (editing.has(slug) && action !== 'new-chat') return send(res, 409, { error: 'A change is still being made. Wait for it to finish.' })

    if (action === 'undo' || action === 'redo') {
      const label = await versions[action](slug)
      return send(res, 200, { ok: Boolean(label), label, history: await versions.historyInfo(slug) })
    }
    if (action === 'save-as') {
      const next = await versions.saveAsNew(slug)
      return send(res, 200, { slug: next, versions: await versions.listVersions() })
    }
    if (action === 'new-chat') { resetConversation(slug); return send(res, 200, { ok: true }) }
    if (action === 'chat') {
      const message = String(body.message || '').trim()
      if (!message) return send(res, 400, { error: 'Type what you want to change.' })
      if (message.length > 3000) return send(res, 400, { error: 'Please keep requests under 3,000 characters.' })
      if (new Date().toDateString() !== editDay) { editDay = new Date().toDateString(); editCount = 0 }
      if (editCount >= EDITOR_DAILY) return send(res, 429, { error: 'The editor has reached its limit for today.' })
      editCount++
      editing.add(slug)
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' })
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      const ping = setInterval(() => res.write(': ping\n\n'), 15000)
      try {
        await runEdit(slug, message, emit)
        emit('history', await versions.historyInfo(slug))
      } catch (e) {
        console.error('editor error', e.status || '', e.message)
        const msg = e.status === 401 ? 'The AI key was rejected (check ANTHROPIC_API_KEY).'
          : e.status === 429 ? 'The AI is busy or the spending limit was reached. Try again shortly.'
          : e.status === 503 ? e.message
          : 'Something went wrong while editing. Any finished edits were kept — you can Undo them.'
        emit('error', { message: msg })
        emit('history', await versions.historyInfo(slug))
      } finally {
        clearInterval(ping)
        editing.delete(slug)
      }
      return res.end()
    }
    return send(res, 404, { error: 'Unknown action' })
  }

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
    if (extname(path)) return send(res, 404, 'Not found')
    return redirect(res, '/hpanel1/')
  }
}

createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error(e)
    if (!res.headersSent) send(res, e.status || 500, { error: e.status === 413 ? e.message : 'Server error' })
    else res.end()
  })
}).listen(PORT, () => console.log(`Panel demo on http://localhost:${PORT} — agent: ${agentInfo().model}`))
