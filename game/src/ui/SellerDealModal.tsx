import { AnimatePresence, m } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { PUBLIC_DEALS } from '../../shared/deals';
import { CENTRAL_PARK_DEAL, CENTRAL_PARK_DEAL_ID } from '../core/deal';
import { STARTER_QUESTIONS } from '../core/sellerQuestions';
import { HURDLE_RATE } from '../core/sliceModel';
import { MAX_QUESTION_CHARS, MAX_QUESTIONS } from '../deal/limits';
import type { DealView } from '../deal/dealView';
import { INPUT_PRIORITY } from '../state/input';
import { useGameStore } from '../state/gameStore';
import { getPortraits } from './assets';
import { backdropMotion, modalShellMotion } from './motionPresets';
import { CursorMenu, type CursorMenuItem } from './kit/CursorMenu';
import { Key } from './kit/Money';
import { useInputLayer } from './kit/useInputLayer';
import './styles/seller.css';

/**
 * The seller deal screen ("Paper Trail" layout).
 *
 *   LEFT  the seller: portrait + speech BALLOON (only words the AI seller actually said),
 *         question pips, and a cursor menu: preset questions, "Type my own", Bid, Walk away.
 *   RIGHT the seller's books on PAPER (engine numbers from the deal registry).
 *   BID   a dial (left/right) and THE LINE meter: what the books say the stand earns a
 *         day vs. the 5% a day this bid must earn to create value.
 *
 * The two surfaces are the lesson: the books are engine facts, the balloon is a person
 * who wants to sell. Spotting the gap is the skill the game teaches.
 *
 * All rules (question limit, bid validity, the hidden minimum, finality) live in the
 * deal machine and the server; this screen only renders `DealView` and sends intents.
 * When the seller can't talk, the screen says so plainly; it never fills in words.
 */

const persona = PUBLIC_DEALS[CENTRAL_PARK_DEAL_ID].persona;
const books = CENTRAL_PARK_DEAL.books;
const latestProfit = books[books.length - 1]?.profit ?? 0;
const ASK = CENTRAL_PARK_DEAL.askingPrice;

type Mode = 'menu' | 'typing' | 'bidding';

export function SellerDealModal() {
  const open = useGameStore((s) => s.activeModal === 'seller-stand');
  // Kept outside the body so a half-set bid survives closing and reopening the panel.
  const [bid, setBid] = useState(ASK);
  return <AnimatePresence>{open && <SellerDealBody key="seller" bid={bid} setBid={setBid} />}</AnimatePresence>;
}

function SellerDealBody({ bid, setBid }: { bid: number; setBid: (n: number) => void }) {
  const deal = useGameStore((s) => s.deal);
  const cash = useGameStore((s) => s.economy.cash);
  const actions = useGameStore((s) => s.actions);
  const [mode, setMode] = useState<Mode>('menu');

  const finished = deal?.phase === 'won' || deal?.phase === 'rejected' || deal?.phase === 'walkedAway';
  const busy = !deal || deal.phase === 'loading' || deal.phase === 'answering' || deal.phase === 'resolving';

  return (
    <m.div className="pt-scrim seller-scrim" onClick={actions.closeModal} {...backdropMotion}>
      <m.section
        className="pt-sign seller-window"
        role="dialog"
        aria-label={`Deal with ${persona.name}`}
        onClick={(e) => e.stopPropagation()}
        {...modalShellMotion}
      >
        <header className="pt-titlebar seller-head">
          <span className="pt-disp seller-title">{persona.name}&apos;s stand</span>
          <span className="seller-ask pt-disp">
            <small>ASKING</small> ${ASK}
          </span>
        </header>

        <div className="seller-talk">
          <Speech deal={deal} />
          <QuestionLog deal={deal} />
        </div>

        <SellerBooks />

        <div className="seller-actions pt-sign">
          {finished ? (
            <Outcome deal={deal} onLeave={actions.closeModal} />
          ) : mode === 'typing' ? (
            <AskForm
              onSubmit={(q) => {
                actions.askSeller(q);
                setMode('menu');
              }}
              onCancel={() => setMode('menu')}
            />
          ) : mode === 'bidding' ? (
            <BidDial
              bid={bid}
              setBid={setBid}
              cash={cash}
              deal={deal}
              disabled={busy}
              onSeal={() => actions.submitBid(bid)}
              onBack={() => setMode('menu')}
            />
          ) : (
            <DealMenu deal={deal} busy={busy} setMode={setMode} />
          )}
        </div>
      </m.section>
    </m.div>
  );
}

