# STATUS — Shia & Co. Storefront

**Version:** 1.0.0 · **Lifecycle:** pre-launch · **Last verified:** 2026-09-01

Per Factory Constitution Law 4 and Invariant 17, this file records only what was
actually observed. Anything unverified is labelled as such.

## Deployment — VERIFIED

| Item | Value |
| --- | --- |
| Vercel project | `shia-baby-storefront` (`prj_8tVxaB0d5XBpMvjhUUAWEDIMBgJO`) |
| Production URL | https://shia-baby-storefront.vercel.app |
| Deployment | `dpl_CEAdro8YPk4H67UNTgNGkJrDFWUZ` — state `READY` |
| Runtime | 5 Node serverless functions + static assets |
| Region | `iad1` |

### Live evidence (fetched from the production alias)

| Route | Result |
| --- | --- |
| `/` | **200** — storefront renders, EN/ES, preview banner present |
| `/console/` | **200** — `x-robots-tag: noindex, nofollow` correctly applied |
| `/assets/theme.css` | **200** — shared design tokens served |
| `/api/health` | **200** — `status: degraded`, all 3 required gates pass |

`/api/health` response:

```json
{
  "status": "degraded", "healthy": true, "degraded": true, "backend": "memory",
  "gates": [
    { "id": "web",           "required": true,  "ok": true },
    { "id": "catalog",       "required": true,  "ok": true, "detail": "5 products" },
    { "id": "agent_surface", "required": true,  "ok": true, "detail": "3 approved / 5 blocked claims" },
    { "id": "data_layer",    "required": false, "ok": true, "degraded": true, "mode": "memory",
      "detail": "Supabase environment not configured." }
  ],
  "failed_required_gates": []
}
```

Security headers observed on responses: `x-content-type-options: nosniff`,
`x-frame-options: SAMEORIGIN`, `referrer-policy: strict-origin-when-cross-origin`,
`strict-transport-security`.

## Tests — VERIFIED

`npm test` → **40 passing, 0 failing** across i18n, agent surface, data layer,
integrity, and security suites.

## Known degraded / not yet done

These are stated plainly rather than hidden:

1. **Data layer is in memory mode.** `SHIA_SUPABASE_URL` / `SHIA_SUPABASE_SERVICE_KEY`
   are not set on the Vercel project, so signups are accepted but **not durably
   stored** (`persisted: false`). Fix: set the env vars and run `docs/schema.sql`.
2. **Console order access is disabled.** `SHIA_CONSOLE_TOKEN` is unset, so
   `/api/orders` fails closed with 503. This is the intended safe default.
3. **The Shia-songs Supabase project is not reachable from this account.** The songs
   app points at project ref `bjnkgxkcbbnbtazelsjs`, which does not appear in the
   Supabase organization available here. Order data cannot be verified end to end
   until that project's URL and a service key are supplied.
4. **Repository home is provisional.** Source currently lives in a subdirectory of
   `guardian-of-the-hearth` because this session's GitHub integration lacks
   repository-creation permission. It belongs in its own `shia-baby-storefront`
   repo, linked to the Vercel project for push-to-deploy.
5. **Deploys were made directly from files**, not from a Git push. Until the repo is
   linked, `APP_BUILD_STANDARD.md` §2 ("GitHub is the source of truth") is only
   partially satisfied.

## Claims status (what GARY-001 may advertise)

**3 of 8 claims confirmed.** Approved: location, bilingual service, existence of the
personalized song product. Blocked: pricing, 48-hour SLA, testimonials, star
ratings, store-open date. See the console's claims ledger for blockers.

## Next actions (owner)

1. Confirm retail pricing → promote `claim-pricing` → flip `LAUNCH_STATE` to `live`.
2. Set Supabase env vars + run `docs/schema.sql` to leave degraded mode.
3. Set `SHIA_CONSOLE_TOKEN` to enable the console's order view.
4. Create the `shia-baby-storefront` GitHub repo and link it to Vercel.
