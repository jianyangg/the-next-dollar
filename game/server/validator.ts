import type { PublicDealView } from '../shared/deals/index.ts';
import { MAX_REPLY_WORDS } from '../shared/limits.ts';
import { sellerReplySchema } from '../shared/sellerReply.ts';

/**
 * The seller validator (CONFIGURATION.md A7). A pure function: the same reply and
 * deal always give the same verdict, with no network, clock or randomness. It runs
 * on EVERY model reply before the player can see it.
 *
 * Checks run in this order and the first failure wins:
 *   1. shape      valid JSON, `{ text: string }`, not empty, not a refusal, <= 80 words
 *   2. numbers    every number in the text is a figure from this deal
 *   3. volunteer  PITCH ONLY: the pitch does not mention an off-book fact
 *   4. banned     discount / promise / other-player / minimum-bid phrases
 *
 * HONEST LIMITS. This is a keyword-and-number filter, not understanding. It cannot
 * tell whether a sentence is TRUE, only that its numbers are allowed and that
 * certain words are absent. Each check lists below what it catches and misses.
 */

export type RejectReason =
  | 'bad-json'
  | 'bad-shape'
  | 'empty'
  | 'too-long'
  | 'refusal'
  | 'number-not-in-books'
  | 'volunteered-off-book'
  | 'banned-phrase'
  | 'non-ascii-letters';

export type Verdict = { ok: true; text: string } | { ok: false; reason: RejectReason; detail?: string };
export type ReplyKind = 'pitch' | 'answer';

// ---------------------------------------------------------------------------
// 0. Normalisation (runs once, before ANY check)
// ---------------------------------------------------------------------------
//
// WHY: every check below is a text pattern, and attackers (or a confused model) can
// dodge a pattern without changing what a human reads:
//   "dis​count"      a zero-width space hides the banned word from /discount/
//   "ｄｉｓｃｏｕｎｔ"        full-width letters look the same, but are different code points
//   "dіscount"        a Cyrillic "і" looks like Latin "i"
// So we first make the text canonical:
//   1. NFKC (Unicode compatibility normalisation) folds full-width letters/digits,
//      ligatures, "…" -> "..." and similar look-alikes into plain characters.
//   2. Strip every \p{Cf} ("format") character: zero-width space/joiner/non-joiner,
//      the byte-order mark, and the bidirectional-text controls. They have no
//      visible glyph, so they can only be used to hide things.
// All checks run on this normalised text, and the normalised text is what the
// player sees, so what we checked is exactly what is shown.
//
// Look-alikes that survive NFKC (Cyrillic "і", Greek "ο") are caught by the
// ASCII-only rule below, not by normalisation.

