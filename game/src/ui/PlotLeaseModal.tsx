import { getNeighborhood } from '../core/neighborhoods';
import { STALL_KIT_COST } from '../core/sliceModel';
import { selectCurrentPlotStatus, useGameStore } from '../state/gameStore';
import { getIcons } from './assets';

/** Marked sidewalk plot: sign the lease, then build a stand on it with a Stall Kit. */
export function PlotLeaseModal() {
  const open = useGameStore((s) => s.activeModal === 'plot-lease');
  return open ? <PlotLeaseModalBody /> : null;
}

function PlotLeaseModalBody() {
  const actions = useGameStore((s) => s.actions);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const stallKits = useGameStore((s) => s.economy.stallKits);
  const currentPlotStatus = useGameStore(selectCurrentPlotStatus);
  const icons = getIcons();
  const neighborhood = getNeighborhood(neighborhoodId);

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={icons.map} alt="" className="px-icon-lg" />
            <div>
              <div className="modal-kicker">
                {neighborhood.name} · {currentPlotStatus === 'leased' ? 'Leased Plot' : 'For Lease'}
              </div>
              <div className="modal-title">
                {currentPlotStatus === 'leased' ? 'Ready to Place Lemonade Stand' : 'Sign Sidewalk Plot Lease'}
              </div>
            </div>
          </div>
          <button type="button" className="icon-close-btn" onClick={actions.closeModal} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="vendor-card">
            <div className="vendor-card-head">
              <div>
                <div style={{ fontSize: 16, fontWeight: 900 }}>{neighborhood.name} Corner</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                  {neighborhood.crowdLabel} · Typical price {neighborhood.typicalPrice}
                </div>
              </div>
              <span className="vendor-price-badge game-num">${neighborhood.dailyRent}/day</span>
            </div>

            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-soft)' }}>
              {neighborhood.description}
            </div>

            <div className="impact-list">
              <div className="impact-line">
                <span>Plot Status</span>
                <span className="game-num">
                  {currentPlotStatus === 'leased' ? 'LEASED (Ready for Stall Kit)' : 'EMPTY (For Lease)'}
                </span>
              </div>
              <div className="impact-line">
                <span>Daily Lease Rent</span>
                <span className="game-num val-amber">-${neighborhood.dailyRent}.00/day</span>
              </div>
              <div className="impact-line">
                <span>Stall Kits in Inventory</span>
                <span className="game-num">{stallKits}</span>
              </div>
            </div>

            {currentPlotStatus === 'empty' ? (
              <button type="button" className="gbtn gbtn-gold" onClick={actions.signLease}>
                <span>Sign Lease (${neighborhood.dailyRent}/day)</span>
              </button>
            ) : stallKits >= 1 ? (
              <button type="button" className="gbtn gbtn-green" onClick={actions.buildStandOnPlot}>
                <span>Build Stand Here (Uses 1 Stall Kit)</span>
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-gold)' }}>
                  You need a Wooden Stall Kit (${STALL_KIT_COST}) from Union Square Supply Market to build
                  here.
                </div>
                <button
                  type="button"
                  className="gbtn gbtn-green"
                  onClick={() => actions.selectNeighborhood('market')}
                >
                  <img src={icons.market} alt="" className="px-icon-sm" />
                  <span>Go to Union Square Supply Market →</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
