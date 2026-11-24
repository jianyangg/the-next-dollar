import { z } from 'zod';

/**
 * Runtime (zod) description of the PUBLIC half of a deal. The server owns its deals
 * (shared/deals registry) and no longer accepts them from clients, so this schema is
 * a safety net: a test parses every registered deal with it, proving each entry is
 * well-formed and carries no `reservationPrice`.
 *
 * It mirrors `PublicDealView` (shared/deals/types.ts); shared/dealSchema.test.ts
 * proves at compile time and at run time that the two stay in step.
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

export type PublicDealData = z.infer<typeof publicDealViewSchema>;