/** The seller's balloon, or a plain status when there are no real words to show. */
function Speech({ deal }: { deal: DealView | null }) {
  const portrait = getPortraits().shiba;
  const latest = deal?.qa[deal.qa.length - 1];
  let body: React.ReactNode;
  if (!deal || deal.phase === 'loading' || deal.phase === 'answering') {
    body = <span className="seller-thinking" aria-label="The seller is thinking" />;
  } else if (deal.sellerOffline) {
    body = null; // shown as a status below, never as speech
  } else if (latest?.status === 'answered' && latest.a) {
    body = latest.a;
  } else {
    body = deal.pitch;
  }

  const status =
    deal?.sellerOffline === true
      ? "Seller isn't talking"
      : latest && latest.status === 'no-answer'
        ? latest.refunded
          ? 'No answer · question back'
          : 'No answer'
        : latest?.status === 'error'
          ? "Couldn't reach the seller"
          : null;

  return (
    <div className="seller-speech">
      <div className="seller-portrait">
        <img src={portrait} alt="" className="pixel-portrait" />
        <span className="seller-name">{persona.name}</span>
      </div>
      <div className="seller-speech-col">
        {body !== null && <div className="pt-balloon seller-balloon">{body}</div>}
        {status && <div className="seller-status pt-disp">{status}</div>}
      </div>
    </div>
  );
}

/** Earlier questions, newest last, with their answers (or the honest "no answer"). */
function QuestionLog({ deal }: { deal: DealView | null }) {
  if (!deal || deal.qa.length === 0) return null;
  return (
    <ol className="seller-log">
      {deal.qa.map((entry, i) => (
        <li key={i}>
          <span className="seller-log-q">{entry.q}</span>
          <span className="seller-log-a">{entry.status === 'answered' ? entry.a : '—'}</span>
        </li>
      ))}
    </ol>
  );
}

