import { formatClockTime } from '../core/clock';
import { getNeighborhood } from '../core/neighborhoods';
import { FOUNDER_CATALOG } from '../world/pixelArt';
import { selectEffectiveClockSpeed, useGameStore } from '../state/gameStore';
import { getIcons, getPortraits } from './assets';
import { fmtSignedMoney } from './format';
import { CountUp, Key } from './kit/Money';
import { LineMeter } from './LineMeter';
import { SunArc } from './SunArc';
import './styles/hud.css';

/**
 * The heads-up display: three "sign plates" bolted over the 3D scene.
 *   top-left     founder portrait, Day N/30, place name, sun-arc clock (+ 1x/2x speed)
 *   top-right    cash (big, counts up), the live "today vs the line" meter (the day's
 *                goal) and the run's total value created (the 30-day score)
 *   bottom-right [M] Map, [B] Books and a sound toggle
 *
 * The star rating is not here on purpose: a game HUD shows a few things at a glance, and
 * the rating is a result of service, so it sits on the stand's paper stock tag instead.
 *
 * RE-RENDER DISCIPLINE (unchanged from the old bar): the day clock advances every
 * animation frame, but this component only shows it as a whole-percent bar and an
 * "8:15 AM" label. So instead of subscribing to the raw `timeProgress` (which would
 * re-render the HUD 60 times a second) we subscribe to the two DERIVED values below.
 * React compares them with `Object.is` and only re-renders when the percent or the
 * label text actually changes (a few times per game minute).
 */

// Module-level formatters keep the SAME function identity on every render. CountUp
// restarts its animation effect when `format` changes, so an inline arrow would be wrong.
const fmtCash = (v: number): string => `$${v.toFixed(2)}`;

/** Speaker icon drawn inline (no emoji, no extra image). A cross means muted. */
function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg className="hud-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" />
      {muted ? (
        <path d="M15 9l6 6M21 9l-6 6" stroke="currentColor" strokeWidth="3" fill="none" />
      ) : (
        <path d="M15 8q3 4 0 8M18 5q6 7 0 14" stroke="currentColor" strokeWidth="3" fill="none" />
      )}
    </svg>
  );
}

export function Hud() {
  const actions = useGameStore((s) => s.actions);
  const founderSpecies = useGameStore((s) => s.founderSpecies);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const day = useGameStore((s) => s.economy.day);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const cash = useGameStore((s) => s.economy.cash);
  const totalValueCreated = useGameStore((s) => s.economy.totalValueCreated);
  const clockSpeed = useGameStore((s) => s.clockSpeed);
  // The badge shows the speed the game is really running at: at the counter (serving or
  // brewing) it is 1x even when 2x is chosen (core/clock.ts effectiveClockSpeed).
  const runningSpeed = useGameStore(selectEffectiveClockSpeed);
  const heldAtCounter = runningSpeed !== clockSpeed;
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
    <header className="hud">
      {/* Top-left plate: who, which day, where, how far through the day. */}
      <div className="pt-sign hud-plate hud-left">
        <button
          type="button"
          className="hud-portrait-btn"
          onClick={actions.openFounderModal}
          title={`${selectedFounder.name}: change founder`}
          aria-label="Choose your founder"
        >
          <img src={portraits[founderSpecies]} alt={selectedFounder.name} className="hud-portrait" />
        </button>
        <div className="hud-left-body">
          <div className="hud-left-top">
            <span className="pt-disp hud-day">
              Day {day}/{maxDays}
            </span>
            <button
              type="button"
              className={`hud-speed ${runningSpeed === 2 ? 'is-fast' : ''}`}
              onClick={actions.toggleClockSpeed}
              aria-label={`Clock speed ${runningSpeed}x`}
              title={heldAtCounter ? 'The counter runs at 1x; 2x comes back when you step away' : 'Clock speed'}
            >
              {runningSpeed}x
            </button>
          </div>
          <div className="hud-place">{neighborhood.shortName}</div>
          <div className="hud-clock" aria-label={`Day ${day} clock ${clockLabel}`}>
            <SunArc pct={dayClockPct} />
            <span className="pt-num hud-clock-time">{clockLabel}</span>
          </div>
        </div>
      </div>

      {/* Top-right plate: the two money numbers a player watches. */}
      <div className="pt-sign hud-plate hud-right">
        <div className="hud-cash" aria-label="Cash">
          <img src={icons.coin} alt="" className="hud-coin" />
          <CountUp value={cash} format={fmtCash} className="pt-disp hud-cash-num" />
        </div>
        <LineMeter />
        <div className="hud-value">
          <span className="hud-value-label">Total</span>
          <CountUp
            value={totalValueCreated}
            format={fmtSignedMoney}
            className={`pt-num hud-value-num ${totalValueCreated >= 0 ? 'pt-gain-sign' : 'pt-cost-sign'}`}
          />
        </div>
      </div>

      {/* Bottom-right: navigation bullets and the sound toggle. */}
      <nav className="hud-keys" aria-label="Game menu">
        <button
          type="button"
          className={`pt-sign hud-nav ${mapOpen ? 'is-active' : ''}`}
          onClick={() => actions.toggleMap({ click: true })}
        >
          <Key k="M" nav />
          <span className="pt-disp hud-nav-word">Map</span>
        </button>
        <button
          type="button"
          className={`pt-sign hud-nav ${booksOpen ? 'is-active' : ''}`}
          onClick={() => actions.toggleBooks({ click: true })}
        >
          <Key k="B" nav />
          <span className="pt-disp hud-nav-word">Books</span>
        </button>
        <button
          type="button"
          className="pt-sign hud-nav hud-sound"
          onClick={actions.toggleSound}
          aria-label={muted ? 'Sound off' : 'Sound on'}
          title={muted ? 'Sound off' : 'Sound on'}
        >
          <SoundIcon muted={muted} />
        </button>
      </nav>
    </header>
  );
}
