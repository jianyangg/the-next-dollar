import { AnimatePresence } from 'motion/react';
import { lemonCupsLeft } from '../core/brewing';
import * as Purchases from '../core/purchases';
import { STALL_KIT_COST } from '../core/sliceModel';
import { useGameStore } from '../state/gameStore';
import { getVendorPortraits } from './assets';
import { PurchasePreviewView, ShopWindow, useExitRows, type ShopRow } from './shop/ShopWindow';
import { previewPurchase } from './shop/preview';

/**
 * The three Union Square Supply Market vendor windows (lemons, stall kits, pitchers).
 * Each one is a small "gate" that subscribes to just `activeModal === <its id>`; the
 * body (which reads the economy) mounts only while that window is open.
 *
 * Every row's preview comes from running the SAME pure rule the store runs
 * (core/purchases) on the current economy, so the chips can never disagree with what
 * the purchase really does. Rows are not greyed out when you are short of money: the
 * cursor can still land on them and the preview says "Need $X" (the store refuses the
 * purchase with a buzz if you confirm anyway).
 */

const money = (n: number) => `$${n}`;

// --- Rocco's lemons ---------------------------------------------------------

function LemonModal() {
  const open = useGameStore((s) => s.activeModal === 'market-lemons');
  return <AnimatePresence>{open && <LemonModalBody key="LemonModal" />}</AnimatePresence>;
}

function LemonModalBody() {
  const actions = useGameStore((s) => s.actions);
  const economy = useGameStore((s) => s.economy);
  const brewedCups = useGameStore((s) => s.brewedCups);
  const exits = useExitRows();

  const rows: ShopRow[] = [
    {
      id: 'buy-lemons',
      label: `Lemons ×${Purchases.LEMON_CRATE_CUPS}`,
      value: money(Purchases.LEMON_CRATE_COST),
      onSelect: actions.buyLemons,
      preview: (
        <PurchasePreviewView preview={previewPurchase(economy, Purchases.buyLemons, Purchases.LEMON_CRATE_COST)} />
      ),
    },
    ...exits,
  ];

  return (
    <ShopWindow
      title="Rocco's Lemons"
      menuLabel="Lemon shop"
      portrait={{ src: getVendorPortraits().grower, alt: 'Rocco, the lemon vendor' }}
      stats={[
        { label: 'CASH', value: `$${economy.cash.toFixed(2)}` },
        // Same "lemons" figure as the stand's stock tag: lemons not yet brewed.
        { label: 'LEMONS', value: String(lemonCupsLeft(economy.cupsInStock, brewedCups)) },
      ]}
      rows={rows}
      onClose={actions.closeModal}
    />
  );
}

// --- June's stall kits ------------------------------------------------------

function StallKitModal() {
  const open = useGameStore((s) => s.activeModal === 'market-stalls');
  return <AnimatePresence>{open && <StallKitModalBody key="StallKitModal" />}</AnimatePresence>;
}

function StallKitModalBody() {
  const actions = useGameStore((s) => s.actions);
  const economy = useGameStore((s) => s.economy);
  const exits = useExitRows();

  const rows: ShopRow[] = [
    {
      id: 'buy-kit',
      label: 'Stall kit',
      value: money(STALL_KIT_COST),
      onSelect: actions.buyStallKit,
      preview: <PurchasePreviewView preview={previewPurchase(economy, Purchases.buyStallKit, STALL_KIT_COST)} />,
    },
    ...exits,
  ];

  return (
    <ShopWindow
      title="June's Stall Kits"
      menuLabel="Stall kit shop"
      portrait={{ src: getVendorPortraits().carpenter, alt: 'June, the carpentry vendor' }}
      stats={[
        { label: 'CASH', value: `$${economy.cash.toFixed(2)}` },
        { label: 'KITS', value: String(economy.stallKits) },
      ]}
      rows={rows}
      onClose={actions.closeModal}
    />
  );
}

// --- Otis's pitchers --------------------------------------------------------

function PitcherModal() {
  const open = useGameStore((s) => s.activeModal === 'market-pitchers');
  return <AnimatePresence>{open && <PitcherModalBody key="PitcherModal" />}</AnimatePresence>;
}

function PitcherModalBody() {
  const actions = useGameStore((s) => s.actions);
  const economy = useGameStore((s) => s.economy);
  const exits = useExitRows();

  const rows: ShopRow[] = [
    {
      id: 'buy-pitcher',
      label: 'Pitcher',
      value: money(Purchases.PITCHER_COST),
      onSelect: actions.buyPitcher,
      preview: (
        <PurchasePreviewView preview={previewPurchase(economy, Purchases.buyPitcher, Purchases.PITCHER_COST)} />
      ),
    },
    // Selling back only makes sense once you own one (same condition as before).
    ...(economy.pitchers >= 1
      ? [
          {
            id: 'sell-pitcher',
            label: 'Sell a pitcher',
            value: `+${money(Purchases.USED_PITCHER_RESALE)}`,
            onSelect: actions.sellUsedPitcher,
            // The rule books the $3 shortfall as a loss, so PROFIT shows it honestly.
            preview: <PurchasePreviewView preview={previewPurchase(economy, Purchases.sellUsedPitcher, 0)} />,
          } satisfies ShopRow,
        ]
      : []),
    ...exits,
  ];

  return (
    <ShopWindow
      title="Otis's Pitchers"
      menuLabel="Pitcher shop"
      portrait={{ src: getVendorPortraits().glazier, alt: 'Otis, the glassware vendor' }}
      stats={[
        { label: 'CASH', value: `$${economy.cash.toFixed(2)}` },
        { label: 'OWN', value: String(economy.pitchers) },
      ]}
      rows={rows}
      onClose={actions.closeModal}
    />
  );
}

/** Mounts all three vendor windows; at most one is open at a time (store `activeModal`). */
export function MarketModals() {
  return (
    <>
      <LemonModal />
      <StallKitModal />
      <PitcherModal />
    </>
  );
}
