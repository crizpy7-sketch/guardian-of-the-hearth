# Shia & Co. — Storefront System

The connective tissue for the Shia Baby product family: a bilingual customer
storefront, an operator console, and an agent-readable growth surface.

Built to the [Shia App Factory](https://github.com/crizpy7-sketch/Shia-factory)
Canonical App Build & Delivery Standard.

```
public/index.html      Customer storefront (EN/ES)
public/console/        Operator console — health, claims ledger, song orders
public/agent/          Agent surface documentation
api/                   Vercel serverless functions
src/catalog.js         Products + claims ledger  ← the spine
src/agent-surface.js   The brief GARY-001 reads
src/data-layer.js      Supabase over REST, with reported degraded mode
```

## What this connects

| System | Role | Repo |
| --- | --- | --- |
| **Shia Baby Inventory** | Invoices, pricing, SKUs, Square, barcode labels | [`shia-baby-inventory`](https://github.com/crizpy7-sketch/shia-baby-inventory) |
| **Shia Songs** | Personalized song order intake + admin | [`Shia-songs`](https://github.com/crizpy7-sketch/Shia-songs) |
| **GARY-001** | Growth/advertising agent | [`Shia-factory`](https://github.com/crizpy7-sketch/Shia-factory) |

See [`docs/architecture/SYSTEM.md`](docs/architecture/SYSTEM.md) for the diagram.

## Run locally

No build step, no dependencies.

```sh
npm test                      # 40 contract tests
npx serve public              # static preview (API routes need `vercel dev`)
npx vercel dev                # full stack incl. /api
```

## Configure

Copy the variable **names** from `.env.example` into your Vercel project settings.
Real values never belong in this repository.

```
SHIA_SUPABASE_URL           Supabase project URL
SHIA_SUPABASE_SERVICE_KEY   Service role key (server-side only)
SHIA_CONSOLE_TOKEN          Gates /api/orders; unset = access disabled
```

Then apply [`docs/schema.sql`](docs/schema.sql) once to create `shia_subscribers`.
It is additive and idempotent and does not touch the songs app's table.

**Without configuration the app still runs**, in a clearly-reported degraded mode:
signups are accepted in memory and `/api/subscribe` returns `persisted: false`. It
never claims a write that did not happen.

## The evidence rule

Every marketing-repeatable claim in `src/catalog.js` is tagged `confirmed`,
`proposed`, `evidence_gap`, or `placeholder`. **Only `confirmed` may be advertised**,
and `publishable()` enforces that in code.

This is why the storefront ships **no testimonials and no star rating**: none exist
yet. Inventing them would be indistinguishable from real reviews to both a customer
and to an advertising agent reading the page.

To change copy or prices, edit `src/catalog.js` — not the HTML. The page, the API,
and GARY-001's brief all derive from it, so they cannot drift apart.

## Health

`GET /api/health` reports four gates: `web`, `catalog`, `agent_surface` (required)
and `data_layer` (optional, reports degradation). A required-gate failure returns
HTTP 503 so CI fails the deploy rather than reporting a false green.

## Current state

Pre-launch. Pricing and opening date are **not owner-confirmed**, so the storefront
shows a preview banner. See [`docs/STATUS.md`](docs/STATUS.md).
