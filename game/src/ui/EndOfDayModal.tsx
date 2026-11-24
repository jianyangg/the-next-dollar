import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useMemo, useRef } from 'react';
import { beatTheLine } from '../core/dayEnd';
import { getDailyPlotRent } from '../core/rent';
import { getNeighborhood } from '../core/neighborhoods';
import { getRunSeed } from '../core/runRandom';
import { getDailyWages, getInvestedCapital, HURDLE_RATE } from '../core/sliceModel';
import type { DayRecord } from '../core/sliceModel';
import { INPUT_PRIORITY } from '../state/input';
import { useGameStore } from '../state/gameStore';
import { buildReceipt, splitProfit } from './books/receipt';
import type { ReceiptRow, Tone } from './books/receipt';
import { useReveal } from './books/useReveal';
import { fmtSignedMoney } from './format';
import { Key, CountUp } from './kit/Money';
import { useInputLayer } from './kit/useInputLayer';
import { backdropMotion, modalShellMotion } from './motionPresets';
import { ValueTrajectoryStrip } from './ValueTrajectoryStrip';
import './styles/eod.css';

/**
 * Closing bell: the day's VERDICT first, then the receipt that explains it.
 *
 * The day has one goal (beat the line: rent + wages + the 5% charge), so the screen
 * leads with one beat: "BEAT THE LINE" in green or "MISSED THE LINE" in red, a stamp
 * that slams down when the receipt finishes printing, and the run's tally of days
 * beaten. The old letter grade is gone: it was S on almost every day (it graded the
 * return, which is far above 20% on any normal day), so it carried no information.
 *
 * The gate subscribes only to the closed-day record (non-null while the screen shows);
 * the body mounts when it exists. The gate hands the record to the body as a PROP (not a
 * store read) so that while AnimatePresence plays the exit fade the body still has its
 * content; a body that read the store would see `null` and vanish instantly.
 */
export function EndOfDayModal() {
  const eodRecord = useGameStore((s) => s.eodRecord);
  return <AnimatePresence>{eodRecord && <EndOfDayBody key="eod" eodRecord={eodRecord} />}</AnimatePresence>;
}

const TONE_CLASS: Record<Tone, string> = { gain: 'pt-gain-paper', cost: 'pt-cost-paper', flat: '' };
const CONFIRM_KEYS = ['Enter', 'e', 'E'];

