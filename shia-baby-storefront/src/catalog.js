/**
 * Shia & Co. — Canonical catalog and claims ledger.
 *
 * This module is the single source of truth for products, pricing, and every
 * externally-repeatable claim about the business.
 *
 * FACTORY CONSTITUTION COMPLIANCE
 * -------------------------------
 * Law 4  (evidence outranks confidence) and Invariant 16/17 (epistemic states
 * remain distinct; no fake progress) require that anything an agent might
 * repeat in public carries an explicit epistemic state. GARY-001's
 * growth-operator skill forbids inventing prices, testimonials, reviews, and
 * results — so every field an ad could quote is tagged here.
 *
 * EVIDENCE STATES
 *   confirmed        Owner-confirmed fact. Safe for GARY-001 to publish.
 *   proposed         Drafted by strategy, NOT yet owner-confirmed. Do not publish.
 *   evidence_gap     Known unknown. Must be resolved before it is claimed.
 *   placeholder      Illustrative sample content. NEVER publishable.
 *
 * Only `confirmed` may appear in outbound advertising. Everything else is
 * internal. `publishable()` below enforces that boundary in code, so the rule
 * is mechanical rather than a matter of an agent's judgement (Invariant 13:
 * mechanics become code).
 */

export const EVIDENCE = Object.freeze({
  CONFIRMED: 'confirmed',
  PROPOSED: 'proposed',
  GAP: 'evidence_gap',
  PLACEHOLDER: 'placeholder',
});

/** Only confirmed facts may be used in outbound campaigns. */
export function publishable(node) {
  return node?.evidence_state === EVIDENCE.CONFIRMED;
}

export const BRAND = Object.freeze({
  id: 'shia-and-co',
  legal_business: { value: 'Shia Baby', evidence_state: EVIDENCE.CONFIRMED },
  brand_name: { value: 'Shia & Co.', evidence_state: EVIDENCE.CONFIRMED },
  market: {
    value: 'McAllen, Texas — serving the Rio Grande Valley',
    evidence_state: EVIDENCE.CONFIRMED,
  },
  languages: { value: ['en', 'es'], evidence_state: EVIDENCE.CONFIRMED },
  tagline: {
    en: 'Where first moments become forever',
    es: 'Donde los primeros momentos se vuelven para siempre',
    evidence_state: EVIDENCE.PROPOSED,
    note: 'Strategy-drafted tagline. Confirm with owner before external use.',
  },
  positioning: {
    value:
      'Baby keepsakes and personalized baby songs for RGV families — timeless, ' +
      'personal, and local.',
    evidence_state: EVIDENCE.PROPOSED,
  },
  storefront_status: {
    value: 'pre-launch',
    evidence_state: EVIDENCE.GAP,
    note: 'Open/launch date not supplied. GARY-001 must not imply the store is open.',
  },
});

/**
 * Product lines.
 *
 * `source_system` links each line to the mini-app that actually operates it, so
 * the storefront, the console, and GARY-001 all agree on where truth lives.
 */
