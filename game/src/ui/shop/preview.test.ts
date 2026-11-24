import { describe, expect, it } from 'vitest';
import { buildStand, buyLemons, buyPitcher, sellUsedPitcher } from '../../core/purchases';
import { createInitialState, STALL_KIT_COST } from '../../core/sliceModel';
import { previewPurchase } from './preview';

describe('previewPurchase', () => {
  it('shows exactly what the pitcher rule would move, without changing the economy', () => {
    const economy = createInitialState();
    const preview = previewPurchase(economy, buyPitcher, 10);
    expect(preview.kind).toBe('chips');
    if (preview.kind !== 'chips') return;
    expect(preview.chips).toEqual([
      { kind: 'cash', delta: -10 },
      { kind: 'gear', delta: 10 },
      { kind: 'profit', delta: 0 },
      { kind: 'line', delta: 0.5 },
    ]);
    expect(economy.cash).toBe(30); // the preview never writes anything
  });

  it('reports the rule real price when cash is short', () => {
    const poor = { ...createInitialState(), cash: 3 };
    expect(previewPurchase(poor, buyLemons, 5)).toEqual({ kind: 'need', cost: 5, needs: 'cash' });
  });

  it('asks for a kit when the build rule refuses for lack of one', () => {
    const leased = { ...createInitialState(), plots: { ...createInitialState().plots, broadway: 'leased' as const } };
    expect(previewPurchase(leased, (s) => buildStand(s, 'broadway'), STALL_KIT_COST)).toEqual({
      kind: 'need',
      cost: STALL_KIT_COST,
      needs: 'kit',
    });
  });

  it('shows the booked loss when selling a pitcher back', () => {
    const owner = { ...createInitialState(), pitchers: 1, equipmentValue: 10 };
    const preview = previewPurchase(owner, sellUsedPitcher, 0);
    expect(preview.kind === 'chips' && preview.chips.find((c) => c.kind === 'profit')?.delta).toBe(-3);
  });

  it('has nothing to preview for a refusal that is not about money', () => {
    expect(previewPurchase(createInitialState(), sellUsedPitcher, 0)).toEqual({ kind: 'none' });
  });
});