/** The seller's published books: engine numbers on paper. */
function SellerBooks() {
  return (
    <div className="pt-paper seller-books">
      <div className="seller-books-title">
        <span className="pt-disp">Their books</span>
        <span className="pt-ink-dim">per day</span>
      </div>
      <table className="pt-ledger">
        <thead>
          <tr>
            <th>Period</th>
            <th>Sales</th>
            <th>Lemons</th>
            <th>Manager</th>
            <th>Rent</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
          {books.map((b, i) => (
            <tr key={b.label} className={i === books.length - 1 ? 'is-total' : undefined}>
              <td>{b.label}</td>
              <td>${b.sales}</td>
              <td>${b.lemons}</td>
              <td>${b.managerWage}</td>
              <td>${b.rent}</td>
              <td>${b.profit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealMenu({
  deal,
  busy,
  setMode,
}: {
  deal: DealView | null;
  busy: boolean;
  setMode: (m: Mode) => void;
}) {
  const actions = useGameStore((s) => s.actions);
  const left = deal?.questionsLeft ?? 0;
  const canAsk = !busy && (deal?.canAsk ?? false);
  const asked = new Set(deal?.qa.map((e) => e.q.toLowerCase()) ?? []);

  const items: CursorMenuItem[] = [
    ...STARTER_QUESTIONS.map((q) => ({
      id: `preset:${q}`,
      label: q,
      disabled: !canAsk || asked.has(q.toLowerCase()),
      onSelect: () => actions.askSeller(q),
    })),
    { id: 'type', label: 'Ask my own', disabled: !canAsk, onSelect: () => setMode('typing') },
    { id: 'bid', label: 'Bid', disabled: busy, onSelect: () => setMode('bidding') },
    { id: 'walk', label: 'Walk away', disabled: busy, onSelect: actions.walkAwayFromDeal },
  ];

  return (
    <div className="seller-menu">
      <div className="seller-pips-row">
        <span>Questions</span>
        <span className="pt-pips" aria-label={`${left} of ${MAX_QUESTIONS} questions left`}>
          {Array.from({ length: MAX_QUESTIONS }, (_, i) => (
            <i key={i} className={i < left ? undefined : 'is-used'} />
          ))}
        </span>
      </div>
      <CursorMenu label="Deal" items={items} blocking />
    </div>
  );
}

/** Type a question. Enter submits (native form), Escape closes the panel (router). */
function AskForm({ onSubmit, onCancel }: { onSubmit: (q: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSubmit(text.trim());
  };
  return (
    <form className="seller-ask-form" onSubmit={submit}>
      <input
        className="seller-input"
        autoFocus
        value={text}
        maxLength={MAX_QUESTION_CHARS}
        onChange={(e) => setText(e.target.value)}
        placeholder="When does the lease renew?"
        aria-label="Your question"
      />
      <div className="seller-form-row">
        <span className="pt-dim">
          {text.length}/{MAX_QUESTION_CHARS}
        </span>
        <button type="button" className="pt-btn is-ghost" onClick={onCancel}>
          Back
        </button>
        <button type="submit" className="pt-btn" disabled={!text.trim()}>
          Ask
        </button>
      </div>
    </form>
  );
}

/**
 * The sealed bid: a dial plus THE LINE meter.
 *   "Books say $8 a day"     = the seller's latest reported profit (engine number)
 *   "Must earn $2.25 a day"  = bid x 5%, the daily cost of the money this bid ties up
 * Left/right change the bid by $1, up/down by $5, E/Enter seals it.
 */
function BidDial({
  bid,
  setBid,
  cash,
  deal,
  disabled,
  onSeal,
  onBack,
}: {
  bid: number;
  setBid: (n: number) => void;
  cash: number;
  deal: DealView | null;
  disabled: boolean;
  onSeal: () => void;
  onBack: () => void;
}) {
  const clamp = (n: number) => Math.max(1, Math.round(n));
  const mustEarn = +(bid * HURDLE_RATE).toFixed(2);
  // Meter scale: the larger of the two figures fills the bar.
  const scale = Math.max(latestProfit, mustEarn, 0.01);

  useInputLayer(
    (e) => {
      const step = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1, ArrowDown: -5, s: -5, S: -5, ArrowUp: 5, w: 5, W: 5 }[
        e.key
      ];
      if (step !== undefined) {
        e.preventDefault();
        setBid(clamp(bid + step));
        return true;
      }
      if ((e.key === 'Enter' || e.key === 'e' || e.key === 'E') && !disabled) {
        e.preventDefault();
        if (e.repeat) return true; // a held key must not seal a bid by itself
        onSeal();
        return true;
      }
      return false;
    },
    { blocking: true, priority: INPUT_PRIORITY.modal }
  );

  const err = deal?.bidError;
  return (
    <div className="seller-bid">
      <div className="seller-dial">
        <span className="pt-dim">Your bid</span>
        <div className="seller-dial-row">
          <button type="button" className="seller-dial-btn" onClick={() => setBid(clamp(bid - 1))} aria-label="Lower bid">
            &#9664;
          </button>
          <output className="pt-disp seller-dial-value">${bid}</output>
          <button type="button" className="seller-dial-btn" onClick={() => setBid(clamp(bid + 1))} aria-label="Raise bid">
            &#9654;
          </button>
        </div>
        <span className="pt-dim">Cash ${cash.toFixed(2)}</span>
      </div>

      <div className="seller-meter-col">
        <div className="seller-meter-cap">
          <span>
            Books say <b className="pt-num pt-gain-sign">${latestProfit.toFixed(2)}</b>/day
          </span>
          <span>
            Must earn <b className="pt-num seller-line-text">${mustEarn.toFixed(2)}</b>/day
          </span>
        </div>
        <div className="seller-meter" aria-hidden="true">
          <i className="seller-meter-earn" style={{ width: `${(latestProfit / scale) * 100}%` }} />
          <i className="seller-meter-need" style={{ left: `${(mustEarn / scale) * 100}%` }} />
        </div>
        {err && (
          <span className="seller-bid-error pt-disp">
            {err.kind === 'insufficient-cash'
              ? `Only $${err.cash.toFixed(2)} cash`
              : err.kind === 'error'
                ? 'Bid failed, try again'
                : 'Bid not accepted'}
          </span>
        )}
      </div>

      <div className="seller-bid-buttons">
        <button type="button" className="pt-btn" disabled={disabled} onClick={onSeal}>
          <Key k="E" /> Seal bid
        </button>
        <button type="button" className="pt-btn is-ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Final result stamp. The deal is closed for the career. */
function Outcome({ deal, onLeave }: { deal: DealView | null; onLeave: () => void }) {
  useInputLayer(
    (e) => {
      if (e.key === 'Enter' || e.key === 'e' || e.key === 'E') {
        if (!e.repeat) onLeave();
        return true;
      }
      return false;
    },
    { blocking: true, priority: INPUT_PRIORITY.modal }
  );
  const won = deal?.phase === 'won';
  const label = won ? 'SOLD' : deal?.phase === 'rejected' ? 'NO DEAL' : 'WALKED AWAY';
  return (
    <div className="seller-outcome">
      <m.span
        className={`pt-stamp seller-stamp ${won ? 'pt-gain-sign' : 'pt-cost-sign'}`}
        initial={{ scale: 1.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.12, ease: [0.2, 1.6, 0.4, 1] }}
      >
        {label}
      </m.span>
      {deal?.bid !== undefined && <span className="pt-disp seller-outcome-bid">Bid ${deal.bid}</span>}
      <button type="button" className="pt-btn" onClick={onLeave}>
        <Key k="E" /> Leave
      </button>
    </div>
  );
}
