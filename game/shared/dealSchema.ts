import { z } from 'zod';

/**
 * Runtime (zod) description of the PUBLIC half of a deal, the only half the
 * server may ever receive or store.
 *
 * It mirrors `PublicDealView` in src/core/deal.ts. shared/ must not import from
 * src/ (the Worker project cannot see the browser code), so the shape is written
 * out here and shared/dealSchema.test.ts proves at compile time and at run time
 * that the two stay in step.
 *
 * Every object is `strictObject`: an unknown key is an error, not silently
 * dropped. That is what makes a stray `reservationPrice` a rejected request
 * instead of a field that quietly rides along into storage or a prompt.
 */

/** Keep in step with `NeighborhoodId` in src/core/neighborhoods.ts (checked by the test). */
export const NEIGHBORHOOD_IDS = [
  'central-park',
  'columbia',
  'broadway',
  'market',
  'west-village',
  'fidi',
  'fifth-ave',
] as const;

const money = z.number().finite().min(0).max(1_000_000);

export const bookPeriodSchema = z.strictObject({
  label: z.string().min(1).max(40),
  sales: money,
  lemons: money,
  managerWage: money,
  rent: money,
  profit: z.number().finite().min(-1_000_000).max(1_000_000),
});

export const offBookFactSchema = z.strictObject({
  id: z.string().min(1).max(64),
  topic: z.enum(['staffing', 'lease', 'reason-for-selling']),
  statement: z.string().min(1).max(400),
  figures: z.array(z.number().finite()).max(10),
});

export const publicDealViewSchema = z.strictObject({
  id: z.string().min(1).max(64),
  neighborhood: z.enum(NEIGHBORHOOD_IDS),
  askingPrice: money,
  books: z.array(bookPeriodSchema).min(1).max(6),
  offBookFacts: z.array(offBookFactSchema).max(4),
});

/**
 * The seller's character. The client sends it with the pitch request because the
 * deal data (src/core/deal.ts) does not carry a persona yet.
 *
 * SECURITY: name, location and manner are pasted into the model's system prompt,
 * so a modified browser could use them to smuggle instructions. They are therefore
 * short and limited to ordinary letters, digits and light punctuation. The proper
 * fix is for the server to own personas and look them up by deal id; until then
 * this allow-list is the guard.
 */
const personaText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[\p{L}\p{N} .,'’&-]+$/u, "letters, digits and . , ' & - only");

export const sellerPersonaSchema = z.strictObject({
  /** Seller's name, e.g. "Miles". */
  name: personaText(40),
  /** Where the stand is, e.g. "Park Corner". */
  location: personaText(60),
  /** Way of talking, e.g. "warm, chatty". */
  manner: personaText(60),
});

export type SellerPersona = z.infer<typeof sellerPersonaSchema>;
export type PublicDealData = z.infer<typeof publicDealViewSchema>;
