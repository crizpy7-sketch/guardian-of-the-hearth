/**
 * Shia & Co. — Pluggable data layer.
 *
 * Talks to Supabase over its REST (PostgREST) interface using `fetch`, so the
 * storefront keeps the same zero-build, zero-dependency shape as the existing
 * Shia mini-apps.
 *
 * SECRETS
 * -------
 * Configuration comes from environment variables only. Per
 * APP_BUILD_STANDARD.md §9, no key, URL, or credential is ever committed here.
 * `.env.example` documents the names; the values live in Vercel project
 * settings.
 *
 * DEGRADED MODE
 * -------------
 * If the environment is not configured, the layer reports `configured: false`
 * and stores writes in memory for the lifetime of the process. That keeps local
 * development and preview deployments functional without secrets, and — per
 * Invariant 17 (no fake progress) — it reports itself as degraded rather than
 * pretending a write was persisted.
 */

const SUPABASE_URL = process.env.SHIA_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SHIA_SUPABASE_SERVICE_KEY ?? '';

const SUBSCRIBERS_TABLE = process.env.SHIA_SUBSCRIBERS_TABLE ?? 'shia_subscribers';
const SONG_ORDERS_TABLE = process.env.SHIA_SONG_ORDERS_TABLE ?? 'shia_song_orders';

/** In-memory fallback store, used only when Supabase is not configured. */
const memory = { subscribers: [], products: [] };

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export function backendMode() {
  return isConfigured() ? 'supabase' : 'memory';
}

async function supabaseRequest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Surface the status without leaking credentials into logs.
    const detail = await response.text().catch(() => '');
    throw new Error(`supabase ${method} ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  // 204 responses (no representation requested) have no body to parse.
  return response.status === 204 ? null : response.json();
}

/** Basic shape validation. Returns a list of problems (empty when valid). */
export function validateSubscriber(input) {
  const problems = [];
  if (!input || typeof input !== 'object') return ['payload must be an object'];
  if (!String(input.first_name ?? '').trim()) problems.push('first_name is required');

  const email = String(input.email ?? '').trim();
  // Deliberately permissive: rejecting unusual-but-valid addresses loses signups.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('a valid email is required');

  if (input.locale && !['en', 'es'].includes(input.locale)) problems.push('locale must be en or es');
  if (input.sms_opt_in && !String(input.phone ?? '').trim()) {
    problems.push('phone is required when sms_opt_in is true');
  }
  return problems;
}

/**
 * Records a Milestone Club signup.
 * `due_or_birthday` powers the milestone reminder flow (baby outgrows a size
 * roughly every three months), which is the repeat-revenue engine.
 */
export async function createSubscriber(input) {
  const row = {
    first_name: String(input.first_name).trim(),
    email: String(input.email).trim().toLowerCase(),
    phone: String(input.phone ?? '').trim() || null,
    sms_opt_in: Boolean(input.sms_opt_in),
    due_or_birthday: input.due_or_birthday || null,
    locale: input.locale === 'es' ? 'es' : 'en',
    source: String(input.source ?? 'storefront').slice(0, 120),
    utm_campaign: String(input.utm_campaign ?? '').slice(0, 120) || null,
    utm_source: String(input.utm_source ?? '').slice(0, 120) || null,
    utm_medium: String(input.utm_medium ?? '').slice(0, 120) || null,
    created_at: new Date().toISOString(),
  };

  if (!isConfigured()) {
    memory.subscribers.push(row);
    return { stored: true, persisted: false, mode: 'memory', subscriber: row };
  }

  const [created] = (await supabaseRequest(SUBSCRIBERS_TABLE, {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  })) ?? [row];

  return { stored: true, persisted: true, mode: 'supabase', subscriber: created };
}

export async function countSubscribers() {
  if (!isConfigured()) return { count: memory.subscribers.length, mode: 'memory' };
  const rows = await supabaseRequest(`${SUBSCRIBERS_TABLE}?select=id`);
  return { count: Array.isArray(rows) ? rows.length : 0, mode: 'supabase' };
}

/**
 * Reads recent song orders produced by the existing Shia-songs application.
 * Read-only: that app owns this table, and two systems must not hold
 * conflicting write authority over one mutable resource (Invariant 7).
 */
export async function listSongOrders({ limit = 25 } = {}) {
  if (!isConfigured()) {
    return { orders: [], mode: 'memory', note: 'Supabase not configured in this environment.' };
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const rows = await supabaseRequest(
    `${SONG_ORDERS_TABLE}?select=*&order=created_at.desc&limit=${safeLimit}`,
  );
  return { orders: Array.isArray(rows) ? rows : [], mode: 'supabase' };
}

/* ------------------------------------------------------------------ *
 * Products — the real catalog, imported from shia-baby-inventory.
 * ------------------------------------------------------------------ */

const PRODUCTS_TABLE = process.env.SHIA_PRODUCTS_TABLE ?? 'shia_products';

/** All products including unpublished ones. Operator console only. */
export async function listAllProducts({ limit = 500 } = {}) {
  if (!isConfigured()) return { products: [...memory.products], mode: 'memory' };
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const rows = await supabaseRequest(
    `${PRODUCTS_TABLE}?select=*&order=name.asc&limit=${safeLimit}`,
  );
  return { products: Array.isArray(rows) ? rows : [], mode: 'supabase' };
}

/** Published, in-stock products only. Safe for the public storefront. */
export async function listPublishedProducts() {
  if (!isConfigured()) {
    return { products: memory.products.filter((p) => p.published), mode: 'memory' };
  }
  const rows = await supabaseRequest(
    `${PRODUCTS_TABLE}?select=*&published=is.true&order=name.asc&limit=1000`,
  );
  return { products: Array.isArray(rows) ? rows : [], mode: 'supabase' };
}

/**
 * Upserts imported products. Conflicts resolve on `sku` so re-importing an
 * invoice updates existing records instead of duplicating the catalog.
 * `published` is deliberately NOT overwritten on conflict — a re-import must
 * never silently republish something the operator took down.
 */
export async function upsertProducts(products) {
  if (!products.length) return { written: 0, mode: backendMode() };

  if (!isConfigured()) {
    for (const incoming of products) {
      const index = memory.products.findIndex((p) => p.sku && p.sku === incoming.sku);
      if (index >= 0) {
        memory.products[index] = { ...memory.products[index], ...incoming, published: memory.products[index].published };
      } else {
        memory.products.push({ ...incoming, id: `mem_${memory.products.length + 1}` });
      }
    }
    return { written: products.length, mode: 'memory', persisted: false };
  }

  const rows = await supabaseRequest(
    `${PRODUCTS_TABLE}?on_conflict=sku`,
    {
      method: 'POST',
      body: products,
      prefer: 'resolution=merge-duplicates,return=representation',
    },
  );
  return { written: Array.isArray(rows) ? rows.length : products.length, mode: 'supabase', persisted: true };
}

/** Patches one product (price, description, image, published flag). */
export async function updateProduct(id, patch) {
  const allowed = ['name', 'size', 'category', 'price_cents', 'stock', 'description', 'image_url', 'published'];
  const body = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) body[key] = patch[key];
  }
  if (!Object.keys(body).length) return { updated: 0, mode: backendMode() };

  if (!isConfigured()) {
    const product = memory.products.find((p) => String(p.id) === String(id));
    if (!product) return { updated: 0, mode: 'memory' };
    Object.assign(product, body);
    return { updated: 1, mode: 'memory', persisted: false, product };
  }

  const rows = await supabaseRequest(`${PRODUCTS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    prefer: 'return=representation',
  });
  return { updated: Array.isArray(rows) ? rows.length : 0, mode: 'supabase', persisted: true, product: rows?.[0] };
}

