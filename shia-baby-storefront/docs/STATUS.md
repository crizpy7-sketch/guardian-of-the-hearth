# STATUS — Shia & Co. Storefront

**Version:** 1.1.0 · **Lifecycle:** pre-launch · **Last verified:** 2026-09-01

Per Factory Constitution Law 4 and Invariant 17, this records only what was
actually observed. Anything unverified is labelled as such.

## Deployment — VERIFIED LIVE (v1.1.0)

| Item | Value |
| --- | --- |
| Vercel project | `shia-baby-storefront` (`prj_8tVxaB0d5XBpMvjhUUAWEDIMBgJO`) |
| Production URL | https://shia-baby-storefront.vercel.app |
| Deployment | `dpl_4WamTkkRoyESvBZ14LGLuaLd39B7` |
| Functions | 8 Node serverless functions + static assets |

### Live evidence (fetched from the production alias)

| Route | Result |
| --- | --- |
| `/api/health` | **200** — `degraded`, all 3 required gates pass, 5 gates reported |
| `/api/products` | **200** — `count: 0`, `backend: memory` (nothing imported yet) |
| `/api/admin/products` | **503** — `console_not_configured`, **fails closed** ✅ |

`/api/health` gates: `web` pass · `catalog` pass (5 product lines) ·
`agent_surface` pass (3 approved / 5 blocked claims) · `data_layer` degraded
(Supabase unset) · `admin_console` degraded (token unset).

The 503 on the admin route is the correct, intended behaviour: with no
`SHIA_CONSOLE_TOKEN` set, no customer order data or wholesale figure is
reachable by anyone.

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

## Previously verified (still serving)

`/` (bilingual storefront, preview banner), `/console/` (with
`x-robots-tag: noindex, nofollow`) and `/assets/theme.css` were each verified
200 on the v1.0.0 deployment and ship unchanged-or-extended in v1.1.0.

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

1. **Data layer is in memory mode.** `SHIA_SUPABASE_URL` /
   `SHIA_SUPABASE_SERVICE_KEY` are unset on Vercel, so signups and products are
   accepted but **not durably stored** (`persisted: false`).
2. **Admin is disabled in production.** `SHIA_CONSOLE_TOKEN` is unset, so admin
   endpoints return 503 by design.
3. **The Shia-songs Supabase project is unreachable from this account.** That app
   points at project ref `bjnkgxkcbbnbtazelsjs`, which is not in the Supabase
   organization available here. Song-order administration cannot be verified
   end to end until its URL and a service key are supplied.
4. **Repository home is provisional.** Source lives in a subdirectory of
   `guardian-of-the-hearth` because this session's GitHub integration lacks
   repository-creation permission.
5. **Deploys are file-direct, not push-to-deploy.** Until the repo is linked to
   the Vercel project, `APP_BUILD_STANDARD.md` §2 is only partially satisfied.
6. **No checkout.** The shop displays and filters products; it does not sell
   them. Payments are out of scope for 1.x.

## Claims status

**3 of 8 claims confirmed.** Approved: location, bilingual service, existence of
the personalized song product. Blocked: pricing, 48-hour SLA, testimonials, star
ratings, store-open date.

## Next actions (owner)

1. Set `SHIA_SUPABASE_URL` + `SHIA_SUPABASE_SERVICE_KEY`, then run
   `docs/schema.sql` (creates `shia_subscribers` and `shia_products`).
2. Set `SHIA_CONSOLE_TOKEN` to unlock the console.
3. Supply the Shia-songs Supabase credentials to connect song orders.
4. Confirm retail pricing → promote `claim-pricing` → flip `LAUNCH_STATE` to `live`.
5. Create the `shia-baby-storefront` GitHub repo and link it to Vercel.
