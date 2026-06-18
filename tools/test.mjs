// Runs the engine's built-in verification suite (src/core.js → GOTH.TestSuite)
// under Node using fake-indexeddb, mirroring the in-app harness (makeTestEnv).
//
//   node tools/test.mjs
//
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import 'fake-indexeddb/auto';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(root + 'src/core.js', 'utf8');

// core.js attaches GOTH to its root (self||globalThis); give it what a browser has.
globalThis.self = globalThis;
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;

vm.runInThisContext(core, { filename: 'core.js' });
const G = globalThis.GOTH;
if (!G || !G.TestSuite) throw new Error('GOTH.TestSuite not found after loading core.js');

function deleteDb(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
async function makeTestEnv() {
  await deleteDb(G.CONFIG.DB.testName);
  const backend = G.createIdbBackend(G.CONFIG.DB.testName);
  const db = G.makeDB(backend);
  await db.open();
  const repos = G.makeRepositories(db);
  const services = G.makeServices(db, repos);
  return {
    db, repos, services,
    reset: () => db.clearAllStores(),
    close: () => db.close(),
  };
}

const results = await G.TestSuite.runAll(makeTestEnv);
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  if (!r.ok) console.log('  FAIL  ' + r.name + '  —  ' + r.error);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed` +
  (failed.length ? `, ${failed.length} FAILED` : ' ✓'));
process.exit(failed.length ? 1 : 0);
