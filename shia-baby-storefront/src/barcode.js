/**
 * Code 128-B barcode generation.
 *
 * Lifted from shia-baby-inventory, which already had a correct implementation,
 * and turned into a shared module so the storefront console and the inventory
 * app cannot drift into printing different barcodes for the same SKU.
 *
 * WHY IT VERIFIES ITS OWN OUTPUT
 * ------------------------------
 * `barcodeSvg()` decodes the symbol it just encoded and refuses to emit it
 * unless the round trip returns the original SKU. That looks redundant until you
 * remember what the failure costs: a wrong barcode is not noticed on screen, it
 * is noticed weeks later at the register, on a whole shipment of garments that
 * are already tagged and on the shelf. Reprinting is cheap; discovering it at
 * the till is not. The original author was right to do this and it is kept.
 *
 * WHY BAR WIDTH IS CHECKED
 * ------------------------
 * A scanner needs a minimum module width to read reliably. Rather than squeezing
 * a long SKU into a small label and producing a symbol that scans intermittently
 * — the worst outcome, because it appears to work — this throws and names the
 * SKU, so the operator shortens it or picks larger stock.
 */

/** Code 128 patterns, values 0–106. Each string gives bar/space widths. */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

export function encodeCode128B(text) {
  const value = String(text);
  if (!value) throw new Error('A SKU is required to make a barcode.');

  // Code 128-B covers ASCII 32–126. Anything else — an accented character
  // pasted from an invoice, say — cannot be encoded and must be caught here
  // rather than producing a symbol that scans as the wrong thing.
  const bad = [...value].find((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code > 126;
  });
  if (bad) {
    throw new Error(`SKU "${value}" contains "${bad}", which Code 128-B cannot encode.`);
  }

  const codes = [START_B];
  for (const ch of value) codes.push(ch.charCodeAt(0) - 32);

  let checksum = START_B;
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
  checksum %= 103;

  return [...codes, checksum, STOP];
}

/** Decodes what `encodeCode128B` produced, verifying framing and checksum. */
export function decodeCode128B(codes) {
  if (codes[0] !== START_B || codes[codes.length - 1] !== STOP) {
    throw new Error('Invalid Code 128 framing.');
  }
  const data = codes.slice(1, -2);
  const checksum = codes[codes.length - 2];

  let calculated = START_B;
  data.forEach((code, index) => { calculated += code * (index + 1); });
  if (calculated % 103 !== checksum) throw new Error('Code 128 checksum failed.');

  return data.map((code) => String.fromCharCode(code + 32)).join('');
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

/**
 * Renders a scannable Code 128-B symbol as SVG.
 *
 * SVG rather than canvas because these are printed: a vector symbol prints at
 * the printer's true resolution, while a rasterised one gets resampled and the
 * bar edges blur — which is exactly what makes a label scan on the third try.
 *
 * @param {string} text        The SKU to encode.
 * @param {number} maxWidthIn  Printable width of the label, in inches.
 * @param {number} heightIn    Bar height, in inches.
 * @param {number} dpi         Target resolution used to compute module width.
 */
export function barcodeSvg(text, maxWidthIn = 1.86, heightIn = 0.43, dpi = 600) {
  const codes = encodeCode128B(text);

  // Round-trip check. See the file header for why this is not redundant.
  const decoded = decodeCode128B(codes);
  if (decoded !== String(text)) {
    throw new Error(`Barcode verification failed for "${text}" — refusing to print it.`);
  }

  const QUIET_MODULES = 10; // Quiet zone each side; scanners need it to lock on.
  let totalModules = QUIET_MODULES * 2;
  const patterns = codes.map((code) => CODE128_PATTERNS[code]);
  for (const pattern of patterns) {
    totalModules += [...pattern].reduce((sum, n) => sum + Number(n), 0);
  }

  const maxPx = Math.floor(maxWidthIn * dpi);
  // At 600 dpi, 4 pixels per module is ~6.7 mil — comfortably above the ~5 mil
  // floor most retail scanners need.
  const pixelsPerModule = Math.max(4, Math.floor(maxPx / totalModules));

  if (totalModules * pixelsPerModule > maxPx) {
    throw new Error(
      `SKU "${text}" is too long for a ${maxWidthIn}in label at a scannable bar width. `
      + 'Use a shorter SKU or larger label stock.',
    );
  }

  const height = Math.floor(heightIn * dpi);
  const rects = [];
  let x = QUIET_MODULES * pixelsPerModule;

  for (const pattern of patterns) {
    let isBar = true;
    for (const widthChar of pattern) {
      const width = Number(widthChar) * pixelsPerModule;
      if (isBar) rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}"/>`);
      x += width;
      isBar = !isBar;
    }
  }

  const width = totalModules * pixelsPerModule;
  return `<svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" `
    + `preserveAspectRatio="xMidYMid meet" role="img" aria-label="Barcode ${escapeXml(text)}">`
    + `<rect width="100%" height="100%" fill="#fff"/>${rects.join('')}</svg>`;
}

export default { encodeCode128B, decodeCode128B, barcodeSvg };
