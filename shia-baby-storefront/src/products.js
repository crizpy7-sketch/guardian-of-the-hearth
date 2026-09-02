/**
 * Shia & Co. — Product catalog (the real one).
 *
 * Bridges the Shia Baby Inventory app to the public storefront.
 *
 * THE INVENTORY APP'S MODEL
 * -------------------------
 * shia-baby-inventory keeps rows in browser localStorage under
 * `shiaBabyInventoryState` shaped like:
 *
 *   { id, name, size, cost, retail, sku, gtin, qty, copies, vendor, status, margin }
 *
 * `cost` and `margin` are WHOLESALE figures. Publishing them would expose your
 * buying price and markup to customers and competitors, so `toPublicProduct()`
 * builds an allowlisted object rather than deleting fields from the input — a
 * new inventory field can never leak by being forgotten.
 */

/** Fields that must never reach a public response, for tests to assert against. */
export const PRIVATE_FIELDS = Object.freeze(['cost', 'margin', 'vendor_cost', 'invoice_ref']);

export const SIZES = Object.freeze([
  'newborn', '0-3m', '3-6m', '6-9m', '9-12m', '12-18m', '18-24m', 'one-size',
]);

export const CATEGORIES = Object.freeze([
  'clothing', 'essentials', 'keepsake', 'gift-set', 'blanket', 'accessory', 'other',
]);

/** Money is stored in cents; floats and prices do not mix. */
export function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100);
}

export function formatPrice(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** Normalises a free-text size into one of SIZES, or null when unrecognised. */
export function normaliseSize(raw) {
  const value = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!value) return null;
  if (/^(nb|newborn|recien|reciénnacido)$/.test(value)) return 'newborn';
  if (/^(os|onesize|unitalla)$/.test(value)) return 'one-size';

  // "0-3", "0-3m", "0/3m", "0 a 3 meses" → "0-3m"
  const range = value.match(/(\d{1,2})\D{1,4}(\d{1,2})/);
  if (range) {
    const candidate = `${Number(range[1])}-${Number(range[2])}m`;
    if (SIZES.includes(candidate)) return candidate;
  }
  return SIZES.includes(value) ? value : null;
}

export function guessCategory(name) {
  const text = String(name ?? '').toLowerCase();
  if (/(blanket|cobija|swaddle|manta)/.test(text)) return 'blanket';
  // "box" deliberately excluded here: a "Welcome Home Box" is a gift set, while
  // a "Memory Box" still lands on keepsake via "memory".
  if (/(keepsake|recuerdo|frame|memory)/.test(text)) return 'keepsake';
  if (/(set|bundle|box|caja)/.test(text)) return 'gift-set';
  if (/(bib|hat|sock|shoe|bow|headband|gorro|calcet)/.test(text)) return 'accessory';
  if (/(onesie|footie|romper|gown|outfit|mameluco|pijama|body)/.test(text)) return 'clothing';
  if (/(wipe|diaper|bottle|pañal|toalla)/.test(text)) return 'essentials';
  return 'other';
}

/**
 * Converts one inventory row into a storefront product record.
 * Returns { product, problems } — a row missing a name or retail price cannot
 * be sold and is reported rather than silently dropped.
 */
export function fromInventoryRow(row) {
  const problems = [];
  const name = String(row?.name ?? '').trim();
  if (!name) problems.push('name is required');

  const priceCents = toCents(row?.retail);
  if (priceCents === null || priceCents === 0) problems.push('a retail price is required');

  const sku = String(row?.sku ?? '').trim();
  const qty = Number(row?.qty);

  const product = {
    sku: sku || null,
    gtin: String(row?.gtin ?? '').trim() || null,
    name,
    size: normaliseSize(row?.size),
    category: guessCategory(name),
    price_cents: priceCents,
    currency: 'USD',
    stock: Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : 0,
    vendor: String(row?.vendor ?? '').trim() || null,
    description: null,
    image_url: null,
    // New imports stay unpublished. Nothing reaches the public storefront until
    // a human decides it should (Constitution: approval before external effect).
    published: false,
    source: 'shia-baby-inventory',
  };

  return { product, problems };
}

/**
 * Bulk import from the inventory app's exported state.
 * Accepts the whole `shiaBabyInventoryState` object, a bare array of rows, or
 * `{ items: [...] }` — whichever shape the operator happens to paste.
 */
export function fromInventoryExport(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : [];

  const accepted = [];
  const rejected = [];

  rows.forEach((row, index) => {
    const { product, problems } = fromInventoryRow(row);
    if (problems.length) rejected.push({ index, name: row?.name ?? null, problems });
    else accepted.push(product);
  });

  // Two rows with the same SKU would fight over one catalog record; last wins,
  // and the collision is reported rather than hidden.
  const bySku = new Map();
  const duplicates = [];
  for (const product of accepted) {
    if (product.sku && bySku.has(product.sku)) duplicates.push(product.sku);
    bySku.set(product.sku ?? `__nosku_${bySku.size}`, product);
  }

  return { products: [...bySku.values()], rejected, duplicates };
}

/**
 * Public shape. Built by allowlist so wholesale cost can never leak, even if
 * the inventory app adds fields later.
 */
export function toPublicProduct(product) {
  return {
    id: product.id ?? null,
    sku: product.sku ?? null,
    name: product.name,
    size: product.size ?? null,
    category: product.category ?? 'other',
    price_cents: product.price_cents ?? null,
    price_display: formatPrice(product.price_cents, product.currency ?? 'USD'),
    currency: product.currency ?? 'USD',
    in_stock: Number(product.stock ?? 0) > 0,
    description: product.description ?? null,
    image_url: product.image_url ?? null,
  };
}

export function publicCatalog(products) {
  return products
    .filter((p) => p.published && Number(p.stock ?? 0) > 0)
    .map(toPublicProduct);
}

export default {
  PRIVATE_FIELDS, SIZES, CATEGORIES,
  toCents, formatPrice, normaliseSize, guessCategory,
  fromInventoryRow, fromInventoryExport, toPublicProduct, publicCatalog,
};
