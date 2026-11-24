import { AnimatePresence } from 'motion/react';
import { buildStand } from '../core/purchases';
import { getNeighborhood } from '../core/neighborhoods';
import { STALL_KIT_COST } from '../core/sliceModel';
import { selectCurrentPlotStatus, useGameStore } from '../state/gameStore';
import { PaperChip, PurchasePreviewView, ShopWindow, type ShopRow } from './shop/ShopWindow';
import { previewPurchase } from './shop/preview';

/**
 * Marked sidewalk plot: sign the lease, then build a stand on it with a Stall Kit.
 * Same three states as before (empty / leased with a kit / leased without one); each is
 * now a menu row whose preview comes from the real rule (core/purchases).
 */
export function PlotLeaseModal() {
  const open = useGameStore((s) => s.activeModal === 'plot-lease');
  return <AnimatePresence>{open && <PlotLeaseModalBody key="plot-lease" />}</AnimatePresence>;
}

function PlotLeaseModalBody() {
  const actions = useGameStore((s) => s.actions);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const economy = useGameStore((s) => s.economy);
  const currentPlotStatus = useGameStore(selectCurrentPlotStatus);
  const neighborhood = getNeighborhood(neighborhoodId);
  // Rent per day is an engine number (core/neighborhoods), shown on paper.
  const rent = <PaperChip label="RENT/DAY" value={`$${neighborhood.dailyRent}`} />;
  const buildPreview = previewPurchase(economy, (s) => buildStand(s, neighborhoodId), STALL_KIT_COST);

  let actionRow: ShopRow;
  if (currentPlotStatus === 'empty') {
    actionRow = {
      id: 'sign-lease',
      label: 'Sign lease',
      // "from tonight": signing pays nothing now; the first rent is booked at the closing
      // bell, so the row says WHEN the cost starts, not only how much it is.
      value: `$${neighborhood.dailyRent}/day from tonight`,
      onSelect: actions.signLease,
      // Leasing moves no money today (rent starts at day close), so the rent IS the preview.
      preview: <PurchasePreviewView preview={{ kind: 'none' }}>{rent}</PurchasePreviewView>,
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
      title={`${neighborhood.shortName} plot`}
      menuLabel="Plot lease"
      stats={[{ label: 'KITS', value: String(economy.stallKits) }]}
      rows={rows}
      onClose={actions.closeModal}
    />
  );
}
