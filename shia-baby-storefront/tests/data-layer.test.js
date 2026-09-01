/**
 * AC-2 — subscriber capture, including consent integrity and honest reporting
 * of degraded mode.
 *
 * These run without Supabase configured, which is exactly the degraded path we
 * need to prove behaves correctly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSubscriber, createSubscriber, isConfigured, backendMode } from '../src/data-layer.js';

test('test environment is unconfigured, exercising the degraded path', () => {
  assert.equal(isConfigured(), false);
  assert.equal(backendMode(), 'memory');
});

test('valid payload passes validation', () => {
  assert.deepEqual(
    validateSubscriber({ first_name: 'Marisol', email: 'marisol@example.com' }),
    [],
  );
});

test('missing first name and bad email are both reported', () => {
  const problems = validateSubscriber({ first_name: '  ', email: 'not-an-email' });
  assert.equal(problems.length, 2);
});

test('SMS opt-in without a phone number is rejected', () => {
  // Consent integrity: we must never record an SMS opt-in we cannot honour.
  const problems = validateSubscriber({
    first_name: 'Ana',
    email: 'ana@example.com',
    sms_opt_in: true,
  });
  assert.ok(problems.some((p) => p.includes('phone')));
});

test('locale is restricted to the two supported languages', () => {
  const problems = validateSubscriber({
    first_name: 'Ana', email: 'ana@example.com', locale: 'fr',
  });
  assert.ok(problems.some((p) => p.includes('locale')));
});

test('non-object payloads are rejected rather than throwing', () => {
  assert.deepEqual(validateSubscriber(null), ['payload must be an object']);
  assert.deepEqual(validateSubscriber('nope'), ['payload must be an object']);
});

test('degraded write reports persisted:false instead of faking success', async () => {
  const result = await createSubscriber({
    first_name: 'Daniela',
    email: 'Daniela@Example.COM',
    locale: 'es',
  });
  assert.equal(result.stored, true);
  // Invariant 17 — no fake progress. The row is not durably stored here.
  assert.equal(result.persisted, false);
  assert.equal(result.mode, 'memory');
});

test('email is normalised and UTM attribution is captured', async () => {
  const result = await createSubscriber({
    first_name: 'Andrea',
    email: '  Andrea@Example.com ',
    utm_campaign: 'shia-2026-q1-first-song',
    utm_source: 'tiktok',
  });
  assert.equal(result.subscriber.email, 'andrea@example.com');
  assert.equal(result.subscriber.utm_campaign, 'shia-2026-q1-first-song');
  assert.equal(result.subscriber.utm_source, 'tiktok');
});

test('unknown locale falls back to English rather than storing junk', async () => {
  const result = await createSubscriber({
    first_name: 'Sam', email: 'sam@example.com', locale: 'zz',
  });
  assert.equal(result.subscriber.locale, 'en');
});
