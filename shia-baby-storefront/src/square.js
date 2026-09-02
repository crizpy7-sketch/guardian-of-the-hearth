/**
 * Shia & Co. — Square connector.
 *
 * THIS IS THE BACKEND shia-baby-inventory HAS ALWAYS POINTED AT
 * ------------------------------------------------------------
 * That app's "3. Square-ready sync" card asks for "a secure backend endpoint
 * you control" and warns, correctly, that a Square access token must never sit
 * in a browser HTML file. It then POSTs a fully-formed payload to that endpoint.
 * The endpoint did not exist, so every invoice sync has been a dead end. This
 * module is that endpoint's implementation, and it accepts the payload
 * `buildPayload()` already produces — unchanged, so the inventory app needs no
 * rewrite to start working.
 *
 * SOURCE OF TRUTH
 * ---------------
 * Square owns the catalog. The boutique's real stock, prices and barcodes live
 * there because that is what the register sells from, and a website showing
 * anything else is lying about what is on the shelf. This storefront pushes
 * invoices *into* Square and reads the catalog *back out*; it does not keep a
 * competing product list.
 *
 * SECRETS
 * -------
 * `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` are environment-only, never
 * committed, and never returned in any response body. The token is a bearer
 * credential for real money movement, so it is also kept out of error text:
 * failures report Square's status and message, never the request headers.
 */

const SANDBOX_BASE = 'https://connect.squareupsandbox.com';
const PRODUCTION_BASE = 'https://connect.squareup.com';

/**
 * Square requires an explicit API version header and pins behaviour to it.
 * Overridable because Square ships a new version monthly and the correct value
 * is whatever the owner's Square dashboard reports for their application —
 * guessing a version that does not exist would fail every call.
 */
const API_VERSION = (process.env.SQUARE_API_VERSION ?? '2025-01-23').trim();

const ACCESS_TOKEN = (process.env.SQUARE_ACCESS_TOKEN ?? '').trim();
const LOCATION_ID = (process.env.SQUARE_LOCATION_ID ?? '').trim();
const ENVIRONMENT = (process.env.SQUARE_ENVIRONMENT ?? 'sandbox').trim().toLowerCase();

export function squareBase() {
  return ENVIRONMENT === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

export function isSquareConfigured() {
  return Boolean(ACCESS_TOKEN && LOCATION_ID);
}

export function squareStatus() {
  return {
    configured: isSquareConfigured(),
    environment: ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    api_version: API_VERSION,
    // Presence only. The token itself is never echoed, not even truncated.
    has_access_token: Boolean(ACCESS_TOKEN),
    has_location_id: Boolean(LOCATION_ID),
  };
}

/** A distinct idempotency key per call, so a retry cannot double-apply a write. */
function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Calls the Square API.
 *
 * Square reports failures as `{ errors: [{ category, code, detail, field }] }`
 * with a 2xx-shaped body in some batch cases, so both the HTTP status and the
 * body are inspected. The thrown message carries Square's own wording, which is
 * specific enough to act on ("INVALID_VALUE at line_items[0].quantity") and
 * contains no credential.
 */
async function squareRequest(path, { method = 'POST', body } = {}) {
  if (!isSquareConfigured()) {
    throw new Error('square_not_configured');
  }

  const response = await fetch(`${squareBase()}${path}`, {
    method,
    headers: {
      'Square-Version': API_VERSION,
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length)) {
    const detail = (payload.errors ?? [])
      .map((e) => `${e.code ?? 'ERROR'}${e.field ? ` at ${e.field}` : ''}: ${e.detail ?? ''}`)
      .join('; ');
    throw new Error(`square ${method} ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }

  return payload;
}

/* ------------------------------------------------------------------ *
 * Invoice → Square catalog
 * ------------------------------------------------------------------ */

/**
 * Translates one inventory-app payload into Square catalog objects.
 *
 * The inventory app groups rows by product name into `{ name, variations[] }`,
 * which maps exactly onto Square's ITEM / ITEM_VARIATION shape — a "Ribbed
 * Footie" item with 0-3m, 3-6m, 6-9m variations, each with its own SKU, UPC and
 * price. That grouping is why sizes stay one product on the register instead of
 * three unrelated ones.
 *
 * `wholesaleCostCents` is deliberately NOT sent. Square has no field for it on
 * a variation, and the buying price is not something to upload to a system whose
 * catalog is readable by staff devices. It stays in the invoice tool.
 *
 * Temporary IDs must start with '#' and be unique within the batch; Square
 * replaces them with real object IDs in the response.
 */
export function toCatalogBatch(payload) {
  const currency = payload?.currency || 'USD';
  const groups = Array.isArray(payload?.items) ? payload.items : [];
  const problems = [];
  const objects = [];

  groups.forEach((group, groupIndex) => {
    const name = String(group?.name ?? '').trim();
    if (!name) {
      problems.push(`item ${groupIndex + 1} has no name`);
      return;
    }

    const variations = (Array.isArray(group.variations) ? group.variations : [])
      .map((variation, variationIndex) => {
        const sku = String(variation?.sku ?? '').trim();
        const amount = Number(variation?.priceMoney?.amount);
        if (!sku) {
          problems.push(`${name}: variation ${variationIndex + 1} has no SKU`);
          return null;
        }
        if (!Number.isInteger(amount) || amount < 0) {
          problems.push(`${name} / ${sku}: price must be a whole number of cents`);
          return null;
        }

        return {
          type: 'ITEM_VARIATION',
          id: `#var_${groupIndex}_${variationIndex}`,
          item_variation_data: {
            item_id: `#item_${groupIndex}`,
            name: String(variation?.size ?? '').trim() || 'Regular',
            sku,
            // Square rejects an empty-string UPC; omit the field instead.
            ...(variation?.upc ? { upc: String(variation.upc).trim() } : {}),
            pricing_type: 'FIXED_PRICING',
            price_money: { amount, currency: variation?.priceMoney?.currency || currency },
            track_inventory: true,
          },
        };
      })
      .filter(Boolean);

    if (!variations.length) {
      problems.push(`${name}: no usable variations`);
      return;
    }

    objects.push({
      type: 'ITEM',
      id: `#item_${groupIndex}`,
      item_data: {
        name,
        variations,
      },
    });
  });

  return { objects, problems };
}

