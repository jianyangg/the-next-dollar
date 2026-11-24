import { crowdAt, walkersPerDay } from '../core/standSales';
import { useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { buildStand, leaseFee, signLease } from '../core/purchases';
import { getNeighborhood } from '../core/neighborhoods';
import { STALL_KIT_COST } from '../core/sliceModel';
import { selectActivePlot, useGameStore } from '../state/gameStore';
import { PaperChip, PurchasePreviewView, ShopWindow, type ShopRow } from './shop/ShopWindow';
import { previewPurchase } from './shop/preview';

/**
 * One sidewalk plot (a district has 2-3: corner, side street, plaza): sign the lease,
 * then build a stand on it with a Stall Kit. The window shows the plot's trade-off in
 * two engine numbers: its RENT and how many WALKERS pass it in a day (core/plots.ts).
 * Signing also pays the district's one-off city permit (core/purchases.ts `leaseFee`,
 * $0 in Central Park); the row names it and the preview shows it leaving the cash box.
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
  // Rent and foot traffic are engine numbers, shown on paper. Walkers are what this plot
  // would really get with a stand on it: the one sales formula (core/standSales.ts
  // walkersPerDay), so the player's other stands in the district (shared crowd) and the
  // district's marketing awareness are counted, exactly as sales will count them.
  const rent = <PaperChip label="RENT/DAY" value={`$${plot.dailyRent}`} />;
  const withStand = { plots: { ...economy.plots, [plot.id]: 'built' as const }, awareness: economy.awareness };
  const walkersHere = walkersPerDay(plot.id, crowdAt(withStand, plot.id));
  const walkers = <PaperChip label="WALKERS/DAY" value={String(Math.round(walkersHere))} />;
  const buildPreview = previewPurchase(economy, (s) => buildStand(s, plot.id), STALL_KIT_COST);
  const permit = leaseFee(plot.id);
  const leasePreview = previewPurchase(economy, (s) => signLease(s, plot.id), permit);

  let actionRow: ShopRow;
  if (plot.status === 'empty') {
    actionRow = {
      id: 'sign-lease',
      label: 'Sign lease',
      // Rent is booked at the closing bell, so the row says WHEN that cost starts; the
      // permit (if the district has one) is paid on the spot, so it is named first.
      value: permit > 0 ? `$${permit} permit + $${plot.dailyRent}/day` : `$${plot.dailyRent}/day from tonight`,
      onSelect: actions.signLease,
      // The preview runs the real rule: the permit leaving cash (or "need $X" when short).
      preview: (
        <PurchasePreviewView preview={leasePreview}>
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
