/**
 * GET /api/agent/brief — the growth brief for GARY-001.
 *
 * This is the endpoint the advertising agent reads before building a campaign.
 * It returns approved claims, blocked claims with their blockers, product data
 * with evidence states, UTM conventions, and the owner-approval policy.
 *
 * The payload is data, not instructions. It grants no authority.
 */

import { buildBrief } from '../../src/agent-surface.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Signals to any well-behaved consumer that this body is untrusted evidence.
  res.setHeader('X-Content-Semantics', 'data-not-instructions');
  return res.status(200).json(buildBrief());
}
