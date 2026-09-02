# STATUS — Shia & Co. Storefront

**Version:** 1.2.0 · **Lifecycle:** pre-launch · **Last verified:** 2026-09-02

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

`npm test` → **111 passing, 0 failing** (i18n, agent surface, data layer,
integrity, security, products, admin, square, reveal, barcode, deploy manifest).

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

## What v1.2.0 adds — the shop actually sells

**Square is now the source of truth.** The invented `shia_products` table is no
longer what customers see. `/api/products` reads the live Square catalog and
stock, because the register sells from Square and a website showing anything
else advertises stock that is not on the shelf.

**The connector `shia-baby-inventory` has always called now exists.** That app's
"Send to Square connector" button posts to "a secure backend endpoint you
control" — an endpoint that was never built, so every invoice sync since that app
was written has been a dead end. `POST /api/square/sync` accepts its payload
verbatim; the app needs only its endpoint field pointed here.

**Checkout.** `POST /api/checkout` validates a cart against live Square stock and
returns a Square-hosted payment link. The browser sends ids and quantities only —
every price is re-derived server-side, so a tampered client can ask to buy
something but cannot say what it costs. No card data touches this deployment.

**Reveal & experience boxes** (`/reveal/`) with confidential gender capture. The
buyer never submits the gender and never sees it; a separate single-use link lets
the person who knows submit it. Buyer-facing status does not change when the
secret arrives, because that alone would leak it.

**The invoice → barcode tool moved into the site** (`/console/invoice/`): paste an
invoice, price it by markup, generate SKUs, push to Square, print Code 128
labels. The encoder is the one from `shia-baby-inventory`, now a tested module.

**Design handoff** (`docs/DESIGN_SYSTEM.md`) — tokens, component classes, the API
contract, and the four invariants a redesign must not break.

## What v1.1.0 added

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
6. **Square is not connected yet.** `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID`
   are unset, so `/api/products` returns an empty catalog and `/api/checkout`
   refuses with 503. **This is now the gap that matters most**: everything needed
   to sell is built and tested, and nothing can be sold until these are set.
7. **The Square integration is untested against a real Square account.** The
   catalog mapping, stock counts, visibility flag and checkout are covered by
   unit tests against known payload shapes, but no call has been made to Square
   itself from this session — there are no credentials to make one with. Treat
   the first sandbox sync as the real test.
8. **Reveal orders need Supabase.** Without it they are accepted in memory and
   lost on the next cold start, which for a paid order is worse than useless.

## Claims status

**3 of 8 claims confirmed.** Approved: location, bilingual service, existence of
the personalized song product. Blocked: pricing, 48-hour SLA, testimonials, star
ratings, store-open date.

## Next actions (owner)

1. **Connect Square** — `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`,
   `SQUARE_ENVIRONMENT=sandbox`. Nothing sells until this is done. Start in
   sandbox, run one invoice through `/console/invoice/`, then buy something from
   `/shop/` end to end before switching to production.
2. Set `SHIA_SUPABASE_URL` + `SHIA_SUPABASE_SERVICE_KEY`, then run
   `docs/schema.sql` (creates `shia_subscribers`, `shia_products` and
   `shia_reveal_orders`). Reveal orders are not durable without it.
3. ~~Set `SHIA_CONSOLE_TOKEN` to unlock the console.~~ **Done** — configured and
   verified live on 2026-09-02.
3. Supply the Shia-songs Supabase credentials to connect song orders.
4. Confirm retail pricing → promote `claim-pricing` → flip `LAUNCH_STATE` to `live`.
5. Create the `shia-baby-storefront` GitHub repo and link it to Vercel.
