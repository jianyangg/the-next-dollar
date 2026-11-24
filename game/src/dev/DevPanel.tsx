import { useState } from 'react';
import { INPUT_PRIORITY } from '../state/input';
import { useGameStore } from '../state/gameStore';
import { useInputLayer } from '../ui/kit/useInputLayer';
import '../ui/styles/dev.css';
import * as dev from './devTools';

/**
 * The developer panel. Mounted by App.tsx as `{import.meta.env.DEV && <DevPanelHost />}`,
 * so production builds drop it entirely, and it still stays hidden unless the URL has
 * `?dev`. Press the backquote key (`) to hide or show it.
 */

/** True when the page URL has the `?dev` flag. */
export function isDevUrl(): boolean {
  return new URLSearchParams(window.location.search).has('dev');
}

/** Renders nothing unless `?dev` is in the URL. The check is a separate component so
 *  the panel's hooks never run conditionally (hooks must run on every render). */
export function DevPanelHost() {
  return isDevUrl() ? <DevPanel /> : null;
}

/** Above every game layer (modal = 200) so the toggle works even with a window open. */
const DEV_PRIORITY = INPUT_PRIORITY.modal + 100;

function DevPanel() {
  const [open, setOpen] = useState(true);
  const [clock, setClock] = useState<dev.DevClockMode>(dev.getDevClockMode());
  const [dayText, setDayText] = useState('2');
  const [status, setStatus] = useState<{ text: string; refused: boolean }>({ text: '', refused: false });

  const day = useGameStore((s) => s.economy.day);
  const cash = useGameStore((s) => s.economy.cash);

  // Not blocking: every key except the backquote falls through to the game untouched.
  useInputLayer(
    (e) => {
      if (e.code !== 'Backquote' && e.key !== '`') return false;
      setOpen((o) => !o);
      return true;
    },
    { priority: DEV_PRIORITY }
  );

  if (!open) return null;

  /** Run a cheat, show its outcome. Blur so a later Space press cannot re-click it. */
  const run = (label: string, cheat: () => dev.DevResult) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    try {
      const r = cheat();
      setStatus(r.ok ? { text: `${label}: done`, refused: false } : { text: `${label}: refused (${r.reason})`, refused: true });
    } catch (err) {
      setStatus({ text: `${label}: ${err instanceof Error ? err.message : String(err)}`, refused: true });
    }
  };
  const btn = (label: string, cheat: () => dev.DevResult, on = false) => (
    <button type="button" className={`pt-btn dv-btn${on ? ' is-on' : ''}`} onClick={run(label, cheat)}>
      {label}
    </button>
  );
  const clockBtn = (label: string, mode: dev.DevClockMode) =>
    btn(label, () => {
      const r = dev.setDevClockMode(mode);
      setClock(mode);
      return r;
    }, clock === mode);

  return (
    <aside className="pt-sign dv-panel" aria-label="Developer tools">
      <div className="pt-titlebar dv-title">DEV</div>
      <p className="dv-hint">Press ` to hide. Day {day}, cash ${cash.toFixed(2)}</p>

      <section className="dv-group">
        <h2 className="dv-group-name">Money and stock</h2>
        <div className="dv-row">
          {btn('Cash +$100', dev.addCash)}
          {btn('Cash $0', dev.zeroCash)}
          {btn('+10 lemons', dev.addLemons)}
          {btn('+1 pitcher', dev.addPitcher)}
          {btn('+1 stall kit', dev.addStallKit)}
        </div>
      </section>

      <section className="dv-group">
        <h2 className="dv-group-name">Time</h2>
        <div className="dv-row">
          {btn('Skip to 8 PM', dev.skipToEvening)}
          <input
            className="dv-input"
            type="number"
            min={1}
            max={30}
            aria-label="Day number"
            value={dayText}
            onChange={(e) => setDayText(e.target.value)}
          />
          {btn('Go to day', () => dev.jumpToDay(Number(dayText)))}
        </div>
        <div className="dv-row" style={{ marginTop: 'var(--s-2)' }}>
          {clockBtn('x1', 'normal')}
          {clockBtn('x10', 'x10')}
          {clockBtn('Pause', 'paused')}
        </div>
      </section>

      <section className="dv-group">
        <h2 className="dv-group-name">Progress</h2>
        <div className="dv-row">
          {btn('Skip tutorial', dev.skipTutorial)}
          {btn('Reset seller deal', dev.resetSellerDeal)}
          {btn('Build stand here', dev.buildStandHere)}
        </div>
      </section>

      <section className="dv-group">
        <h2 className="dv-group-name">Seed</h2>
        <p className="dv-seed">{dev.currentSeed()}</p>
        <div className="dv-row">
          {btn('Restart, same seed', () => {
            dev.restartWithSameSeed();
            return { ok: true };
          })}
        </div>
      </section>

      <p className={`dv-status${status.refused ? ' is-refused' : ''}`} role="status">
        {status.text}
      </p>
    </aside>
  );
}
