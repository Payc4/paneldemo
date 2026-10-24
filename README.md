# Quayside panel — concept demo

A redesigned hosting control-panel home page with a working AI assistant (Claude).
Made-up customer accounts and prices; nothing is ever charged.

- **SALE! countdown, Refer & earn, promo carousel** — discount slides with was/now/save prices from the catalog.
- **Your to-dos** — "next best actions" worked out from the account (renewals, temporary domains, plan limits, freebies, credits).
- **Assistant** — Claude answers from the live account data and the price list, and offers products as cards with exact prices. Prices are always calculated by the server from `data/catalog.json`, never by the AI.
- **Cards** — pressing Confirm changes the demo account and the page updates (e.g. claim a domain → the site loses its "temporary address" warning).
- **Demo customers** — switch between Laura (growing store) and Tom (new customer) in the top bar; **Reset** restores the account.

## Versions and the live editor

Each version of the prototype has its own page: **/hpanel1/**, **/hpanel2/**, … (the site root redirects to /hpanel1/).

**/hpanelN/edit** is a password-protected live editor for that version: describe a change in plain words on the left, and Claude edits that version's files while the preview on the right updates. Every change can be undone/redone, and **Save as new version** copies the current state to the next free /hpanelN.

- Claude edits only the version's `index.html`, `styles.css` and `app.js` (never the server). Script edits are syntax-checked before they're saved, so a bad edit can't break the page.
- `public/` is the template. On first start it becomes hpanel1. Versions that have never been edited are refreshed automatically when the template changes on a redeploy; edited versions are left exactly as they are.
- The editor preview doesn't count towards /stats.

### Editing from claude.ai (uses the client's own Claude plan)

The same editing tools are also available as a **claude.ai connector** (remote MCP server at `/mcp`), so changes can be made from a normal Claude chat on the client's Pro/Max plan instead of the API key.

1. In Coolify add `MCP_TOKEN` (a long random secret, runtime variable) and make sure the site has an `https://` address.
2. In claude.ai: **Settings → Connectors → Add custom connector**. URL: `https://<your address>/mcp`. Authentication: request header `Authorization: Bearer <MCP_TOKEN>`. If the app has no header field, use `https://<your address>/mcp/<MCP_TOKEN>` with "No sign in".
3. Open the live preview `https://<your address>/hpanel1/?live=1` next to Claude. It reloads by itself after every change.
4. In a chat, turn the connector on and ask, e.g. "On hpanel1, add a first deals slide about connecting AI tools."

Tools: list_versions, get_outline, search, view, replace, insert, undo, redo, save_as_new_version. Edits made within 3 minutes of each other are one undo step. The editor page's **Use in claude.ai** button shows these steps with the right address.

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
   - `STATS_KEY` — a password for the statistics page (`/stats?key=...`). Without it, /stats is open to anyone.
   - `EDITOR_PASSWORD` — password for the live editor (`/hpanel1/edit`). The editor is off when this isn't set.
   - optional `EDITOR_MODEL` — model for the editor (default: `ANTHROPIC_MODEL`, else `claude-sonnet-5-5`).
   - optional `EDITOR_DAILY_LIMIT` — editor requests per day (default 300).
   - `MCP_TOKEN` — secret for the claude.ai connector at `/mcp`. The connector is off when this isn't set.
4. **Domain**: use Coolify's generated sslip.io address, or add an A record (e.g. `panel.yourdomain.com → server IP`) and enter `https://panel.yourdomain.com` in the Domains field.
5. Deploy.

## Statistics

`/stats?key=STATS_KEY` shows visitors, page loads, assistant messages and, per placement (SALE! banner, each promo slide, each to-do, usage meters, the assistant…): views, clicks, click rate, offers shown, confirmed, declined and the demo "revenue" confirmed cards would have charged. Add `&reset=1` to start counting from zero.

Numbers are saved to `/app/stats/stats.json`. To keep them across redeploys, add a **Persistent Storage** volume in Coolify mounted at `/app/stats`.

Versions are saved in `/app/versions`. **Add a second Persistent Storage volume mounted at `/app/versions`**, otherwise every redeploy resets all versions and editor changes.

## Editing the demo

- Prices and products: `data/catalog.json`
- Demo customers: `data/personas/*.json`
- Recommendation rules: `nextBestActions()` in `lib/commerce.js`
- Assistant instructions: `systemPrompt()` in `lib/agent.js`

Limits: 25 assistant messages per visitor per 10 minutes, 1,000 characters per message, sessions kept in memory for 6 hours.
