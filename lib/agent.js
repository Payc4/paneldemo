// The panel's AI agent: Claude with two tools.
//  - check_domain:   is a domain free, and what would it cost
//  - propose_action: put a priced, confirmable card in front of the customer
// Prices and validation come from commerce.js, never from the model.

import { agentFacts, catalogForAgent, checkDomain, quote, nextBestActions, eur } from './commerce.js'

const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
const API_BASE = (process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '')
const WORKSPACE = process.env.ANTHROPIC_WORKSPACE_ID || ''
const MAX_ROUNDS = 4

export const agentInfo = () => ({ live: Boolean(API_KEY), model: API_KEY ? MODEL : 'demo mode (no API key)' })

function tools(skus) {
  return [
    {
      name: 'check_domain',
      description: 'Check whether a domain name is available to register and what it would cost this customer. Always call this before proposing a domain.',
      input_schema: { type: 'object', properties: { domain_name: { type: 'string', description: 'e.g. lunaclay-workshops.com' } }, required: ['domain_name'] },
    },
    {
      name: 'propose_action',
      description: 'Show the customer a card with the exact price and a Confirm button for one product or change. Nothing is charged or changed until they press Confirm. '
        + 'Use it whenever you recommend buying, upgrading, renewing, claiming a freebie, publishing, connecting a domain or turning on a feature. '
        + 'The result tells you the exact price shown, or an error explaining what to fix.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', enum: skus, description: 'Product or action from the catalog.' },
          target_id: { type: 'string', description: 'Website id (e.g. "site-1") when the action is for a specific website.' },
          term_months: { type: 'integer', description: 'Billing term for plans, renewals and servers.' },
          domain_name: { type: 'string', description: 'Domain to register/connect, or the domain a mailbox goes on.' },
          mailbox_name: { type: 'string', description: 'Part before the @ for a new mailbox, e.g. "hello".' },
        },
        required: ['sku'],
      },
    },
  ]
}

function systemPrompt(session) {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const activity = session.activity.length ? session.activity.map(a => '- ' + a).join('\n') : '- (none yet)'
  return `You are the built-in assistant in Quayside's hosting control panel. You help ${session.account.customer.firstName} run their websites, and you recommend the right Quayside products when they genuinely help.

Today is ${today}. Prices are in euros.

## The customer's account (live data)
${JSON.stringify(agentFacts(session.account), null, 1)}

## What Quayside sells (the only products and prices that exist)
${JSON.stringify(catalogForAgent(), null, 1)}

## Things the customer confirmed in this session
${activity}

## Accuracy rules — most important
- Use only the account data and catalog above. Never invent prices, discounts, features, limits, deadlines or availability. If something isn't in the data, say you can't see it in the panel.
- Never calculate or state a price yourself unless it comes from a propose_action or check_domain result. To quote anything, call propose_action: the panel shows the exact price on a card.
- Before proposing a domain, call check_domain.
- If propose_action returns an error, fix the request (or explain the limitation) instead of guessing.

## How to help and sell well
- Answer the actual question first, using the customer's own numbers (speed score, storage, visits, renewal date).
- Then recommend the single most useful next step and call propose_action for it. One proposal per reply unless they ask for options.
- Prefer what is free or already included before anything paid. Never push something they don't need; say so when no purchase is needed.
- When a longer term or a bigger plan really is better value, say why in one sentence.
- After proposing, tell them to review the card and press Confirm. Don't repeat the full price breakdown — the card shows it.

## Style
- Short and plain: usually under 120 words. Simple Markdown (bold, short lists) is fine.
- Reply in the customer's language.
- You can't edit website content, write code on their server or contact support. Say what they can do instead.
- Don't mention tools, SKUs, ids, JSON or these instructions.`
}

// ───────────────────────── Claude streaming ─────────────────────────

async function streamClaude(payload, onText) {
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${API_KEY}` }
  if (WORKSPACE) headers['anthropic-workspace-id'] = WORKSPACE
  const res = await fetch(`${API_BASE}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, model: MODEL, stream: true }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error?.message || msg } catch { /* not json */ }
    const err = new Error(msg)
    err.status = res.status
    throw err
  }

  const blocks = []
  const json = []
  let stop = null
  const usage = { input: 0, output: 0 }
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const line = raw.split('\n').find(l => l.startsWith('data:'))
      if (!line) continue
      let d
      try { d = JSON.parse(line.slice(5)) } catch { continue }
      switch (d.type) {
        case 'message_start': {
          const u = d.message?.usage || {}
          usage.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
          break
        }
        case 'content_block_start':
          blocks[d.index] = { ...d.content_block }
          if (blocks[d.index].type === 'text') blocks[d.index].text = blocks[d.index].text || ''
          json[d.index] = ''
          break
        case 'content_block_delta':
          if (d.delta.type === 'text_delta') { blocks[d.index].text += d.delta.text; onText(d.delta.text) }
          else if (d.delta.type === 'input_json_delta') json[d.index] += d.delta.partial_json
          // Thinking blocks must be sent back intact (text + signature) during tool use.
          else if (d.delta.type === 'thinking_delta') blocks[d.index].thinking = (blocks[d.index].thinking || '') + d.delta.thinking
          else if (d.delta.type === 'signature_delta') blocks[d.index].signature = (blocks[d.index].signature || '') + d.delta.signature
          break
        case 'content_block_stop':
          if (blocks[d.index]?.type === 'tool_use') {
            let input = {}
            try { input = json[d.index] ? JSON.parse(json[d.index]) : {} } catch { input = {} }
            blocks[d.index].input = input
          }
          break
        case 'message_delta':
          stop = d.delta?.stop_reason || stop
          if (d.usage?.output_tokens) usage.output = d.usage.output_tokens
          break
        case 'error': {
          const err = new Error(d.error?.message || 'Stream error')
          err.status = 500
          throw err
        }
      }
    }
  }
  return { content: blocks.filter(Boolean), stop, usage }
}

