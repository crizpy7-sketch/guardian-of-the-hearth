/**
 * Shia & Co. — Reveal & experience boxes.
 *
 * A reveal box is a physical product (box, outfit, keepsake) plus a custom Shia
 * Song, where the song is what announces the baby's gender.
 *
 * THE PROBLEM THIS MODULE EXISTS TO SOLVE
 * ---------------------------------------
 * The buyer usually must not learn the answer. In the common case the parents
 * order the box themselves and the gender is known only to a doctor, a sonographer
 * or the friend holding the sealed envelope. If the gender were an ordinary order
 * field, then:
 *
 *   - the order confirmation would spoil it,
 *   - the order-status page would spoil it,
 *   - a receipt email would spoil it,
 *   - and the product the customer paid for would be destroyed by the system
 *     that sold it to them.
 *
 * So the gender is never part of the order. It is submitted separately by a
 * "secret keeper" through a single-use link, stored apart from the order, and
 * withheld from every buyer-facing surface. `toBuyerView()` is the only shape
 * ever returned to a customer, and it is built by allowlist so a future field
 * cannot leak the answer by being forgotten.
 *
 * The operator CAN see it, because someone has to actually make the song.
 */

import { randomUUID, createHash, randomBytes } from 'node:crypto';

export const REVEAL_KINDS = Object.freeze({
  GENDER_REVEAL: 'gender-reveal',
  RAINBOW_BABY: 'rainbow-baby',
  MILESTONE: 'milestone',
});

/**
 * Only a gender-reveal box carries a secret. A rainbow baby box is personalised
 * but has nothing to hide from the person buying it, so it must not be sent
 * through a secret-keeper flow that would confuse the buyer for no reason.
 */
export function needsSecretKeeper(kind) {
  return kind === REVEAL_KINDS.GENDER_REVEAL;
}

export const REVEAL_STATUSES = Object.freeze([
  'awaiting_secret',   // ordered, gender not yet submitted — song cannot start
  'ready_to_write',    // secret received, song writing can begin
  'song_in_progress',
  'box_packing',
  'shipped',
  'delivered',
  'cancelled',
]);

export const GENDER_VALUES = Object.freeze(['girl', 'boy', 'surprise_other']);

/** Sizes the outfit in the box can be ordered in. */
export const OUTFIT_SIZES = Object.freeze(['newborn', '0-3m', '3-6m', '6-9m', '9-12m']);

/**
 * Validates a reveal order.
 *
 * Deliberately rejects any attempt to submit the gender with the order itself.
 * A well-meaning form change, or a customer pasting it into the notes field,
 * would silently defeat the entire design — so it is caught loudly here rather
 * than quietly stored somewhere it can leak.
 */
export function validateRevealOrder(input) {
  const problems = [];
  if (!input || typeof input !== 'object') return ['payload must be an object'];

  const kind = String(input.kind ?? '');
  if (!Object.values(REVEAL_KINDS).includes(kind)) {
    problems.push(`kind must be one of: ${Object.values(REVEAL_KINDS).join(', ')}`);
  }

  if (!String(input.buyer_name ?? '').trim()) problems.push('buyer_name is required');

  const email = String(input.buyer_email ?? '').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    problems.push('a valid buyer_email is required');
  }

  if (input.outfit_size && !OUTFIT_SIZES.includes(input.outfit_size)) {
    problems.push(`outfit_size must be one of: ${OUTFIT_SIZES.join(', ')}`);
  }

  if (needsSecretKeeper(kind)) {
    const keeperEmail = String(input.keeper_email ?? '').trim();
    if (!keeperEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(keeperEmail)) {
      problems.push('keeper_email is required: someone who already knows the gender must submit it');
    }
    if (keeperEmail && keeperEmail.toLowerCase() === email.toLowerCase()) {
      // Not a hard error — a grandparent may legitimately buy and also know —
      // but the buyer is usually the person being surprised, and silently
      // letting these match is how a surprise gets ruined.
      problems.push(
        'keeper_email matches buyer_email. If you already know the gender, choose the '
        + '"I know the gender myself" option; otherwise give the email of the person who does.',
      );
    }
    if (input.gender !== undefined) {
      problems.push('gender must never be submitted with the order; it is collected separately');
    }
  }

  return problems;
}

