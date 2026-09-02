# Shia & Co. — Design System & Front-End Handoff

**For whoever redesigns the front end** — a designer, Figma, Lovable, v0, or a
person with an editor. This is the contract: what you may freely change, what
the pages must keep doing, and where every piece of data comes from.

**The short version:** the visual layer is disposable. The API is not. You can
throw away every HTML file in `public/` and rebuild it in any framework, and the
business will keep working — provided the new front end calls the same endpoints
and respects the four rules in *Invariants* below.

---

## 1. Token definitions

**Where:** `public/assets/theme.css`, as CSS custom properties on `:root`. That
is the single source of truth. There is no Style Dictionary, no theme JSON, and
no transformation pipeline — the tokens are consumed directly by the browser.

```css
:root {
  /* Brand */
  --indigo:      #24345f;   /* primary — headings, buttons, brand mark */
  --indigo-soft: #334a7c;   /* primary hover */
  --gold:        #b89b68;   /* accent — CTAs, prices, active states */
  --gold-deep:   #9a7f4e;   /* accent hover, price text */
  --blue:        #aecbeb;   /* soft fill — the "join" band */
  --blue-deep:   #8fb4dc;

  /* Surfaces */
  --cream:       #f7f1e8;   /* page background */
  --cream-deep:  #efe7db;   /* alternating band background */
  --paper:       #fffdf9;   /* card background */
  --line:        #ded8cf;   /* borders, dividers */

  /* Text */
  --ink:         #1e2430;   /* body */
  --muted:       #6d7280;   /* secondary */

  /* Status */
  --ok: #2c6d50;  --warn: #a76b17;  --danger: #a53232;

  /* Shape & depth */
  --radius: 18px;  --radius-sm: 12px;
  --shadow:    0 14px 40px rgba(24,31,50,.10);
  --shadow-lg: 0 26px 70px rgba(24,31,50,.16);

  /* Type */
  --serif: "Cormorant Garamond", Georgia, "Times New Roman", serif;
  --sans:  Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono:  ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

**Palette origin:** lifted from the existing `shia-baby-inventory` app so the
boutique's tools and its storefront look like one business. Changing these is
fine — changing them *inconsistently across the two apps* is what to avoid.

**Type rule:** Cormorant Garamond for headings (`h1,h2,h3,.serif`), Inter for
everything else. The serif carries the "heirloom" feel; body copy in a serif at
small sizes hurts readability, which is why the split exists.

**Spacing:** there is no spacing scale token set. Layout uses `rem` directly and
`clamp()` for fluid type. If you introduce a scale, add it here as tokens rather
than scattering magic numbers.

---

## 2. Component library

**There isn't one, deliberately.** No React, no Vue, no component framework. The
"components" are CSS classes in `theme.css` applied to plain HTML:

| Class | Role |
| --- | --- |
| `.card` | Surface container — padding, radius, shadow, border |
| `.btn` + `.btn-primary` / `.btn-gold` / `.btn-ghost` | Buttons |
| `.field` | Text input, select, textarea |
| `.badge` + `.ok` / `.warn` / `.bad` / `.gold` | Status pills |
| `.notice` + `.ok` / `.warn` / `.danger` | Inline message blocks |
| `.wrap` | Page container — `min(1180px, 92vw)`, centred |
| `.eyebrow` | Small uppercase label above a heading |
| `.muted` / `.hidden` | Utilities |

Page-specific layout lives in a `<style>` block in that page's HTML. Shared
primitives live in `theme.css`. That boundary is the only structural rule.

**No Storybook, no component docs.** This file is the documentation.

**If you rebuild in a framework:** map these classes to components 1:1 and keep
`theme.css` as the token layer. Do not port the classes into Tailwind utilities
scattered through markup — the point of the split is that a colour change is one
edit.

---

## 3. Frameworks, libraries, build

**None. This is the most important architectural fact.**

- **No build step.** No bundler, no transpiler, no `node_modules`. `npm test`
  runs Node's built-in test runner and that is the entire toolchain.
- **No dependencies.** `package.json` has zero `dependencies` and zero
  `devDependencies`. Server code calls `fetch` directly against Square and
  Supabase REST.
- **Runtime:** Vercel serverless functions, Node ≥20, ES modules.
- **Static:** `outputDirectory: public`, `cleanUrls: true`.

**Why:** the boutique's other two apps are single HTML files. A build pipeline
here would mean the owner could not open a file and fix a typo. If you introduce
a framework, you are also introducing a build, a deploy change, and a dependency
tree someone has to maintain — do it knowingly, not by habit.

**External resources:** only Google Fonts. Everything else is first-party.

---

## 4. Asset management

- **Product images come from Square**, not from this repo. `image_url` on a
  product is whatever Square serves. There is no image pipeline, no
  optimisation step, and no CDN configuration of our own — Vercel's edge cache
  and Square's image hosting do that work.
- **Local static assets** live in `public/assets/`. Currently: `theme.css` and
  `barcode.js`.
- **No images are committed.** If a product has no Square image, the shop renders
  a neutral placeholder glyph rather than a broken image.

---

## 5. Icon system

**There is no icon set.** Emoji are used as glyphs (🎀 reveal, 🧺 shop, 🤍
thanks, 🕊️ error). They render everywhere, need no licence, no sprite sheet and
no loading, and they suit a baby boutique better than a line-icon set would.

If you replace them with a real icon set, replace them *everywhere* — a page
mixing emoji and SVG icons looks unfinished.

---

## 6. Styling approach

- **Plain CSS with custom properties.** No CSS Modules, no CSS-in-JS, no
  preprocessor.
- **Global styles:** `theme.css` — a light reset, tokens, and the shared classes.
- **Responsive:** mobile-first via `clamp()` for type and
  `grid-template-columns: repeat(auto-fit, minmax(Npx, 1fr))` for layout, so most
  layouts reflow with no media query at all. Explicit breakpoints appear only
  where a layout genuinely must change (`max-width: 720px`, `640px`, `420px`).
- **Motion:** currently minimal — hover lifts and a loading shimmer. `theme.css`
  honours `prefers-reduced-motion` by cutting all animation to `0.01ms`. **If you
  add motion, keep that block working.** Vestibular-triggered nausea is a real
  accessibility failure, not a preference.

---

## 7. Project structure

```
shia-baby-storefront/
├── api/                  Vercel serverless functions (one file = one route)
│   ├── health.js         Deployment gates
│   ├── products.js       PUBLIC  catalog, read live from Square
│   ├── checkout.js       PUBLIC  cart → Square hosted payment link
│   ├── reveal.js         PUBLIC  reveal orders + secret-keeper flow
│   ├── subscribe.js      PUBLIC  Milestone Club signup
│   ├── catalog.js        PUBLIC  product lines + claims ledger
│   ├── agent/brief.js    PUBLIC  machine-readable brief for the ads agent
│   ├── square/sync.js    OPERATOR invoice → Square catalog + stock
│   └── admin/*.js        OPERATOR back office
├── src/                  Logic. No HTTP, no framework — pure and testable.
│   ├── square.js         Square API client, catalog mapping, checkout
│   ├── reveal.js         Reveal orders + the confidentiality rules
│   ├── barcode.js        Code 128-B encoder
│   ├── auth.js           Operator token guard
│   ├── data-layer.js     Supabase REST + in-memory fallback
│   ├── catalog.js        Claims ledger (what marketing may say)
│   └── agent-surface.js  The ads agent's brief
├── public/               Everything a designer touches
│   ├── index.html            Storefront home
│   ├── shop/index.html       Catalog + cart
│   ├── reveal/index.html     Reveal box ordering
│   ├── reveal-secret.html    Secret-keeper page (tokened, noindex)
│   ├── order-complete.html   Post-payment landing
│   ├── console/index.html    Operator back office
│   ├── console/invoice/      Invoice → Square → barcode labels
│   └── assets/theme.css      All tokens
├── tests/                Node test runner, no framework
└── docs/                 This file, STATUS.md, schema.sql, architecture/
```

**The pattern:** `src/` holds logic with no knowledge of HTTP; `api/` holds thin
handlers that parse a request, call `src/`, and shape a response; `public/` holds
presentation that calls `api/`. A rule that matters should live in `src/` where a
test can reach it — not in a request handler, and never in a page.

---

## 8. The API contract

Everything a front end needs. Full detail in `docs/API.md`.

| Endpoint | Auth | Returns |
| --- | --- | --- |
| `GET /api/products` | public | `{ count, products[], sizes[], configured }` |
| `POST /api/checkout` | public | `{ checkout_url }` — then redirect the browser to it |
| `GET /api/reveal` | public | Order-form options |
| `POST /api/reveal` | public | `{ order, keeper_link }` |
| `GET /api/reveal?keeper=T` | token in URL | `{ asking_for }` |
| `POST /api/reveal?keeper=T` | token in URL | `{ ok }` — never the answer |
| `POST /api/subscribe` | public | `{ ok, persisted }` |
| `GET /api/health` | public | Gate status |

A public product looks like this, and **only** like this:

```json
{
  "id": "SQUARE_VARIATION_ID",
  "sku": "RF-BLU-03",
  "name": "Ribbed Footie — 0-3m",
  "size": "0-3m",
  "price_cents": 2699,
  "price_display": "$26.99",
  "in_stock": true,
  "description": null,
  "image_url": null
}
```

---

## 9. Invariants — break these and you break the business

These are enforced by tests. If your redesign fails the suite, the redesign is
wrong, not the test.

**1. Wholesale cost never reaches a customer.** Public payloads are built by
allowlist (`toPublicSquareProduct`), and cost is never uploaded to Square in the
first place. Do not add a field to a public response without checking what it
carries. *(`tests/square.test.js`)*

**2. The client never sets a price.** The cart holds ids and quantities only.
Prices are re-derived server-side from Square at checkout. If you find yourself
sending an amount from the browser, stop. *(`api/checkout.js`)*

**3. The gender is never shown to the buyer.** Not in a confirmation, not in
order status, not in a receipt, not in a URL. The buyer-facing status does not
even change when the secret arrives, because that alone would leak it. The buyer
paid for a surprise; revealing it destroys the product.
*(`tests/reveal.test.js` — 14 tests exist solely for this)*

**4. Nothing is sold that isn't listed and in stock.** Both conditions, checked
server-side. Filtering with CSS is not filtering. *(`isPubliclySellable`)*

---

## 10. What is safe to change

**Freely:** every file in `public/`. Layout, typography, colour, motion,
copy, page structure, adding pages, swapping the framework. Token *values* in
`theme.css`.

**With care:** token *names* (used across all pages); the `data-agent`
attributes (the ads agent navigates by them — see `public/agent/README.md`);
bilingual EN/ES parity, which is tested (`tests/i18n.test.js`) because a large
share of the highest-value gift buyers in the Rio Grande Valley are
Spanish-first. Spanish is not a translation layer here, it is a first-class
track.

**Do not:** move business rules into the front end; call Square directly from
the browser (the access token is a server secret); remove the
`prefers-reduced-motion` block; weaken any invariant in §9.

---

## 11. Running it

```bash
npm test          # 100+ tests, no install step, ~0.5s
```

There is nothing to build and nothing to install. Open `public/index.html`
against a deployed API, or deploy the whole directory.
