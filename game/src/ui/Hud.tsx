import { formatClockTime } from '../core/clock';
import { getNeighborhood } from '../core/neighborhoods';
import { FOUNDER_CATALOG } from '../world/pixelArt';
import { useGameStore } from '../state/gameStore';
import { getIcons, getPortraits } from './assets';
import { fmtSignedMoney } from './format';

/**
 * Top bar: founder crest + district + day clock, then value/rating ticker and the
 * Sound / Map / Books buttons.
 *
 * The day clock advances every animation frame, but this bar only shows it as a
 * whole-percent bar and an "8:15 AM" label. So instead of subscribing to the raw
 * `timeProgress` (which would re-render the HUD 60 times a second) we subscribe to the
 * two DERIVED values below: React compares them with `Object.is` and only re-renders
 * when the percent or the label text actually changes (a few times per game minute).
 */
export function Hud() {
  const actions = useGameStore((s) => s.actions);
  const founderSpecies = useGameStore((s) => s.founderSpecies);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const day = useGameStore((s) => s.economy.day);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const totalValueCreated = useGameStore((s) => s.economy.totalValueCreated);
  const ratingAvg = useGameStore((s) => s.economy.ratingAvg);
  const reviewCount = useGameStore((s) => s.economy.reviews.length);
  const clockSpeed = useGameStore((s) => s.clockSpeed);
  const muted = useGameStore((s) => s.muted);
  const mapOpen = useGameStore((s) => s.mapOpen);
  const booksOpen = useGameStore((s) => s.booksOpen);
  const dayClockPct = useGameStore((s) => Math.min(100, Math.max(0, Math.round(s.timeProgress * 100))));
  const clockLabel = useGameStore((s) => formatClockTime(s.timeProgress));

  const icons = getIcons();
  const portraits = getPortraits();
  const neighborhood = getNeighborhood(neighborhoodId);
  const selectedFounder = FOUNDER_CATALOG.find((f) => f.id === founderSpecies) ?? FOUNDER_CATALOG[0];

  return (
    <header className="top-hud">
      {/* Left: Founder & District Crest */}
      <div className="career-crest">
        <button
          type="button"
          className="crest-avatar-btn"
          onClick={actions.openFounderModal}
          title={`Founder: ${selectedFounder.name} (${selectedFounder.title}) — Click to switch`}
          aria-label="Choose Your Founder"
        >
          <img
            src={portraits[founderSpecies]}
            alt={selectedFounder.name}
            className="crest-avatar-img pixel-portrait"
          />
        </button>
        <div className="crest-meta">
          <div className="crest-row">
            <span className="crest-location">{neighborhood.shortName}</span>
            <span className="crest-day game-num">
              <img src={icons.sun} alt="" className="px-icon-sm" />
              <span>
                Day {day}/{maxDays} · {clockLabel}
              </span>
            </span>
            <button
              type="button"
              className={`clock-speed-btn game-num ${clockSpeed === 2 ? 'is-fast' : ''}`}
              onClick={actions.toggleClockSpeed}
              title="Toggle Day Clock Speed (1x = 120s, 2x = 60s)"
              aria-label={`Clock Speed ${clockSpeed}x`}
            >
              {clockSpeed}x
            </button>
          </div>
          <div className="crest-progress-track" aria-label={`Day ${day} Clock ${clockLabel}`}>
            <div className="crest-progress-fill" style={{ width: `${dayClockPct}%` }} />
          </div>
        </div>
      </div>

      {/* Right: Compact Value/Rating Ticker + Action Buttons */}
      <div className="top-hud-right">
        <div className="finance-ticker">
          <div className="ticker-stat" title="Cumulative Value Created (EVA)">
            <div>
              <div className="ticker-label">Value Created</div>
              <div className={`ticker-value game-num ${totalValueCreated >= 0 ? 'positive' : 'negative'}`}>
                {fmtSignedMoney(totalValueCreated)}
              </div>
            </div>
          </div>
          <div className="ticker-stat" title="Customer Satisfaction Rating">
            <div>
              <div className="ticker-label">Rating</div>
              <div className="ticker-value game-num" style={{ color: 'var(--accent-gold)' }}>
                ★ {ratingAvg.toFixed(1)} ({reviewCount})
              </div>
            </div>
          </div>
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className={`gbtn ${muted ? 'gbtn-slate' : ''}`}
            onClick={actions.toggleSound}
            title={muted ? 'Unmute game audio' : 'Mute game audio'}
            aria-label={muted ? 'Sound Off' : 'Sound On'}
          >
            <span>{muted ? 'Sound Off' : 'Sound On'}</span>
          </button>
          <button
            type="button"
            className={`gbtn gbtn-green ${mapOpen ? 'is-active' : ''}`}
            onClick={() => actions.toggleMap({ click: true })}
          >
            <img src={icons.map} alt="" className="px-icon-sm" />
            <span>NY Map</span>
            <span className="keycap">M</span>
          </button>
          <button
            type="button"
            className={`gbtn ${booksOpen ? 'is-active' : ''}`}
            onClick={() => actions.toggleBooks({ click: true })}
          >
            <img src={icons.book} alt="" className="px-icon-sm" />
            <span>Books</span>
            <span className="keycap">B</span>
          </button>
        </div>
      </div>
    </header>
  );
}