/**
 * A single-use secret-keeper token.
 *
 * Only the SHA-256 hash is stored. If the orders table were ever exposed, the
 * hashes could not be replayed as working links. This is the same reason a
 * password is not stored in plaintext, and it costs nothing to do correctly.
 */
export function mintKeeperToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Builds the stored row for a new reveal order. */
export function buildRevealOrder(input) {
  const kind = String(input.kind);
  const secret = needsSecretKeeper(kind) && !input.buyer_knows_gender;
  const { token, tokenHash } = secret ? mintKeeperToken() : { token: null, tokenHash: null };

  const row = {
    id: randomUUID(),
    kind,
    status: secret ? 'awaiting_secret' : 'ready_to_write',
    buyer_name: String(input.buyer_name).trim(),
    buyer_email: String(input.buyer_email).trim().toLowerCase(),
    buyer_phone: String(input.buyer_phone ?? '').trim() || null,
    baby_family_name: String(input.baby_family_name ?? '').trim() || null,
    outfit_size: input.outfit_size ?? null,
    reveal_date: input.reveal_date || null,
    song_notes: String(input.song_notes ?? '').slice(0, 2000) || null,
    keeper_email: secret ? String(input.keeper_email).trim().toLowerCase() : null,
    keeper_token_hash: tokenHash,
    keeper_submitted_at: null,
    // The answer itself. Never selected into a buyer-facing response.
    secret_gender: null,
    square_order_id: input.square_order_id ?? null,
    locale: input.locale === 'es' ? 'es' : 'en',
    created_at: new Date().toISOString(),
  };

  // The raw token is returned once, for the link that goes to the keeper. It is
  // not part of the row and is not recoverable afterwards.
  return { row, keeperToken: token };
}

/**
 * What a customer is allowed to see.
 *
 * Allowlist, and `secret_gender` is not in it. Note that even the *status* is
 * translated: raw `awaiting_secret` would tell an observant buyer whether the
 * keeper has answered yet, which is a small leak but a real one on the day of a
 * party. Buyers see progress, not the mechanism.
 */
export function toBuyerView(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: buyerStatus(row.status),
    buyer_name: row.buyer_name,
    baby_family_name: row.baby_family_name,
    outfit_size: row.outfit_size,
    reveal_date: row.reveal_date,
    created_at: row.created_at,
  };
}

function buyerStatus(status) {
  switch (status) {
    case 'awaiting_secret':
    case 'ready_to_write':
    case 'song_in_progress':
      return 'in_progress';
    case 'box_packing':
      return 'preparing_your_box';
    case 'shipped':
      return 'shipped';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'in_progress';
  }
}

/**
 * What the operator sees. Includes the secret, because the song cannot be
 * written without it.
 */
export function toOperatorView(row) {
  return {
    ...row,
    keeper_token_hash: undefined,   // never useful to display, only to compare
    secret_known: Boolean(row.secret_gender),
  };
}

/** Validates a secret-keeper submission. */
export function validateSecret(input) {
  const problems = [];
  if (!GENDER_VALUES.includes(String(input?.gender ?? ''))) {
    problems.push(`gender must be one of: ${GENDER_VALUES.join(', ')}`);
  }
  return problems;
}

export default {
  REVEAL_KINDS, REVEAL_STATUSES, GENDER_VALUES, OUTFIT_SIZES,
  needsSecretKeeper, validateRevealOrder, buildRevealOrder,
  mintKeeperToken, hashToken, toBuyerView, toOperatorView, validateSecret,
};