/** Upserts a catalog batch. Returns Square's id mappings and created objects. */
export async function upsertCatalog(objects) {
  const result = await squareRequest('/v2/catalog/batch-upsert-catalog-objects', {
    body: {
      idempotency_key: idempotencyKey('shia-catalog'),
      batches: [{ objects }],
    },
  });
  return {
    objects: result.objects ?? [],
    id_mappings: result.id_mappings ?? [],
  };
}

/**
 * Sets stock levels as a physical count.
 *
 * PHYSICAL_COUNT is the correct type for receiving a shipment against a counted
 * invoice: it asserts "there are now N on the shelf" rather than "add N", so a
 * re-sent invoice corrects the number instead of doubling it. That matters
 * because the inventory app's sync button is easy to press twice.
 */
export async function setInventoryCounts(counts) {
  if (!counts.length) return { changes: 0 };

  const occurredAt = new Date().toISOString();
  const changes = counts.map(({ catalogObjectId, quantity }) => ({
    type: 'PHYSICAL_COUNT',
    physical_count: {
      catalog_object_id: catalogObjectId,
      state: 'IN_STOCK',
      location_id: LOCATION_ID,
      quantity: String(Math.max(0, Math.trunc(Number(quantity) || 0))),
      occurred_at: occurredAt,
    },
  }));

  await squareRequest('/v2/inventory/changes/batch-create', {
    body: { idempotency_key: idempotencyKey('shia-inventory'), changes },
  });
  return { changes: changes.length };
}

/**
 * Full invoice sync: catalog upsert, then stock counts for whatever was created.
 *
 * Square returns `id_mappings` pairing each '#temp' id with the real object id,
 * which is how a quantity from the invoice finds the variation it belongs to.
 */
export async function syncInvoice(payload) {
  const { objects, problems } = toCatalogBatch(payload);
  if (!objects.length) {
    return { ok: false, error: 'nothing_syncable', problems };
  }

  const { objects: created, id_mappings: mappings } = await upsertCatalog(objects);
  const realId = new Map(mappings.map((m) => [m.client_object_id, m.object_id]));

  // Rebuild the quantity list against real Square ids.
  const counts = [];
  (payload.items ?? []).forEach((group, groupIndex) => {
    (group.variations ?? []).forEach((variation, variationIndex) => {
      const tempId = `#var_${groupIndex}_${variationIndex}`;
      const catalogObjectId = realId.get(tempId);
      const quantity = Number(variation?.quantity);
      if (catalogObjectId && Number.isFinite(quantity)) {
        counts.push({ catalogObjectId, quantity, sku: variation.sku });
      }
    });
  });

  const inventory = await setInventoryCounts(counts);

  return {
    ok: true,
    environment: squareStatus().environment,
    items_upserted: created.filter((o) => o.type === 'ITEM').length,
    variations_upserted: counts.length,
    stock_updates: inventory.changes,
    problems,
  };
}

/* ------------------------------------------------------------------ *
 * Square catalog → storefront
 * ------------------------------------------------------------------ */

