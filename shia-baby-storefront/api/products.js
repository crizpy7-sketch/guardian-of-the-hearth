/**
 * GET /api/products — the public product catalog.
 *
 * Returns only published, in-stock items, shaped by `toPublicProduct()` so
 * wholesale cost and margin can never reach a customer or a competitor.
 *
 * Supports `?size=`, `?category=`, and `?q=` for the storefront's filters.
 */

import { listPublishedProducts } from '../src/data-layer.js';
import { publicCatalog, SIZES, CATEGORIES } from '../src/products.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const { products, mode } = await listPublishedProducts();
    let visible = publicCatalog(products);

    const { size, category, q } = req.query ?? {};
    if (size && SIZES.includes(size)) visible = visible.filter((p) => p.size === size);
    if (category && CATEGORIES.includes(category)) visible = visible.filter((p) => p.category === category);
    if (q) {
      const needle = String(q).toLowerCase().slice(0, 80);
      visible = visible.filter((p) => p.name.toLowerCase().includes(needle));
    }

    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      schema: 'shia.catalog.products/1',
      count: visible.length,
      // Facets let the storefront build filters without a second request.
      sizes: [...new Set(visible.map((p) => p.size).filter(Boolean))],
      categories: [...new Set(visible.map((p) => p.category))],
      backend: mode,
      products: visible,
    });
  } catch (error) {
    console.error('products fetch failed:', error.message);
    return res.status(502).json({ error: 'catalog_unavailable' });
  }
}