export function normalizeReplyText(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

// ASCII-ONLY RULE. After normalisation a reply may contain only:
//   - printable ASCII, plus newline and tab, and
//   - this small allow-list of common typographic characters the model likes to use:
//     curly quotes ‘ ’ “ ”, en dash –, em dash —, and the star ★.
//     (An ellipsis … is already turned into "..." by NFKC.)
// Anything else (accented or Cyrillic/Greek letters, other scripts, non-ASCII digits,
// emoji, symbols) rejects the reply with 'non-ascii-letters'. This is stricter than
// "letters only" on purpose: the game is English-only, and every non-ASCII character
// is a chance to hide a look-alike. Cost: an innocent "café" is rejected too; the
// player then sees the fallback instead, which is the safe direction.
const ALLOWED_NON_ASCII = new Set(['‘', '’', '“', '”', '–', '—', '★']);

/** The first character that breaks the ASCII-only rule, or null. */
export function findDisallowedCharacter(text: string): string | null {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const printableAscii = (code >= 0x20 && code <= 0x7e) || ch === '\n' || ch === '\t' || ch === '\r';
    if (!printableAscii && !ALLOWED_NON_ASCII.has(ch)) return ch;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Shape
// ---------------------------------------------------------------------------

const REFUSAL = /^\s*(i['’]?m sorry|sorry,|i cannot|i can['’]?t|i am unable|i['’]?m unable|as an ai)\b/i;

export function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// 2. Numbers
// ---------------------------------------------------------------------------
//
// CAUGHT: digits ("$18", "14", "1,000", "14.50", "5%", "3 days", "4th"), spelled-out
// numbers from zero to ninety-nine except "one" (and compounds such as "twenty-one"),
// plus "dozen", "hundred", "thousand", "million".
//
// MISSED (documented, not hidden):
//  - The UNIT is not checked. "5 days" passes if $5 (rent) is a figure, because we
//    only compare the number 5. A model that confuses units would slip through.
//  - "one" is skipped: it is mostly the pronoun/determiner ("one of the best"), and
//    rejecting every "one" would reject most replies. "one dollar" therefore passes.
//  - Vague quantities ("a couple", "half", "twice", "a few") and roman numerals.
//  - Digits written with a non-ASCII script are normalised (NFKC) first, so full-width
//    digits ARE caught, but other numeral systems (e.g. Arabic-Indic) are not.
//  - A number can be allowed yet used falsely ("sales were $15 today"): truthfulness
//    of the claim around the number is not checked.

const UNITS: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const BIG: Record<string, number> = { dozen: 12, hundred: 100, thousand: 1000, million: 1_000_000 };

const DIGITS = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const TENS_WORDS = Object.keys(TENS).join('|');
// "twenty", "twenty-one", "twenty one" ("one" is only consumed as part of a compound).
const TENS_COMPOUND = new RegExp(`\\b(${TENS_WORDS})(?:[- ]one|[- ](two|three|four|five|six|seven|eight|nine))?\\b`, 'g');
const PLAIN_WORDS = new RegExp(`\\b(${[...Object.keys(UNITS), ...Object.keys(BIG)].join('|')})\\b`, 'g');

/** Every number the text mentions, as numeric values. Exported for tests. */
export function extractNumbers(text: string): number[] {
  const t = text.normalize('NFKC');
  const found: number[] = [];

  for (const m of t.matchAll(DIGITS)) found.push(Number(m[0].replace(/,/g, '')));

  const lower = t.toLowerCase();
  // Handle tens-compounds first and blank them out so "twenty" is not counted twice.
  const withoutCompounds = lower.replace(TENS_COMPOUND, (whole: string, tens: string, unit?: string) => {
    const tensValue = TENS[tens] ?? 0;
    const unitValue = unit ? (UNITS[unit] ?? 0) : whole.match(/[- ]one$/) ? 1 : 0;
    found.push(tensValue + unitValue);
    return ' ';
  });
  for (const m of withoutCompounds.matchAll(PLAIN_WORDS)) {
    const word = m[1] ?? '';
    found.push(UNITS[word] ?? BIG[word] ?? Number.NaN);
  }
  return found;
}

/** The set of figures a reply may use: asking price, every book cell, and off-book figures. */
export function allowedFigures(deal: PublicDealView): Set<number> {
  const allowed = new Set<number>([deal.askingPrice]);
  for (const b of deal.books) {
    for (const n of [b.sales, b.lemons, b.managerWage, b.rent, b.profit]) allowed.add(n);
    // Period labels such as "2 periods ago" are printed in the books too.
    for (const m of b.label.matchAll(DIGITS)) allowed.add(Number(m[0].replace(/,/g, '')));
  }
  for (const f of deal.offBookFacts) for (const n of f.figures) allowed.add(n);
  return allowed;
}

// ---------------------------------------------------------------------------
// 3. Volunteer guard (pitch only)
// ---------------------------------------------------------------------------
//
// SPEC GAP: A7.3 says the pitch must not volunteer off-book NEGATIVE facts, but the
// deal data (OffBookFact) has no "is negative" flag. We therefore guard EVERY
// off-book fact in a pitch. Safe direction: it can wrongly reject a harmless pitch
// (the player then sees the template), never wrongly allow a leak of a flagged one.
//
// A pitch is rejected if it:
//  (a) contains a figure that appears ONLY in an off-book fact (e.g. the "4" in
//      "lease renews in 4 days"), or
//  (b) contains a keyword for the fact's topic (lease/renew/landlord, manager/
//      wage/unpaid, moving/relocating/commute), or
//  (c) shares a distinctive word STEM (first 5 letters of a 6+ letter word) with
//      the fact's own statement, e.g. "Brooklyn", "uptown", "personally".
//
// MISSED: a paraphrase using none of those words or figures ("things are changing
// at the end of the month", "I'm ready for a fresh start"); a negative fact whose
// statement is short and generic; and the second-order case where the model hints
// without any fact vocabulary. Whether this guard is good enough, or a second model
// check is needed, is CONFIGURATION.md open question 2. Only a human-read sample of
// live pitches (the live evaluation) can answer it.
// FALSE POSITIVES: a pitch that praises a "personally run" stand, or says "manager"
// in a harmless way, is rejected.

const TOPIC_KEYWORDS: Record<string, RegExp> = {
  staffing: /\b(manager|managers|wage|wages|payroll|staff|employee|employees|unpaid|owner[- ]operated|(?:run|runs|running|ran)\s+(?:it|the stand|this place)\s+(?:myself|personally|alone))\b/i,
  lease: /\b(lease|leases|leasing|renew|renews|renewal|renewing|landlord|rent (?:rise|rises|increase|increases|hike|goes up|is going up|step))\b/i,
  'reason-for-selling': /\b(moving|move|relocat\w*|leaving|commute|why i['’]?m selling|reason for selling|retiring|graduat\w*)\b/i,
};

const STEM_STOPWORDS = new Set(['seller', 'lemonade', 'because', 'another', 'without', 'before', 'during']);

function distinctiveStems(statement: string): string[] {
  const stems = new Set<string>();
  for (const w of statement.toLowerCase().match(/[a-z]{6,}/g) ?? []) {
    if (!STEM_STOPWORDS.has(w)) stems.add(w.slice(0, 5));
  }
  return [...stems];
}

/** Why a pitch counts as volunteering an off-book fact, or null if it does not. */
export function findVolunteeredFact(text: string, deal: PublicDealView): string | null {
  const bookFigures = new Set<number>([deal.askingPrice]);
  for (const b of deal.books) for (const n of [b.sales, b.lemons, b.managerWage, b.rent, b.profit]) bookFigures.add(n);

  const mentioned = extractNumbers(text);
  const textStems = new Set((text.normalize('NFKC').toLowerCase().match(/[a-z]{6,}/g) ?? []).map((w) => w.slice(0, 5)));

  for (const fact of deal.offBookFacts) {
    const ownFigure = fact.figures.find((n) => !bookFigures.has(n) && mentioned.includes(n));
    if (ownFigure !== undefined) return `${fact.id}: figure ${ownFigure}`;

    const keyword = TOPIC_KEYWORDS[fact.topic]?.exec(text);
    if (keyword) return `${fact.id}: keyword "${keyword[0]}"`;

    const stem = distinctiveStems(fact.statement).find((s) => textStems.has(s));
    if (stem) return `${fact.id}: word starting "${stem}"`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Banned phrases (A7.4, plus A3 "hinting at a minimum acceptable bid")
// ---------------------------------------------------------------------------
//
// MISSED: any wording that avoids these exact words ("I could come down a little",
// "make it worth my while" are NOT in the list). Matching is on whole words,
// case-insensitive. "lower" and "bargain" can reject innocent sales talk ("lower
// costs", "a bargain"); that is accepted: the player just gets the fallback.

const BANNED: Array<[label: string, pattern: RegExp]> = [
  ['price change', /\b(discount\w*|deal on the price|lower|i['’]?ll take|negotiable|haggle|haggling|bargain\w*|come down|knock off|price drop)\b/i],
  ['minimum bid', /\b(minimum|lowest|bottom dollar|reserve price|reservation|rock[- ]bottom)\b/i],
  ['promise', /\b(guarantee\w*|double|triple|risk[- ]free|can['’]?t lose|sure thing|promise\w*)\b/i],
  ['other players or game', /\b(other (?:players?|buyers?|bidders?|stands?|deals?|sellers?)|another (?:buyer|bidder|player)|leaderboard|the game|game rules?|random seed)\b/i],
];

// ---------------------------------------------------------------------------

export function validateSellerReply(rawText: string, deal: PublicDealView, kind: ReplyKind): Verdict {
  // 1. Shape.
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const parsed = sellerReplySchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'bad-shape' };

  // Normalise ONCE, before every check (see section 0), then trim.
  const text = normalizeReplyText(parsed.data.text).trim();
  if (text === '') return { ok: false, reason: 'empty' };
  const odd = findDisallowedCharacter(text);
  if (odd !== null) {
    const hex = (odd.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    return { ok: false, reason: 'non-ascii-letters', detail: `U+${hex}` };
  }
  if (REFUSAL.test(text)) return { ok: false, reason: 'refusal' };
  const words = countWords(text);
  if (words > MAX_REPLY_WORDS) return { ok: false, reason: 'too-long', detail: `${words} words` };

  // 2. Numbers.
  const allowed = allowedFigures(deal);
  const stray = extractNumbers(text).find((n) => !allowed.has(n));
  if (stray !== undefined) return { ok: false, reason: 'number-not-in-books', detail: String(stray) };

  // 3. Volunteer guard: the pitch only. Answers must be free to disclose off-book facts.
  if (kind === 'pitch') {
    const hit = findVolunteeredFact(text, deal);
    if (hit) return { ok: false, reason: 'volunteered-off-book', detail: hit };
  }

  // 4. Banned phrases.
  for (const [label, pattern] of BANNED) {
    const m = pattern.exec(text);
    if (m) return { ok: false, reason: 'banned-phrase', detail: `${label}: "${m[0]}"` };
  }

  return { ok: true, text };
}
