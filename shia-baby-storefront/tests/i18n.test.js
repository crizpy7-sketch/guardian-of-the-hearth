/**
 * AC-1 — the EN/ES toggle must switch every visible string.
 *
 * A missing key leaves English text stranded on a Spanish page. In a market
 * where a large share of high-value gift buyers are Spanish-first, that is a
 * conversion bug, not a cosmetic one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile, extractObjectBody, topLevelKeys } from './helpers.js';

const html = readRepoFile('public/index.html');
const i18nBody = extractObjectBody(html, 'const I18N =');
const enKeys = topLevelKeys(extractObjectBody(i18nBody, 'en:'));
const esKeys = topLevelKeys(extractObjectBody(i18nBody, 'es:'));

test('both language dictionaries are non-empty', () => {
  assert.ok(enKeys.length > 20, `expected a populated en dictionary, got ${enKeys.length}`);
  assert.ok(esKeys.length > 20, `expected a populated es dictionary, got ${esKeys.length}`);
});

test('en and es dictionaries have identical key sets', () => {
  const missingInEs = enKeys.filter((k) => !esKeys.includes(k));
  const missingInEn = esKeys.filter((k) => !enKeys.includes(k));
  assert.deepEqual(missingInEs, [], `keys missing Spanish translation: ${missingInEs.join(', ')}`);
  assert.deepEqual(missingInEn, [], `keys missing English translation: ${missingInEn.join(', ')}`);
});

test('every data-i18n attribute in the markup has a translation', () => {
  const used = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'no data-i18n attributes found');

  const undefinedKeys = [...new Set(used)].filter((k) => !enKeys.includes(k));
  assert.deepEqual(undefinedKeys, [], `markup references untranslated keys: ${undefinedKeys.join(', ')}`);
});

test('the html lang attribute is updated when language changes', () => {
  assert.match(html, /document\.documentElement\.lang\s*=/, 'setLang must update <html lang>');
});