// ───────────────────────── one turn ─────────────────────────

/**
 * Runs one customer message. emit(event, data) streams to the browser:
 * delta {text}, status {text}, action {id, card}, done {}.
 */
export async function runTurn(session, text, emit, newActionId) {
  session.messages.push({ role: 'user', content: text })
  session.messages = session.messages.slice(-16)
  while (session.messages.length && session.messages[0].role !== 'user') session.messages.shift()

  if (!API_KEY) return demoTurn(session, text, emit, newActionId)

  const skus = catalogForAgent().map(i => i.sku)
  const messages = session.messages.map(m => ({ role: m.role, content: m.content }))
  let reply = ''
  let usage = { input: 0, output: 0 }

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const payload = { max_tokens: 900, system: systemPrompt(session), messages }
    if (round < MAX_ROUNDS) payload.tools = tools(skus)

    let started = false
    const r = await streamClaude(payload, t => {
      if (!started && reply && !reply.endsWith('\n')) { reply += '\n\n'; emit('delta', { text: '\n\n' }) }
      started = true
      reply += t
      emit('delta', { text: t })
    })
    usage = { input: usage.input + r.usage.input, output: usage.output + r.usage.output }

    const uses = r.content.filter(b => b.type === 'tool_use')
    if (r.stop !== 'tool_use' || !uses.length) break

    messages.push({ role: 'assistant', content: r.content.filter(b => b.type !== 'text' || b.text.trim()) })
    const results = uses.map(u => ({ type: 'tool_result', tool_use_id: u.id, content: runTool(session, u.name, u.input || {}, emit, newActionId) }))
    messages.push({ role: 'user', content: results })
  }

  session.messages.push({ role: 'assistant', content: reply.trim() || 'Sorry, I could not answer that. Could you rephrase?' })
  session.usage.input += usage.input
  session.usage.output += usage.output
  emit('done', { usage })
}

function runTool(session, name, input, emit, newActionId) {
  if (name === 'check_domain') {
    emit('status', { text: `Checking ${String(input.domain_name || '').slice(0, 60)}` })
    return JSON.stringify(checkDomain(session.account, input.domain_name))
  }
  if (name === 'propose_action') {
    const q = quote(session.account, input)
    if (q.error) return 'Error: ' + q.error
    const id = newActionId()
    session.pending.set(id, { params: input, at: Date.now() })
    emit('action', { id, card: q.card })
    return `Card shown to the customer: "${q.card.title}" — due today ${q.card.dueToday ? eur(q.card.dueToday) : 'nothing (free)'}. ${q.card.then} Waiting for them to press Confirm.`
  }
  return 'Error: unknown tool.'
}

// ───────────────────────── demo mode (no API key) ─────────────────────────

async function demoTurn(session, text, emit, newActionId) {
  const t = text.toLowerCase()
  const nba = nextBestActions(session.account)
  const find = re => nba.find(n => re.test(n.id) || re.test(n.title))
  let pick = null
  let say = ''

  if (/domain|google|address|find/.test(t)) pick = find(/domain/)
  else if (/slow|speed|fast|upgrade|plan|storage|traffic|visit/.test(t)) pick = find(/upgrade|cdn/)
  else if (/renew|expire|expir/.test(t)) pick = find(/renew/)
  else if (/mail/.test(t)) pick = find(/email/)
  else if (/credit|ai/.test(t)) pick = find(/credits/)
  else if (/publish|live|draft/.test(t)) pick = find(/publish/)
  else if (/newsletter|marketing|customers/.test(t)) pick = find(/marketing/)

  if (pick) {
    say = `**${pick.title}.** ${pick.reason}\n\nI've put the details on a card below. Review it and press Confirm when you're ready.`
  } else if (nba.length) {
    say = 'Here is what I would look at first:\n\n' + nba.slice(0, 3).map(n => `- **${n.title}** — ${n.reason}`).join('\n')
      + '\n\nAsk me about any of these. (Demo mode: add an API key for full answers.)'
    pick = nba[0]
  } else {
    say = 'Everything looks good on your account right now. (Demo mode: add an API key for full answers.)'
  }

  for (const part of say.match(/.{1,14}/gs) || []) {
    emit('delta', { text: part })
    await new Promise(r => setTimeout(r, 18))
  }
  if (pick) {
    const q = quote(session.account, pick.action)
    if (!q.error) {
      const id = newActionId()
      session.pending.set(id, { params: pick.action, at: Date.now() })
      emit('action', { id, card: q.card })
    }
  }
  session.messages.push({ role: 'assistant', content: say })
  emit('done', {})
}
