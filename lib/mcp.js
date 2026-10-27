// claude.ai connector: a remote MCP server (Streamable HTTP, JSON responses) that lets Claude — in the
// client's own claude.ai / Claude Desktop account — edit the prototype versions. Same tools and safety
// checks as the in-page editor (lib/editor.js). Protected by MCP_TOKEN (sent as a bearer token).

import { FILES, listVersions, exists, snapshot, undo, redo, historyInfo, saveAsNew } from './versions.js'
import { applyTool, loadFiles, outlineAll } from './editor.js'

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const GROUP_MS = 3 * 60 * 1000 // edits within 3 minutes of each other share one undo step
const lastWrite = new Map() // slug -> time of last edit

const v = { version: { type: 'string', description: 'Version to edit, e.g. "hpanel1". Use list_versions to see them.' } }
const file = { type: 'string', enum: FILES }

const TOOLS = [
  { name: 'list_versions', description: 'List the prototype versions and their live preview addresses. Call this first.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_outline', description: 'Outline of a version\'s three files (index.html, styles.css, app.js) with line numbers of every function, CSS section and main HTML block. Use it to find where to look.', inputSchema: { type: 'object', properties: v, required: ['version'] } },
  { name: 'search', description: 'Case-insensitive literal search in a version\'s files. Returns up to 40 matching lines as "file:line: text".', inputSchema: { type: 'object', properties: { ...v, query: { type: 'string' }, file: { ...file, description: 'Optional: limit to one file.' } }, required: ['version', 'query'] } },
  { name: 'view', description: 'Show numbered lines of a file (at most 400 lines per call). Always view the exact lines before editing them.', inputSchema: { type: 'object', properties: { ...v, file, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['version', 'file', 'start_line', 'end_line'] } },
  { name: 'replace', description: 'Replace one exact, unique piece of text in a file. old_text must match exactly (including indentation) and occur exactly once. app.js edits are syntax-checked and refused if they would break the page. The live preview reloads automatically.', inputSchema: { type: 'object', properties: { ...v, file, old_text: { type: 'string' }, new_text: { type: 'string' }, change_label: { type: 'string', description: 'Short plain-language name for this change, shown in the undo history (e.g. "Bigger greeting").' } }, required: ['version', 'file', 'old_text', 'new_text'] } },
  { name: 'insert', description: 'Insert text after a line number (0 = top; last line number = append at the end). Good for new CSS rules or functions. The live preview reloads automatically.', inputSchema: { type: 'object', properties: { ...v, file, after_line: { type: 'integer' }, text: { type: 'string' }, change_label: { type: 'string' } }, required: ['version', 'file', 'after_line', 'text'] } },
  { name: 'undo', description: 'Undo the last change to a version (edits made together count as one change).', inputSchema: { type: 'object', properties: v, required: ['version'] } },
  { name: 'redo', description: 'Redo the last undone change.', inputSchema: { type: 'object', properties: v, required: ['version'] } },
  { name: 'save_as_new_version', description: 'Copy a version to the next free hpanelN, so the current state is kept while experimenting further. Returns the new version name.', inputSchema: { type: 'object', properties: v, required: ['version'] } },
]

const INSTRUCTIONS = `Edits the Hostinger hosting-panel prototype. Each version (hpanel1, hpanel2, …) is a single-page app made of index.html (static shell), styles.css (all styles; brand purple --accent: #673DE6 in :root) and app.js (renders every page, the deals carousel, to-dos, the Agent workspace and routing via location.hash).
Workflow: list_versions → get_outline → search/view the exact lines → small edits with replace/insert. Never guess file contents. Keep the existing style, class names and brand; reuse helpers (I(), esc(), ICON, ICON2). Data like deals (app.data.promos) and to-dos (app.data.nba) comes from the server; to add or change them, do it client-side in app.js (e.g. prepend a slide in renderPromo). Don't change /api calls or track() calls. Use inline SVG/CSS only (no external files); don't draw other companies' logos — use a name badge instead. Check phones too (@media (max-width: 899.98px)).
The person watches the live preview (address from list_versions) and it reloads after each edit. Finish with a short plain-language summary of what changed. If they don't like it, use undo.`

export const mcpEnabled = () => Boolean(process.env.MCP_TOKEN)

async function callTool(name, args, baseUrl) {
  const slug = String(args.version || '')
  if (name === 'list_versions') {
    const list = await listVersions()
    return list.map(x => `${x.slug}${x.from && x.from !== 'template' ? ` (copied from ${x.from})` : ''} — preview: ${baseUrl}/${x.slug}/?live=1`).join('\n') || 'No versions yet.'
  }
  if (!(await exists(slug))) throw new Error(`Unknown version "${slug}". Call list_versions.`)
  if (name === 'get_outline') return outlineAll(await loadFiles(slug))
  if (name === 'undo' || name === 'redo') {
    const label = await (name === 'undo' ? undo(slug) : redo(slug))
    lastWrite.delete(slug)
    const h = await historyInfo(slug)
    return label ? `${name === 'undo' ? 'Undid' : 'Redid'}: ${label}. (${h.undo} more undo step(s), ${h.redo} redo step(s))` : `Nothing to ${name}.`
  }
  if (name === 'save_as_new_version') {
    const next = await saveAsNew(slug)
    return `Saved a copy of ${slug} as ${next}. Preview: ${baseUrl}/${next}/?live=1 — ${slug} is unchanged.`
  }
  if (['search', 'view', 'replace', 'insert'].includes(name)) {
    const files = await loadFiles(slug)
    const beforeWrite = async () => {
      const now = Date.now()
      if (!lastWrite.has(slug) || now - lastWrite.get(slug) > GROUP_MS) await snapshot(slug, String(args.change_label || 'Change made in Claude').slice(0, 80))
      lastWrite.set(slug, now)
    }
    const out = await applyTool(slug, files, name, args, beforeWrite)
    if (typeof out !== 'string') throw new Error(out.error)
    return out
  }
  throw new Error(`Unknown tool ${name}`)
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

async function handleMessage(msg, baseUrl) {
  const { id, method, params = {} } = msg || {}
  if (id === undefined || id === null) return null // notification (e.g. notifications/initialized)
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'quayside-prototype-editor', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    case 'ping': return rpcResult(id, {})
    case 'tools/list': return rpcResult(id, { tools: TOOLS })
    case 'tools/call': {
      try {
        const text = await callTool(String(params.name || ''), params.arguments || {}, baseUrl)
        return rpcResult(id, { content: [{ type: 'text', text }] })
      } catch (e) {
        return rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true })
      }
    }
    case 'resources/list': return rpcResult(id, { resources: [] })
    case 'prompts/list': return rpcResult(id, { prompts: [] })
    default: return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

/** POST /mcp — JSON-RPC message or batch. Returns { status, body } */
export async function handleMcp(body, baseUrl) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handleMessage(m, baseUrl)))).filter(Boolean)
    return out.length ? { status: 200, body: out } : { status: 202 }
  }
  if (!body || body.jsonrpc !== '2.0') return { status: 400, body: rpcError(null, -32600, 'Invalid request') }
  const out = await handleMessage(body, baseUrl)
  return out ? { status: 200, body: out } : { status: 202 }
}
