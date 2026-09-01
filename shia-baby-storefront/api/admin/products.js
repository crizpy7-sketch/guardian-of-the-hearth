/**
 * /api/admin/products — product administration. Operator token required.
 *
 *   GET    list every product, published or not, with cost-bearing fields
 *          intact (this is the back office, not the storefront)
 *   POST   import an inventory export from shia-baby-inventory
 *   PATCH  update one product (price, size, category, description, image,
 *          published)
 *
 * IMPORT SAFETY
 * -------------
 * Imported products always land unpublished, and a re-import never flips
 * `published` back on. Nothing reaches customers without a deliberate act.
 */

import { requireOperator, parseBody } from '../../src/auth.js';
import { listAllProducts, upsertProducts, updateProduct } from '../../src/data-layer.js';
import { fromInventoryExport } from '../../src/products.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const denied = requireOperator(req);
  if (denied) return res.status(denied.status).json(denied.body);

  try {
    if (req.method === 'GET') {
      const { products, mode } = await listAllProducts({ limit: req.query?.limit ?? 500 });
      return res.status(200).json({ count: products.length, backend: mode, products });
    }

    if (req.method === 'POST') {
      const { value, error } = parseBody(req);
      if (error) return res.status(400).json({ error });

      const { products, rejected, duplicates } = fromInventoryExport(value);
      if (!products.length) {
        return res.status(400).json({
          error: 'nothing_importable',
          detail: 'No rows had both a name and a retail price.',
          rejected,
        });
      }

      const result = await upsertProducts(products);
      return res.status(200).json({
        ok: true,
        imported: result.written,
        persisted: result.persisted ?? false,
        backend: result.mode,
        // Reported, never silently dropped.
        rejected,
        duplicate_skus: duplicates,
        note: 'Imported products start unpublished. Publish them to show on the storefront.',
      });
    }

    if (req.method === 'PATCH') {
      const { value, error } = parseBody(req);
      if (error) return res.status(400).json({ error });

      const { id, ...patch } = value;
      if (!id) return res.status(400).json({ error: 'id_required' });

      const result = await updateProduct(id, patch);
      if (!result.updated) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ ok: true, ...result });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('admin/products failed:', err.message);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
}
