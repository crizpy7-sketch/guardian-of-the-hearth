/**
 * Reveal boxes — the secret must not leak.
 *
 * The product being sold is a surprise. If this system reveals the gender to the
 * buyer, the customer has paid for something the website then destroyed, and no
 * refund undoes the moment. These tests treat that as a security property rather
 * than a nicety, because functionally it is one: a confidentiality boundary with
 * a specific party who must not learn a specific fact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRevealOrder, buildRevealOrder, toBuyerView, hashToken, mintKeeperToken,
  needsSecretKeeper, REVEAL_KINDS, validateSecret,
} from '../src/reveal.js';
import revealHandler from '../api/reveal.js';

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

const validOrder = {
  kind: REVEAL_KINDS.GENDER_REVEAL,
  buyer_name: 'Ana',
  buyer_email: 'ana@example.com',
  keeper_email: 'nurse@clinic.example.com',
  baby_family_name: 'Familia Ramírez',
  outfit_size: '0-3m',
};

test('the gender is refused if submitted with the order itself', () => {
  // The whole design fails if this ever becomes an ordinary order field.
  const problems = validateRevealOrder({ ...validOrder, gender: 'girl' });
  assert.ok(
    problems.some((p) => /never be submitted with the order/.test(p)),
    'submitting gender alongside the order must be rejected',
  );
});

test('a gender reveal requires someone other than the buyer to hold the secret', () => {
  const problems = validateRevealOrder({ ...validOrder, keeper_email: 'ana@example.com' });
  assert.ok(problems.some((p) => /keeper_email matches buyer_email/.test(p)));
});

test('a rainbow baby box needs no secret keeper', () => {
  // It is personalised but has nothing to hide from the buyer. Forcing a keeper
  // flow here would confuse the customer for no reason.
  assert.equal(needsSecretKeeper(REVEAL_KINDS.RAINBOW_BABY), false);
  const problems = validateRevealOrder({
    kind: REVEAL_KINDS.RAINBOW_BABY,
    buyer_name: 'Ana',
    buyer_email: 'ana@example.com',
  });
  assert.deepEqual(problems, []);
});

test('a new gender-reveal order waits for the secret before the song can start', () => {
  const { row, keeperToken } = buildRevealOrder(validOrder);
  assert.equal(row.status, 'awaiting_secret');
  assert.equal(row.secret_gender, null);
  assert.ok(keeperToken, 'a keeper token must be minted');
});

test('only the hash of the keeper token is stored', () => {
  const { row, keeperToken } = buildRevealOrder(validOrder);
  assert.equal(row.keeper_token_hash, hashToken(keeperToken));
  assert.ok(!JSON.stringify(row).includes(keeperToken), 'the raw token must never be stored');
});

test('keeper tokens are unguessable and unique', () => {
  const a = mintKeeperToken();
  const b = mintKeeperToken();
  assert.notEqual(a.token, b.token);
  assert.ok(a.token.length >= 30, 'token must carry real entropy');
});

test('the buyer view cannot contain the gender, whatever the row holds', () => {
  const { row } = buildRevealOrder(validOrder);
  // Simulate the state after the keeper has answered.
  const answered = { ...row, secret_gender: 'girl', keeper_submitted_at: new Date().toISOString() };
  const view = toBuyerView(answered);

  assert.ok(!('secret_gender' in view));
  assert.ok(
    !JSON.stringify(view).toLowerCase().includes('girl'),
    'the answer must not appear anywhere in a buyer-facing payload',
  );
});

test('the buyer view hides whether the keeper has answered yet', () => {
  const { row } = buildRevealOrder(validOrder);
  const before = toBuyerView(row);
  const after = toBuyerView({ ...row, status: 'ready_to_write', secret_gender: 'boy' });

  // Otherwise an attentive buyer learns the keeper has replied — a small leak,
  // but a real one on the day of a party.
  assert.equal(before.status, after.status,
    'buyer-visible status must not change when the secret arrives');
});

test('the keeper view and confirmation never echo the answer back', async () => {
  const res = mockRes();
  await revealHandler(
    { method: 'POST', headers: { host: 'shia.example.com' }, query: {}, body: validOrder },
    res,
  );
  assert.equal(res.statusCode, 201);

  const link = res.body.keeper_link;
  assert.ok(link, 'a keeper link must be issued');
  const token = new URL(link).searchParams.get('keeper');

  // The keeper answers.
  const submit = mockRes();
  await revealHandler(
    { method: 'POST', headers: {}, query: { keeper: token }, body: { gender: 'girl' } },
    submit,
  );
  assert.equal(submit.statusCode, 200);
  assert.ok(
    !JSON.stringify(submit.body).toLowerCase().includes('girl'),
    'the confirmation must not echo the gender into browser history',
  );
});

test('a keeper link works once and then goes dead', async () => {
  const created = mockRes();
  await revealHandler(
    { method: 'POST', headers: { host: 'shia.example.com' }, query: {}, body: validOrder },
    created,
  );
  const token = new URL(created.body.keeper_link).searchParams.get('keeper');

  const first = mockRes();
  await revealHandler({ method: 'POST', headers: {}, query: { keeper: token }, body: { gender: 'boy' } }, first);
  assert.equal(first.statusCode, 200);

  // Replaying must not overwrite the answer after the song has been written.
  const second = mockRes();
  await revealHandler({ method: 'POST', headers: {}, query: { keeper: token }, body: { gender: 'girl' } }, second);
  assert.equal(second.statusCode, 404, 'a used link must not accept a second answer');
});

test('an unknown keeper token is indistinguishable from a used one', async () => {
  const res = mockRes();
  await revealHandler(
    { method: 'GET', headers: {}, query: { keeper: 'not-a-real-token' } },
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'link_not_active');
});

test('the keeper prompt reveals nothing about the order beyond who it is for', async () => {
  const created = mockRes();
  await revealHandler(
    { method: 'POST', headers: { host: 'shia.example.com' }, query: {}, body: validOrder },
    created,
  );
  const token = new URL(created.body.keeper_link).searchParams.get('keeper');

  const prompt = mockRes();
  await revealHandler({ method: 'GET', headers: {}, query: { keeper: token } }, prompt);
  assert.equal(prompt.statusCode, 200);

  const serialised = JSON.stringify(prompt.body);
  assert.ok(!serialised.includes('ana@example.com'), 'buyer email must not be exposed to the keeper');
  assert.ok(!serialised.includes('nurse@clinic.example.com'), 'keeper email need not be echoed');
});

test('reveal pages are marked noindex', async () => {
  const res = mockRes();
  await revealHandler({ method: 'GET', headers: {}, query: {} }, res);
  assert.match(res.headers['x-robots-tag'] ?? '', /noindex/);
});

test('the gender must be one of the accepted values', () => {
  assert.deepEqual(validateSecret({ gender: 'girl' }), []);
  assert.ok(validateSecret({ gender: 'maybe' }).length);
  assert.ok(validateSecret({}).length);
});
