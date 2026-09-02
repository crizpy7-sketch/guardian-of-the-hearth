/**
 * /api/admin/songs — song order administration. Operator token required.
 *
 *   GET    list recent orders from the Shia-songs intake app
 *   PATCH  set an order's workflow status and internal notes
 *
 * WRITE BOUNDARY
 * --------------
 * PATCH writes exactly two columns — `status` and `internal_notes` — the same
 * pair the Shia-songs admin panel already writes. Customer answers, uploaded
 * photos, and contact details remain owned by that application. Widening this
 * set would put two systems in conflict over one mutable record (Factory
 * Constitution, Invariant 7).
 */

import { requireOperator, parseBody } from '../../src/auth.js';
import { listSongOrders, updateSongOrder, SONG_STATUSES } from '../../src/data-layer.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const denied = requireOperator(req);
  if (denied) return res.status(denied.status).json(denied.body);

  try {
    if (req.method === 'GET') {
      const result = await listSongOrders({ limit: req.query?.limit ?? 50 });
      return res.status(200).json({ ...result, statuses: SONG_STATUSES });
    }

    if (req.method === 'PATCH') {
      const { value, error } = parseBody(req);
      if (error) return res.status(400).json({ error });

      const { id, status, internal_notes } = value;
      if (!id) return res.status(400).json({ error: 'id_required' });
      if (status !== undefined && !SONG_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'invalid_status', allowed: SONG_STATUSES });
      }

      const result = await updateSongOrder(id, { status, internal_notes });
      if (!result.updated) {
        return res.status(result.mode === 'memory' ? 503 : 404).json({
          error: result.mode === 'memory' ? 'backend_not_configured' : 'not_found',
          detail: result.note,
        });
      }
      return res.status(200).json({ ok: true, ...result });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('admin/songs failed:', err.message);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
}
