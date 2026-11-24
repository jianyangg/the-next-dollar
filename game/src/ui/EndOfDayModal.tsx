import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useMemo, useRef } from 'react';
import { getDailyPlotRent } from '../core/rent';
import { getNeighborhood } from '../core/neighborhoods';
import { getRunSeed } from '../core/runRandom';
import { getDailyWages, getInvestedCapital, HURDLE_RATE } from '../core/sliceModel';
import type { DayRecord } from '../core/sliceModel';
import { INPUT_PRIORITY } from '../state/input';
import { useGameStore } from '../state/gameStore';
import { buildReceipt, gradeTone, splitProfit } from './books/receipt';
import type { ReceiptRow, Tone } from './books/receipt';
import { useReveal } from './books/useReveal';
import { fmtSignedMoney } from './format';
import { Key, CountUp } from './kit/Money';
import { useInputLayer } from './kit/useInputLayer';
import { backdropMotion, modalShellMotion } from './motionPresets';
import { ValueTrajectoryStrip } from './ValueTrajectoryStrip';
import './styles/eod.css';

/**
 * 8:00 PM closing bell: the end-of-day receipt, printed on PAPER over a dark scrim.
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
    actions.startNextDay();
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
  const tone = gradeTone(eodRecord.grade);

  return (
    <m.div className="pt-scrim" {...backdropMotion}>
      <m.div className="eodr-frame" onClick={(e) => e.stopPropagation()} {...modalShellMotion}>
        <div className="eodr-card" role="dialog" aria-label={`Day ${eodRecord.day} closed`}>
          <header className="eodr-head">
            <h2 className="pt-disp eodr-title">DAY {eodRecord.day} CLOSED</h2>
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
            <div className={`pt-stamp eodr-stamp is-${tone} ${stage.stamped ? '' : 'is-pre'}`} aria-label={`Grade ${eodRecord.grade}`}>
              {eodRecord.grade}
            </div>

            <div className="pt-paper eodr-run">
              <div className="eodr-run-label">Total so far ({maxDays} days)</div>
              <div className={`pt-disp eodr-run-big ${eodRecord.cumulativeValue >= 0 ? 'pt-gain-paper' : 'pt-cost-paper'}`}>
                {fmtSignedMoney(eodRecord.cumulativeValue)}
              </div>
              <ValueTrajectoryStrip />
            </div>

            <button type="button" className="pt-btn eodr-next" onClick={advance}>
              <Key k="E" />
              <span>{lastDay ? 'KEEP PLAYING' : 'NEXT DAY'}</span>
            </button>
            {/* Run seed lets a playtester report this exact run (replay with ?seed=N). */}
            <div className="eodr-seed">Run seed {getRunSeed()}</div>
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
