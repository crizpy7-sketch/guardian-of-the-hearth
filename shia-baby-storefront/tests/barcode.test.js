/**
 * Code 128-B — a wrong barcode is discovered at the register, not on screen.
 *
 * These tests exist because the failure mode is delayed and expensive: a
 * mis-encoded symbol looks fine in the browser, prints fine, gets stuck on a
 * whole shipment, and surfaces weeks later when a garment will not scan.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodeCode128B, decodeCode128B, barcodeSvg } from '../src/barcode.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a SKU survives the encode/decode round trip', () => {
  for (const sku of ['RF-BLU-03', 'SB-0001', 'A', 'MS-ONE-SIZE-2026', 'x'.repeat(20)]) {
    assert.equal(decodeCode128B(encodeCode128B(sku)), sku, `round trip failed for ${sku}`);
  }
});

test('the symbol is framed with start-B and stop values', () => {
  const codes = encodeCode128B('RF-BLU-03');
  assert.equal(codes[0], 104, 'must start with the Code 128-B start character');
  assert.equal(codes[codes.length - 1], 106, 'must end with the stop character');
});

test('a corrupted symbol fails the checksum rather than decoding to something else', () => {
  const codes = encodeCode128B('RF-BLU-03');
  // Flip one data character, as a damaged or misread symbol would.
  const corrupted = [...codes];
  corrupted[2] += 1;
  assert.throws(() => decodeCode128B(corrupted), /checksum failed/i);
});

test('characters Code 128-B cannot encode are refused by name', () => {
  // An accented character pasted from a supplier invoice is the realistic case.
  assert.throws(() => encodeCode128B('CAFÉ-1'), /cannot encode/i);
  assert.throws(() => encodeCode128B('tab\there'), /cannot encode/i);
});

test('an empty SKU is refused', () => {
  assert.throws(() => encodeCode128B(''), /required/i);
});

test('the SVG contains bars and a white background', () => {
  const svg = barcodeSvg('RF-BLU-03');
  assert.match(svg, /^<svg/);
  assert.match(svg, /<rect width="100%" height="100%" fill="#fff"\/>/);
  assert.ok((svg.match(/<rect /g) ?? []).length > 10, 'a real symbol has many bars');
});

test('the SKU is escaped in the accessible label', () => {
  // A SKU is operator-entered text landing in an XML attribute.
  const svg = barcodeSvg('A&B<C>');
  assert.ok(svg.includes('aria-label="Barcode A&amp;B&lt;C&gt;"'));
  assert.ok(!svg.includes('aria-label="Barcode A&B<C>"'));
});

test('a SKU too long for the label is refused rather than printed unscannably', () => {
  // Squeezing it in would produce a symbol that scans intermittently — worse
  // than one that visibly fails, because it looks like it works.
  assert.throws(
    () => barcodeSvg('THIS-SKU-IS-FAR-TOO-LONG-FOR-A-SMALL-LABEL-0123456789', 1.0),
    /too long for a .* label/i,
  );
});

test('a wider label accepts a SKU that a narrow one rejects', () => {
  const sku = 'RF-BLUE-NEWBORN-0003';
  assert.throws(() => barcodeSvg(sku, 0.6));
  assert.match(barcodeSvg(sku, 2.48), /^<svg/);
});

test('bars never fall below a scannable module width', () => {
  // The floor is 4px at 600dpi (~6.7 mil). Below ~5 mil, retail scanners
  // struggle, so the generator must widen the symbol or refuse.
  const svg = barcodeSvg('SB-1', 1.86);
  const widths = [...svg.matchAll(/width="(\d+)"/g)]
    .map((m) => Number(m[1]))
    .filter((w) => w < 1000); // exclude the 100% background rect
  assert.ok(Math.min(...widths) >= 4, 'a bar narrower than 4px would scan unreliably');
});

test('the browser copy of the encoder is byte-identical to the source module', () => {
  // The invoice tool runs in the browser and needs this code client-side, while
  // src/ is the module the server and tests use. Two copies of a barcode
  // encoder that drift would print labels that scan as the wrong SKU — so the
  // duplication is allowed but pinned, not trusted.
  assert.equal(
    readFileSync(join(ROOT, 'public/assets/barcode.js'), 'utf8'),
    readFileSync(join(ROOT, 'src/barcode.js'), 'utf8'),
    'public/assets/barcode.js has drifted from src/barcode.js — re-copy it',
  );
});
