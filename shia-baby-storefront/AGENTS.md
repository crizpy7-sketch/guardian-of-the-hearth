# Shia & Co. Storefront — Agent Instructions

This repository follows the **Shia App Factory Canonical App Build & Delivery Standard**
(`Shia-factory/APP_BUILD_STANDARD.md`) and inherits `Shia-factory/FACTORY_CONSTITUTION.md`.

This file is a map, not an encyclopedia.

## Product outcome

One coherent Shia & Co. system: a bilingual customer storefront, an operator console
that unifies the existing Shia mini-apps, and a machine-readable growth surface that
lets GARY-001 build campaigns from evidence instead of from scraped page text.

## Start here

1. `src/catalog.js` — canonical products **and the claims ledger**. Every externally
   repeatable statement carries an evidence state. Start here before changing copy.
2. `src/agent-surface.js` — what GARY-001 reads (`/api/agent/brief`).
3. `src/data-layer.js` — Supabase over REST, with a reported degraded mode.
4. `docs/architecture/SYSTEM.md` — how the three Shia apps fit together.
5. `docs/ACCEPTANCE_CRITERIA.md` — the definition of done for this app.
6. `docs/STATUS.md` — current verified state.

## Sources of truth

| Question | Authority |
| --- | --- |
| What products/prices exist? | `src/catalog.js` |
| What may an ad claim? | Claims ledger in `src/catalog.js` (`evidence_state`) |
| What is live? | `/api/health` + Vercel deployment evidence |
| Who owns song orders? | The `Shia-songs` app. This repo reads, never writes. |
| Who owns inventory/SKUs? | The `shia-baby-inventory` app. |
| What are the secrets? | Vercel environment variables. Never this repo. |

## The evidence rule (most important rule here)

`src/catalog.js` tags every claim `confirmed`, `proposed`, `evidence_gap`, or
`placeholder`. **Only `confirmed` may appear in outbound advertising.**

- Do not promote a claim to `confirmed` because it sounds right, because a strategy
  document asserted it, or because a model generated it. Promote it when the owner
  confirms it or measurement proves it.
- Never add invented testimonials, review counts, star ratings, scarcity, or
  performance results. The storefront renders no testimonial section for exactly
  this reason.
- Prices are currently `proposed`. The storefront shows a preview banner while that
  is true. Flip `LAUNCH_STATE` in `public/index.html` only after owner confirmation.

## Commands

```sh
npm test          # contract tests over catalog, agent surface, and data layer
curl /api/health  # health gates (see APP_BUILD_STANDARD §7)
```

## Write boundaries

- **May write:** everything in this repository.
- **Read-only:** `shia_song_orders` (owned by Shia-songs).
- **Never write:** production Supabase schema without an additive, idempotent
  migration in `docs/schema.sql`.
- **Never commit:** any secret, key, token, or `.env` file.

## Before declaring DONE

- `npm test` passes.
- `/api/health` returns `healthy` (or `degraded` with the reason stated honestly).
- No claim was promoted to `confirmed` without owner confirmation or measurement.
- Deployment is tied to the intended commit, verified from deployment evidence —
  not inferred from a successful push.

Anything not verified must be labelled unverified.
