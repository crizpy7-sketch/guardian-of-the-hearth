/**
 * Square connector — catalog mapping and the rules that protect money.
 *
 * These cover the translation the inventory app depends on, and the two
 * properties that decide whether this is a shop or a way to lose money: the
 * client cannot set a price, and nothing unlisted or out of stock is sellable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toCatalogBatch, flattenCatalog, isPubliclySellable, toPublicSquareProduct,
  formatMoney, squareStatus, ONLINE_VISIBLE,
} from '../src/square.js';

/** The exact shape shia-baby-inventory's buildPayload() emits. */
const inventoryPayload = {
  app: 'Shia Baby Inventory',
  currency: 'USD',
  vendor: 'Little Threads',
  invoiceReference: 'INV-4471',
  items: [
    {
      name: 'Ribbed Footie',
      variations: [
        { size: '0-3m', sku: 'RF-BLU-03', upc: '0123456789012', priceMoney: { amount: 2699, currency: 'USD' }, wholesaleCostCents: 1250, quantity: 4 },
        { size: '3-6m', sku: 'RF-BLU-36', upc: '', priceMoney: { amount: 2699, currency: 'USD' }, wholesaleCostCents: 1250, quantity: 6 },
      ],
    },
  ],
};

test('an inventory payload becomes one Square item with its sizes as variations', () => {
  // Sizes must stay one product on the register, not three unrelated items.
  const { objects, problems } = toCatalogBatch(inventoryPayload);
  assert.deepEqual(problems, []);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].type, 'ITEM');
  assert.equal(objects[0].item_data.name, 'Ribbed Footie');
  assert.equal(objects[0].item_data.variations.length, 2);
});

test('wholesale cost is never uploaded to Square', () => {
  // The payload carries it (the invoice tool prices from it); the connector must
  // drop it. Square has no field for it and staff devices can read the catalog.
  const { objects } = toCatalogBatch(inventoryPayload);
  const serialised = JSON.stringify(objects);
  assert.ok(!/wholesaleCost/i.test(serialised));
  assert.ok(!serialised.includes('1250'), 'the buying price must not appear anywhere in the batch');
});

test('an empty UPC is omitted rather than sent as an empty string', () => {
  // Square rejects an empty upc field, which would fail the whole batch.
  const { objects } = toCatalogBatch(inventoryPayload);
  const [first, second] = objects[0].item_data.variations;
  assert.equal(first.item_variation_data.upc, '0123456789012');
  assert.ok(!('upc' in second.item_variation_data));
});

test('temporary ids are unique and link each variation to its parent item', () => {
  const { objects } = toCatalogBatch({
    currency: 'USD',
    items: [inventoryPayload.items[0], { name: 'Muslin Swaddle', variations: [{ size: 'one size', sku: 'MS-1', priceMoney: { amount: 1899 }, quantity: 3 }] }],
  });
  const ids = objects.flatMap((o) => o.item_data.variations.map((v) => v.id));
  assert.equal(new Set(ids).size, ids.length, 'duplicate temp ids would collide in the batch');
  assert.equal(objects[1].item_data.variations[0].item_variation_data.item_id, objects[1].id);
});

test('rows without a SKU or a whole-cent price are reported, not silently dropped', () => {
  const { objects, problems } = toCatalogBatch({
    currency: 'USD',
    items: [{
      name: 'Bad Row',
      variations: [
        { size: '0-3m', sku: '', priceMoney: { amount: 100 }, quantity: 1 },
        { size: '3-6m', sku: 'OK-1', priceMoney: { amount: 12.5 }, quantity: 1 },
      ],
    }],
  });
  assert.equal(objects.length, 0);
  assert.equal(problems.length, 3); // no SKU, fractional cents, and no usable variations
  assert.ok(problems.some((p) => /no SKU/.test(p)));
  assert.ok(problems.some((p) => /whole number of cents/.test(p)));
});

/* ------------------------------------------------------------------ */

