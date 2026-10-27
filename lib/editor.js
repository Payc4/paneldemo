// Live editor: Claude changes one prototype version (index.html, styles.css, app.js) from a plain-language
// request. It works with small tools (outline, search, view, exact replace, insert) instead of whole files,
// and every app.js edit is syntax-checked before it is saved, so the page can't be broken by a typo.

import { spawn } from 'node:child_process'
import { streamClaude } from './agent.js'
import { FILES, readVersionFile, writeVersionFile, snapshot } from './versions.js'

const MODEL = process.env.EDITOR_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
const MAX_ROUNDS = 40
const MAX_VIEW = 400
export const editorInfo = () => ({ live: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL })

// ───────────────────────── outline ─────────────────────────

function outline(name, text) {
  const lines = text.split('\n')
  const out = []
  lines.forEach((l, i) => {
    let m
    if (name === 'app.js') {
      if ((m = l.match(/^(?:async )?function (\w+)/)) || (m = l.match(/^(?:const|let) (\w+) =/)) || (m = l.match(/^(\w+)\.(\w+) = /))) out.push(`${i + 1}: ${m[2] ? m[1] + '.' + m[2] : m[1]}`)
      else if ((m = l.match(/^\/\/ ─+ (.+?) ─+/))) out.push(`${i + 1}: ── ${m[1]}`)
    } else if (name === 'styles.css') {
      if ((m = l.match(/^\/\* ─+ (.+?) ─+ \*\//))) out.push(`${i + 1}: ── ${m[1]}`)
      else if ((m = l.match(/^@media ([^{]+)/))) out.push(`${i + 1}: @media ${m[1].trim()}`)
    } else if ((m = l.match(/^\s{0,8}<(header|nav|main|section|aside|div class="(?:ag|modal|pop|rate|toast)[^"]*"|div class="wrap[^"]*")[^>]*?(?:id="([^"]+)")?[^>]*>/))) {
      out.push(`${i + 1}: <${m[1].split(' ')[0]}${m[2] ? ' #' + m[2] : ''}>${l.includes('aria-label') ? ' ' + (l.match(/aria-label="([^"]+)"/) || [])[1] : ''}`)
    }
  })
  return `${name} — ${lines.length} lines\n${out.join('\n')}`
}

// ───────────────────────── tools ─────────────────────────

const TOOLS = [
  {
    name: 'search',
    description: 'Case-insensitive literal search across the version files. Returns up to 40 matching lines as "file:line: text". Use it to find where something is before viewing or editing.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, file: { type: 'string', enum: FILES, description: 'Optional: limit to one file.' } }, required: ['query'] },
  },
  {
    name: 'view',
    description: `Show numbered lines of a file (at most ${MAX_VIEW} lines per call). Always view the exact lines before editing them.`,
    input_schema: { type: 'object', properties: { file: { type: 'string', enum: FILES }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['file', 'start_line', 'end_line'] },
  },
  {
    name: 'replace',
    description: 'Replace one exact, unique piece of text in a file. old_text must match the file exactly (including indentation) and occur exactly once; include enough surrounding lines to make it unique. Use an empty new_text to delete.',
    input_schema: { type: 'object', properties: { file: { type: 'string', enum: FILES }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['file', 'old_text', 'new_text'] },
  },
  {
    name: 'insert',
    description: 'Insert text after a given line number (0 = top of file, or the last line number to append at the end). Good for adding new CSS rules or new functions.',
    input_schema: { type: 'object', properties: { file: { type: 'string', enum: FILES }, after_line: { type: 'integer' }, text: { type: 'string' } }, required: ['file', 'after_line', 'text'] },
  },
]

function systemPrompt(slug, outlines) {
  return `You are the live design editor for "${slug}", one version of the Hostinger hosting control panel prototype. A non-technical person types requests in plain language and watches the page update in a live preview next to this chat. Your job is to make the change they ask for by editing this version's files.

## The files (a single-page app, no build step)
- index.html — the static shell: top bar, sidebar, home sections, Agent workspace markup, pop-ups. Loads styles.css and app.js.
- styles.css — all styles. Colour tokens are CSS variables in :root at the top (brand purple --accent: #673DE6). Responsive rules are in @media blocks.
- app.js — renders everything dynamic: the home page (greeting, deals carousel, to-dos, sites, plan, renewals), every inner page (Websites, Domains, Emails, VPS, GPU, API, AI Router, Ecommerce, AI apps…), the Agent workspace and its pages, pop-ups, and routing (location.hash, e.g. #websites).

Data such as the customer, deals (app.data.promos), to-dos (app.data.nba) and sites comes from the server via /api/state. You cannot edit the server. To add or change something that comes from the server, do it in app.js — for example, to add a deals slide, prepend an object to the list inside renderPromo or apply() using the same fields the other slides use (look at an existing promo first).

## Outline (line numbers)
${outlines}

## How to work
1. Find the right place with search and view. Never guess line contents — view them first.
2. Make small, targeted edits with replace (or insert for new rules/functions). Keep the existing style, class naming, brand purple and fonts. Reuse existing CSS classes and helpers (I(), esc(), ICON, ICON2) where possible.
3. New visuals should be inline SVG or CSS. Don't load external scripts, images or fonts. You cannot draw other companies' logos; if a request asks for a brand logo, use a neat badge with the name (and a simple generic icon) instead and say so in one short sentence.
4. Don't change /api calls, tracking (track(...)), the server, or anything the request didn't ask for. Don't remove features.
5. Make sure the change works on phones too (there are @media (max-width: 899.98px) rules).
6. Work quietly: don't narrate before tool calls. When finished, reply with 1–3 short plain-language sentences describing what changed and where to look. No code, no file names unless asked.
7. If the request is unclear, make the most reasonable choice, do it, and mention the choice. If it truly can't be done here (e.g. needs the server), say so briefly and suggest the closest thing you can do.`
}

// ───────────────────────── shared tool implementation ─────────────────────────
// Used by the in-page editor (runEdit) and the claude.ai connector (lib/mcp.js).
// files: { name: content } cache for the version; beforeWrite(): called once before the first write.

export async function loadFiles(slug) {
  const files = {}
  for (const f of FILES) files[f] = await readVersionFile(slug, f)
  return files
}
export const outlineAll = files => FILES.map(f => outline(f, files[f])).join('\n\n')
export { TOOLS }

// app.js is loaded with <script type="module">, so check it as a module: that catches errors a
// plain script check misses, like a function declared twice. Returns the error text, or null.
function moduleSyntaxError(src) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['--input-type=module', '--check'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let err = ''
    const timer = setTimeout(() => { p.kill(); resolve(null) }, 10000)
    p.stderr.on('data', d => { err += d })
    p.on('error', () => { clearTimeout(timer); resolve(null) })
    p.on('close', code => {
      clearTimeout(timer)
      if (code === 0) return resolve(null)
      const line = (err.match(/^\[stdin\]:(\d+)/m) || [])[1]
      const msg = (err.match(/^\w*Error: .*$/m) || ['syntax error'])[0]
      resolve(line ? `${msg}, line ${line}` : msg)
    })
    p.stdin.on('error', () => {})
    p.stdin.end(src)
  })
}

export async function applyTool(slug, files, name, input, beforeWrite) {
  const file = input.file
  if (file && !FILES.includes(file)) return { error: `Unknown file. Use one of: ${FILES.join(', ')}` }
  if (name === 'search') {
    const q = String(input.query || '').toLowerCase()
    if (!q) return { error: 'Empty query.' }
    const hits = []
    for (const f of file ? [file] : FILES) {
      files[f].split('\n').forEach((l, i) => { if (hits.length < 40 && l.toLowerCase().includes(q)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 220)}`) })
    }
    return hits.length ? hits.join('\n') : 'No matches.'
  }
  if (name === 'view') {
    const lines = files[file].split('\n')
    const a = Math.max(1, Number(input.start_line) || 1)
    const b = Math.min(lines.length, Number(input.end_line) || a + 100, a + MAX_VIEW - 1)
    return lines.slice(a - 1, b).map((l, i) => `${a + i}\t${l}`).join('\n') + (b < lines.length ? `\n… (${lines.length} lines total)` : '')
  }
  if (name === 'replace' || name === 'insert') {
    let next
    if (name === 'replace') {
      const old = String(input.old_text ?? '')
      if (!old) return { error: 'old_text is empty.' }
      const count = files[file].split(old).length - 1
      if (count === 0) return { error: 'old_text was not found. View the lines again and copy them exactly, including indentation.' }
      if (count > 1) return { error: `old_text occurs ${count} times. Include more surrounding lines so it is unique.` }
      next = files[file].replace(old, () => String(input.new_text ?? ''))
    } else {
      const lines = files[file].split('\n')
      const at = Math.max(0, Math.min(lines.length, Number(input.after_line) || 0))
      lines.splice(at, 0, String(input.text ?? ''))
      next = lines.join('\n')
    }
    if (file === 'app.js') {
      const bad = await moduleSyntaxError(next)
      if (bad) return { error: `That edit would break app.js (${bad}). It was not saved — fix it and try again.` }
    }
    await beforeWrite()
    files[file] = next
    await writeVersionFile(slug, file, next)
    return `Saved. ${file} now has ${next.split('\n').length} lines.`
  }
  return { error: `Unknown tool ${name}` }
}

// ───────────────────────── run one request ─────────────────────────

const conversations = new Map() // slug -> [{ role, content }] (plain text only, last few turns)

export function resetConversation(slug) { conversations.delete(slug) }

/**
 * emit(event, data): status {text}, delta {text}, done {changed, summary}, error {message}
 */
export async function runEdit(slug, request, emit) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('The editor needs ANTHROPIC_API_KEY to be set.'), { status: 503 })

  const files = await loadFiles(slug)
  const outlines = outlineAll(files)

  const history = conversations.get(slug) || []
  const messages = [...history, { role: 'user', content: request }]
  let changed = false
  let snapped = false
  let finalText = ''

  const beforeWrite = async () => {
    if (snapped) return
    await snapshot(slug, request.slice(0, 80))
    snapped = true
  }

  const run = async (name, input) => {
    const out = await applyTool(slug, files, name, input, beforeWrite)
    if (typeof out === 'string' && out.startsWith('Saved.')) changed = true
    return out
  }

  const label = { search: i => `Looking for “${String(i.query || '').slice(0, 40)}”`, view: i => `Reading ${i.file}`, replace: i => `Editing ${i.file}`, insert: i => `Adding to ${i.file}` }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Cache the long system prompt and the growing conversation between rounds.
    const msgs = messages.map((m, i) => {
      if (i !== messages.length - 1) return m
      const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content.map(b => ({ ...b }))
      content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } }
      return { ...m, content }
    })
    let text = ''
    const r = await streamClaude({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: systemPrompt(slug, outlines), cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages: msgs,
    }, t => { text += t; emit('delta', { text: t }) })
    const content = r.content.filter(b => b.type !== 'text' || b.text.trim())
    if (!content.length) break
    messages.push({ role: 'assistant', content })
    if (text.trim()) finalText = text.trim()
    const uses = r.content.filter(b => b.type === 'tool_use')
    if (r.stop !== 'tool_use' || !uses.length) break
    if (text.trim()) emit('delta', { text: '\n\n' })
    const results = []
    for (const u of uses) {
      emit('status', { text: (label[u.name] || (() => 'Working'))(u.input || {}) + '…' })
      let out
      try { out = await run(u.name, u.input || {}) } catch (e) { out = { error: e.message } }
      if (u.name === 'replace' || u.name === 'insert') emit('changed', {})
      results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : out.error, ...(typeof out === 'string' ? {} : { is_error: true }) })
    }
    messages.push({ role: 'user', content: results })
    if (round === MAX_ROUNDS - 1) finalText = (finalText ? finalText + '\n\n' : '') + 'I stopped here because this change took many steps. Ask me to continue if something is missing.'
  }

  const summary = finalText || (changed ? 'Done.' : 'No changes were made.')
  conversations.set(slug, [...history, { role: 'user', content: request }, { role: 'assistant', content: summary }].slice(-12))
  emit('done', { changed, summary })
  return { changed, summary }
}
