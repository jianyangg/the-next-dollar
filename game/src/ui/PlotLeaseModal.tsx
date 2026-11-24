import { useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { buildStand } from '../core/purchases';
import { getNeighborhood } from '../core/neighborhoods';
import { STALL_KIT_COST } from '../core/sliceModel';
import { selectActivePlot, useGameStore } from '../state/gameStore';
import { PaperChip, PurchasePreviewView, ShopWindow, type ShopRow } from './shop/ShopWindow';
import { previewPurchase } from './shop/preview';

/**
 * One sidewalk plot (a district has 2-3: corner, side street, plaza): sign the lease,
 * then build a stand on it with a Stall Kit. The window shows the plot's trade-off in
 * two engine numbers: its RENT and how many WALKERS pass it in a day (core/plots.ts).
 * Same three states as before (empty / leased with a kit / leased without one); each is
 * a menu row whose preview comes from the real rule (core/purchases).
 */
export function PlotLeaseModal() {
  const open = useGameStore((s) => s.activeModal === 'plot-lease' && selectActivePlot(s) !== null);
  return <AnimatePresence>{open && <PlotLeaseModalBody key="plot-lease" />}</AnimatePresence>;
}

function PlotLeaseModalBody() {
  // selectActivePlot builds a new object each call; useShallow compares its fields (all
  // plain values) so the window re-renders only when the plot itself changed. The
  // last plot is kept while the window animates out after the plot was cleared.
  const picked = useGameStore(useShallow(selectActivePlot));
  const last = useRef(picked);
  if (picked) last.current = picked;
  const plot = last.current;
  const actions = useGameStore((s) => s.actions);
  const economy = useGameStore((s) => s.economy);
  if (!plot) return null;
  const neighborhood = getNeighborhood(plot.district);
  // Rent and foot traffic are engine numbers (core/plots), shown on paper.
  const rent = <PaperChip label="RENT/DAY" value={`$${plot.dailyRent}`} />;
  const walkers = <PaperChip label="WALKERS/DAY" value={String(plot.walkersPerDay)} />;
  const buildPreview = previewPurchase(economy, (s) => buildStand(s, plot.id), STALL_KIT_COST);

  let actionRow: ShopRow;
  if (plot.status === 'empty') {
    actionRow = {
      id: 'sign-lease',
      label: 'Sign lease',
      // "from tonight": signing pays nothing now; the first rent is booked at the closing
      // bell, so the row says WHEN the cost starts, not only how much it is.
      value: `$${plot.dailyRent}/day from tonight`,
      onSelect: actions.signLease,
      // Leasing moves no money today (rent starts at day close), so the rent IS the preview.
      preview: (
        <PurchasePreviewView preview={{ kind: 'none' }}>
          {rent}
          {walkers}
        </PurchasePreviewView>
      ),
    };
  } else if (economy.stallKits >= 1) {
    const kitDelta = buildPreview.kind === 'chips' ? buildPreview.after.stallKits - buildPreview.before.stallKits : 0;
    actionRow = {
      id: 'build-stand',
      label: 'Build stand',
      value: '1 kit',
      onSelect: actions.buildStandOnPlot,
      preview: (
        <PurchasePreviewView preview={buildPreview}>
          {kitDelta !== 0 && <PaperChip label="KITS" value={`${kitDelta}`} />}
          {rent}
        </PurchasePreviewView>
      ),
    };
  } else {
    actionRow = {
      id: 'to-market',
      label: 'Get a kit',
      value: `$${STALL_KIT_COST}`,
      onSelect: () => actions.selectNeighborhood('market'),
      // The build rule itself refuses with "no-stall-kit", so the preview is its real kit price.
      preview: <PurchasePreviewView preview={buildPreview} />,
    };
  }

  const rows: ShopRow[] = [actionRow, { id: 'leave', label: 'Leave', onSelect: actions.closeModal }];

  return (
    <ShopWindow
      title={`${neighborhood.shortName} · ${plot.label}`}
      menuLabel="Plot lease"
      stats={[{ label: 'KITS', value: String(economy.stallKits) }]}
      rows={rows}
      onClose={actions.closeModal}
    />
  );
}
