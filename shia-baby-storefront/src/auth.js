/**
 * Operator authentication for the console's admin endpoints.
 *
 * A single shared token, supplied as `SHIA_CONSOLE_TOKEN`. This is deliberately
 * modest: it gates one operator's back office, not a multi-user system. If more
 * than one person ever needs distinct access, replace this with Supabase Auth
 * and the `shia_admins` table the Shia-songs app already uses — do not grow a
 * home-made role system here.
 *
 * FAILS CLOSED
 * ------------
 * With no token configured every admin endpoint refuses to serve. Customer
 * order data and wholesale pricing must never be reachable by default.
 */

/** Constant-time comparison, so the token cannot be guessed byte by byte. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Guards an admin request.
 * Returns null when authorised; otherwise returns { status, body } for the
 * caller to send. Returning rather than writing keeps handlers testable.
 */
export function requireOperator(req) {
  // Trimmed on both sides. Pasting a token into a dashboard field very often
  // carries a trailing newline, which made the stored value one byte longer
  // than the header and produced an unexplained 401. Surrounding whitespace is
  // never meaningful in a shared secret, so it must not decide authentication.
  const expected = (process.env.SHIA_CONSOLE_TOKEN ?? '').trim();
  if (!expected) {
    return {
      status: 503,
      body: {
        error: 'console_not_configured',
        detail: 'SHIA_CONSOLE_TOKEN is not set; admin access is disabled.',
      },
    };
  }

  const presented = String(req.headers?.['x-shia-console-token'] ?? '').trim();
  if (!timingSafeEqual(presented, expected)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  return null;
}

/** Parses a JSON body that may arrive as an object or a raw string. */
export function parseBody(req) {
  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return { error: 'invalid_json' };
    }
  }
  return { value: payload ?? {} };
}

export default { requireOperator, parseBody };
