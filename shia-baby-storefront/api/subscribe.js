/**
 * POST /api/subscribe — Milestone Club signup capture.
 *
 * This is the storefront's primary conversion. It records the baby's due date
 * or birthday, which drives the milestone reminder flow (the repeat-revenue
 * engine), and the UTM tags that let GARY-001 attribute a campaign to a real
 * confirmed subscriber rather than to impressions.
 */

import { validateSubscriber, createSubscriber } from '../src/data-layer.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Vercel parses JSON bodies, but a form post or raw string can still arrive.
  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
  }

  const problems = validateSubscriber(payload);
  if (problems.length > 0) {
    return res.status(400).json({ error: 'validation_failed', problems });
  }

  try {
    const result = await createSubscriber(payload);
    return res.status(201).json({
      ok: true,
      // Reported honestly: in degraded mode the row is not durably stored.
      persisted: result.persisted,
      mode: result.mode,
      message:
        result.persisted
          ? 'Subscriber recorded.'
          : 'Accepted in degraded mode — backend not configured, not durably stored.',
    });
  } catch (error) {
    // Never echo credentials or raw backend detail to the client.
    console.error('subscribe failed:', error.message);
    return res.status(502).json({ ok: false, error: 'storage_unavailable' });
  }
}
