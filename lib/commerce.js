// Prices, validation, effects and "next best action" rules.
// Every price shown anywhere (page, cards, agent) is computed here from data/catalog.json,
// so the agent can never invent a number.

import { readFileSync } from 'node:fs'

const root = new URL('../data/', import.meta.url)
export const catalog = JSON.parse(readFileSync(new URL('catalog.json', root), 'utf8'))
export const items = Object.fromEntries(catalog.items.map(i => [i.sku, i]))
export const personas = Object.fromEntries(
  ['laura', 'tom'].map(id => [id, JSON.parse(readFileSync(new URL(`personas/${id}.json`, root), 'utf8'))])
)

const TAKEN_DOMAINS = new Set(['google.com', 'amazon.com', 'facebook.com', 'lunaclay.com', 'tomreed.com', 'photography.com'])

// ───────────────────────── helpers ─────────────────────────

export const eur = n => '€' + (Math.round(n * 100) / 100).toFixed(2)
const round2 = n => Math.round(n * 100) / 100
export function dateIn(days) {
  const d = new Date(Date.now() + days * 86400000)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const clone = o => JSON.parse(JSON.stringify(o))
export const newAccount = personaId => clone(personas[personaId] || personas.laura)

export function planOf(account) { return items[account.plan.sku] }

export function usage(account) {
  const plan = planOf(account)
  const storage = round2(account.sites.reduce((s, x) => s + (x.storageGb || 0), 0))
  const visits = account.sites.reduce((s, x) => s + (x.visits30d || 0), 0)
  return {
    websites: { used: account.sites.length, limit: plan.limits.websites },
    storageGb: { used: storage, limit: plan.limits.storageGb },
    visits: { used: visits, limit: plan.limits.visitsMonthly },
    aiCredits: account.credits.ai,
  }
}
const pct = m => (m.limit ? Math.round((m.used / m.limit) * 100) : 0)

function findSite(account, id) { return account.sites.find(s => s.id === id) }
function ownsDomain(account, name) { return account.domains.some(d => d.name === name) }
function domainOk(name) { return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(com|net|online|shop|store)$/.test(name) }

export function checkDomain(account, rawName) {
  const name = String(rawName || '').trim().toLowerCase()
  if (!domainOk(name)) return { name, available: false, reason: 'Not a valid domain name. Use letters, numbers and hyphens with .com, .net, .online, .shop or .store.' }
  if (ownsDomain(account, name)) return { name, available: false, reason: 'The customer already owns this domain.' }
  if (TAKEN_DOMAINS.has(name)) return { name, available: false, reason: 'Already registered by someone else.' }
  return {
    name,
    available: true,
    options: [
      ...(account.freebies.freeDomain ? [{ sku: 'domain-free', price: 0, note: 'Free for the first year with the plan, then €15.99/year' }] : []),
      { sku: 'domain-com', price: items['domain-com'].price, note: 'First year, then €15.99/year' },
    ],
  }
}

// ───────────────────────── quotes ─────────────────────────

/**
 * Validates an action and prices it. Returns { error } or
 * { card, apply(account) -> summary }.
 */
export function quote(account, params) {
  const p = { ...params }
  const item = items[p.sku]
  if (!item) return { error: `Unknown product "${p.sku}".` }
  const plan = planOf(account)
  const site = p.target_id ? findSite(account, p.target_id) : null
  if (p.target_id && !site && !['email-free', 'email-business', 'email-ai'].includes(p.sku)) {
    return { error: `There is no website with id "${p.target_id}".` }
  }

  const card = { sku: item.sku, title: item.name, subtitle: '', lines: [], dueToday: 0, then: '', bullets: [], confirm: 'Confirm' }
  const termOf = (prices, wanted) => {
    const terms = Object.keys(prices).map(Number)
    const t = Number(wanted || (terms.includes(12) ? 12 : terms[0]))
    return terms.includes(t) ? t : null
  }

  switch (item.kind) {
    case 'plan': {
      if (item.tier <= plan.tier) return { error: `The customer is already on ${plan.name}; ${item.name} is not an upgrade.` }
      // An upgrade keeps the current term and end date, so price it at the new plan's rate for that term.
      const term = item.prices[account.plan.termMonths] ? account.plan.termMonths : termOf(item.prices, p.term_months)
      if (!term) return { error: `${item.name} is sold for ${Object.keys(item.prices).join(', ')} months.` }
      const monthly = item.prices[term]
      const days = account.plan.renewsInDays
      const due = round2(Math.max(0, (monthly - account.plan.monthlyPrice) * (days / 30)))
      card.title = `Upgrade to ${item.name}`
      card.subtitle = `From ${plan.name}`
      card.lines = [
        { label: `Difference for the rest of your current term (${days} days)`, value: eur(due) },
        { label: `${item.name} price`, value: `${eur(monthly)}/mo` },
      ]
      card.dueToday = due
      card.then = `Renews on ${dateIn(days)} at ${eur(item.renewal)}/mo, or lock in ${eur(item.prices[48] || monthly)}/mo by renewing for longer.`
      card.bullets = item.includes.slice(0, 5)
      card.confirm = `Upgrade for ${eur(due)}`
      return {
        card,
        apply: a => {
          a.plan.sku = item.sku
          a.plan.monthlyPrice = monthly
          if (item.features.dailyBackups) a.sites.forEach(s => { s.backups = 'daily' })
          a.credits.ai += item.limits.aiCreditsMonthly
          return `Upgraded to ${item.name} (${eur(due)} charged).`
        },
      }
    }

    case 'renewal': {
      const term = termOf(plan.prices, p.term_months || 24)
      if (!term) return { error: `${plan.name} renews for ${Object.keys(plan.prices).join(', ')} months.` }
      const monthly = plan.prices[term]
      const total = round2(monthly * term)
      const saving = round2((plan.renewal - monthly) * term)
      card.title = `Renew ${plan.name} for ${term} months`
      card.subtitle = `Currently expires ${dateIn(account.plan.renewsInDays)}`
      card.lines = [
        { label: `${eur(monthly)}/mo × ${term} months`, value: eur(total) },
        { label: `Saving vs the standard ${eur(plan.renewal)}/mo`, value: eur(saving) },
      ]
      card.dueToday = total
      card.then = `Your plan then runs until ${dateIn(account.plan.renewsInDays + Math.round(term * 30.42))}.`
      card.bullets = ['Price locked for the whole term', 'Websites, email and domains stay online', '30-day money-back guarantee']
      card.confirm = `Renew for ${eur(total)}`
      return {
        card,
        apply: a => {
          a.plan.renewsInDays += Math.round(term * 30.42)
          a.plan.termMonths = term
          a.plan.monthlyPrice = monthly
          return `Renewed ${plan.name} for ${term} months (${eur(total)}).`
        },
      }
    }

    case 'setting': {
      if (account.plan.autoRenew) return { error: 'Auto-renew is already on.' }
      card.subtitle = `${plan.name} · card ${account.customer.card}`
      card.lines = [{ label: 'Cost now', value: eur(0) }]
      card.then = `On ${dateIn(account.plan.renewsInDays)} the plan renews automatically at ${eur(plan.renewal)}/mo for 12 months. You get a reminder 7 days before and can turn it off any time.`
      card.confirm = 'Turn on auto-renew'
      return { card, apply: a => { a.plan.autoRenew = true; return 'Auto-renew turned on.' } }
    }

    case 'domain': {
      if (item.requires === 'freeDomain' && !account.freebies.freeDomain) return { error: 'The free domain has already been used.' }
      const check = checkDomain(account, p.domain_name)
      if (!check.available) return { error: `${check.name || 'That domain'}: ${check.reason}` }
      if (item.sku === 'domain-com' && !check.name.endsWith('.com')) return { error: 'domain-com is only for .com names.' }
      card.title = item.price === 0 ? `Claim ${check.name} free` : `Register ${check.name}`
      card.subtitle = site ? `and connect it to ${site.name}` : 'Domain registration'
      card.lines = [{ label: 'First year', value: item.price === 0 ? 'Free' : eur(item.price) }]
      card.dueToday = item.price
      card.then = `Renews on ${dateIn(365)} at ${eur(item.renewal)}/year.`
      card.bullets = ['Free WHOIS privacy', 'Free SSL certificate', ...(site ? [`Connected to ${site.name} automatically, usually live within 10 minutes`] : [])]
      card.confirm = item.price === 0 ? 'Claim free domain' : `Register for ${eur(item.price)}`
      return {
        card,
        apply: a => {
          a.domains.push({ id: 'dom-' + (a.domains.length + 1), name: check.name, renewsInDays: 365, autoRenew: true })
          if (item.requires === 'freeDomain') a.freebies.freeDomain = false
          const s = site && findSite(a, site.id)
          if (s) {
            s.domain = check.name
            s.temp = false
            s.diagnostics = (s.diagnostics || []).filter(d => !/temporary|domain/i.test(d))
          }
          return `${item.price === 0 ? 'Claimed' : 'Registered'} ${check.name}${s ? ` and connected it to ${s.name}` : ''}.`
        },
      }
    }

    case 'service': {
      if (!site) return { error: 'target_id (a website id) is required.' }
      if (item.sku === 'site-publish') {
        if (site.status !== 'draft') return { error: `${site.name} is already live.` }
        card.title = `Publish ${site.name}`
        card.subtitle = site.domain
        card.lines = [{ label: 'Cost', value: 'Included' }]
        card.then = site.temp ? 'It goes live on the temporary address. Connect a domain so people can find it on Google.' : 'It goes live on your domain.'
        card.confirm = 'Publish now'
        return {
          card,
          apply: a => {
            const s = findSite(a, site.id)
            s.status = 'online'
            s.diagnostics = (s.diagnostics || []).filter(d => !/draft/i.test(d))
            return `Published ${s.name}.`
          },
        }
      }
      const name = String(p.domain_name || '').toLowerCase()
      if (!ownsDomain(account, name)) return { error: `The customer doesn't own "${name}". Use domain-free or domain-com to get it first.` }
      card.title = `Connect ${name}`
      card.subtitle = `to ${site.name}`
      card.lines = [{ label: 'Cost', value: 'Included' }]
      card.then = 'DNS is updated for you and SSL is issued automatically.'
      card.confirm = 'Connect domain'
      return {
        card,
        apply: a => {
          const s = findSite(a, site.id)
          s.domain = name
          s.temp = false
          s.diagnostics = (s.diagnostics || []).filter(d => !/temporary|domain/i.test(d))
          return `Connected ${name} to ${s.name}.`
        },
      }
    }

    case 'email': {
      if (item.requires === 'freeEmail' && !account.freebies.freeEmail) return { error: 'The free mailbox has already been claimed.' }
      if (!account.domains.length) return { error: 'The customer needs a domain before they can have a mailbox. Offer domain-free or domain-com first.' }
      const domain = String(p.domain_name || account.domains[0].name).toLowerCase()
      if (!ownsDomain(account, domain)) return { error: `The customer doesn't own "${domain}".` }
      const box = String(p.mailbox_name || 'hello').toLowerCase().replace(/@.*/, '')
      if (!/^[a-z0-9._-]{1,32}$/.test(box)) return { error: 'Mailbox name can only use letters, numbers, dots, dashes and underscores.' }
      const address = `${box}@${domain}`
      if (account.mailboxes.some(m => m.address === address)) return { error: `${address} already exists.` }
      const monthly = item.prices ? item.prices[12] : 0
      const total = round2(monthly * 12)
      card.title = item.requires ? `Claim ${address} free` : `Create ${address}`
      card.subtitle = item.name
      card.lines = item.requires
        ? [{ label: 'First year', value: 'Free' }]
        : [{ label: `${eur(monthly)}/mo × 12 months`, value: eur(total) }]
      card.dueToday = total
      card.then = item.requires ? `Then ${eur(item.renewal)}/mo from ${dateIn(365)}.` : `Renews at ${eur(item.renewal)}/mo.`
      card.bullets = item.sku === 'email-ai' ? ['AI drafts replies in your tone', 'Inbox sorted automatically', '10 GB storage'] : ['Works with Gmail, Outlook and phones', 'Spam and virus protection', '10 GB storage']
      card.confirm = item.requires ? 'Claim free mailbox' : `Create for ${eur(total)}`
      return {
        card,
        apply: a => {
          a.mailboxes.push({ address, product: item.name })
          if (item.requires) a.freebies.freeEmail = false
          return `Created mailbox ${address}.`
        },
      }
    }

    case 'feature': {
      if (!site) return { error: 'target_id (a website id) is required.' }
      if (!plan.features.cdn) return { error: `CDN isn't included in ${plan.name}. It comes with Business and Cloud plans — propose plan-business instead.` }
      if (site.cdn) return { error: `CDN is already on for ${site.name}.` }
      card.title = `Turn on CDN for ${site.name}`
      card.subtitle = site.domain
      card.lines = [{ label: 'Cost', value: `Included in ${plan.name}` }]
      card.then = 'Pages and images are served from the location closest to each visitor.'
      card.confirm = 'Turn on CDN'
      return {
        card,
        apply: a => {
          const s = findSite(a, site.id)
          s.cdn = true
          s.speedMobile = Math.min(96, s.speedMobile + 24)
          s.diagnostics = (s.diagnostics || []).filter(d => !/CDN|loads in/i.test(d))
          return `CDN turned on for ${s.name}.`
        },
      }
    }

    case 'addon': {
      if (item.sku === 'backups-daily' && plan.features.dailyBackups) return { error: `Daily backups are already included in ${plan.name}.` }
      if (item.sku === 'email-marketing' && account.marketing.active) return { error: 'Email marketing is already active.' }
      const monthly = item.prices[12]
      const total = round2(monthly * 12)
      card.subtitle = item.description
      card.lines = [{ label: monthly ? `${eur(monthly)}/mo × 12 months` : 'First year', value: monthly ? eur(total) : 'Free' }]
      card.dueToday = total
      card.then = `Renews at ${eur(item.renewal)}/mo.`
      card.confirm = monthly ? `Add for ${eur(total)}` : 'Start free'
      return {
        card,
        apply: a => {
          if (item.sku === 'backups-daily') a.sites.forEach(s => { s.backups = 'daily' })
          if (item.sku === 'email-marketing') a.marketing.active = true
          return `Added ${item.name}.`
        },
      }
    }

    case 'credits': {
      card.subtitle = item.description
      card.lines = [{ label: `${item.credits} credits`, value: eur(item.price) }, { label: 'Balance after', value: `${account.credits.ai + item.credits} credits` }]
      card.dueToday = item.price
      card.then = 'One-off purchase. Credits never expire.'
      card.confirm = `Buy for ${eur(item.price)}`
      return { card, apply: a => { a.credits.ai += item.credits; return `Added ${item.credits} AI credits.` } }
    }

    case 'server': {
      const term = termOf(item.prices, p.term_months)
      if (!term) return { error: `${item.name} is sold for ${Object.keys(item.prices).join(', ')} months.` }
      const total = round2(item.prices[term] * term)
      card.subtitle = item.description
      card.lines = [{ label: `${eur(item.prices[term])}/mo × ${term} months`, value: eur(total) }]
      card.dueToday = total
      card.then = `Renews at ${eur(item.renewal)}/mo.`
      card.confirm = `Order for ${eur(total)}`
      return {
        card,
        apply: a => {
          a.servers.push({ id: 'srv-' + (a.servers.length + 1), name: item.name, status: 'running' })
          return `Ordered ${item.name}.`
        },
      }
    }
  }

  return { error: 'This product cannot be ordered here.' }
}

// ───────────────────────── next best actions ─────────────────────────

/**
 * Ordered recommendations for this account. Each has the reason shown to the
 * customer and the action params (priced through quote()).
 */
export function nextBestActions(account) {
  const out = []
  const plan = planOf(account)
  const u = usage(account)

  for (const s of account.sites.filter(s => s.status === 'draft')) {
    out.push({ id: 'publish-' + s.id, priority: 100, tone: 'urgent', title: `${s.name} isn't live yet`, reason: 'Your website is still a draft, so nobody can see it. Publishing takes one click.', action: { sku: 'site-publish', target_id: s.id } })
  }

  if (!account.plan.autoRenew && account.plan.renewsInDays <= 30) {
    out.push({
      id: 'renew', priority: 95, tone: 'urgent',
      title: `Your hosting expires in ${account.plan.renewsInDays} days`,
      reason: `If it lapses, ${account.sites.length === 1 ? 'your website goes' : `all ${account.sites.length} websites go`} offline on ${dateIn(account.plan.renewsInDays)}. Renewing for 24 months locks in a lower price.`,
      action: { sku: 'renew-plan', term_months: 24 },
      secondary: { label: 'Turn on auto-renew instead', action: { sku: 'autorenew-on' } },
    })
  }

  for (const s of account.sites.filter(s => s.temp)) {
    const sku = account.freebies.freeDomain ? 'domain-free' : 'domain-com'
    out.push({
      id: 'domain-' + s.id, priority: 90, tone: 'important',
      title: `${s.name} can't be found on Google`,
      reason: `It's on a temporary address (${s.domain}). ${account.freebies.freeDomain ? 'Your plan includes a free domain for the first year.' : 'A .com costs ' + eur(items['domain-com'].price) + ' for the first year.'}`,
      action: { sku, target_id: s.id, domain_name: s.suggestedDomain },
    })
  }

  const store = account.sites.find(s => s.orders30d)
  const tight = [pct(u.storageGb), pct(u.visits)].some(x => x >= 80)
  if (tight && plan.tier < 2) {
    out.push({
      id: 'upgrade', priority: 85, tone: 'important',
      title: 'Your store is outgrowing Premium',
      reason: `You're using ${pct(u.storageGb)}% of storage and ${pct(u.visits)}% of monthly visits${store ? `, and ${store.name} takes ${(store.diagnostics || []).find(d => /loads in/.test(d))?.match(/[\d.]+ s/)?.[0] || 'long'} to load on mobile` : ''}. Business adds a free CDN, daily backups and 2x the resources.`,
      action: { sku: 'plan-business', term_months: 12 },
    })
  } else if (store && !store.cdn && plan.features.cdn) {
    out.push({ id: 'cdn-' + store.id, priority: 80, tone: 'important', title: `Speed up ${store.name}`, reason: `Mobile speed score is ${store.speedMobile}/100. The CDN is included in your plan but switched off.`, action: { sku: 'cdn-enable', target_id: store.id } })
  }

  if (account.freebies.freeEmail && account.domains.length && !account.mailboxes.length) {
    out.push({ id: 'email', priority: 70, tone: 'gift', title: `Claim hello@${account.domains[0].name} — free`, reason: 'A mailbox on your own domain looks more trustworthy than Gmail. It\'s included free for the first year.', action: { sku: 'email-free', domain_name: account.domains[0].name, mailbox_name: 'hello' } })
  }

  if (store && !account.marketing.active) {
    out.push({ id: 'marketing', priority: 60, tone: 'gift', title: `Bring back your ${store.orders30d} recent customers`, reason: 'Email marketing is free for the first year: send a newsletter or an automatic "we miss you" offer.', action: { sku: 'email-marketing' } })
  }

  if (account.credits.ai < 20) {
    out.push({ id: 'credits', priority: 50, tone: 'neutral', title: `Only ${account.credits.ai} AI credits left`, reason: 'The AI builder and AI agents stop when credits run out. The 500 pack is 20% cheaper per credit.', action: { sku: 'ai-credits-100' }, secondary: { label: 'Get 500 for ' + eur(items['ai-credits-500'].price), action: { sku: 'ai-credits-500' } } })
  }

  out.sort((a, b) => b.priority - a.priority)
  // Attach the live price so the page can show it.
  return out.map(n => {
    const q = quote(account, n.action)
    return q.error ? null : { ...n, price: q.card.dueToday, priceText: q.card.dueToday ? eur(q.card.dueToday) : 'Free', cta: q.card.confirm }
  }).filter(Boolean)
}

// ───────────────────────── page state ─────────────────────────

export function publicState(account, persona) {
  const plan = planOf(account)
  return {
    persona,
    personas: Object.values(personas).map(p => ({ id: p.id, label: p.label })),
    customer: account.customer,
    plan: {
      name: plan.name, sku: plan.sku, monthlyPrice: account.plan.monthlyPrice, renewal: plan.renewal,
      renewsOn: dateIn(account.plan.renewsInDays), renewsInDays: account.plan.renewsInDays, autoRenew: account.plan.autoRenew,
      features: plan.features,
    },
    usage: usage(account),
    sites: account.sites,
    domains: account.domains.map(d => ({ ...d, renewsOn: dateIn(d.renewsInDays) })),
    mailboxes: account.mailboxes,
    servers: account.servers,
    marketing: account.marketing,
    freebies: account.freebies,
    nba: nextBestActions(account),
  }
}

/** Compact facts for the agent's system prompt. */
export function agentFacts(account) {
  const s = publicState(account, account.id)
  return {
    customer: s.customer.firstName,
    plan: s.plan,
    usage: s.usage,
    freebiesAvailable: s.freebies,
    websites: s.sites.map(x => ({ id: x.id, name: x.name, address: x.domain, onTemporaryAddress: x.temp, status: x.status, platform: x.platform, visitsLast30Days: x.visits30d, visitsTrendPercent: x.visitsTrend, orders30d: x.orders30d, mobileSpeedScore: x.speedMobile, cdn: x.cdn, backups: x.backups, ssl: x.ssl, storageGb: x.storageGb, findings: x.diagnostics })),
    domains: s.domains.map(d => ({ name: d.name, renewsOn: d.renewsOn, autoRenew: d.autoRenew })),
    mailboxes: s.mailboxes.map(m => m.address),
    servers: s.servers,
    emailMarketingActive: s.marketing.active,
    recommendations: s.nba.map(n => ({ title: n.title, reason: n.reason, action: n.action, price: n.priceText })),
  }
}

export function catalogForAgent() {
  return catalog.items.map(i => {
    const o = { sku: i.sku, name: i.name, kind: i.kind }
    if (i.prices) o.monthlyPriceByTermMonths = i.prices
    if (i.price !== undefined) o.price = i.price
    if (i.renewal !== undefined) o.renewal = i.renewal + (i.renewalPeriod ? '/' + i.renewalPeriod : '/month')
    if (i.limits) o.limits = i.limits
    if (i.includes) o.includes = i.includes
    if (i.description) o.description = i.description
    if (i.credits) o.credits = i.credits
    return o
  })
}
