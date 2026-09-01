/**
 * AC-4 — no fabricated marketing claims may reach the rendered page.
 *
 * This is the test that would have caught the mistake this project nearly made:
 * an earlier draft landing page shipped invented customer testimonials with
 * real-sounding names and cities. Those are indistinguishable from real reviews
 * to a visitor and to an advertising agent scraping the page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile } from './helpers.js';
import { CLAIMS, EVIDENCE } from '../src/catalog.js';

// Strip HTML comments before scanning: comments are not rendered to visitors,
// and the markup deliberately *documents* why there is no testimonial section.
// The guard must stay strict on rendered output rather than be loosened.
const storefront = readRepoFile('public/index.html').replace(/<!--[\s\S]*?-->/g, '');

test('storefront renders no testimonial or review section', () => {
  const forbidden = [/class="quote/i, /testimonial/i, /\breviews?\b\s*<\//i];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(storefront),
      `storefront must not render testimonials/reviews (matched ${pattern})`,
    );
  }
});

test('storefront claims no star rating or review count', () => {
  // e.g. "4.8★", "4.8 stars", "50+ reviews"
  assert.ok(!/\d\.\d\s*(★|stars?)/i.test(storefront), 'no star rating may be claimed');
  assert.ok(!/\d+\+?\s*reviews/i.test(storefront), 'no review count may be claimed');
});

test('storefront uses no fabricated scarcity or urgency', () => {
  const scarcity = [/only \d+ (left|made|remaining)/i, /selling fast/i, /ends tonight/i, /last chance/i];
  for (const pattern of scarcity) {
    assert.ok(!pattern.test(storefront), `no fabricated scarcity (matched ${pattern})`);
  }
});

test('unconfirmed pricing is disclosed by a preview banner', () => {
  const pricingConfirmed = CLAIMS.find((c) => c.id === 'claim-pricing')?.evidence_state === EVIDENCE.CONFIRMED;
  if (pricingConfirmed) return; // Banner may be removed once pricing is confirmed.

  assert.match(storefront, /id="previewBar"/, 'preview banner must exist while pricing is unconfirmed');
  assert.match(storefront, /LAUNCH_STATE\s*=\s*'preview'/, 'launch state must be preview while pricing is unconfirmed');
});

test('JSON-LD omits price offers while pricing is unconfirmed', () => {
  const pricingConfirmed = CLAIMS.find((c) => c.id === 'claim-pricing')?.evidence_state === EVIDENCE.CONFIRMED;
  if (pricingConfirmed) return;

  const ldMatch = storefront.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ldMatch, 'structured data block must exist');
  const ld = JSON.parse(ldMatch[1]);
  assert.ok(!('offers' in ld), 'must not publish unconfirmed prices as structured offers');
});

test('no secret-looking values are committed in tracked source', () => {
  const files = ['public/index.html', 'public/console/index.html', 'src/data-layer.js', '.env.example'];
  // Supabase keys are JWTs; a service key in source is the classic leak.
  const jwtLike = /eyJ[A-Za-z0-9_-]{20,}\./;
  for (const file of files) {
    assert.ok(!jwtLike.test(readRepoFile(file)), `${file} appears to contain a JWT-like secret`);
  }
});

test('.env.example documents names without values', () => {
  const env = readRepoFile('.env.example');
  assert.match(env, /^SHIA_SUPABASE_URL=$/m, 'env example must not carry a real URL');
  assert.match(env, /^SHIA_SUPABASE_SERVICE_KEY=$/m, 'env example must not carry a real key');
});

test('the console is excluded from search indexing', () => {
  const consoleHtml = readRepoFile('public/console/index.html');
  assert.match(consoleHtml, /name="robots"\s+content="noindex/i);
});
