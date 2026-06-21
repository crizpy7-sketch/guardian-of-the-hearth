// Pure-Node PNG cut-out tool (no native deps) for Guardian of the Hearth.
// Decodes 8-bit RGB/RGBA PNGs, removes a green-screen background to alpha,
// splits sprite sheets into cells, auto-trims to content, and re-encodes RGBA.
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const SRC = '/root/.claude/uploads/58de9331-a6e8-5ec3-b72a-5be3f6a4c43f/';

function decodePNG(path) {
  const b = readFileSync(path);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const bitDepth = b[24], colorType = b[25];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error('unsupported PNG ' + path + ' bd=' + bitDepth + ' ct=' + colorType);
  }
  const channels = colorType === 6 ? 4 : 3;
  // gather IDAT
  let p = 8; const chunks = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p); const type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') chunks.push(b.slice(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = w * channels;
  const rgba = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[off++];
    const line = Buffer.from(raw.slice(off, off + stride)); off += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const bb = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + bb) & 255;
      else if (filter === 3) v = (v + ((a + bb) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
        v = (v + pred) & 255;
      }
      line[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * channels, d = (y * w + x) * 4;
      rgba[d] = line[s]; rgba[d + 1] = line[s + 1]; rgba[d + 2] = line[s + 2];
      rgba[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { w, h, rgba };
}

// Remove green-screen: alpha->0 where green clearly dominates (chroma green),
// while preserving muted/sage greens in artwork (small dominance margin).
function chromaKey(img, opts) {
  const { rgba, w, h } = img;
  const margin = opts.margin != null ? opts.margin : 60; // how much g must exceed r & b
  const minG = opts.minG != null ? opts.minG : 90;
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (g >= minG && (g - r) >= margin && (g - b) >= margin) {
      rgba[i * 4 + 3] = 0;
    } else if (g >= minG && (g - r) >= margin * 0.6 && (g - b) >= margin * 0.6) {
      // soft edge: knock down green spill a bit and partially fade
      rgba[i * 4 + 3] = 120;
      rgba[i * 4 + 1] = Math.min(g, Math.round((r + b) / 2) + 30);
    }
  }
  return img;
}

function crop(img, x0, y0, x1, y1) {
  const nw = x1 - x0, nh = y1 - y0;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const s = ((y + y0) * img.w + (x + x0)) * 4, d = (y * nw + x) * 4;
      out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1]; out[d + 2] = img.rgba[s + 2]; out[d + 3] = img.rgba[s + 3];
    }
  return { w: nw, h: nh, rgba: out };
}

function autotrim(img, pad) {
  const { rgba, w, h } = img;
  let minX = w, minY = h, maxX = 0, maxY = 0, any = false;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 16) {
        any = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  if (!any) return img;
  pad = pad || 0;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  return crop(img, minX, minY, maxX + 1, maxY + 1);
}

function encodePNG(img, path) {
  const { w, h, rgba } = img;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const out = [];
  out.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    out.push(len, t, data, crc);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  chunk('IHDR', ihdr); chunk('IDAT', idat); chunk('IEND', Buffer.alloc(0));
  writeFileSync(path, Buffer.concat(out));
  return { w, h, bytes: Buffer.concat(out).length };
}

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return ~c; }

// ---- sample corners to confirm background color ----
const samples = ['6e4f9e82-IMG_5170', '4ee599f8-IMG_5171', '6b58cc04-IMG_5169'];
for (const name of samples) {
  const img = decodePNG(SRC + name + '.png');
  const c = (x, y) => { const i = (y * img.w + x) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };
  console.log(name, img.w + 'x' + img.h, 'TL', c(5, 5), 'TR', c(img.w - 6, 5), 'BL', c(5, img.h - 6), 'mid-top', c(img.w >> 1, 8));
}

export { decodePNG, chromaKey, crop, autotrim, encodePNG };
