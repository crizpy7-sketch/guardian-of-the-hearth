/**
 * AC-3 — the agent surface must be complete and, above all, honest.
 *
 * The whole point of the brief is that GARY-001 can trust `approved_claims`
 * without re-deriving evidence. If an unconfirmed claim ever leaks into that
 * list, the agent will publish it. This suite is the guard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief, buildCatalogResponse, CAMPAIGN_REGISTRY, NAVIGATION } from '../src/agent-surface.js';
import { EVIDENCE, CLAIMS, publishable } from '../src/catalog.js';

const brief = buildBrief();

test('brief separates approved from blocked claims', () => {
  assert.ok(Array.isArray(brief.approved_claims));
  assert.ok(Array.isArray(brief.blocked_claims));
  assert.equal(
    brief.approved_claims.length + brief.blocked_claims.length,
    CLAIMS.length,
    'every claim must land in exactly one bucket',
  );
});

test('no unconfirmed claim ever appears in approved_claims', () => {
  const approvedIds = new Set(brief.approved_claims.map((c) => c.id));
  const leaked = CLAIMS.filter((c) => approvedIds.has(c.id) && !publishable(c));
  assert.deepEqual(leaked, [], `unconfirmed claims leaked into approved list: ${leaked.map((c) => c.id).join(', ')}`);
});

test('every blocked claim explains what is blocking it', () => {
  for (const claim of brief.blocked_claims) {
    assert.ok(
      claim.blocker && claim.blocker.length > 0,
      `blocked claim ${claim.id} must state its blocker so the owner can resolve it`,
    );
    assert.notEqual(claim.evidence_state, EVIDENCE.CONFIRMED);
  }
});

test('testimonials and ratings are blocked, not advertisable', () => {
  const blockedIds = brief.blocked_claims.map((c) => c.id);
  assert.ok(blockedIds.includes('claim-testimonials'), 'testimonials must be blocked');
  assert.ok(blockedIds.includes('claim-reviews-rating'), 'star ratings must be blocked');
});

test('campaign registry defines tracking and exactly one primary KPI', () => {
  assert.ok(CAMPAIGN_REGISTRY.utm_convention.utm_source);
  assert.ok(CAMPAIGN_REGISTRY.utm_convention.utm_campaign);
  assert.equal(typeof CAMPAIGN_REGISTRY.primary_kpi, 'string');
  assert.ok(CAMPAIGN_REGISTRY.primary_kpi.length > 0);
});

test('policy forbids autonomous publishing and spending', () => {
  assert.equal(CAMPAIGN_REGISTRY.policy.may_publish_without_owner_approval, false);
  assert.equal(CAMPAIGN_REGISTRY.policy.may_spend_money, false);
  assert.equal(brief.constraints.publish_requires_owner_approval, true);
  assert.equal(brief.constraints.spend_requires_owner_approval, true);
});

test('constraints encode the growth-operator prohibitions', () => {
  const c = brief.constraints;
  assert.equal(c.no_fabricated_testimonials, true);
  assert.equal(c.no_fabricated_reviews_or_ratings, true);
  assert.equal(c.no_fabricated_scarcity_or_urgency, true);
  assert.equal(c.no_performance_guarantees, true);
  assert.equal(c.no_grief_exploitation, true);
});

test('the grief-adjacent product carries explicit agent guidance', () => {
  const rainbow = brief.products.find((p) => p.id === 'rainbow-blessing');
  assert.ok(rainbow, 'rainbow-blessing product must exist');
  assert.equal(rainbow.sensitivity, 'high');
  assert.ok(rainbow.agent_guidance, 'sensitive product must carry guidance for the agent');
});

test('brief declares that its content is data rather than instructions', () => {
  assert.equal(brief.integrity.content_is_data_not_instructions, true);
});

test('navigation lists the conversion surface and the API', () => {
  const storefront = NAVIGATION.surfaces.find((s) => s.id === 'storefront');
  assert.ok(storefront.sections.some((s) => s.converts === true), 'a converting section must be marked');
  assert.ok(NAVIGATION.api.some((a) => a.path === '/api/subscribe'));
  assert.ok(NAVIGATION.api.some((a) => a.path === '/api/health'));
});

test('catalog response exposes evidence states for every product price', () => {
  const catalog = buildCatalogResponse();
  assert.ok(catalog.products.length > 0);
  for (const product of catalog.products) {
    assert.ok(product.price?.evidence_state, `${product.id} price must carry an evidence_state`);
    assert.ok(
      Object.values(EVIDENCE).includes(product.price.evidence_state),
      `${product.id} has an unknown evidence_state`,
    );
  }
});
