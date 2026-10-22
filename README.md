# Quayside panel — concept demo

A redesigned hosting control-panel home page with a working AI assistant (Claude).
Made-up customer accounts and prices; nothing is ever charged.

- **Recommended for you** — "next best actions" worked out from the account (renewals, temporary domains, plan limits, freebies, credits).
- **Assistant** — Claude answers from the live account data and the price list, and offers products as cards with exact prices. Prices are always calculated by the server from `data/catalog.json`, never by the AI.
- **Cards** — pressing Confirm changes the demo account and the page updates (e.g. claim a domain → the site loses its "temporary address" warning).
- **Demo customers** — switch between Laura (growing store) and Tom (new customer) in the top bar; **Reset** restores the account.

## Run locally

```bash
node server.js            # http://localhost:3000 (no API key = simple demo mode)
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

No dependencies; Node 20+.

## Deploy on Coolify

1. **+ New → Resource → Public repository** (or the GitHub App for a private repo), paste the repo URL, branch `main`.
2. Build pack: **Dockerfile**. Port: **3000**.
3. **Environment variables**
   - `ANTHROPIC_API_KEY` — Claude key (runtime only).
   - optional `ANTHROPIC_MODEL` — default `claude-sonnet-5-5` (e.g. `claude-haiku-5-5` for cheaper).
   - optional `DAILY_CHAT_LIMIT` — total assistant messages per day for all visitors (default 1000).
   - optional `ANTHROPIC_WORKSPACE_ID` — only if the key is not scoped to a workspace.
4. **Domain**: use Coolify's generated sslip.io address, or add an A record (e.g. `panel.yourdomain.com → server IP`) and enter `https://panel.yourdomain.com` in the Domains field.
5. Deploy.

## Editing the demo

- Prices and products: `data/catalog.json`
- Demo customers: `data/personas/*.json`
- Recommendation rules: `nextBestActions()` in `lib/commerce.js`
- Assistant instructions: `systemPrompt()` in `lib/agent.js`

Limits: 25 assistant messages per visitor per 10 minutes, 1,000 characters per message, sessions kept in memory for 6 hours.
