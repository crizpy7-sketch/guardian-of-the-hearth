/**
 * GET /api/catalog — products and the claims ledger, with evidence states.
 *
 * Public and cacheable. Consumed by the storefront UI and by GARY-001.
 */

import { buildCatalogResponse } from '../src/agent-surface.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  // Read-only public data; a short cache keeps agent polling cheap.
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json(buildCatalogResponse());
}
