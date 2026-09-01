# STATUS — Shia & Co. Storefront

**Version:** 1.1.0 · **Lifecycle:** pre-launch · **Last updated:** 2026-09-01

Per Factory Constitution Law 4 and Invariant 17, this records only what was
actually observed. Anything unverified is labelled as such.

## ⚠️ Deployed version is behind the repository

| | Version | Contains |
| --- | --- | --- |
| **Repository (this code)** | 1.1.0 | Shop page, product catalog, admin console, admin APIs |
| **Live on Vercel** | 1.0.0 | Storefront, agent surface, subscribe — **no shop, no admin** |

The v1.1.0 deploy was **blocked**: the Vercel `deploy_to_vercel` call returned
`MCP tool call requires approval` on two attempts. Read calls to Vercel succeed,
so this is a write-permission gate on the operator's client, not a Vercel fault.

**To ship v1.1.0:** approve the Vercel deploy tool, then redeploy. Nothing in the
code needs to change.

## Verified — repository

`npm test` → **61 passing, 0 failing** (i18n, agent surface, data layer,
integrity, security, products, admin).

Notable guarantees under test:
- Wholesale `cost` and `margin` never appear in a public product payload
  (`tests/products.test.js`, asserted against the literal value).
- Admin endpoints fail closed when `SHIA_CONSOLE_TOKEN` is unset.
- Song statuses match the Shia-songs admin panel exactly, so the two apps
  cannot drift apart.
- EN/ES dictionaries have identical key sets; every `data-i18n` key resolves.

## Verified — live deployment (v1.0.0)

| Route | Result |
| --- | --- |
| `/` | 200, bilingual, preview banner present |
| `/console/` | 200, `x-robots-tag: noindex, nofollow` |
| `/assets/theme.css` | 200 |
| `/api/health` | 200, `degraded`, 3/3 required gates pass |

`/shop/`, `/api/products`, `/api/admin/*` are **not yet live** — they ship with v1.1.0.

## What v1.1.0 adds

**The shop** (`/shop/`) — full catalog page with search and size/category/price
filters, bilingual, rendering real inventory from `/api/products`. Only
published, in-stock items appear.

**Product pipeline** — `src/products.js` maps inventory rows to sellable
products, normalising the messy size strings invoices actually contain
(`0/3 M`, `NB`, `one size`). Imports always land unpublished; a re-import never
republishes something taken down.

**Operator console** — tabbed back office (overview / products / song orders /
claims). Products can be imported, priced, given an image, and published inline.
Song orders can be filtered and have their status and internal notes updated.
The token lives in `sessionStorage`, so access dies with the tab.

**Inventory bridge** — `shia-baby-inventory` gained a "Publish to storefront"
step (branch `claude/publish-to-storefront`) that POSTs rows straight to
`/api/admin/products`. `cost` and `margin` are excluded from that payload.

## Known degraded / not done

1. **v1.1.0 is not deployed** (see above). This is the only blocker on the shop
   and admin console going live.
2. **Data layer is in memory mode.** `SHIA_SUPABASE_URL` /
   `SHIA_SUPABASE_SERVICE_KEY` are unset on Vercel, so signups and products are
   accepted but **not durably stored** (`persisted: false`).
3. **Admin is disabled in production.** `SHIA_CONSOLE_TOKEN` is unset, so admin
   endpoints return 503 by design.
4. **The Shia-songs Supabase project is unreachable from this account.** That app
   points at project ref `bjnkgxkcbbnbtazelsjs`, which is not in the Supabase
   organization available here. Song-order administration cannot be verified
   end to end until its URL and a service key are supplied.
5. **Repository home is provisional.** Source lives in a subdirectory of
   `guardian-of-the-hearth` because this session's GitHub integration lacks
   repository-creation permission.
6. **Deploys are file-direct, not push-to-deploy.** Until the repo is linked to
   the Vercel project, `APP_BUILD_STANDARD.md` §2 is only partially satisfied.
7. **No checkout.** The shop displays and filters products; it does not sell
   them. Payments are out of scope for 1.x.

## Claims status

**3 of 8 claims confirmed.** Approved: location, bilingual service, existence of
the personalized song product. Blocked: pricing, 48-hour SLA, testimonials, star
ratings, store-open date.

## Next actions (owner)

1. Approve the Vercel deploy tool → redeploy v1.1.0.
2. Set `SHIA_SUPABASE_URL` + `SHIA_SUPABASE_SERVICE_KEY`, then run
   `docs/schema.sql` (creates `shia_subscribers` and `shia_products`).
3. Set `SHIA_CONSOLE_TOKEN` to unlock the console.
4. Supply the Shia-songs Supabase credentials to connect song orders.
5. Confirm retail pricing → promote `claim-pricing` → flip `LAUNCH_STATE` to `live`.
6. Create the `shia-baby-storefront` GitHub repo and link it to Vercel.
