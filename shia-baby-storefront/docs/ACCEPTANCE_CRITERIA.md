# Acceptance Criteria — Shia & Co. Storefront v1.0.0

Factory Constitution Law 2: work cannot responsibly finish against an undefined
finish line. These are observable and testable.

## AC-1 — Storefront serves bilingually
- [x] `/` renders without a build step.
- [x] EN/ES toggle switches **every** visible string (no untranslated remnants).
- [x] `?lang=es` and a Spanish browser locale both open in Spanish.
- **Evidence:** `tests/i18n.test.js` asserts key parity between the two dictionaries.

## AC-2 — Milestone Club capture works end to end
- [x] `POST /api/subscribe` validates and stores a subscriber.
- [x] Invalid payloads return 400 with specific problems.
- [x] `sms_opt_in` without a phone number is rejected (consent integrity).
- [x] UTM parameters are captured for campaign attribution.
- [x] Degraded mode returns `persisted: false` rather than claiming a false write.
- **Evidence:** `tests/data-layer.test.js`.

## AC-3 — Agent surface is complete and honest
- [x] `GET /api/agent/brief` returns approved claims and blocked claims separately.
- [x] No `proposed`, `evidence_gap`, or `placeholder` claim appears in
      `approved_claims`.
- [x] Campaign registry defines UTM conventions and one primary KPI.
- [x] Policy block states that publishing and spending require owner approval.
- **Evidence:** `tests/agent-surface.test.js`.

## AC-4 — No fabricated marketing claims exist anywhere
- [x] No testimonial, review count, or star rating is rendered by the storefront.
- [x] Unconfirmed pricing is accompanied by a preview banner.
- **Evidence:** `tests/integrity.test.js` greps the built page for forbidden patterns.

## AC-5 — Customer data is not publicly readable
- [x] `/api/orders` requires `x-shia-console-token`.
- [x] With `SHIA_CONSOLE_TOKEN` unset the endpoint fails closed (503), not open.
- [x] Token comparison is constant-time.
- **Evidence:** `tests/security.test.js`.

## AC-6 — Deployment health is provable
- [x] `/api/health` reports per-gate results.
- [x] Required-gate failure returns 503 so CI can fail the deploy.
- [x] Degraded data layer is reported, not hidden.
- **Evidence:** live `curl` against the deployment.

## AC-7 — Factory compliance
- [x] `AGENTS.md`, `CLAUDE.md`, `APP_PROFILE.yaml`, `.env.example` present.
- [x] No secret values committed.
- [x] Migration in `docs/schema.sql` is additive and idempotent.
- [x] Song-order table treated as read-only.

## Out of scope for v1.0.0
- Payments/checkout (no Stripe or Square checkout in this release).
- Real customer authentication.
- Automated milestone email/SMS sending (schema supports it; sender not built).
- Merging the songs order form into the storefront UI (it remains its own app).
