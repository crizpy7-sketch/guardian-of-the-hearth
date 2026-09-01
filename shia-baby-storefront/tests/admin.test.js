/**
 * Admin endpoints — authorisation and write boundaries.
 *
 * These endpoints expose customer orders and wholesale-adjacent data, so the
 * default-closed behaviour is tested before anything else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import adminProducts from '../api/admin/products.js';
import adminSongs from '../api/admin/songs.js';
import publicProducts from '../api/products.js';
import { SONG_STATUSES } from '../src/data-layer.js';

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

const TOKEN = 'operator-token-for-tests';
const authed = (extra = {}) => ({ headers: { 'x-shia-console-token': TOKEN }, query: {}, ...extra });

test.afterEach(() => { delete process.env.SHIA_CONSOLE_TOKEN; });

test('admin products fails closed when no token is configured', async () => {
  delete process.env.SHIA_CONSOLE_TOKEN;
  const res = mockRes();
  await adminProducts({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'console_not_configured');
  assert.ok(!('products' in res.body));
});

test('admin songs fails closed when no token is configured', async () => {
  delete process.env.SHIA_CONSOLE_TOKEN;
  const res = mockRes();
  await adminSongs({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.ok(!('orders' in res.body));
});

test('admin endpoints reject a wrong token', async () => {
  process.env.SHIA_CONSOLE_TOKEN = TOKEN;
  const res = mockRes();
  await adminProducts({ method: 'GET', headers: { 'x-shia-console-token': 'nope' }, query: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('importing an inventory export stores products unpublished', async () => {
  process.env.SHIA_CONSOLE_TOKEN = TOKEN;
  const res = mockRes();
  await adminProducts(authed({
    method: 'POST',
    body: { items: [{ name: 'Ribbed Footie', size: '0-3m', retail: 26.99, sku: 'T-RF-1', qty: 4, cost: 12.5 }] },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.imported, 1);
  assert.match(res.body.note, /unpublished/i);
  // Degraded mode must be reported, not hidden.
  assert.equal(res.body.persisted, false);
});

test('an import with no usable rows is a 400 that explains why', async () => {
  process.env.SHIA_CONSOLE_TOKEN = TOKEN;
  const res = mockRes();
  await adminProducts(authed({ method: 'POST', body: { items: [{ name: 'No price' }] } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'nothing_importable');
  assert.equal(res.body.rejected.length, 1);
});

test('the public product endpoint never requires or leaks a token', async () => {
  const res = mockRes();
  await publicProducts({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.products));
  const serialised = JSON.stringify(res.body);
  assert.ok(!/cost|margin/i.test(serialised), 'public catalog must not mention cost or margin');
});

test('song order status is validated against the songs app vocabulary', async () => {
  process.env.SHIA_CONSOLE_TOKEN = TOKEN;
  const res = mockRes();
  await adminSongs(authed({ method: 'PATCH', body: { id: 1, status: 'shipped' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_status');
  assert.deepEqual(res.body.allowed, SONG_STATUSES);
});

test('song statuses match the Shia-songs admin panel exactly', () => {
  // Drift here would silently split the two apps' workflows.
  assert.deepEqual(SONG_STATUSES, [
    'new', 'reviewing', 'lyrics_in_progress', 'waiting_on_customer',
    'song_in_progress', 'completed', 'delivered', 'cancelled',
  ]);
});

test('song order PATCH requires an id', async () => {
  process.env.SHIA_CONSOLE_TOKEN = TOKEN;
  const res = mockRes();
  await adminSongs(authed({ method: 'PATCH', body: { status: 'new' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'id_required');
});

test('admin endpoints reject unsupported methods', async () => {
  process.env.SHIA_CONSOLE_TOKEN = TOKEN;
  const res = mockRes();
  await adminSongs(authed({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 405);
});