export const PRODUCTS = Object.freeze([
  {
    id: 'shia-songs',
    slug: 'shia-songs',
    name: { en: 'Shia Songs — Your Baby’s First Song', es: 'Shia Songs — La primera canción de tu bebé' },
    kind: 'personalized-service',
    hero: true,
    source_system: 'shia-songs',
    summary: {
      en: 'A song written for one baby only, from your family’s story.',
      es: 'Una canción escrita para un solo bebé, a partir de la historia de tu familia.',
      evidence_state: EVIDENCE.PROPOSED,
    },
    price: {
      amount: 89,
      currency: 'USD',
      display: 'from $89',
      evidence_state: EVIDENCE.PROPOSED,
      note: 'Strategy-proposed price point. Owner must confirm before advertising.',
    },
    fulfillment_sla: {
      value: '48 hours',
      evidence_state: EVIDENCE.PROPOSED,
      note: 'Proposed standard. Do not advertise until operationally proven.',
    },
    order_flow: {
      // The existing Spanish-language ordering app already does this job.
      app: 'shia-songs',
      repo: 'crizpy7-sketch/Shia-songs',
      backend: 'supabase:shia_song_orders',
      evidence_state: EVIDENCE.CONFIRMED,
    },
  },
  {
    id: 'first-song-set',
    slug: 'first-song-set',
    name: { en: 'The First Song Set', es: 'El Set de la Primera Canción' },
    kind: 'bundle',
    source_system: 'shia-baby-inventory',
    components: ['shia-songs', 'lyric-keepsake', 'heirloom-onesie'],
    summary: {
      en: 'A Shia Song, a framed lyric keepsake, and an heirloom onesie.',
      es: 'Una Shia Song, un recuerdo con la letra enmarcada y un mameluco de herencia.',
      evidence_state: EVIDENCE.PROPOSED,
    },
    price: { amount: 89, currency: 'USD', display: '$89', evidence_state: EVIDENCE.PROPOSED },
  },
  {
    id: 'welcome-home-box',
    slug: 'welcome-home-box',
    name: { en: 'The Welcome Home Box', es: 'La Caja de Bienvenida' },
    kind: 'bundle',
    source_system: 'shia-baby-inventory',
    components: ['newborn-essentials', 'blanket', 'teddy', 'keepsake'],
    summary: {
      en: 'Newborn essentials, a blanket, a teddy, and a keepsake in one box.',
      es: 'Esenciales para recién nacido, una cobija, un osito y un recuerdo en una caja.',
      evidence_state: EVIDENCE.PROPOSED,
    },
    price: { amount: 129, currency: 'USD', display: '$129', evidence_state: EVIDENCE.PROPOSED },
  },
  {
    id: 'rainbow-blessing',
    slug: 'rainbow-blessing',
    name: { en: 'The Rainbow Blessing', es: 'La Bendición Arcoíris' },
    kind: 'bundle',
    source_system: 'shia-baby-inventory',
    sensitivity: 'high',
    summary: {
      en: 'A tribute set for rainbow babies — keepsake, song, and a hand-written note.',
      es: 'Un set tributo para bebés arcoíris — recuerdo, canción y una nota escrita a mano.',
      evidence_state: EVIDENCE.PROPOSED,
    },
    price: { amount: 99, currency: 'USD', display: '$99', evidence_state: EVIDENCE.PROPOSED },
    agent_guidance:
      'Grief-adjacent. GARY-001 growth-operator skill forbids grief exploitation: ' +
      'no urgency, no scarcity, no performance claims on this line.',
  },
  {
    id: 'abuela-gift',
    slug: 'abuela-gift',
    name: { en: 'The Abuela Gift', es: 'El Regalo de la Abuela' },
    kind: 'service-bundle',
    source_system: 'shia-baby-inventory',
    summary: {
      en: 'Concierge-picked and beautifully wrapped — chosen for you.',
      es: 'Elegido a mano y bellamente envuelto — seleccionado para ti.',
      evidence_state: EVIDENCE.PROPOSED,
    },
    price: {
      amount_min: 75,
      amount_max: 150,
      currency: 'USD',
      display: '$75–$150',
      evidence_state: EVIDENCE.PROPOSED,
    },
    audience_note: 'Spanish-first gift buyers (grandparents). Highest AOV segment.',
  },
]);

/**
 * Claims ledger — every marketing-relevant assertion, with its epistemic state.
 * GARY-001 reads this to know what it may and may not say.
 */
export const CLAIMS = Object.freeze([
  {
    id: 'claim-location',
    text: 'Shia & Co. is based in McAllen, Texas and serves the Rio Grande Valley.',
    evidence_state: EVIDENCE.CONFIRMED,
  },
  {
    id: 'claim-bilingual',
    text: 'Shia & Co. serves customers in English and Spanish.',
    evidence_state: EVIDENCE.CONFIRMED,
  },
  {
    id: 'claim-personalized-song',
    text: 'Shia & Co. offers a personalized baby song product.',
    evidence_state: EVIDENCE.CONFIRMED,
    support: 'Operating order-intake application exists (Shia-songs repo, Supabase-backed).',
  },
  {
    id: 'claim-pricing',
    text: 'Product prices as listed in the catalog.',
    evidence_state: EVIDENCE.PROPOSED,
    blocker: 'Owner has not confirmed final retail pricing.',
  },
  {
    id: 'claim-48h-sla',
    text: 'Shia Songs delivered within 48 hours.',
    evidence_state: EVIDENCE.PROPOSED,
    blocker: 'No fulfillment time has been measured. Do not advertise as a promise.',
  },
  {
    id: 'claim-testimonials',
    text: 'Customer testimonials.',
    evidence_state: EVIDENCE.PLACEHOLDER,
    blocker:
      'No real customer testimonials have been collected. Sample quotes in design ' +
      'mockups are illustrative only and must never be published as real reviews.',
  },
  {
    id: 'claim-reviews-rating',
    text: 'Star rating / review count.',
    evidence_state: EVIDENCE.GAP,
    blocker: 'No Google Business Profile review data supplied.',
  },
  {
    id: 'claim-store-open',
    text: 'The physical store is open / opening date.',
    evidence_state: EVIDENCE.GAP,
    blocker: 'Launch date not supplied. Do not imply an open storefront.',
  },
]);

/** Products whose every publishable field is confirmed. */
export function advertisableProducts() {
  return PRODUCTS.filter((p) => publishable(p.price) && publishable(p.summary));
}

/** Claims GARY-001 is cleared to repeat verbatim. */
export function approvedClaims() {
  return CLAIMS.filter(publishable);
}

/** Claims that block campaigns until resolved — GARY-001 must surface these. */
export function blockingEvidenceGaps() {
  return CLAIMS.filter((c) => c.evidence_state !== EVIDENCE.CONFIRMED);
}

export default { BRAND, PRODUCTS, CLAIMS, EVIDENCE, publishable, advertisableProducts, approvedClaims, blockingEvidenceGaps };
