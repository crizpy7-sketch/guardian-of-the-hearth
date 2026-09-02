/**
 * Product catalog — inventory import and public exposure.
 *
 * The highest-stakes test here is the cost leak guard. The inventory app's rows
 * carry `cost` and `margin`; publishing either would hand customers and
 * competitors your buying price and markup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromInventoryRow, fromInventoryExport, toPublicProduct, publicCatalog,
  normaliseSize, guessCategory, toCents, formatPrice, PRIVATE_FIELDS,
} from '../src/products.js';

/** A row exactly as shia-baby-inventory stores it. */
const inventoryRow = {
  id: 'r1',
  name: 'Ribbed Footie',
  size: '0-3m',
  cost: 12.5,
  retail: 26.99,
  sku: 'RF-BLU-03',
  gtin: '0123456789012',
  qty: 4,
  copies: 4,
  vendor: 'Forever French Baby',
  margin: 0.53,
};

test('an inventory row converts to a sellable product', () => {
  const { product, problems } = fromInventoryRow(inventoryRow);
  assert.deepEqual(problems, []);
  assert.equal(product.name, 'Ribbed Footie');
  assert.equal(product.sku, 'RF-BLU-03');
  assert.equal(product.size, '0-3m');
  assert.equal(product.price_cents, 2699);
  assert.equal(product.stock, 4);
});

test('imported products are never published automatically', () => {
  const { product } = fromInventoryRow(inventoryRow);
  // Nothing reaches customers without a deliberate act by the operator.
  assert.equal(product.published, false);
});

test('WHOLESALE COST NEVER REACHES A PUBLIC PRODUCT', () => {
  const { product } = fromInventoryRow(inventoryRow);
  const publicView = toPublicProduct({ ...product, ...inventoryRow, id: 1 });
  const serialised = JSON.stringify(publicView);

  for (const field of PRIVATE_FIELDS) {
    assert.ok(!(field in publicView), `public product must not expose "${field}"`);
  }
  // Belt and braces: the literal cost value must not appear anywhere.
  assert.ok(!serialised.includes('12.5'), 'cost value leaked into public payload');
  assert.ok(!serialised.includes('1250'), 'cost in cents leaked into public payload');
  assert.ok(!/margin/i.test(serialised), 'margin leaked into public payload');
});

test('public products carry only the display fields', () => {
  const publicView = toPublicProduct({ ...inventoryRow, price_cents: 2699, category: 'clothing', stock: 4 });
  assert.deepEqual(
    Object.keys(publicView).sort(),
    ['category', 'currency', 'description', 'id', 'image_url', 'in_stock', 'name', 'price_cents', 'price_display', 'size', 'sku'].sort(),
  );
});

test('rows without a name or price are rejected, not silently dropped', () => {
  assert.ok(fromInventoryRow({ retail: 10 }).problems.includes('name is required'));
  assert.ok(fromInventoryRow({ name: 'Bib' }).problems.some((p) => p.includes('retail price')));
  assert.ok(fromInventoryRow({ name: 'Bib', retail: 0 }).problems.some((p) => p.includes('retail price')));
});

test('bulk import reports rejects and de-duplicates SKUs', () => {
  const result = fromInventoryExport({
    items: [
      inventoryRow,
      { name: 'No price here' },
      { ...inventoryRow, retail: 29.99 }, // same SKU, updated price
    ],
  });
  assert.equal(result.products.length, 1, 'duplicate SKU collapses to one record');
  assert.equal(result.products[0].price_cents, 2999, 'last write wins');
  assert.equal(result.rejected.length, 1);
  assert.deepEqual(result.duplicates, ['RF-BLU-03']);
});

test('import accepts a bare array as well as the wrapped state object', () => {
  assert.equal(fromInventoryExport([inventoryRow]).products.length, 1);
  assert.equal(fromInventoryExport({ items: [inventoryRow] }).products.length, 1);
  assert.equal(fromInventoryExport(null).products.length, 0);
});

test('sizes normalise from the messy forms an invoice actually contains', () => {
  assert.equal(normaliseSize('0-3m'), '0-3m');
  assert.equal(normaliseSize('0/3 M'), '0-3m');
  assert.equal(normaliseSize('NB'), 'newborn');
  assert.equal(normaliseSize('Newborn'), 'newborn');
  assert.equal(normaliseSize('one size'), 'one-size');
  assert.equal(normaliseSize('12-18m'), '12-18m');
  assert.equal(normaliseSize(''), null);
  assert.equal(normaliseSize('gigantic'), null);
});

test('categories are guessed from the product name', () => {
  assert.equal(guessCategory('Ribbed Footie'), 'clothing');
  assert.equal(guessCategory('Muslin Blanket'), 'blanket');
  assert.equal(guessCategory('Memory Keepsake Frame'), 'keepsake');
  assert.equal(guessCategory('Welcome Home Box'), 'gift-set');
  assert.equal(guessCategory('Bow Headband'), 'accessory');
  assert.equal(guessCategory('Mystery Thing'), 'other');
});

test('money conversion rejects nonsense rather than storing NaN', () => {
  assert.equal(toCents(26.99), 2699);
  assert.equal(toCents('26.99'), 2699);
  assert.equal(toCents(-1), null);
  assert.equal(toCents('abc'), null);
  assert.equal(formatPrice(2699), '$26.99');
});

test('the public catalog hides unpublished and out-of-stock items', () => {
  const catalog = publicCatalog([
    { name: 'Live', price_cents: 100, published: true, stock: 3, category: 'clothing' },
    { name: 'Draft', price_cents: 100, published: false, stock: 3, category: 'clothing' },
    { name: 'Sold out', price_cents: 100, published: true, stock: 0, category: 'clothing' },
  ]);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].name, 'Live');
});