/* ------------------------------------------------------------------ *
 * Song orders — administration for the Shia-songs intake app.
 * ------------------------------------------------------------------ */

/**
 * Updates a song order's workflow status and internal notes.
 *
 * This is the ONE field set this system may write on the songs table, matching
 * exactly what the Shia-songs admin panel already writes
 * (`update({status, internal_notes})`). Customer-submitted answers, photos, and
 * contact details stay owned by that app and are never modified here.
 */
export const SONG_STATUSES = Object.freeze([
  'new', 'reviewing', 'lyrics_in_progress', 'waiting_on_customer',
  'song_in_progress', 'completed', 'delivered', 'cancelled',
]);

export async function updateSongOrder(id, { status, internal_notes }) {
  const body = {};
  if (status !== undefined) {
    if (!SONG_STATUSES.includes(status)) {
      throw new Error(`unknown status: ${status}`);
    }
    body.status = status;
  }
  if (internal_notes !== undefined) body.internal_notes = String(internal_notes).slice(0, 5000);
  if (!Object.keys(body).length) return { updated: 0, mode: backendMode() };

  if (!isConfigured()) {
    return { updated: 0, mode: 'memory', persisted: false, note: 'Supabase not configured.' };
  }

  const rows = await supabaseRequest(`${SONG_ORDERS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    prefer: 'return=representation',
  });
  return { updated: Array.isArray(rows) ? rows.length : 0, mode: 'supabase', persisted: true };
}

/** Connectivity probe used by the health gates. */
export async function probe() {
  if (!isConfigured()) {
    return { ok: true, mode: 'memory', degraded: true, reason: 'Supabase environment not configured.' };
  }
  try {
    await supabaseRequest(`${SUBSCRIBERS_TABLE}?select=id&limit=1`);
    return { ok: true, mode: 'supabase', degraded: false };
  } catch (error) {
    return { ok: false, mode: 'supabase', degraded: true, reason: error.message };
  }
}

export default {
  isConfigured,
  backendMode,
  validateSubscriber,
  createSubscriber,
  countSubscribers,
  listSongOrders,
  updateSongOrder,
  SONG_STATUSES,
  listAllProducts,
  listPublishedProducts,
  upsertProducts,
  updateProduct,
  probe,
};
