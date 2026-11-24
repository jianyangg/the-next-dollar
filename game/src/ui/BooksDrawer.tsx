import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { type ReactNode, useMemo, useState } from 'react';
import {
  getDailyHurdleCharge,
  getDailyWages,
  getMoneyInBusiness,
  getTotalEquity,
  HURDLE_RATE,
  STALL_KIT_COST,
} from '../core/sliceModel';
import { projectDay } from '../core/dayEnd';
import { PITCHER_COST, STAND_DIVEST_PROCEEDS, USED_PITCHER_RESALE } from '../core/purchases';
import { getDailyPlotRent } from '../core/rent';
import { getNeighborhood } from '../core/neighborhoods';
import { selectLivePlotId, useGameStore } from '../state/gameStore';
import { INPUT_PRIORITY } from '../state/input';
import { awarenessLines, BOOKS_TABS, type BooksTab, meterShape } from './books/ledger';
import { MARKETING_LABEL, ratePct } from './books/receipt';
import { fmtSignedMoney } from './format';
import { Key } from './kit/Money';
import { CursorMenu, type CursorMenuItem } from './kit/CursorMenu';
import { useInputLayer } from './kit/useInputLayer';
import { drawerMotion } from './motionPresets';
import { ValueTrajectoryStrip } from './ValueTrajectoryStrip';
import './styles/books.css';

/** "$8.40": amounts on the sell buttons, read from the engine's price constants. */
const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Cheap gate: subscribes ONLY to `booksOpen`. While the drawer is closed this is the
 * only thing that can wake up; the heavy body below (which reads the whole economy)
 * is not even mounted.
 */
export function BooksDrawer() {
  const booksOpen = useGameStore((s) => s.booksOpen);
  return <AnimatePresence>{booksOpen && <BooksDrawerBody key="books" />}</AnimatePresence>;
}

type Tone = 'gain' | 'cost' | 'flat';
const TONE_CLASS: Record<Tone, string> = { gain: 'pt-gain-paper', cost: 'pt-cost-paper', flat: '' };

/**
 * One ledger line: a plain-word label first, the formal accounting term in brackets after
 * it (so a student learns the word next to the idea), and the figure on the right.
 */
function Row({
  label,
  formal,
  value,
  tone = 'flat',
  total = false,
  line = false,
}: {
  label: string;
  formal?: string;
  value: ReactNode;
  tone?: Tone;
  total?: boolean;
  /** THE LINE: the one row that shows the 5% daily charge wears the hazard stripes. */
  line?: boolean;
}) {
  return (
    <tr className={`${total ? 'is-total' : ''} ${line ? 'books-line-row pt-line-row' : ''}`}>
      <td>
        {label}
        {formal && <span className="books-formal">({formal})</span>}
      </td>
      <td className={TONE_CLASS[tone]}>{value}</td>
    </tr>
  );
}

function Ledger({ children }: { children: ReactNode }) {
  return (
    <table className="pt-ledger books-table">
      <tbody>{children}</tbody>
    </table>
  );
}

/**
 * "Built, not counted in your worth": the brand awareness campaigns bought.
 *
 * The lesson: campaigns were expensed the day they were bought, and awareness cannot be
 * sold, so the balance sheet above shows none of it, yet it still brings walkers. This
 * block sits right under "Your worth" so the gap between the books and the business is
 * visible. Hidden entirely on a run that never advertised (nothing to explain).
 */
function BuiltNotCounted({
  awareness,
  totalMarketing,
}: {
  awareness: Parameters<typeof awarenessLines>[0];
  totalMarketing: number;
}) {
  if (totalMarketing <= 0) return null;
  const lines = awarenessLines(awareness);
  return (
    <section className="books-built" aria-label="Built, not counted in your worth">
      <div className="books-built-title">Built, not counted in your worth</div>
      <Ledger>
        {lines.length === 0 ? (
          // Spent, but every district has faded back below 1: say so rather than show an empty list.
          <tr>
            <td colSpan={2} className="books-built-empty">
              Awareness has faded everywhere
            </td>
          </tr>
        ) : (
          lines.map((line) => <Row key={line.id} label={line.name} formal="awareness" value={`${line.pct}/100`} />)
        )}
        <Row label="Spent on marketing" formal="this run" value={`$${totalMarketing.toFixed(2)}`} total />
      </Ledger>
    </section>
  );
}

