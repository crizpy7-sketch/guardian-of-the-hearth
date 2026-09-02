/**
 * GET /api/health — deployment health gates.
 *
 * APP_BUILD_STANDARD.md §7: a deployment is not successful merely because a
 * build finished. This endpoint reports each layer separately so CI can fail a
 * deploy on real evidence rather than on a shallow liveness ping.
 *
 * Returns 200 when every REQUIRED gate passes. A degraded-but-serving data
 * layer is reported honestly as `degraded: true` and does not fake success.
 */

import { probe, backendMode } from '../src/data-layer.js';
import { PRODUCTS } from '../src/catalog.js';
import { buildBrief } from '../src/agent-surface.js';

/**
 * Reports whether the operator token is usable, and — importantly — whether the
 * stored value carries surrounding whitespace.
 *
 * Pasting a secret into a dashboard field commonly appends a newline. That made
 * the stored value one byte longer than the header the console sends, so the
 * constant-time comparison's length check failed first and every unlock returned
 * a bare 401. `requireOperator()` now trims both sides, but the whitespace is
 * still worth surfacing: it explains an otherwise invisible past failure, and it
 * tells the operator their stored value is not exactly what they think it is.
 */
function inspectConsoleToken() {
  const raw = process.env.SHIA_CONSOLE_TOKEN ?? '';
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: true,
      degraded: true,
      detail: 'SHIA_CONSOLE_TOKEN is not set; admin endpoints refuse to serve.',
    };
  }
  return {
    ok: true,
    degraded: false,
    detail: raw === trimmed
      ? 'operator token configured'
      : 'operator token configured (note: stored value has surrounding whitespace; it is trimmed before comparison)',
  };
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  const gates = [];

  // Gate 1 — web/runtime: the function executes at all.
  gates.push({ id: 'web', required: true, ok: true });

  // Gate 2 — catalog integrity: the product spine loads and is non-empty.
  const catalogOk = Array.isArray(PRODUCTS) && PRODUCTS.length > 0;
  gates.push({
    id: 'catalog',
    required: true,
    ok: catalogOk,
    detail: `${PRODUCTS.length} product lines`,
  });

  // Gate 3 — agent surface: GARY-001's brief builds and separates claim states.
  let agentOk = false;
  let agentDetail = '';
  try {
    const brief = buildBrief();
    agentOk = Array.isArray(brief.approved_claims) && Array.isArray(brief.blocked_claims);
    agentDetail = `${brief.approved_claims.length} approved / ${brief.blocked_claims.length} blocked claims`;
  } catch (error) {
    agentDetail = error.message;
  }
  gates.push({ id: 'agent_surface', required: true, ok: agentOk, detail: agentDetail });

  // Gate 4 — data layer. Not required: the storefront still serves and captures
  // signups in degraded mode, so an unconfigured backend must not block a deploy.
  const dataProbe = await probe();
  gates.push({
    id: 'data_layer',
    required: false,
    ok: dataProbe.ok,
    degraded: dataProbe.degraded,
    mode: dataProbe.mode,
    detail: dataProbe.reason ?? 'connected',
  });

  // Gate 5 — admin console. Not required: a storefront with no back office still
  // serves customers correctly, and an unset token is a safe state, not a fault.
  const consoleGate = inspectConsoleToken();
  gates.push({
    id: 'admin_console',
    required: false,
    ok: consoleGate.ok,
    degraded: consoleGate.degraded,
    detail: consoleGate.detail,
  });

  const requiredFailures = gates.filter((g) => g.required && !g.ok);
  const healthy = requiredFailures.length === 0;
  const degraded = gates.some((g) => g.degraded);

  res.setHeader('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? (degraded ? 'degraded' : 'healthy') : 'unhealthy',
    healthy,
    degraded,
    backend: backendMode(),
    gates,
    failed_required_gates: requiredFailures.map((g) => g.id),
    checked_in_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
