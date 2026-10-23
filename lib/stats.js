// Experiment statistics: views, clicks, offers shown, confirms (demo "purchases") per placement.
// Kept in memory and saved to STATS_FILE every few seconds so a restart doesn't lose them.
// (On Coolify, add a persistent volume at /app/stats to keep them across redeploys.)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const FILE = process.env.STATS_FILE || new URL('../stats/stats.json', import.meta.url).pathname
const TYPES = new Set(['view', 'click', 'propose', 'confirm', 'decline', 'message'])
const MAX_PLACEMENTS = 300

let data = { since: new Date().toISOString(), sessions: [], placements: {} }
try { data = { ...data, ...JSON.parse(readFileSync(FILE, 'utf8')) } } catch { /* first run */ }
const sessions = new Set(data.sessions)

let dirty = false
setInterval(() => {
  if (!dirty) return
  dirty = false
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify({ ...data, sessions: [...sessions].slice(-50000) }))
  } catch (e) {
    console.error('stats save failed', e.message)
  }
}, 5000).unref()

export const validPlacement = p => /^[a-z0-9:_.-]{1,60}$/i.test(String(p || ''))

export function record(session, type, placement, { revenue = 0 } = {}) {
  if (!TYPES.has(type) || !validPlacement(placement)) return false
  const known = data.placements[placement]
  if (!known && Object.keys(data.placements).length >= MAX_PLACEMENTS) return false
  const row = known || (data.placements[placement] = { view: 0, click: 0, propose: 0, confirm: 0, decline: 0, message: 0, revenue: 0 })
  row[type]++
  if (type === 'confirm') row.revenue = Math.round((row.revenue + revenue) * 100) / 100
  if (session) sessions.add(session)
  dirty = true
  return true
}

export function reset() {
  data = { since: new Date().toISOString(), sessions: [], placements: {} }
  sessions.clear()
  dirty = true
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—')

const LABELS = {
  page: 'Page loads',
  'sale-banner': 'SALE! countdown banner',
  refer: 'Refer & earn button',
  agent: 'AI assistant (messages, offers made in chat)',
  chip: 'Suggested questions under the assistant',
}
function label(p) {
  if (LABELS[p]) return LABELS[p]
  const [kind, id] = p.split(':')
  return ({ promo: 'Promo slide', todo: 'To-do', meter: 'Usage meter', site: 'Website card', renewal: 'Renewals panel' }[kind] || kind) + (id ? ` · ${id}` : '')
}

export function statsHtml(key) {
  const rows = Object.entries(data.placements).sort((a, b) => (b[1].confirm - a[1].confirm) || (b[1].click - a[1].click) || (b[1].view - a[1].view))
  const tot = rows.reduce((t, [, r]) => { for (const k in r) t[k] = (t[k] || 0) + r[k]; return t }, {})
  const k = key ? `?key=${encodeURIComponent(key)}` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Quayside demo — stats</title><style>
body{margin:0;background:#F5F6F8;color:#101828;font:14px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px}
h1{font-size:24px;margin:0 0 4px}.muted{color:#667085}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0}
.tile{background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 0 0 1px #E4E7EC}.tile b{display:block;font-size:24px}
.box{background:#fff;border-radius:12px;box-shadow:0 0 0 1px #E4E7EC;overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:760px}th,td{padding:10px 14px;text-align:right;border-bottom:1px solid #EAECF0;white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal}th{font-size:12px;color:#475467;font-weight:600;background:#F9FAFB}
a{color:#3451D1}</style></head><body><main>
<h1>Experiment statistics</h1>
<p class="muted">Since ${esc(new Date(data.since).toUTCString())} · demo "revenue" is what confirmed cards would have charged · <a href="/stats${k}">refresh</a></p>
<div class="tiles">
<div class="tile"><span class="muted">Visitors (sessions)</span><b>${sessions.size}</b></div>
<div class="tile"><span class="muted">Page loads</span><b>${data.placements.page?.view || 0}</b></div>
<div class="tile"><span class="muted">Assistant messages</span><b>${tot.message || 0}</b></div>
<div class="tile"><span class="muted">Offers shown (cards)</span><b>${tot.propose || 0}</b></div>
<div class="tile"><span class="muted">Confirmed</span><b>${tot.confirm || 0}</b></div>
<div class="tile"><span class="muted">Demo revenue</span><b>€${(tot.revenue || 0).toFixed(2)}</b></div>
</div>
<div class="box"><table><thead><tr><th>Placement</th><th>Views</th><th>Clicks</th><th>Click rate</th><th>Offers shown</th><th>Confirmed</th><th>Declined</th><th>Confirm rate</th><th>Demo revenue</th></tr></thead><tbody>
${rows.filter(([p]) => p !== 'page').map(([p, r]) => `<tr><td>${esc(label(p))}</td><td>${r.view}</td><td>${r.click}</td><td>${pct(r.click, r.view)}</td><td>${r.propose}</td><td>${r.confirm}</td><td>${r.decline}</td><td>${pct(r.confirm, r.propose)}</td><td>€${r.revenue.toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No data yet.</td></tr>'}
</tbody></table></div>
<p class="muted" style="margin-top:14px">Click rate = clicks ÷ views. Confirm rate = confirmed ÷ offers shown. Views are counted once per page load.</p>
</main></body></html>`
}
