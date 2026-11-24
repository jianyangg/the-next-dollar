// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { domAnimation, LazyMotion } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no 2D canvas, so the pixel-art helpers are replaced by trivial fakes.
vi.mock('../../world/pixelArt', () => ({
  FOUNDER_CATALOG: [{ id: 'squirrel', name: 'Sam', title: 'Founder', tagline: 'Nutty' }],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));
vi.mock('../../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));

import { dispatchKeyDown, resetInputRouterForTests } from '../../state/input';
import { resetAnchorStore } from '../../state/anchorStore';
import { resetGameStore, selectCampaign, useGameStore } from '../../state/gameStore';
import { getNeighborhood } from '../../core/neighborhoods';
import { StandWorkbench } from '../StandWorkbench';
import { campaignPriceLabel } from './AdvertisePanel';

const press = (key: string) =>
  act(() => dispatchKeyDown({ key, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent));

const renderStand = () =>
  render(
    <LazyMotion features={domAnimation} strict>
      <StandWorkbench />
    </LazyMotion>
  );

const campaign = () => selectCampaign(useGameStore.getState());
const setEconomy = (over: Partial<ReturnType<typeof useGameStore.getState>['economy']>) =>
  act(() => useGameStore.setState((s) => ({ economy: { ...s.economy, ...over } })));
const openAdvertise = () => fireEvent.click(screen.getByRole('menuitem', { name: /^Advertise/ }));
const buyItem = () => screen.getByRole('menuitem', { name: /Buy campaign|No campaign here/ }) as HTMLButtonElement;

beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
  act(() => useGameStore.setState({ founderModalOpen: false, workingAtStand: true, neighborhoodId: 'central-park' }));
});
afterEach(() => {
  cleanup();
  resetInputRouterForTests();
  resetGameStore();
});

describe('Advertise row', () => {
  it("shows the selector's campaign price on the main menu", () => {
    renderStand();
    const cost = campaign().cost;
    expect(cost).not.toBeNull();
    const row = screen.getByRole('menuitem', { name: /^Advertise/ });
    expect(row.textContent).toContain(`$${cost!.toFixed(2)}`);
  });

  it('says there is nobody to reach (not a price) when the rules give no cost', () => {
    expect(campaignPriceLabel(null)).toBe('Nobody to reach');
    expect(campaignPriceLabel(24)).toBe('$24.00');
  });
});

describe('Advertise panel', () => {
  it("shows the district, awareness now, tomorrow's mark, the buy preview and the walker lift", () => {
    setEconomy({ cash: 500, awareness: { ...useGameStore.getState().economy.awareness, 'central-park': 0.5 } });
    renderStand();
    openAdvertise();
    const c = campaign();
    expect(document.body.textContent).toContain(getNeighborhood('central-park').name);
    expect(screen.getByLabelText(`Awareness ${Math.round(c.now * 100)} of 100`)).toBeTruthy();
    // Every bar mark sits at the selector's exact fraction (no re-derived maths).
    const at = (sel: string, prop: 'width' | 'left') =>
      (document.querySelector(sel) as HTMLElement).style[prop];
    expect(at('.stand-ad-fill', 'width')).toBe(`${c.now * 100}%`);
    expect(at('.stand-ad-tick', 'left')).toBe(`${c.tomorrow * 100}%`);
    expect(at('.stand-ad-ghost', 'width')).toBe(`${c.afterBuy * 100}%`);
    expect(document.body.textContent).toContain(`Tomorrow: ${Math.round(c.tomorrow * 100)}`);
    expect(document.body.textContent).toContain(`One more campaign: ${Math.round(c.afterBuy * 100)}`);
    expect(document.body.textContent).toContain(`+${Math.round(c.walkerLift * 100)}% walkers here`);
    expect(buyItem().textContent).toContain(`$${c.cost!.toFixed(2)}`);
  });

  it('Buy campaign calls actions.advertise and keeps the panel open', () => {
    // resetGameStore keeps the actions object, so the spy is swapped back afterwards or it
    // would leak into the next test (which needs the real purchase).
    const real = useGameStore.getState().actions;
    const advertise = vi.fn();
    act(() => useGameStore.setState({ actions: { ...real, advertise } }));
    try {
      setEconomy({ cash: 500 });
      renderStand();
      openAdvertise();
      fireEvent.click(buyItem());
      expect(advertise).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('menu', { name: 'Advertise' })).toBeTruthy();
    } finally {
      act(() => useGameStore.setState({ actions: real }));
    }
  });

  it('a real purchase moves the bar to what the panel promised', () => {
    setEconomy({ cash: 500 });
    renderStand();
    openAdvertise();
    const promised = campaign().afterBuy;
    fireEvent.click(buyItem());
    expect(campaign().now).toBeCloseTo(promised);
    expect((document.querySelector('.stand-ad-fill') as HTMLElement).style.width).toBe(`${campaign().now * 100}%`);
  });

  it('Buy is disabled when cash does not cover the campaign', () => {
    setEconomy({ cash: 0 });
    renderStand();
    openAdvertise();
    expect(campaign().canAfford).toBe(false);
    expect(buyItem().disabled).toBe(true);
  });

  it('Escape and Done return to the main menu without leaving the stand', () => {
    renderStand();
    openAdvertise();
    press('Escape');
    expect(screen.getByRole('menu', { name: 'Stand' })).toBeTruthy();
    expect(useGameStore.getState().workingAtStand).toBe(true);
    openAdvertise();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Done' }));
    expect(screen.getByRole('menu', { name: 'Stand' })).toBeTruthy();
  });
});
