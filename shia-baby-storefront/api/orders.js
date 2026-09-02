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
import { requireOperator } from '../src/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Delegated to the shared guard rather than reimplemented here. This route
  // used to carry its own copy of the comparison, which was not updated when
  // `requireOperator()` learned to trim — so the same token the console accepted
  // was rejected here. Two implementations of one security rule will always
  // drift; there is now only one.
  const denied = requireOperator(req);
  if (denied) return res.status(denied.status).json(denied.body);

  try {
    const result = await listSongOrders({ limit: req.query?.limit ?? 25 });
    return res.status(200).json(result);
  } catch (error) {
    console.error('orders fetch failed:', error.message);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
}
