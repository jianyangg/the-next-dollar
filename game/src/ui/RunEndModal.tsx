import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { beatTheLine } from '../core/dayEnd';
import { useGameStore } from '../state/gameStore';
import { INPUT_PRIORITY } from '../state/input';
import { fmtSignedMoney } from './format';
import { Key } from './kit/Money';
import { useInputLayer } from './kit/useInputLayer';
import { backdropMotion, modalShellMotion } from './motionPresets';
import { ValueTrajectoryStrip } from './ValueTrajectoryStrip';
import './styles/runend.css';

/**
 * THE ENDING: after the last day's receipt, the run is over and this screen gives the
 * 30-day verdict. Before it existed, day 30 repeated forever behind "KEEP PLAYING", so
 * the game had no win or lose state at all.
 *
 * The verdict is the game's own score: total value created over the run. Positive =
 * across the whole run the money beat its 5% a day ("You beat the line"); negative =
 * the line won. Days beaten and the per-day strip show how the run got there.
 *
 * "New run" reloads the page without a seed (see `newRunUrl`): a reload is the one way
 * to guarantee a clean run (fresh 3D scene, fresh random seed, fresh seller run id), and
 * it costs about a second. The intro is not shown again (it is remembered per browser).
 */
export function RunEndModal() {
  const open = useGameStore((s) => s.runOver);
  return <AnimatePresence>{open && <RunEndBody key="runend" />}</AnimatePresence>;
}

/**
 * Same page, no `seed` (a new random run), keeping `dev` so testers stay in dev mode.
 *
 * Built with the URL API from the CURRENT full URL, changing only the query and hash,
 * so the result is always on the same origin. (Gluing the pathname into a string was
 * an open redirect: a path like "//evil.example" is read by the browser as a link to
 * another site.)
 */
export function newRunUrl(currentHref: string): string {
  const url = new URL(currentHref);
  url.search = url.searchParams.has('dev') ? '?dev' : '';
  url.hash = '';
  return url.href;
}

function RunEndBody() {
  const total = useGameStore((s) => s.economy.totalValueCreated);
  const history = useGameStore((s) => s.economy.dayHistory);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const daysBeaten = history.filter(beatTheLine).length;
  const won = total >= 0;

  const newRun = (): void => window.location.assign(newRunUrl(window.location.href));

  useInputLayer(
    (e) => {
      if (e.key !== 'e' && e.key !== 'E' && e.key !== 'Enter') return false;
      e.preventDefault();
      if (!e.repeat) newRun();
      return true;
    },
    { blocking: true, passKeys: [], priority: INPUT_PRIORITY.modal }
  );

  return (
    <m.div className="pt-scrim runend-scrim" {...backdropMotion}>
      <m.div className="pt-sign runend-window" role="dialog" aria-label="Run results" {...modalShellMotion}>
        <header className="pt-titlebar runend-head">
          <h2 className="pt-disp runend-title">{maxDays} days done</h2>
        </header>

        <div className={`pt-disp runend-verdict ${won ? 'pt-gain-sign' : 'pt-cost-sign'}`}>
          {won ? 'You beat the line' : 'The line won'}
        </div>

        <div className="pt-paper runend-score">
          <div className="runend-row">
            <span className="runend-label">Value created</span>
            <span className={`pt-disp runend-big ${won ? 'pt-gain-paper' : 'pt-cost-paper'}`}>{fmtSignedMoney(total)}</span>
          </div>
          <div className="runend-row">
            <span className="runend-label">Days beaten</span>
            <span className="pt-disp runend-mid">
              {daysBeaten}/{history.length}
            </span>
          </div>
          <ValueTrajectoryStrip />
        </div>

        <button type="button" className="pt-btn runend-new" onClick={newRun}>
          <Key k="E" />
          <span>NEW RUN</span>
        </button>
      </m.div>
    </m.div>
  );
}
