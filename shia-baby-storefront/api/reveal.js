/**
 * /api/reveal — reveal & experience box orders.
 *
 *   POST                      place an order (public)
 *   GET  ?keeper=<token>      what the secret keeper is being asked (public, tokened)
 *   POST ?keeper=<token>      submit the gender (public, tokened, one-shot)
 *
 * WHY THE KEEPER ROUTES ARE PUBLIC
 * --------------------------------
 * The person who knows the gender is a doctor's office, a sonographer or a
 * friend. They will not have an account and must not need one — any friction
 * here means the secret never arrives and the song cannot be written. The token
 * in the link IS the authorisation: unguessable (192 bits), stored only as a
 * SHA-256 hash, and useful exactly once.
 *
 * WHAT NEVER COMES BACK OUT
 * -------------------------
 * No response on this endpoint contains `secret_gender`. Buyer-facing payloads
 * are built by `toBuyerView()`, an allowlist that does not include it, and the
 * keeper's own confirmation deliberately does not echo the answer back either —
 * an echoed value sits in a browser history and a shared screen.
 */

import { parseBody } from '../src/auth.js';
import {
  validateRevealOrder, buildRevealOrder, toBuyerView, validateSecret,
  needsSecretKeeper, hashToken, REVEAL_KINDS, OUTFIT_SIZES,
} from '../src/reveal.js';
import {
  createRevealOrder, findRevealByKeeperHash, recordRevealSecret,
} from '../src/data-layer.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // A reveal order and a keeper link must never be cached by an intermediary.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const keeperToken = typeof req.query?.keeper === 'string' ? req.query.keeper : null;

  if (keeperToken) {
    return req.method === 'GET'
      ? keeperPrompt(req, res, keeperToken)
      : req.method === 'POST'
        ? keeperSubmit(req, res, keeperToken)
        : methodNotAllowed(res, 'GET, POST');
  }

  if (req.method === 'GET') {
    // The order form's options, so the front end never hardcodes them.
    return res.status(200).json({
      kinds: Object.values(REVEAL_KINDS),
      outfit_sizes: OUTFIT_SIZES,
      note: 'For a gender reveal, the gender is never submitted with the order.',
    });
  }

  if (req.method !== 'POST') return methodNotAllowed(res, 'GET, POST');

  const { value, error } = parseBody(req);
  if (error) return res.status(400).json({ error });

  const problems = validateRevealOrder(value);
  if (problems.length) {
    return res.status(400).json({ error: 'validation_failed', problems });
  }

  try {
    const { row, keeperToken: token } = buildRevealOrder(value);
    const result = await createRevealOrder(row);

    const origin = originOf(req);
    const keeperLink = token && origin
      ? `${origin}/reveal-secret?keeper=${encodeURIComponent(token)}`
      : null;

    return res.status(201).json({
      ok: true,
      order: toBuyerView(result.order ?? row),
      persisted: result.persisted,
      // Returned so the operator console can send it, and so the flow is
      // testable before email delivery exists. It is shown once and never
      // recoverable from storage.
      keeper_link: keeperLink,
      keeper_email: row.keeper_email,
      next_step: needsSecretKeeper(row.kind) && row.status === 'awaiting_secret'
        ? 'Send the keeper link to the person who knows. The song starts once they answer.'
        : 'Order received.',
      ...(result.persisted ? {} : {
        warning: 'Stored in memory only — this order will not survive a restart.',
      }),
    });
  } catch (err) {
    console.error('reveal order failed:', err.message);
    return res.status(502).json({ error: 'order_failed' });
  }
}

/** What the keeper sees when they open their link. */
async function keeperPrompt(req, res, token) {
  const order = await findRevealByKeeperHash(hashToken(token));

  // Same response for an unknown token and a used one, so the endpoint cannot
  // be used to discover which tokens are real.
  if (!order || order.status !== 'awaiting_secret') {
    return res.status(404).json({ error: 'link_not_active' });
  }

  return res.status(200).json({
    ok: true,
    // Only what the keeper needs to know they are answering for the right family.
    asking_for: order.baby_family_name || order.buyer_name,
    reveal_date: order.reveal_date,
    prompt: 'Only you will see this. The family will hear it in their song.',
  });
}

/** Records the secret. One-shot. */
async function keeperSubmit(req, res, token) {
  const { value, error } = parseBody(req);
  if (error) return res.status(400).json({ error });

  const problems = validateSecret(value);
  if (problems.length) return res.status(400).json({ error: 'validation_failed', problems });

  const order = await findRevealByKeeperHash(hashToken(token));
  if (!order || order.status !== 'awaiting_secret') {
    return res.status(404).json({ error: 'link_not_active' });
  }

  const result = await recordRevealSecret(order.id, String(value.gender));
  if (!result.updated) {
    // Lost a race with another submission of the same link.
    return res.status(409).json({ error: 'already_submitted' });
  }

  return res.status(200).json({
    ok: true,
    // Deliberately does not echo the gender back.
    message: 'Thank you — it is safe with us. The family will not see this.',
    persisted: result.persisted !== false,
  });
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return res.status(405).json({ error: 'method_not_allowed' });
}

function originOf(req) {
  const host = req.headers?.['x-forwarded-host'] ?? req.headers?.host;
  if (!host) return null;
  const proto = req.headers?.['x-forwarded-proto'] ?? 'https';
  return `${proto}://${host}`;
}
