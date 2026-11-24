import type { PublicDealView, SellerPersona } from '../shared/deals/index.ts';

/**
 * The fallback texts (CONFIGURATION.md A8). No model is involved, so they cannot
 * invent a number: the template only copies figures out of the deal's own books.
 */

/** A8: shown when an ANSWER fails (timeout, error, or validator rejection). */
export const NEUTRAL_ANSWER = "I've put everything I have on the sheet—make your best offer.";

/**
 * A tiny seeded random generator (mulberry32). The document says the template
 * "chooses which numbers to show and the order of sentences at random", but the
 * repo forbids Math.random in game logic (src/core/noMathRandom.test.ts) and a
 * fixed seed makes the same deal always read the same, which keeps tests exact.
 * We seed from the deal id, so different deals still read differently.
 */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Scripted pitch built ONLY from the deal's real numbers. It deliberately avoids
 * the manager-wage and rent columns and every off-book fact, so it can never hint
 * at the catch (A8: "never volunteers off-book facts"). A test runs it through the
 * real validator for many deal ids.
 *
 * Example output: "A brownstone corner by Central Park stand for sale, $60. Latest profit: $8 a day.
 * Latest sales: $16 a day. The books are below."
 */
export function buildTemplatePitch(deal: PublicDealView, persona: SellerPersona): string {
  // Persona locations are lower-case phrases ("a brownstone corner by Central Park"); capitalise for a sentence start.
  const where = persona.location.charAt(0).toUpperCase() + persona.location.slice(1);
  const rand = seededRandom(deal.id);
  const first = deal.books[0];
  const latest = deal.books[deal.books.length - 1];
  // Schema guarantees at least one period; this guard keeps the compiler honest too.
  if (!first || !latest) return `${where} stand for sale, $${deal.askingPrice}. The books are below.`;

  const facts: string[] = [
    `Latest sales: $${latest.sales} a day.`,
    `Latest profit: $${latest.profit} a day.`,
  ];
  // Only claim growth when the books really show it.
  if (deal.books.length > 1 && latest.sales > first.sales) {
    facts.push(`Daily sales went from $${first.sales} to $${latest.sales}.`);
  }

  const chosen = shuffled(facts, rand).slice(0, 2);
  return [`${where} stand for sale, $${deal.askingPrice}.`, ...chosen, 'The books are below.'].join(' ');
}
