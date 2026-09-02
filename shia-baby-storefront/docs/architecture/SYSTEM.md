# Shia & Co. — System Architecture

How the previously separate Shia mini-apps become one manageable system.

## The problem this solves

Three good applications existed with no connective tissue:

| App | Owns | Was missing |
| --- | --- | --- |
| **shia-baby-inventory** | Invoices, cost/retail pricing, SKUs, Square payloads, Code 128 labels | No customer-facing surface |
| **Shia-songs** | Personalized song order intake + admin (Supabase) | Spanish-only, unlinked from any storefront |
| *(none)* | A place customers actually land | — |

Nothing told an advertising agent what was true, what a thing cost, or what it was
allowed to say. This repository is that connective tissue.

## Shape

```text
                         ┌──────────────────────────────┐
   customer ─────────────▶  Storefront  (public/)       │
                         │  bilingual EN/ES             │
                         │  Milestone Club capture      │
                         └──────────┬───────────────────┘
                                    │ POST /api/subscribe
                                    ▼
                         ┌──────────────────────────────┐
                         │  Vercel serverless (api/)    │
                         │  health · catalog · subscribe│
                         │  orders · agent/brief        │
                         └──────────┬───────────────────┘
                                    │
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
        ┌────────────────────┐          ┌────────────────────────┐
        │ src/catalog.js     │          │ src/data-layer.js      │
        │ products + CLAIMS  │          │ Supabase REST          │
        │ (evidence states)  │          │ (degraded fallback)    │
        └─────────┬──────────┘          └───────────┬────────────┘
                  │                                 │
                  │                    ┌────────────┴─────────────┐
                  │                    ▼                          ▼
                  │         shia_subscribers            shia_song_orders
                  │         (this app owns)             (Shia-songs owns —
                  │                                      READ ONLY here)
                  ▼
        ┌───────────────────────┐
        │ /api/agent/brief      │────▶  GARY-001 growth agent
        │ approved vs blocked   │       (builds campaigns from evidence)
        └───────────────────────┘

        /console/  ─── operator view over all of the above
```

## Key design decisions

### 1. The catalog is the single spine
`src/catalog.js` feeds the storefront UI, `/api/catalog`, and GARY-001's brief. Copy
changes happen there, not in HTML, so the page and the advertising agent can never
disagree about price or product.

### 2. Claims carry epistemic state
Every marketing-repeatable statement is tagged `confirmed | proposed | evidence_gap |
placeholder`. Only `confirmed` is advertisable, and `publishable()` enforces it in
code rather than leaving it to an agent's judgement (Invariant 13: mechanics become
code).

This is why the storefront ships **no testimonial section**: no real testimonials
exist, and inventing them would violate Law 4 and Invariant 17.

### 3. Write authority is not shared
`shia_song_orders` is owned by the Shia-songs app. This system reads it for the
console and never writes, satisfying Invariant 7 (no conflicting autonomous
objectives over one mutable resource).

### 4. Degraded mode is reported, not hidden
With no Supabase environment configured the app still serves and still accepts
signups — but `/api/subscribe` returns `persisted: false` and `/api/health` reports
`degraded`. It never claims a write that did not happen.

### 5. No build step
Static HTML plus serverless functions, matching the existing Shia mini-apps. Nothing
to compile, nothing to break in CI, and any agent can edit a file and see the result.

### 6. Shared design tokens
`public/assets/theme.css` lifts the palette from the inventory app (indigo `#24345f`,
cream `#f7f1e8`, gold `#b89b68`) so all three apps read as one product family.

## Health gates

`/api/health` reports four gates (`web`, `catalog`, `agent_surface`, `data_layer`).
The first three are **required**; a failure returns HTTP 503 and must fail a
deployment. `data_layer` is optional so an unconfigured preview still deploys, but it
reports its degradation rather than passing silently.
