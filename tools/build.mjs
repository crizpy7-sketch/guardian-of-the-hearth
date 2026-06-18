// Build step for Guardian of the Hearth.
//
// The app ships as a single static index.html. The readable sources live in
// src/ (core.js = game engine, ui.jsx = React UI). This script splices them
// back into index.html, transpiling the JSX ahead of time so the phone never
// has to run Babel at runtime.
//
//   npm run build
//
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetReact = require('@babel/preset-react');

const root = new URL('..', import.meta.url).pathname;
let html = readFileSync(root + 'index.html', 'utf8');
const core = readFileSync(root + 'src/core.js', 'utf8');
const jsx = readFileSync(root + 'src/ui.jsx', 'utf8');

// Replace a <script>…</script> block, identified by a string it must contain.
function replaceScript(html, marker, newInner) {
  const markerIdx = html.indexOf(marker);
  if (markerIdx < 0) throw new Error('marker not found: ' + marker);
  const open = html.lastIndexOf('<script>', markerIdx);
  if (open < 0) throw new Error('opening <script> not found for: ' + marker);
  const innerStart = open + '<script>'.length;
  const close = html.indexOf('</script>', innerStart);
  if (close < 0) throw new Error('closing </script> not found for: ' + marker);
  return html.slice(0, innerStart) + newInner + html.slice(close);
}

// Core engine: copied verbatim (it is already plain JS).
html = replaceScript(html, 'GUARDIAN OF THE HEARTH — CORE', '\n' + core + '\n');

// UI: transpile JSX -> React.createElement (classic runtime, no Babel at runtime).
const out = babel.transformSync(jsx, {
  presets: [[presetReact, { runtime: 'classic', development: false }]],
  compact: false,
  comments: true,
  filename: 'ui.jsx',
  // Keep emoji / non-ASCII literals raw instead of \uXXXX escapes.
  generatorOpts: { jsescOption: { minimal: true } },
});
html = replaceScript(html, 'ReactDOM.createRoot', '\n' + out.code + '\n');

writeFileSync(root + 'index.html', html);
console.log('built index.html — core %d bytes, ui %d -> %d bytes',
  core.length, jsx.length, out.code.length);
