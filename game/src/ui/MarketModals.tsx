import { STALL_KIT_COST } from '../core/sliceModel';
import { getNeighborhood } from '../core/neighborhoods';
import { useGameStore } from '../state/gameStore';
import { getIcons, getPortraits } from './assets';

/**
 * The three Union Square Supply Market vendor modals (lemons, stall kits, pitchers).
 * Each one is a small "gate" that subscribes to just `activeModal === <its id>`; the
 * body (which reads cash/stock) mounts only while that modal is open.
 */

/** The "Back to <district> →" button every vendor modal ends with. */
function BackToDistrictButton() {
  const actions = useGameStore((s) => s.actions);
  const lastBusinessNeighborhood = useGameStore((s) => s.lastBusinessNeighborhood);
  const lastBusinessDistrict = getNeighborhood(lastBusinessNeighborhood);
  return (
    <button
      type="button"
      className="gbtn gbtn-gold"
      onClick={() => actions.selectNeighborhood(lastBusinessNeighborhood)}
    >
      Back to {lastBusinessDistrict.shortName} →
    </button>
  );
}

// --- Leo's Fresh Lemon Stall ------------------------------------------------

function LemonModal() {
  const open = useGameStore((s) => s.activeModal === 'market-lemons');
  return open ? <LemonModalBody /> : null;
}

