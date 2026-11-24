import { describe, expect, it } from 'vitest';
import { ledgerChips } from './ledgerChips';
import { buyCampaign } from './marketing';
import { buyLemons, buyPitcher, sellUsedPitcher } from './purchases';
import { applySale } from './sales';
import { createInitialState, type SliceState } from './sliceModel';

/** Apply a purchase rule that must succeed, returning the new state. */
function mustBuy(rule: (s: SliceState) => ReturnType<typeof buyPitcher>, s: SliceState): SliceState {
  const r = rule(s);
  if (!r.ok) throw new Error(`purchase refused: ${r.reason}`);
  return r.state;
}

describe('ledgerChips', () => {
  it('a pitcher purchase moves cash into gear: PROFIT $0 and the line unchanged', () => {
    // Today's line was fixed at the opening bell, so no purchase can move it (no line chip).
    const before = createInitialState();
    const after = mustBuy(buyPitcher, before);
    expect(ledgerChips(before, after)).toEqual([
      { kind: 'cash', delta: -10 },
      { kind: 'gear', delta: 10 },
      { kind: 'profit', delta: 0 },
    ]);
  });

  it('a lemon crate moves cash into stock', () => {
    const before = createInitialState();
    const after = mustBuy(buyLemons, before);
    expect(ledgerChips(before, after).map((c) => c.kind)).toEqual(['cash', 'stock', 'profit']);
    expect(ledgerChips(before, after)[0]).toEqual({ kind: 'cash', delta: -5 });
  });

  it('selling a used pitcher below cost shows the loss in profit', () => {
    const owned = mustBuy(buyPitcher, createInitialState());
    const after = mustBuy(sellUsedPitcher, owned);
    const chips = ledgerChips(owned, after);
    expect(chips.find((c) => c.kind === 'cash')?.delta).toBe(7);
    expect(chips.find((c) => c.kind === 'gear')?.delta).toBe(-10);
    expect(chips.find((c) => c.kind === 'profit')?.delta).toBe(-3);
    // The $3 loss does not move TODAY's line (frozen at the opening bell); it lowers
    // tomorrow's, through a lower opening worth.
    expect(chips.find((c) => c.kind === 'line')).toBeUndefined();
  });

  it('a sale shows cash in, stock out and profit up', () => {
    const stocked = mustBuy(buyLemons, createInitialState());
    const after = applySale(stocked, 1, 1);
    const kinds = ledgerChips(stocked, after).map((c) => c.kind);
    expect(kinds).toEqual(['cash', 'stock', 'profit']);
  });

  it('an action that moves no money produces no chips', () => {
    const s = createInitialState();
    expect(ledgerChips(s, { ...s, pricePerCup: s.pricePerCup + 1 })).toEqual([]);
  });
});

describe('ledgerChips for a marketing campaign', () => {
  it('a campaign is spent, not kept: CASH and PROFIT both fall by its price', () => {
    // Profit comes from core/dayEnd.ts projectDay, the same figure the closing receipt
    // books, so the chip cannot disagree with the receipt.
    const before = { ...createInitialState(), cash: 100 };
    const after = buyCampaign(before, 'central-park');
    if (!after) throw new Error('campaign refused');
    expect(ledgerChips(before, after)).toEqual([
      { kind: 'cash', delta: -13 },
      { kind: 'profit', delta: -13 },
    ]);
  });
});