/** The financial statements as four tabs: Income, Balance, Value (Grandma's daily rate), Reviews. */
function BooksDrawerBody() {
  const actions = useGameStore((s) => s.actions);
  const state = useGameStore((s) => s.economy);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  // The stand Divest sells: the one being run in this district (null = none here).
  const livePlotId = useGameStore(selectLivePlotId);
  const neighborhood = getNeighborhood(neighborhoodId);
  const [tab, setTab] = useState<BooksTab>('income');

  // Daily rent: every leased/built district plot plus any acquired seller stand (core/rent.ts)
  const estRent = getDailyPlotRent(state);
  const dailyWages = getDailyWages(state);

  // Derived financial metrics (all from the engine's own functions)
  const moneyIn = getMoneyInBusiness(state);
  const dailyHurdle = getDailyHurdleCharge(state);
  // Same formula as the HUD meter and the closing bell (core/dayEnd.ts projectDay).
  const today = projectDay(state);
  const projectedNopat = today.nopat;
  const projectedEva = today.valueCreated;

  const totalAssets = +(state.cash + state.inventoryValue + state.equipmentValue).toFixed(2);
  const totalEquity = getTotalEquity(state);
  const isBalanced = Math.abs(totalAssets - totalEquity) < 0.005;

  const meter = meterShape(dailyHurdle, projectedNopat);
  const signTone = (n: number): Tone => (n >= 0 ? 'gain' : 'cost');

  // The tab row is a CursorMenu: A/D (or arrows) move the cursor, E/Enter opens the tab, and a
  // mouse click works too. The open tab is underlined so it is clear which one is showing.
  const tabItems = useMemo<CursorMenuItem[]>(
    () =>
      BOOKS_TABS.map((t) => ({
        id: t.id,
        label: <span className={`books-tab ${t.id === tab ? 'is-open' : ''}`}>{t.label}</span>,
        onSelect: () => setTab(t.id),
      })),
    [tab]
  );

  // The drawer sits over the world, so keys it does not use must not walk the player.
  // This blocking layer is BELOW the menu (menu = 100) so the tab menu still gets A/D/E,
  // and it lets Escape (close) and B (toggle books) fall through to the shortcut layer.
  useInputLayer(() => false, {
    blocking: true,
    passKeys: ['Escape', 'b', 'B'],
    priority: INPUT_PRIORITY.menu - 10,
  });

  return (
    <m.aside className="pt-paper books-sheet" aria-label="Books" {...drawerMotion}>
      <div className="books-scroll">
        <header className="books-head">
          <div>
            <h2 className="pt-disp books-title">BOOKS</h2>
            <div className="books-kicker">
              {neighborhood.shortName} · Day {state.day}
            </div>
          </div>
          <button type="button" className="pt-btn is-ghost books-close" onClick={actions.closeBooks} aria-label="Close Books">
            <Key k="Esc" nav />
            <span>CLOSE</span>
          </button>
        </header>

        <CursorMenu items={tabItems} orientation="row" label="Books tabs" className="books-tabs" />

        {tab === 'income' && (
          <section aria-label="Income">
            <Ledger>
              <Row label="Sales" formal="revenue" value={`$${state.dayRevenue.toFixed(2)}`} tone="gain" />
              <Row label="Lemons used" formal="COGS" value={`-$${state.dayCogs.toFixed(2)}`} tone="cost" />
              {/* Before rent and wages this is gross profit; "NOPAT" is the figure after them (below). */}
              <Row label="Profit before rent" formal="gross profit" value={`$${today.earned.toFixed(2)}`} />
              <Row label="Rent per day" formal="estimate" value={`-$${estRent.toFixed(2)}`} tone="cost" />
              {dailyWages > 0 && (
                <Row
                  label="Wages"
                  formal={`${state.staffedPlots.length}W · ${state.managers}M`}
                  value={`-$${dailyWages.toFixed(2)}`}
                  tone="cost"
                />
              )}
              {/* Same figure the closing receipt will print (projectDay is the one formula),
                  shown only on a day with a campaign, like the receipt's Marketing row. */}
              {today.marketing > 0 && (
                <Row label={MARKETING_LABEL} formal="expense" value={`-$${today.marketing.toFixed(2)}`} tone="cost" />
              )}
              <Row
                label="Profit today"
                formal="projected NOPAT"
                value={fmtSignedMoney(projectedNopat)}
                tone={signTone(projectedNopat)}
                total
              />
            </Ledger>
          </section>
        )}

        {tab === 'balance' && (
          <section aria-label="Balance">
            <Ledger>
              <Row label="Cash" value={`$${state.cash.toFixed(2)}`} />
              <Row label="Lemons held" formal="inventory" value={`$${state.inventoryValue.toFixed(2)}`} />
              <Row label="Stands, pitchers" formal="equipment" value={`$${state.equipmentValue.toFixed(2)}`} />
              <Row label="All you own" formal="total assets" value={`$${totalAssets.toFixed(2)}`} total />
              <Row label="Your worth" formal="owner's equity" value={`$${totalEquity.toFixed(2)}`} />
            </Ledger>
            <div className={`books-check pt-num ${isBalanced ? 'pt-gain-paper' : 'pt-cost-paper'}`}>
              <span>{isBalanced ? '✓' : '!'}</span>
              <span>
                {isBalanced
                  ? `Balanced: Assets ($${totalAssets.toFixed(2)}) = Equity ($${totalEquity.toFixed(2)})`
                  : 'Out of Balance'}
              </span>
            </div>
            <BuiltNotCounted awareness={state.awareness} totalMarketing={state.totalMarketing} />
          </section>
        )}

        {tab === 'value' && (
          <section aria-label="Value">
            <Ledger>
              <Row label="You at opening" formal="cash + lemons + gear resale" value={`$${moneyIn.toFixed(2)}`} />
              <Row
                label={`Grandma's ${ratePct()} a day`}
                formal="hurdle charge"
                value={`-$${dailyHurdle.toFixed(2)}/d`}
                tone="cost"
                line
              />
            </Ledger>

            {/* The meter: today's profit bar against Grandma's daily share, drawn on one shared scale. */}
            <div className="books-meter">
              <div className="books-meter-top">
                <span>Profit vs the line</span>
                <span className={meter.clears ? 'pt-gain-paper' : 'pt-cost-paper'}>
                  {meter.clears ? 'Beating it' : 'Below it'}
                </span>
              </div>
              <div className="books-meter-row">
                <span className="books-meter-name">Profit</span>
                <div className="books-meter-track">
                  <div
                    className={`books-meter-fill ${meter.clears ? 'is-gain' : 'is-cost'}`}
                    style={{ width: `${meter.profitPct}%` }}
                  />
                </div>
                <span className="pt-num books-meter-val">{fmtSignedMoney(projectedNopat)}</span>
              </div>
              <div className="books-meter-row">
                <span className="books-meter-name">Grandma's {ratePct()}</span>
                <div className="books-meter-track">
                  <div className="books-meter-fill pt-line-fill" style={{ width: `${meter.linePct}%` }} />
                </div>
                <span className="pt-num books-meter-val">-${dailyHurdle.toFixed(2)}</span>
              </div>
            </div>

            <Ledger>
              <Row label="Profit today" formal="NOPAT" value={fmtSignedMoney(projectedNopat)} tone={signTone(projectedNopat)} />
              <Row label="Value today" formal="EVA" value={fmtSignedMoney(projectedEva)} tone={signTone(projectedEva)} />
              <Row
                label="Value so far"
                formal="cumulative EVA"
                value={fmtSignedMoney(state.totalValueCreated)}
                tone={signTone(state.totalValueCreated)}
                total
              />
            </Ledger>
            <ValueTrajectoryStrip />

            {(state.pitchers >= 1 || livePlotId !== null) && (
              <div className="books-sell">
                {state.pitchers >= 1 && (
                  <button
                    type="button"
                    className="pt-btn is-ghost"
                    onClick={actions.sellUsedPitcher}
                    title={`Cash +${money(USED_PITCHER_RESALE)}, equipment -${money(PITCHER_COST)}, ${ratePct()} a day -${money((PITCHER_COST - USED_PITCHER_RESALE) * HURDLE_RATE)}/day`}
                  >
                    Sell Pitcher (+{money(USED_PITCHER_RESALE)})
                  </button>
                )}
                {livePlotId !== null && (
                  <button
                    type="button"
                    className="pt-btn is-ghost"
                    onClick={actions.divestCurrentStand}
                    title={`Cash +${money(STAND_DIVEST_PROCEEDS)}, equipment -${money(STALL_KIT_COST)}, ${ratePct()} a day -${money((STALL_KIT_COST - STAND_DIVEST_PROCEEDS) * HURDLE_RATE)}/day`}
                  >
                    Divest Stand (+{money(STAND_DIVEST_PROCEEDS)})
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {tab === 'reviews' && (
          <section aria-label="Reviews">
            <div className="books-rating pt-num">
              ★ {state.ratingAvg.toFixed(1)} ({state.reviews.length})
            </div>
            {state.reviews.length === 0 ? (
              <div className="books-empty">No reviews yet. Serve a customer!</div>
            ) : (
              <ul className="books-reviews">
                {state.reviews
                  .slice(-4)
                  .reverse()
                  .map((rev) => (
                    <li key={rev.id} className="books-review">
                      <div className="books-stars">
                        {'★'.repeat(rev.stars)}
                        {'☆'.repeat(5 - rev.stars)}
                      </div>
                      <div>{rev.comment}</div>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </m.aside>
  );
}