function LemonModalBody() {
  const actions = useGameStore((s) => s.actions);
  const cash = useGameStore((s) => s.economy.cash);
  const cupsInStock = useGameStore((s) => s.economy.cupsInStock);
  const icons = getIcons();
  const portraits = getPortraits();

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={icons.lemon} alt="" className="px-icon-lg" />
            <div>
              <div className="modal-kicker">Union Square Supply Market · Wholesale</div>
              <div className="modal-title">Leo&apos;s Fresh Lemon Stall</div>
            </div>
          </div>
          <button type="button" className="icon-close-btn" onClick={actions.closeModal} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="seller-intro">
            <div className="seller-avatar">
              <img
                src={portraits.panda}
                alt="Leo the Lemon Vendor"
                className="seller-avatar-img pixel-portrait"
              />
            </div>
            <div className="speech-bubble">
              <div className="speech-bubble-meta">
                <span className="seller-name">Leo · Lemon Wholesaler</span>
                <span className="ask-badge game-num">Cash: ${cash.toFixed(2)}</span>
              </div>
              &ldquo;Fresh crates straight off the truck! Grab a crate of 10 cups for $5 — remember, buying
              inventory swaps Cash for Stock with zero instant profit hit.&rdquo;
            </div>
          </div>

          <div className="vendor-card">
            <div className="vendor-card-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="vendor-icon-box">
                  <img src={icons.lemon} alt="" className="px-icon-lg" />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>Crate of Fresh Lemons</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    +10 cups ($0.50 COGS/cup) · Currently holding {cupsInStock} cups
                  </div>
                </div>
              </div>
              <span className="vendor-price-badge game-num">$5</span>
            </div>

            <div className="impact-list">
              <div className="impact-line">
                <span>Balance Sheet</span>
                <span className="game-num">Cash -$5 → Inventory +$5</span>
              </div>
              <div className="impact-line">
                <span>Immediate P&amp;L Hit</span>
                <span className="game-num val-pos">$0.00</span>
              </div>
              <div className="impact-line">
                <span>5% Daily Hurdle Impact</span>
                <span className="game-num val-amber">+$0.25/day</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="gbtn gbtn-green"
                style={{ flex: 1 }}
                onClick={actions.buyLemons}
                disabled={cash < 5}
              >
                <img src={icons.lemon} alt="" className="px-icon-sm" />
                <span>Buy Lemon Crate ($5)</span>
              </button>
              <BackToDistrictButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Claire's Wooden Stall Kits ---------------------------------------------

function StallKitModal() {
  const open = useGameStore((s) => s.activeModal === 'market-stalls');
  return open ? <StallKitModalBody /> : null;
}

function StallKitModalBody() {
  const actions = useGameStore((s) => s.actions);
  const cash = useGameStore((s) => s.economy.cash);
  const stallKits = useGameStore((s) => s.economy.stallKits);
  const icons = getIcons();
  const portraits = getPortraits();

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={icons.market} alt="" className="px-icon-lg" />
            <div>
              <div className="modal-kicker">Union Square Supply Market · Carpentry Stall</div>
              <div className="modal-title">Claire&apos;s Wooden Stall Kits</div>
            </div>
          </div>
          <button type="button" className="icon-close-btn" onClick={actions.closeModal} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="seller-intro">
            <div className="seller-avatar">
              <img
                src={portraits.bunny}
                alt="Claire the Carpentry Vendor"
                className="seller-avatar-img pixel-portrait"
              />
            </div>
            <div className="speech-bubble">
              <div className="speech-bubble-meta">
                <span className="seller-name">Claire · Carpentry Wholesaler</span>
                <span className="ask-badge game-num">Cash: ${cash.toFixed(2)}</span>
              </div>
              &ldquo;Hand-built cedar lemonade stands ready to assemble on any leased NYC sidewalk plot!
              Buying a Stall Kit swaps Cash for Equipment with zero immediate P&amp;L hit.&rdquo;
            </div>
          </div>

          <div className="vendor-card">
            <div className="vendor-card-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="vendor-icon-box">
                  <img src={icons.market} alt="" className="px-icon-lg" />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>Wooden Stall Kit</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    Place on any leased plot · Holding {stallKits} kit(s)
                  </div>
                </div>
              </div>
              <span className="vendor-price-badge game-num">${STALL_KIT_COST}</span>
            </div>

            <div className="impact-list">
              <div className="impact-line">
                <span>Balance Sheet</span>
                <span className="game-num">
                  Cash -${STALL_KIT_COST} → Equipment +${STALL_KIT_COST}
                </span>
              </div>
              <div className="impact-line">
                <span>Immediate P&amp;L Hit</span>
                <span className="game-num val-pos">$0.00</span>
              </div>
              <div className="impact-line">
                <span>5% Daily Hurdle Impact</span>
                <span className="game-num val-amber">+$0.60/day</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="gbtn gbtn-green"
                style={{ flex: 1 }}
                onClick={actions.buyStallKit}
                disabled={cash < STALL_KIT_COST}
              >
                <img src={icons.market} alt="" className="px-icon-sm" />
                <span>Buy Wooden Stall Kit (${STALL_KIT_COST})</span>
              </button>
              <BackToDistrictButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sam's Glass Pitchers ---------------------------------------------------

function PitcherModal() {
  const open = useGameStore((s) => s.activeModal === 'market-pitchers');
  return open ? <PitcherModalBody /> : null;
}

function PitcherModalBody() {
  const actions = useGameStore((s) => s.actions);
  const cash = useGameStore((s) => s.economy.cash);
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const icons = getIcons();
  const portraits = getPortraits();

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={icons.pitcher} alt="" className="px-icon-lg" />
            <div>
              <div className="modal-kicker">Union Square Supply Market · Glassware Stall</div>
              <div className="modal-title">Sam&apos;s Glass Pitchers</div>
            </div>
          </div>
          <button type="button" className="icon-close-btn" onClick={actions.closeModal} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="seller-intro">
            <div className="seller-avatar">
              <img
                src={portraits.penguin}
                alt="Sam the Pitcher Vendor"
                className="seller-avatar-img pixel-portrait"
              />
            </div>
            <div className="speech-bubble">
              <div className="speech-bubble-meta">
                <span className="seller-name">Sam · Glassware Wholesaler</span>
                <span className="ask-badge game-num">Cash: ${cash.toFixed(2)}</span>
              </div>
              &ldquo;Every stand needs a Glass Pitcher ($10) to brew fresh lemonade, and extra pitchers widen
              your brew sweet spot! You can also sell used pitchers back at 70% salvage value.&rdquo;
            </div>
          </div>

          <div className="vendor-card">
            <div className="vendor-card-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="vendor-icon-box">
                  <img src={icons.pitcher} alt="" className="px-icon-lg" />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>Gleaming Glass Pitcher</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    Required to brew &amp; widens sweet spot · Own {pitchers} pitcher(s)
                  </div>
                </div>
              </div>
              <span className="vendor-price-badge game-num">$10</span>
            </div>

            <div className="impact-list">
              <div className="impact-line">
                <span>Balance Sheet</span>
                <span className="game-num">Cash -$10 → Equipment +$10</span>
              </div>
              <div className="impact-line">
                <span>Immediate P&amp;L Hit</span>
                <span className="game-num val-pos">$0.00</span>
              </div>
              <div className="impact-line">
                <span>5% Daily Hurdle Impact</span>
                <span className="game-num val-amber">+$0.50/day</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="gbtn gbtn-green"
                style={{ flex: 1 }}
                onClick={actions.buyPitcher}
                disabled={cash < 10}
              >
                <img src={icons.pitcher} alt="" className="px-icon-sm" />
                <span>Buy Glass Pitcher ($10)</span>
              </button>
              {pitchers >= 1 && (
                <button
                  type="button"
                  className="gbtn gbtn-slate"
                  onClick={actions.sellUsedPitcher}
                  title="70% salvage value: Cash +$7, Equip -$10, Hurdle -$0.50/day"
                >
                  <span>Sell Used Pitcher (+$7)</span>
                </button>
              )}
              <BackToDistrictButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mounts all three vendor modals; at most one is open at a time (store `activeModal`). */
export function MarketModals() {
  return (
    <>
      <LemonModal />
      <StallKitModal />
      <PitcherModal />
    </>
  );
}
