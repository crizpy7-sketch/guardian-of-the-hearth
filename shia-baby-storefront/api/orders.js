/**
 * GET /api/orders — recent Shia Songs orders, for the operator console.
 *
 * Read-only view of the table owned by the existing Shia-songs application.
 * This system never writes there: two systems must not hold conflicting write
 * authority over one mutable resource (Factory Constitution, Invariant 7).
 *
 * NOTE ON ACCESS
 * --------------
 * This returns customer order data and must not be public. It is gated behind a
 * shared operator token supplied via the SHIA_CONSOLE_TOKEN environment
 * variable. When that variable is unset the endpoint refuses to serve rather
 * than defaulting open.
 */

import { listSongOrders } from '../src/data-layer.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const expected = process.env.SHIA_CONSOLE_TOKEN ?? '';
  if (!expected) {
    // Fail closed: no token configured means no customer data leaves the box.
    return res.status(503).json({
      error: 'console_not_configured',
      detail: 'SHIA_CONSOLE_TOKEN is not set; order access is disabled.',
    });
  }

  const presented = String(req.headers['x-shia-console-token'] ?? '');
  // Length check first so the comparison below is over equal-length strings.
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const result = await listSongOrders({ limit: req.query?.limit ?? 25 });
    return res.status(200).json(result);
  } catch (error) {
    console.error('orders fetch failed:', error.message);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
}

/** Constant-time string comparison, to avoid leaking the token byte by byte. */
function timingSafeEqual(a, b) {
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
