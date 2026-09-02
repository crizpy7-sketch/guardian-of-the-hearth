# STATUS — Shia & Co. Storefront

**Version:** 1.1.2 · **Lifecycle:** pre-launch · **Last verified:** 2026-09-02

Per Factory Constitution Law 4 and Invariant 17, this records only what was
actually observed. Anything unverified is labelled as such.

## Deployment — VERIFIED LIVE (v1.1.1)

| Item | Value |
| --- | --- |
| Vercel project | `shia-baby-storefront` (`prj_8tVxaB0d5XBpMvjhUUAWEDIMBgJO`) |
| Production URL | https://shia-baby-storefront.vercel.app |
| Deployment | `dpl_B4n3iMoJjCgE57qUU5zGq7PvJrB4` (READY, 8 lambdas, iad1) |
| Functions | 8 Node serverless functions + static assets |

### Live evidence (fetched from the production alias, 2026-09-02)

| Route | Result |
| --- | --- |
| `/api/health` | **200** — `degraded`, all 3 required gates pass, 5 gates reported |
| `/api/products` | **200** — `count: 0`, `backend: memory` (nothing imported yet) |
| `/api/admin/products` | **401** `unauthorized` with no token — token now configured |

`/api/health` gates: `web` pass · `catalog` pass (5 product lines) ·
`agent_surface` pass (3 approved / 5 blocked claims) · `data_layer` degraded
(Supabase unset) · `admin_console` **pass, no longer degraded**.

The move from 503 to 401 on the admin route is the meaningful change: 503 meant
"no token configured, admin disabled"; 401 means the token is configured and the
request simply did not present it. Unauthenticated access is still refused.

## Fixed in 1.1.1 — the "token rejected" bug

Unlocking the console failed with an unexplained 401 even with the correct
token. Cause was in this repo, not the operator's input: `src/auth.js` compared
the raw `SHIA_CONSOLE_TOKEN` against a value the console had already trimmed
before sending. Pasting a secret into a dashboard field commonly appends a
newline, so the stored value was one byte longer, the constant-time comparison's
length check failed first, and the result was a 401 with no diagnostic.

Both sides are now trimmed before comparison, and the health gate reports when
the stored value carries surrounding whitespace — as this deployment's does,
which is direct confirmation of the diagnosis. Four regression tests in
`tests/admin.test.js` cover it, including that trimming does not weaken the
check (a wrong token is still rejected) and that a whitespace-only value counts
as unconfigured rather than as a valid secret.

## Verified — repository

`npm test` → **65 passing, 0 failing** (i18n, agent surface, data layer,
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
2. **Admin is enabled but has nothing durable behind it.** `SHIA_CONSOLE_TOKEN`
   is set and the console authenticates, but because the data layer is in memory
   mode (item 1), anything imported or edited there is lost on the next cold
   start. The console is usable for verification, not yet for real operating.
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
2. ~~Set `SHIA_CONSOLE_TOKEN` to unlock the console.~~ **Done** — configured and
   verified live on 2026-09-02.
3. Supply the Shia-songs Supabase credentials to connect song orders.
4. Confirm retail pricing → promote `claim-pricing` → flip `LAUNCH_STATE` to `live`.
5. Create the `shia-baby-storefront` GitHub repo and link it to Vercel.