/**
 * Reads the catalog back out of Square.
 *
 * `list` is used rather than `search` because the boutique's catalog is small
 * and list is a plain GET with cursor paging — fewer ways to get a query wrong.
 * Related objects (images) are requested so the shop can show real photographs
 * instead of category emoji.
 */
export async function listCatalog({ cursor, acc = [], types = 'ITEM,IMAGE' } = {}) {
  const query = new URLSearchParams({ types });
  if (cursor) query.set('cursor', cursor);

  const result = await squareRequest(`/v2/catalog/list?${query}`, { method: 'GET' });
  const items = [...acc, ...(result.objects ?? [])];

  // Paging is bounded: a runaway cursor loop against a paid API is its own bug.
  if (result.cursor && items.length < 1000) {
    return listCatalog({ cursor: result.cursor, acc: items });
  }
  return items;
}

/** Current stock for a set of variation ids, as a Map of id → quantity. */
export async function getInventoryCounts(variationIds) {
  const counts = new Map();
  if (!variationIds.length) return counts;

  // Square caps this request; chunk rather than sending one enormous body.
  for (let i = 0; i < variationIds.length; i += 100) {
    const chunk = variationIds.slice(i, i + 100);
    const result = await squareRequest('/v2/inventory/counts/batch-retrieve', {
      body: { catalog_object_ids: chunk, location_ids: [LOCATION_ID] },
    });
    for (const count of result.counts ?? []) {
      if (count.state === 'IN_STOCK') {
        counts.set(count.catalog_object_id, Number(count.quantity) || 0);
      }
    }
  }
  return counts;
}

/** Builds id → URL from the IMAGE objects returned alongside the items. */
export function indexImages(objects) {
  const map = new Map();
  for (const object of objects) {
    if (object.type === 'IMAGE' && !object.is_deleted && object.image_data?.url) {
      map.set(object.id, object.image_data.url);
    }
  }
  return map;
}

/** First resolvable image for an item, or null. */
function resolveImage(imageIds, imagesById) {
  for (const id of imageIds ?? []) {
    const url = imagesById.get(id);
    if (url) return url;
  }
  return null;
}

/**
 * Flattens Square's ITEM/ITEM_VARIATION tree into one sellable row per
 * variation, which is what a shopper actually buys and what a cart line needs.
 */
export function flattenCatalog(items, stockById = new Map(), imagesById = new Map()) {
  const rows = [];

  for (const item of items) {
    if (item.is_deleted || item.type !== 'ITEM') continue;
    const data = item.item_data ?? {};

    for (const variation of data.variations ?? []) {
      if (variation.is_deleted) continue;
      const v = variation.item_variation_data ?? {};
      const price = v.price_money?.amount;

      rows.push({
        // The variation id is the cart's catalog_object_id at checkout.
        square_variation_id: variation.id,
        square_item_id: item.id,
        name: data.name ?? '',
        variation_name: v.name ?? '',
        sku: v.sku ?? null,
        upc: v.upc ?? null,
        price_cents: Number.isFinite(price) ? Number(price) : null,
        currency: v.price_money?.currency ?? 'USD',
        stock: stockById.get(variation.id) ?? 0,
        description: data.description ?? null,
        // Square returns image_ids on the item and the URLs on separate IMAGE
        // objects. Resolving them here is what puts a real photograph on the
        // shop instead of a placeholder glyph — for a boutique selling how
        // things look, that is not a cosmetic detail.
        image_url: resolveImage(data.image_ids, imagesById),
        // Square's own online-visibility flag decides what customers see.
        // Using it rather than a private "published" column means the owner can
        // list an item from this console OR from Square itself and get the same
        // result, and there is no second database to drift out of sync.
        ecom_visibility: data.ecom_visibility ?? 'UNINDEXED',
      });
    }
  }

  return rows;
}

/** The catalog as sellable rows, with live stock attached. */
export async function fetchSellableCatalog() {
  const objects = await listCatalog();
  const images = indexImages(objects);
  const flattened = flattenCatalog(objects, new Map(), images);
  const stock = await getInventoryCounts(flattened.map((r) => r.square_variation_id));
  return flattenCatalog(objects, stock, images);
}

/** Square's visibility value that means "customers may see and buy this". */
export const ONLINE_VISIBLE = 'VISIBLE';

/**
 * Is this row allowed to appear on the public storefront?
 *
 * Two independent conditions, both required. Visibility is the owner's decision
 * and stock is a fact; selling something nobody marked for online, or something
 * that is not on the shelf, are different failures with the same bad ending —
 * an order that cannot be fulfilled.
 */
