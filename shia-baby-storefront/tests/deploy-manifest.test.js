/**
 * Deploy manifest — the list of files that MUST reach production.
 *
 * WHY THIS EXISTS
 * ---------------
 * Deploys to this project are file-direct: the deploying agent enumerates the
 * file tree by hand and Vercel replaces the whole deployment with exactly what
 * it is handed. That makes an omission silent and total. It has happened twice:
 * once leaving production with no HTML pages at all (the API and stylesheet
 * answered 200 while `/` returned 404), and once shipping an `api/health.js`
 * that existed in no repository, because it was pasted into the deploy payload
 * instead of being written to disk.
 *
 * Verifying "the deploy worked" by fetching `/api/health` cannot catch either
 * failure — the functions are exactly the part that survives. So this file turns
 * the payload into a checked list rather than a remembered one.
 *
 * The manifest is deliberately explicit. Do not replace it with a glob: a glob
 * would happily describe whatever happens to be on disk, which is the assumption
 * that failed. Adding a shipped file means adding a line here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Static assets. An omission here 404s the site while the API looks healthy. */
export const PUBLIC_FILES = Object.freeze([
  'public/index.html',
  'public/shop/index.html',
  'public/reveal/index.html',
  'public/reveal-secret.html',
  'public/order-complete.html',
  'public/console/index.html',
  'public/console/invoice/index.html',
  'public/assets/theme.css',
  'public/assets/barcode.js',
  'public/agent/README.md',
]);

/** Serverless functions. Vercel's Hobby plan allows 12; we ship 8. */
export const API_FILES = Object.freeze([
  'api/health.js',
  'api/catalog.js',
  'api/products.js',
  'api/subscribe.js',
  'api/checkout.js',
  'api/reveal.js',
  'api/square/sync.js',
  'api/agent/brief.js',
  'api/admin/products.js',
  'api/admin/songs.js',
]);

/** Modules the functions import. A missing one breaks every route at runtime. */
export const SRC_FILES = Object.freeze([
  'src/catalog.js',
  'src/agent-surface.js',
  'src/data-layer.js',
  'src/products.js',
  'src/auth.js',
  'src/square.js',
  'src/reveal.js',
  'src/barcode.js',
]);

export const CONFIG_FILES = Object.freeze(['vercel.json', 'package.json']);

export const DEPLOY_MANIFEST = Object.freeze([
  ...PUBLIC_FILES, ...API_FILES, ...SRC_FILES, ...CONFIG_FILES,
]);

test('every file in the deploy manifest exists on disk', () => {
  const missing = DEPLOY_MANIFEST.filter((f) => !existsSync(join(ROOT, f)));
  assert.deepEqual(missing, [], `manifest lists files that do not exist: ${missing.join(', ')}`);
});

test('the manifest ships at most 12 serverless functions', () => {
  // Exceeding the Hobby plan's function limit fails the deploy outright.
  assert.ok(API_FILES.length <= 12, `${API_FILES.length} functions exceeds the plan limit`);
});

test('the site has an entry point — the omission that produced a 404 homepage', () => {
  assert.ok(PUBLIC_FILES.includes('public/index.html'));
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<html/i, 'the homepage must actually be an HTML document');
});

test('vercel.json serves the directory the manifest fills', () => {
  const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(config.outputDirectory, 'public');
  // Every static file in the manifest must live under that directory, or it is
  // published to a path nothing serves.
  const strays = PUBLIC_FILES.filter((f) => !f.startsWith(`${config.outputDirectory}/`));
  assert.deepEqual(strays, [], `static files outside outputDirectory: ${strays.join(', ')}`);
});

test('the version on disk is the version the deploy claims', () => {
  // The drift that put an unversioned api/health.js into production showed up
  // here first: package.json said 1.0.0 while STATUS.md described a 1.1.1 deploy.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const status = readFileSync(join(ROOT, 'docs/STATUS.md'), 'utf8');
  assert.match(
    status,
    new RegExp(`\\*\\*Version:\\*\\* ${pkg.version.replace(/\./g, '\\.')}\\b`),
    `STATUS.md must document package.json's version (${pkg.version})`,
  );
});

test('the admin_console health gate is present in the committed source', () => {
  // This gate ran in production while existing in no repository. Assert it is
  // on disk so the deployed artifact can never again be the only copy.
  const health = readFileSync(join(ROOT, 'api/health.js'), 'utf8');
  assert.match(health, /admin_console/, 'api/health.js must define the admin_console gate');
  assert.match(health, /SHIA_CONSOLE_TOKEN/, 'the gate must read the console token');
});
