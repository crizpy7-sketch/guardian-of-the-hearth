import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readRepoFile(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

/**
 * Returns the object-literal body that follows `marker`, brace-matched.
 * Used to pull the I18N dictionaries out of the storefront HTML without
 * evaluating the page's script.
 */
export function extractObjectBody(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);

  const open = source.indexOf('{', start + marker.length - 1);
  if (open === -1) throw new Error(`no object literal after: ${marker}`);

  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const prev = source[i - 1];

    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after: ${marker}`);
}

/** Top-level keys of an object-literal body (ignores nested objects/strings). */
export function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let token = '';

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const prev = body[i - 1];

    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; token = ''; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; token = ''; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; token = ''; continue; }

    if (depth !== 0) continue;

    if (/[A-Za-z0-9_$]/.test(ch)) {
      token += ch;
    } else if (ch === ':') {
      if (token) keys.push(token);
      token = '';
    } else if (ch === ',' || ch === '\n') {
      token = '';
    }
  }
  return keys;
}
