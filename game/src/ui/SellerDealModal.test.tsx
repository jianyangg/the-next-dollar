// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { domAnimation, LazyMotion } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no 2D canvas, so the pixel-art helpers are replaced by trivial fakes.
vi.mock('../world/pixelArt', () => ({
  FOUNDER_CATALOG: [{ id: 'squirrel', name: 'Alex', title: 'Hustler', tagline: 'x' }],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));
vi.mock('../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));

import { CENTRAL_PARK_DEAL } from '../core/deal';
import type { DealView } from '../deal/dealView';
import { dispatchKeyDown, resetInputRouterForTests } from '../state/input';
import { resetGameStore, useGameStore } from '../state/gameStore';
import { SellerDealModal } from './SellerDealModal';

/**
 * The seller screen renders the deal machine's view and nothing else. These tests pin
 * the "never put words in the seller's mouth" rule: when there is no real AI text, the
 * screen shows a plain status instead of a speech balloon.
 */
const press = (key: string) =>
  act(() => dispatchKeyDown({ key, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent));
const wrap = (ui: React.ReactNode) => <LazyMotion features={domAnimation}>{ui}</LazyMotion>;

const baseDeal: DealView = {
  phase: 'idle',
  pitch: 'Busy corner, loyal regulars.',
  sellerOffline: false,
  qa: [],
  questionsLeft: 3,
  canAsk: true,
  pendingQuestion: null,
};

function show(deal: DealView, cash = 100) {
  useGameStore.setState((s) => ({ activeModal: 'seller-stand', deal, economy: { ...s.economy, cash } }));
  return render(wrap(<SellerDealModal />));
}

beforeEach(() => resetGameStore());
afterEach(() => {
  cleanup();
  resetInputRouterForTests();
});

describe('seller deal screen', () => {
  it("shows the AI pitch in the balloon and the seller's books on paper", () => {
    const { container } = show(baseDeal);
    expect(container.querySelector('.seller-balloon')?.textContent).toBe('Busy corner, loyal regulars.');
    // One row per published period, with the engine's profit figure.
    const last = CENTRAL_PARK_DEAL.books[CENTRAL_PARK_DEAL.books.length - 1];
    expect(screen.getByRole('table').textContent).toContain(`$${last.profit}`);
    expect(container.querySelectorAll('.pt-pips > i:not(.is-used)')).toHaveLength(3);
  });

  it('says the seller is not talking, with no balloon, when the seller is offline', () => {
    const { container } = show({ ...baseDeal, pitch: null, sellerOffline: true, canAsk: false });
    expect(container.querySelector('.seller-balloon')).toBeNull();
    expect(screen.getByText("Seller isn't talking")).toBeTruthy();
  });

  it('shows "No answer" (not an invented reply) when a question got no checked answer', () => {
    const { container } = show({
      ...baseDeal,
      qa: [{ q: 'Why sell?', a: null, status: 'no-answer', refunded: true }],
    });
    expect(screen.getByText('No answer · question back')).toBeTruthy();
    // The balloon still holds only the real pitch, and the log marks the gap with a dash.
    expect(container.querySelector('.seller-balloon')?.textContent).toBe('Busy corner, loyal regulars.');
    expect(container.querySelector('.seller-log-a')?.textContent).toBe('—');
  });

  it('dials a bid with the arrow keys and seals it with E', () => {
    const submitBid = vi.fn();
    useGameStore.setState((s) => ({ actions: { ...s.actions, submitBid } }));
    show(baseDeal);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bid' }));

    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown'); // -5
    const bid = CENTRAL_PARK_DEAL.askingPrice + 2 - 5;
    expect(screen.getByText(`$${bid}`)).toBeTruthy();
    // THE LINE: the bid must earn 5% of itself a day to create value.
    expect(screen.getByText(`$${(bid * 0.05).toFixed(2)}`)).toBeTruthy();

    press('E');
    expect(submitBid).toHaveBeenCalledWith(bid);
  });

  it('stamps the result once the deal is closed', () => {
    show({ ...baseDeal, phase: 'won', bid: 50, canAsk: false });
    expect(screen.getByText('SOLD')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
