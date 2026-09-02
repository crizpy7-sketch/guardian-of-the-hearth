/**
 * POST /api/checkout — turn a cart into a Square-hosted payment page.
 *
 * This is the endpoint that makes the site a shop rather than a brochure.
 *
 * THE CLIENT NEVER SETS A PRICE
 * -----------------------------
 * The request carries only `{ id, quantity }` pairs. Every price, name and
 * availability check is re-derived here from the live Square catalog, and the
 * order Square builds references `catalog_object_id` — so Square itself prices
 * the line. A tampered browser can ask to buy something; it cannot say what that
 * something costs. Trusting a client-supplied price is the single most common
 * way a storefront gets robbed, and there is no reason to accept one.
 *
 * STOCK IS CHECKED BEFORE TAKING MONEY
 * ------------------------------------
 * Selling something that is not on the shelf costs a refund, an apology and a
 * customer. The cart is validated against current counts and refuses with a
 * specific message naming the item, rather than a generic failure.
 *
 * CARD DATA NEVER TOUCHES THIS DEPLOYMENT
 * ---------------------------------------
 * The response is a redirect URL on Square's own domain. No card number, CVV or
 * expiry is seen, logged or stored here, which is why this design carries no PCI
 * obligation for the boutique beyond what Square already handles.
 */

import {
  isSquareConfigured, fetchSellableCatalog, isPubliclySellable, createCheckout, formatMoney,
} from '../src/square.js';
import { parseBody } from '../src/auth.js';

/** Hard ceiling per line. A typo of 9999 should not create a five-figure order. */
const MAX_QUANTITY_PER_LINE = 20;
const MAX_LINES = 40;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!isSquareConfigured()) {
    return res.status(503).json({
      error: 'checkout_unavailable',
      detail: 'The shop is not connected to Square yet, so orders cannot be taken.',
    });
  }

  const { value, error } = parseBody(req);
  if (error) return res.status(400).json({ error });

  const items = Array.isArray(value?.items) ? value.items : [];
  if (!items.length) return res.status(400).json({ error: 'empty_cart' });
  if (items.length > MAX_LINES) return res.status(400).json({ error: 'cart_too_large' });

  try {
    const catalog = await fetchSellableCatalog();
    const byId = new Map(catalog.map((row) => [row.square_variation_id, row]));

    const lineItems = [];
    const rejected = [];

    for (const requested of items) {
      const id = String(requested?.id ?? '');
      const quantity = Math.trunc(Number(requested?.quantity) || 0);
      const row = byId.get(id);

      if (!row || !isPubliclySellable(row)) {
        // Covers unknown ids, unlisted items and anything out of stock. The
        // message stays vague about *why* an unknown id failed, so this endpoint
        // is not a probe for what exists in the catalog.
        rejected.push({ id, reason: 'unavailable', name: row?.name ?? null });
        continue;
      }
      if (quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
        rejected.push({ id, name: row.name, reason: 'invalid_quantity' });
        continue;
      }
      if (quantity > row.stock) {
        rejected.push({
          id,
          name: row.name,
          reason: 'insufficient_stock',
          available: row.stock,
        });
        continue;
      }

      lineItems.push({ square_variation_id: id, quantity });
    }

    if (!lineItems.length) {
      return res.status(409).json({
        error: 'nothing_purchasable',
        detail: 'Nothing in this cart can be bought right now.',
        rejected,
      });
    }

    // A partly-unavailable cart stops rather than quietly charging for less than
    // the customer chose. They decide what to do about the missing item.
    if (rejected.length) {
      return res.status(409).json({
        error: 'cart_changed',
        detail: 'Some items are no longer available. Your cart was not charged.',
        rejected,
      });
    }

    const origin = originOf(req);
    const checkout = await createCheckout({
      lineItems,
      redirectUrl: origin ? `${origin}/order-complete` : undefined,
      buyerEmail: typeof value.email === 'string' ? value.email.trim().slice(0, 254) : undefined,
      note: value.reference,
    });

    if (!checkout.url) {
      throw new Error('Square returned no payment link URL');
    }

    return res.status(200).json({
      ok: true,
      checkout_url: checkout.url,
      order_id: checkout.order_id,
      // Echoed for the confirmation UI, priced from the server's own figures.
      total_display: formatMoney(
        lineItems.reduce((sum, line) => {
          const row = byId.get(line.square_variation_id);
          return sum + (row.price_cents * line.quantity);
        }, 0),
      ),
    });
  } catch (err) {
    console.error('checkout failed:', err.message);
    return res.status(502).json({ error: 'checkout_failed', detail: err.message });
  }
}

/**
 * The deployment's own origin, for Square's post-payment redirect.
 * Built from request headers rather than hardcoded so preview deployments send
 * customers back to the preview, not to production.
 */
function originOf(req) {
  const host = req.headers?.['x-forwarded-host'] ?? req.headers?.host;
  if (!host) return null;
  const proto = req.headers?.['x-forwarded-proto'] ?? 'https';
  return `${proto}://${host}`;
}
