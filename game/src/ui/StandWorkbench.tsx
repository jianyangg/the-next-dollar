import { useState } from 'react';
import { useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { getDailyWages, MANAGER_DAILY_WAGE, WORKER_DAILY_WAGE } from '../core/sliceModel';
import { STAND_DIVEST_PROCEEDS } from '../core/purchases';
import { getNeighborhood } from '../core/neighborhoods';
import { useQueueLength } from '../state/anchorStore';
import { type GameState, selectWorkersHere, useGameStore } from '../state/gameStore';
import { BrewStep } from './BrewMinigame';
import { getConversionProb } from '../core/demand';
import { type CursorMenuItem, CursorMenu } from './kit/CursorMenu';
import { Key } from './kit/Money';
import { PriceCustomers } from './stand/PriceCustomers';
import { StockTag } from './stand/StockTag';
import { useStoreMotionValue } from './useStoreMotionValue';
import './styles/stand.css';

/**
 * What the player sees while standing BEHIND their counter:
 *   - bottom-left: a black SIGN holding the action menu (Brew, Serve, Price, Staff,
 *     Market, Sell stand, Leave) next to a PAPER tag of stock numbers;
 *   - bottom-centre: the brew gauge while a mini-game runs (BrewMinigame.tsx).
 *
 * The menu is NOT blocking (see CursorMenu): F, Space, B, M and Esc keep reaching the
 * shortcut layer underneath, so the keyboard shortcuts work exactly as before.
 */

/** The cup prices the player can pick (unchanged from the old price buttons). */
const PRICES = [2, 3, 4, 5] as const;

/** Selector: pour progress as a percent (0 when idle). Module level = stable identity. */
const selectServePct = (s: GameState): number => (s.serveProgress === null ? 0 : s.serveProgress * 100);
/** Selector: is a cup being poured right now? A boolean, so it flips only twice per pour. */
const selectPouring = (s: GameState): boolean => s.serveProgress !== null;
/** Selector: is a brew mini-game running? Also a boolean (flips at start and end only). */
const selectBrewing = (s: GameState): boolean => s.brewGame !== null;

/**
 * The pour progress bar under the menu.
 *
 * `serveProgress` runs 0 -> 1 on every frame of the pour while the player holds. The bar is driven through a
 * motion value (see `useStoreMotionValue`), so those frames never re-render this component:
 * Motion writes the width straight into the DOM and React is never told. Idle = empty bar.
 */
export function ServeStep() {
  const pourWidth = useTransform(useStoreMotionValue(selectServePct), (pct) => `${Math.round(pct)}%`);
  return (
    <div className="pt-track stand-pour" role="progressbar" aria-label="Pour">
      <m.i className="stand-pour-fill" style={{ width: pourWidth }} />
    </div>
  );
}

/** Label with its Key bullet in front, e.g. [F] Brew. */
function Labelled({ k, children }: { k: string; children: string }) {
  return (
    <span className="stand-lab">
      <Key k={k} />
      {children}
    </span>
  );
}

type Panel = 'price' | 'staff' | 'sell' | null;

/** The sign: main menu, plus a row of choices under it for Price or Staff. */
function StandMenu() {
  const actions = useGameStore((s) => s.actions);
  const brewedCups = useGameStore((s) => s.brewedCups);
  const cupsInStock = useGameStore((s) => s.economy.cupsInStock);
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const pricePerCup = useGameStore((s) => s.economy.pricePerCup);
  // One worker per stand: is THIS stand (the one being run) staffed?
  const staffedHere = useGameStore((s) => selectWorkersHere(s) > 0);
  const managers = useGameStore((s) => s.economy.managers);
  const dailyWages = useGameStore((s) => getDailyWages(s.economy));
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const pouring = useGameStore(selectPouring);
  const brewing = useGameStore(selectBrewing);
  const queueLength = useQueueLength();
  const booksOpen = useGameStore((s) => s.booksOpen);
  const [panel, setPanel] = useState<Panel>(null);
  const neighborhood = getNeighborhood(neighborhoodId);

  // While a mini-game runs it owns W/A/S/D and Space (rapid stir uses them), so the menu
  // stops listening to keys. The mouse still works, and the store ignores a second
  // "start brew", so nothing can go wrong. Books open over the stand owns the keys too:
  // its tab row must be the only menu that hears A/D/E.
  const keysFree = !brewing && !booksOpen;
  const closePanel = () => setPanel(null);

  const mainItems: CursorMenuItem[] = [
    {
      id: 'brew',
      label: <Labelled k="F">Brew</Labelled>,
      // Out of lemons = nothing left to brew (lemons already in the pitcher don't count).
      value: pitchers < 1 ? 'No pitcher' : brewedCups >= cupsInStock ? 'No lemons' : undefined,
      disabled: cupsInStock <= 0 || brewedCups >= cupsInStock,
      onSelect: actions.startBrewGame,
    },
    {
      id: 'serve',
      label: <Labelled k="Space">Hold to serve</Labelled>,
      // Customers waiting in line (engine number); nothing shown when the line is empty.
      value: queueLength > 0 ? queueLength : undefined,
      disabled: brewedCups < 1 || queueLength === 0 || pouring,
      onSelect: actions.startServeFrontCustomer,
      // Hold to pour: the cup fills only while the mouse (or E, or Space) is held down.
      onHoldChange: actions.setSpaceHeld,
    },
    { id: 'price', label: 'Price', value: `$${pricePerCup}`, onSelect: () => setPanel('price') },
    {
      id: 'staff',
      label: 'Staff',
      value: dailyWages > 0 ? `-$${dailyWages}/d` : undefined,
      onSelect: () => setPanel('staff'),
    },
    { id: 'market', label: 'Market', onSelect: () => actions.selectNeighborhood('market') },
    {
      id: 'sell',
      label: 'Sell stand',
      value: `+$${STAND_DIVEST_PROCEEDS.toFixed(2)}`,
      // Selling can't be undone, so it opens a confirm row instead of selling on one E.
      onSelect: () => setPanel('sell'),
    },
    { id: 'leave', label: <Labelled k="Esc">Leave</Labelled>, onSelect: actions.exitStand },
  ];

  // Choosing a price keeps the row open on purpose: the ten customers change as you
  // move between prices, which is the lesson (higher price, fewer buyers).
  const priceItems: CursorMenuItem[] = [
    ...PRICES.map((price) => ({
      id: `price-${price}`,
      label: <span className={price === pricePerCup ? 'stand-picked' : undefined}>${price}</span>,
      onSelect: () => actions.setPrice(price),
    })),
    { id: 'done', label: 'Done', onSelect: closePanel },
  ];

  const staffItems: CursorMenuItem[] = [
    // A worker keeps this stand selling while you are away (and helps you brew here).
    staffedHere
      ? { id: 'worker', label: 'Let worker go', value: `-$${WORKER_DAILY_WAGE}/d`, onSelect: actions.letWorkerGo }
      : { id: 'worker', label: 'Hire worker', value: `$${WORKER_DAILY_WAGE}/d`, onSelect: actions.hireWorker },
    {
      id: 'manager',
      label: managers > 0 ? `Manager ×${managers}` : 'Manager',
      value: `$${MANAGER_DAILY_WAGE}/d`,
      onSelect: actions.hireManager,
    },
    { id: 'done', label: 'Done', onSelect: closePanel },
  ];

  // "Keep" is first so a reflex E after opening the row does not sell.
  const sellItems: CursorMenuItem[] = [
    { id: 'keep', label: 'Keep', onSelect: closePanel },
    {
      id: 'confirm-sell',
      label: 'Sell',
      value: `+$${STAND_DIVEST_PROCEEDS.toFixed(2)}`,
      onSelect: () => {
        closePanel();
        actions.divestCurrentStand();
      },
    },
  ];

  return (
    <div className="pt-sign stand-sign">
      {/* Only one menu listens to keys at a time, or E would confirm in both. */}
      {/* A sub-row (Price, Staff, Sell) REPLACES the main menu, like a JRPG sub-menu:
          the sign stays short enough for a 650px-tall window, and Esc/Done brings the
          main menu back. Only one menu is ever mounted, so only one hears E. */}
      {panel === null && <CursorMenu label="Stand" items={mainItems} active={keysFree} />}
      <ServeStep />
      {panel === 'price' && (
        <div className="stand-sub">
          <CursorMenu
            label="Cup price"
            orientation="row"
            items={priceItems}
            active={keysFree}
            initialId={`price-${pricePerCup}`}
            onBack={closePanel}
          />
          <PriceCustomers buyChance={getConversionProb(pricePerCup, neighborhood.priceSensitivity)} />
        </div>
      )}
      {panel === 'staff' && (
        <div className="stand-sub">
          <CursorMenu label="Staff" orientation="row" items={staffItems} active={keysFree} onBack={closePanel} />
        </div>
      )}
      {panel === 'sell' && (
        <div className="stand-sub">
          <CursorMenu label="Sell stand?" orientation="row" items={sellItems} active={keysFree} onBack={closePanel} />
        </div>
      )}
    </div>
  );
}

export function StandWorkbench() {
  return (
    <>
      {/* One flex row: menu, stock tag, then the brew gauge while brewing. Being in the
          same row (not centred on its own) means the gauge can never cover the tag. */}
      <div className="stand-corner" role="region" aria-label="Stand">
        <StandMenu />
        <StockTag />
        <BrewStep />
      </div>
    </>
  );
}
