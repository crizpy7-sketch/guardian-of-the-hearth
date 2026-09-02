/**
 * AC-5 — customer order data must never be publicly readable.
 *
 * `/api/admin/songs` exposes real customer song orders. The dangerous failure
 * mode is defaulting open when the token env var is missing, so that case is
 * tested first and explicitly.
 *
 * These tests previously ran against `/api/orders`, a legacy alias that carried
 * its own copy of the token comparison. That copy drifted out of sync with the
 * shared guard and rejected tokens the console accepted, so the route was
 * deleted rather than kept in step. The guarantees moved here with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import ordersHandler from '../api/admin/songs.js';
import subscribeHandler from '../api/subscribe.js';

/** Minimal Vercel-style response recorder. */
function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('orders endpoint fails closed when no console token is configured', async () => {
  delete process.env.SHIA_CONSOLE_TOKEN;
  const res = mockRes();
  await ordersHandler({ method: 'GET', headers: {}, query: {} }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'console_not_configured');
  assert.ok(!('orders' in res.body), 'no order data may be returned when unconfigured');
});

test('orders endpoint rejects a missing or wrong token', async () => {
  process.env.SHIA_CONSOLE_TOKEN = 'correct-horse-battery-staple';

  const noToken = mockRes();
  await ordersHandler({ method: 'GET', headers: {}, query: {} }, noToken);
  assert.equal(noToken.statusCode, 401);

  const wrongToken = mockRes();
  await ordersHandler(
    { method: 'GET', headers: { 'x-shia-console-token': 'wrong-token-same-len!!' }, query: {} },
    wrongToken,
  );
  assert.equal(wrongToken.statusCode, 401);
  assert.ok(!('orders' in (wrongToken.body ?? {})));

  delete process.env.SHIA_CONSOLE_TOKEN;
});

test('orders endpoint rejects unsupported methods', async () => {
  process.env.SHIA_CONSOLE_TOKEN = 'token';
  const res = mockRes();
  await ordersHandler(
    { method: 'DELETE', headers: { 'x-shia-console-token': 'token' }, query: {} },
    res,
  );
  assert.equal(res.statusCode, 405);
  delete process.env.SHIA_CONSOLE_TOKEN;
});

test('subscribe endpoint rejects non-POST methods', async () => {
  const res = mockRes();
  await subscribeHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('subscribe endpoint returns field-level problems for invalid input', async () => {
  const res = mockRes();
  await subscribeHandler({ method: 'POST', headers: {}, body: { email: 'bad' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'validation_failed');
  assert.ok(Array.isArray(res.body.problems) && res.body.problems.length > 0);
});

test('subscribe endpoint handles a raw JSON string body', async () => {
  const res = mockRes();
  await subscribeHandler(
    { method: 'POST', headers: {}, body: JSON.stringify({ first_name: 'Ana', email: 'ana@example.com' }) },
    res,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  // Honest reporting in degraded mode.
  assert.equal(res.body.persisted, false);
});

test('subscribe endpoint rejects malformed JSON without throwing', async () => {
  const res = mockRes();
  await subscribeHandler({ method: 'POST', headers: {}, body: '{ not json' }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_json');
});

test('no endpoint sets a permissive CORS header on customer data', async () => {
  process.env.SHIA_CONSOLE_TOKEN = 'token';
  const res = mockRes();
  await ordersHandler({ method: 'GET', headers: {}, query: {} }, res);
  assert.notEqual(res.headers['access-control-allow-origin'], '*');
  delete process.env.SHIA_CONSOLE_TOKEN;
});

test('checkout refuses to sell when Square is not connected', async () => {
  // Failing closed matters more here than anywhere: the alternative is taking
  // an order the boutique has no record of and cannot fulfil.
  const { default: checkoutHandler } = await import('../api/checkout.js');
  const res = mockRes();
  await checkoutHandler(
    { method: 'POST', headers: {}, query: {}, body: { items: [{ id: 'x', quantity: 1 }] } },
    res,
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'checkout_unavailable');
});

test('the Square invoice sync is operator-gated and fails closed', async () => {
  // An open sync endpoint would let anyone rewrite the boutique's prices.
  delete process.env.SHIA_CONSOLE_TOKEN;
  const { default: syncHandler } = await import('../api/square/sync.js');
  const res = mockRes();
  await syncHandler({ method: 'POST', headers: {}, query: {}, body: { items: [] } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'console_not_configured');
});
