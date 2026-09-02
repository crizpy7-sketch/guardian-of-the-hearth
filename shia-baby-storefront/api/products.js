/**
 * GET /api/products — the public product catalog, read live from Square.
 *
 * Square is the source of truth. The boutique's register sells from the Square
 * catalog, so a website that served anything else would advertise stock that is
 * not on the shelf and prices that are not being charged.
 *
 * TWO CONDITIONS TO APPEAR HERE
 * -----------------------------
 * An item reaches a customer only when the owner has marked it visible online
 * AND it has stock. `isPubliclySellable()` enforces both. Sold-out and unlisted
 * items are filtered server-side, not hidden with CSS, so they are absent from
 * the payload rather than merely invisible.
 *
 * Wholesale cost cannot appear here at all: Square is never sent the cost
 * figure, and the response is built by allowlist on top of that.
 */

import {
  isSquareConfigured, fetchSellableCatalog, isPubliclySellable, toPublicSquareProduct,
} from '../src/square.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!isSquareConfigured()) {
    // Honest empty state. The shop page renders "nothing here yet" rather than
    // inventing placeholder stock — per Invariant 17, an unconfigured backend
    // reports itself instead of faking a catalog.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      schema: 'shia.catalog.products/2',
      count: 0,
      backend: 'square',
      configured: false,
      detail: 'Square is not connected, so there is no catalog to show yet.',
      sizes: [],
      products: [],
    });
  }

  try {
    const rows = await fetchSellableCatalog();
    let visible = rows.filter(isPubliclySellable).map(toPublicSquareProduct);

    const { size, q } = req.query ?? {};
    if (size) visible = visible.filter((p) => p.size === size);
    if (q) {
      const needle = String(q).toLowerCase().slice(0, 80);
      visible = visible.filter((p) => p.name.toLowerCase().includes(needle));
    }

    visible.sort((a, b) => a.name.localeCompare(b.name));

    // Short cache: stock changes when something sells in the shop, and showing a
    // sold-out item for minutes is worse than an extra call to Square.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      schema: 'shia.catalog.products/2',
      count: visible.length,
      backend: 'square',
      configured: true,
      sizes: [...new Set(visible.map((p) => p.size).filter(Boolean))],
      products: visible,
    });
  } catch (error) {
    console.error('square catalog fetch failed:', error.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'catalog_unavailable', detail: error.message });
  }
}
