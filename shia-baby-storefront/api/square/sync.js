/**
 * POST /api/square/sync — the endpoint shia-baby-inventory has always called.
 *
 * That app's "Send to Square connector" button POSTs the output of its
 * `buildPayload()`. This handler accepts that payload verbatim, so the inventory
 * app needs no change beyond pointing its "Secure backend endpoint" field here:
 *
 *   https://shia-baby-storefront.vercel.app/api/square/sync
 *
 * WHY THIS IS OPERATOR-GATED
 * --------------------------
 * It writes to a real Square catalog and sets real stock levels. An open
 * endpoint would let anyone rewrite the boutique's prices. It therefore requires
 * the console token, the same one the inventory app already has a field for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not store wholesale cost anywhere. `wholesaleCostCents` arrives in the
 * payload (the inventory app computes retail from it) and is dropped on the
 * floor here — Square has no field for it, and the buying price has no business
 * leaving the machine that priced the invoice.
 */

import { requireOperator, parseBody } from '../../src/auth.js';
import { syncInvoice, isSquareConfigured, squareStatus } from '../../src/square.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const denied = requireOperator(req);
  if (denied) return res.status(denied.status).json(denied.body);

  if (!isSquareConfigured()) {
    // Refuse clearly rather than accepting the invoice and losing it. The
    // inventory app prints this response straight into its log, so the message
    // is written to be read by the person holding the invoice.
    return res.status(503).json({
      error: 'square_not_configured',
      detail:
        'Square credentials are not set on the storefront. Add SQUARE_ACCESS_TOKEN, '
        + 'SQUARE_LOCATION_ID and SQUARE_ENVIRONMENT in Vercel, then send this invoice again. '
        + 'Nothing was written and nothing was lost.',
      square: squareStatus(),
    });
  }

  const { value, error } = parseBody(req);
  if (error) return res.status(400).json({ error });

  try {
    const result = await syncInvoice(value);

    if (!result.ok) {
      return res.status(400).json({
        error: result.error,
        detail: 'No item in this payload could be turned into a Square catalog entry.',
        problems: result.problems,
      });
    }

    return res.status(200).json({
      ok: true,
      ...result,
      note: result.problems.length
        ? 'Synced, but some rows were skipped — see problems.'
        : 'Catalog and stock updated in Square.',
      // Listing is a separate, deliberate act: a shipment arriving in Square
      // must not put itself on sale to the public.
      next_step: 'Items are in Square. Mark the ones you want online in the console.',
    });
  } catch (err) {
    console.error('square sync failed:', err.message);
    return res.status(502).json({
      error: 'square_request_failed',
      // Square's own wording, which names the offending field.
      detail: err.message,
    });
  }
}