export function isPubliclySellable(row) {
  return row?.ecom_visibility === ONLINE_VISIBLE
    && Number(row?.stock ?? 0) > 0
    && Number.isFinite(row?.price_cents)
    && row.price_cents > 0;
}

/**
 * Lists or unlists an item online.
 *
 * Square requires the object's current `version` on upsert for optimistic
 * concurrency — sending a stale version is rejected rather than silently
 * clobbering a change someone made in the Square dashboard a moment earlier.
 * So the item is re-read immediately before it is written.
 */
export async function setOnlineVisibility(itemId, visible) {
  const current = await squareRequest(`/v2/catalog/object/${encodeURIComponent(itemId)}`, {
    method: 'GET',
  });
  const object = current.object;
  if (!object || object.type !== 'ITEM') {
    throw new Error(`catalog object ${itemId} is not an ITEM`);
  }

  const updated = {
    ...object,
    item_data: {
      ...object.item_data,
      ecom_visibility: visible ? ONLINE_VISIBLE : 'UNINDEXED',
    },
  };

  await squareRequest('/v2/catalog/object', {
    body: { idempotency_key: idempotencyKey('shia-visibility'), object: updated },
  });

  return { id: itemId, ecom_visibility: updated.item_data.ecom_visibility };
}

/* ------------------------------------------------------------------ *
 * Checkout
 * ------------------------------------------------------------------ */

/**
 * Creates a Square-hosted payment link for a cart.
 *
 * Hosted checkout is a deliberate choice: the card form lives on Square's
 * domain, so no card data ever reaches this deployment and the PCI burden stays
 * with Square. The customer pays into the same Square account and payout
 * schedule the physical boutique already uses, so online and in-store takings
 * reconcile without extra work.
 *
 * Line items reference `catalog_object_id`, never a client-supplied price:
 * a browser can ask to buy item X, but it cannot tell the server what X costs.
 * That is the difference between a shop and a donation box.
 */
export async function createCheckout({ lineItems, redirectUrl, note, buyerEmail }) {
  const result = await squareRequest('/v2/online-checkout/payment-links', {
    body: {
      idempotency_key: idempotencyKey('shia-checkout'),
      order: {
        location_id: LOCATION_ID,
        line_items: lineItems.map((line) => ({
          catalog_object_id: line.square_variation_id,
          quantity: String(Math.max(1, Math.trunc(Number(line.quantity) || 1))),
          ...(line.note ? { note: String(line.note).slice(0, 500) } : {}),
        })),
        ...(note ? { reference_id: String(note).slice(0, 40) } : {}),
      },
      checkout_options: {
        ask_for_shipping_address: true,
        ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
      },
      ...(buyerEmail ? { pre_populated_data: { buyer_email: buyerEmail } } : {}),
    },
  });

  const link = result.payment_link ?? {};
  return {
    url: link.url,
    order_id: link.order_id ?? null,
    payment_link_id: link.id ?? null,
  };
}

/** Connectivity probe for the health gates. Cheapest authenticated read. */
export async function probeSquare() {
  if (!isSquareConfigured()) {
    return {
      ok: true,
      degraded: true,
      reason: 'SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID not set; the shop cannot sell.',
    };
  }
  try {
    await squareRequest('/v2/locations', { method: 'GET' });
    return { ok: true, degraded: false, environment: squareStatus().environment };
  } catch (error) {
    return { ok: false, degraded: true, reason: error.message };
  }
}

/**
 * The public shape of a product. Allowlist, not delete-list — the same rule the
 * inventory bridge follows, for the same reason: a field Square adds later
 * cannot leak by being forgotten. Square does not hold wholesale cost at all,
 * which is why the invoice tool never uploads it.
 */
export function toPublicSquareProduct(row) {
  return {
    id: row.square_variation_id,
    sku: row.sku,
    name: row.variation_name && row.variation_name !== 'Regular'
      ? `${row.name} — ${row.variation_name}`
      : row.name,
    product_name: row.name,
    size: row.variation_name || null,
    price_cents: row.price_cents,
    price_display: formatMoney(row.price_cents, row.currency),
    currency: row.currency,
    in_stock: Number(row.stock ?? 0) > 0,
    description: row.description,
    image_url: row.image_url ?? null,
  };
}

export function formatMoney(cents, currency = 'USD') {
  if (!Number.isFinite(cents)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export default {
  isSquareConfigured, squareStatus, squareBase,
  toCatalogBatch, upsertCatalog, setInventoryCounts, syncInvoice,
  listCatalog, getInventoryCounts, flattenCatalog, fetchSellableCatalog, indexImages,
  isPubliclySellable, setOnlineVisibility, toPublicSquareProduct, formatMoney,
  ONLINE_VISIBLE, createCheckout, probeSquare,
};