function EndOfDayBody({ eodRecord }: { eodRecord: DayRecord }) {
  const actions = useGameStore((s) => s.actions);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const investedCap = useGameStore((s) => getInvestedCapital(s.economy));
  // The record stores rent + wages as one sum; the engine's own functions give the two parts.
  const dailyRent = useGameStore((s) => getDailyPlotRent(s.economy));
  const dailyWages = useGameStore((s) => getDailyWages(s.economy));
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const neighborhood = getNeighborhood(neighborhoodId);

  const rows = useMemo(
    () => buildReceipt({ record: eodRecord, investedCapital: investedCap, dailyRent, dailyWages }),
    [eodRecord, investedCap, dailyRent, dailyWages]
  );
  const split = useMemo(() => splitProfit(eodRecord), [eodRecord]);

  // Reduced motion: no printing, everything is on the page from the first frame.
  const reducedMotion = useReducedMotion();
  const { stage, done, skipped, skip } = useReveal(rows.length, Boolean(reducedMotion));

  // One press = one step: while the receipt is still printing it skips to the end; once
  // finished it starts the next day. The ref stops a second press (during the exit fade,
  // when this layer is still mounted) from advancing the day twice.
  const advanced = useRef(false);
  const advance = () => {
    if (advanced.current) return;
    if (!done) {
      skip();
      return;
    }
    advanced.current = true;
    // After the last day there is no next morning: show the final results instead.
    if (lastDay) actions.finishRun();
    else actions.startNextDay();
  };

  // A modal: blocking, so WASD and friends never move the player behind the receipt.
  // Key repeat is swallowed so holding E cannot skip AND advance in one go.
  useInputLayer(
    (e) => {
      if (!CONFIRM_KEYS.includes(e.key)) return false;
      e.preventDefault();
      if (!e.repeat) advance();
      return true;
    },
    { blocking: true, priority: INPUT_PRIORITY.modal }
  );

  const lastDay = eodRecord.day >= maxDays;
  const won = beatTheLine(eodRecord);
  const tone = won ? 'gain' : 'cost';
  // Days beaten so far, from the run's own history (this day is already in it).
  const history = useGameStore((s) => s.economy.dayHistory);
  const daysBeaten = history.filter(beatTheLine).length;

  return (
    <m.div className="pt-scrim" {...backdropMotion}>
      <m.div className="eodr-frame" onClick={(e) => e.stopPropagation()} {...modalShellMotion}>
        <div className="eodr-card" role="dialog" aria-label={`Day ${eodRecord.day} closed`}>
          <header className="eodr-head">
            <h2 className={`pt-disp eodr-title ${won ? 'pt-gain-sign' : 'pt-cost-sign'}`}>
              {won ? 'BEAT THE LINE' : 'MISSED THE LINE'}
            </h2>
            <span className="eodr-where">
              {neighborhood.name} · Day {eodRecord.day} of {maxDays}
            </span>
          </header>

          <section className="pt-paper eodr-receipt" aria-label="Receipt">
            {rows.map((row, i) => (
              <ReceiptLine
                key={row.kind}
                row={row}
                shown={i < stage.rowsShown}
                counting={stage.counting}
                skipped={skipped}
              />
            ))}

            <div className={`eodr-split ${stage.rowsShown >= rows.length ? '' : 'is-hidden'}`}>
              {split.kind === 'split' ? (
                <>
                  <div className="eodr-split-bar" role="img" aria-label="How much of the profit the 5% line took">
                    <div className="eodr-split-take pt-line-fill" style={{ width: `${split.takenPct}%` }} />
                    <div className="eodr-split-keep" />
                  </div>
                  <div className="eodr-split-cap">
                    <span>5% line: ${split.taken.toFixed(2)}</span>
                    <span>
                      Yours: ${split.kept.toFixed(2)} of ${split.profit.toFixed(2)}
                    </span>
                  </div>
                  {split.shortfall > 0 && (
                    <div className="eodr-short pt-cost-paper">Line wanted ${split.shortfall.toFixed(2)} more than the profit</div>
                  )}
                </>
              ) : (
                <div className="eodr-short pt-cost-paper">
                  No profit to split. Short of the 5% line by ${split.short.toFixed(2)}
                </div>
              )}
              {/* The same fact as a rate: profit as a share of the money tied up. */}
              <div className="eodr-split-cap">
                <span>Return on money tied up: {eodRecord.roicPct.toFixed(1)}%</span>
                <span>Line asks {(HURDLE_RATE * 100).toFixed(0)}%</span>
              </div>
            </div>
          </section>

          <aside className="eodr-side">
            <div className={`pt-stamp eodr-stamp is-${tone} ${stage.stamped ? '' : 'is-pre'}`} aria-label={won ? 'Day won' : 'Day missed'}>
              {won ? 'WON' : 'MISSED'}
            </div>

            <div className="pt-paper eodr-run">
              <div className="eodr-tally" aria-label={`Days beaten ${daysBeaten} of ${eodRecord.day}`}>
                <span className="eodr-run-label">Days beaten</span>
                <span className="pt-disp eodr-tally-num">
                  {daysBeaten}/{eodRecord.day}
                </span>
              </div>
              <div className="eodr-run-label">Total so far ({maxDays} days)</div>
              <div className={`pt-disp eodr-run-big ${eodRecord.cumulativeValue >= 0 ? 'pt-gain-paper' : 'pt-cost-paper'}`}>
                {fmtSignedMoney(eodRecord.cumulativeValue)}
              </div>
              <ValueTrajectoryStrip />
            </div>

            <button type="button" className="pt-btn eodr-next" onClick={advance}>
              <Key k="E" />
              <span>{lastDay ? 'FINAL RESULTS' : 'NEXT DAY'}</span>
            </button>
            {/* Run seed (to replay a run with ?seed=N) is a testing tool, so it shows only in
                dev builds opened with ?dev. `import.meta.env.DEV` is a compile-time constant,
                so production bundles drop this line entirely. */}
            {import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev') && (
              <div className="eodr-seed">Run seed {getRunSeed()}</div>
            )}
          </aside>
        </div>
      </m.div>
    </m.div>
  );
}

function ReceiptLine({
  row,
  shown,
  counting,
  skipped,
}: {
  row: ReceiptRow;
  shown: boolean;
  counting: boolean;
  skipped: boolean;
}) {
  const isFinal = row.kind === 'final';
  const isLine = row.kind === 'line';
  const classes = [
    'eodr-row',
    row.kind === 'profit' ? 'is-total' : '',
    isLine ? 'pt-line-row is-line' : '',
    isFinal ? 'is-final' : '',
    shown ? '' : 'is-hidden',
  ];
  return (
    <div className={classes.join(' ')} aria-hidden={!shown}>
      <span>
        {isFinal ? row.label.toUpperCase() : row.label}
        {row.how && <span className="eodr-how">{row.how}</span>}
      </span>
      {isFinal ? (
        // Counts from $0 up to the day's value; `key` remounts it after a skip so it jumps.
        <CountUp
          key={skipped ? 'done' : 'run'}
          className={`pt-disp eodr-final-num ${TONE_CLASS[row.tone]}`}
          value={counting ? row.amount : 0}
          format={fmtSignedMoney}
        />
      ) : (
        <span className={`pt-num eodr-num ${TONE_CLASS[row.tone]}`}>{row.text}</span>
      )}
    </div>
  );
}