const catalogFromSquare = [
  {
    id: 'ITEM_1',
    type: 'ITEM',
    item_data: {
      name: 'Ribbed Footie',
      ecom_visibility: ONLINE_VISIBLE,
      variations: [
        { id: 'VAR_1', type: 'ITEM_VARIATION', item_variation_data: { name: '0-3m', sku: 'RF-BLU-03', price_money: { amount: 2699, currency: 'USD' } } },
      ],
    },
  },
  {
    id: 'ITEM_2',
    type: 'ITEM',
    item_data: {
      name: 'Staff Only Sample',
      ecom_visibility: 'UNINDEXED',
      variations: [
        { id: 'VAR_2', type: 'ITEM_VARIATION', item_variation_data: { name: 'Regular', sku: 'SAMPLE-1', price_money: { amount: 500, currency: 'USD' } } },
      ],
    },
  },
];

test('an item not marked visible online is never sellable', () => {
  // The owner chose "only ones I mark for online". An in-store-only sample
  // reaching the website is the failure this prevents.
  const rows = flattenCatalog(catalogFromSquare, new Map([['VAR_1', 5], ['VAR_2', 5]]));
  const sellable = rows.filter(isPubliclySellable);
  assert.equal(sellable.length, 1);
  assert.equal(sellable[0].sku, 'RF-BLU-03');
});

test('a listed item with no stock is not sellable', () => {
  const rows = flattenCatalog(catalogFromSquare, new Map([['VAR_1', 0]]));
  assert.equal(rows.filter(isPubliclySellable).length, 0);
});

test('a listed, stocked item with no price is not sellable', () => {
  // A variation priced VARIABLE_PRICING has no amount; selling it would charge
  // nothing.
  const noPrice = [{
    id: 'ITEM_3',
    type: 'ITEM',
    item_data: {
      name: 'Unpriced',
      ecom_visibility: ONLINE_VISIBLE,
      variations: [{ id: 'VAR_3', type: 'ITEM_VARIATION', item_variation_data: { name: 'Regular', sku: 'U-1' } }],
    },
  }];
  const rows = flattenCatalog(noPrice, new Map([['VAR_3', 3]]));
  assert.equal(rows.filter(isPubliclySellable).length, 0);
});

test('deleted items and variations are excluded', () => {
  const deleted = [{
    id: 'ITEM_4', type: 'ITEM', is_deleted: true,
    item_data: { name: 'Gone', ecom_visibility: ONLINE_VISIBLE, variations: [{ id: 'VAR_4', item_variation_data: { price_money: { amount: 100 } } }] },
  }];
  assert.equal(flattenCatalog(deleted).length, 0);
});

test('the public product shape carries no cost, stock count or internal id', () => {
  const rows = flattenCatalog(catalogFromSquare, new Map([['VAR_1', 7]]));
  const publicRow = toPublicSquareProduct(rows[0]);

  assert.equal(publicRow.in_stock, true);
  // Exact stock is a business fact competitors need not have; in_stock is enough.
  assert.ok(!('stock' in publicRow));
  assert.ok(!('ecom_visibility' in publicRow));
  const serialised = JSON.stringify(publicRow).toLowerCase();
  assert.ok(!serialised.includes('cost'));
  assert.ok(!serialised.includes('margin'));
});

test('prices are formatted from cents and never from floats', () => {
  assert.equal(formatMoney(2699), '$26.99');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(null), '');
});

test('square status reports configuration without exposing the token', () => {
  const status = squareStatus();
  assert.ok('configured' in status);
  const serialised = JSON.stringify(status);
  assert.ok(!/access_token"\s*:\s*"[^"]+"/.test(serialised.replace('has_access_token', '')),
    'the token value must never be serialised');
});

test('the sandbox is the default environment', () => {
  // Defaulting to production would let a misconfiguration write to the real
  // catalog of a live boutique.
  assert.equal(squareStatus().environment, 'sandbox');
});
