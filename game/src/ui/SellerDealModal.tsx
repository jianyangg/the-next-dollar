import React, { useState } from 'react';
import { CENTRAL_PARK_DEAL } from '../core/deal';
import { STARTER_QUESTIONS } from '../core/sellerQuestions';
import { getDailyHurdleCharge, HURDLE_RATE } from '../core/sliceModel';
import { useGameStore } from '../state/gameStore';
import { getPortraits } from './assets';

// The seller's published books, formatted for the deal table. The numbers live in core/deal.ts.
const SELLER_ASK = CENTRAL_PARK_DEAL.askingPrice;
const SELLER_PERIODS = CENTRAL_PARK_DEAL.books.map((b) => ({
  period: b.label,
  sales: `$${b.sales}`,
  lemons: `$${b.lemons}`,
  manager: `$${b.managerWage}`,
  rent: `$${b.rent}`,
  profit: `$${b.profit}`,
}));

/**
 * Typing in an <input> must not trigger the game's global hotkeys (WASD, E, M, B...),
 * which listen on `window`. Stopping the NATIVE event's propagation keeps the keystroke
 * inside the input. Escape is let through so it can still close the modal.
 */
const stopInputKeyPropagation = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== 'Escape') {
    e.nativeEvent.stopPropagation();
  }
};

/**
 * Seller due-diligence & sealed-bid dossier.
 *
 * The two text boxes are purely local UI state (nobody else needs them), so they live
 * here as `useState` rather than in the game store. They sit in this always-mounted
 * outer component, not the body, so a half-typed question or bid survives closing and
 * reopening the modal, exactly as it did when this lived in App.
 */
export function SellerDealModal() {
  const open = useGameStore((s) => s.activeModal === 'seller-stand');
  const [questionInput, setQuestionInput] = useState('');
  const [bidInput, setBidInput] = useState('45');

  if (!open) return null;
  return (
    <SellerDealBody
      questionInput={questionInput}
      setQuestionInput={setQuestionInput}
      bidInput={bidInput}
      setBidInput={setBidInput}
    />
  );
}

interface SellerDealBodyProps {
  questionInput: string;
  setQuestionInput: (v: string) => void;
  bidInput: string;
  setBidInput: (v: string) => void;
}

function SellerDealBody({ questionInput, setQuestionInput, bidInput, setBidInput }: SellerDealBodyProps) {
  const actions = useGameStore((s) => s.actions);
  const qaLog = useGameStore((s) => s.qaLog);
  const bidMessage = useGameStore((s) => s.bidMessage);
  const dealStatus = useGameStore((s) => s.economy.dealStatus);
  const cash = useGameStore((s) => s.economy.cash);
  const dailyHurdle = useGameStore((s) => getDailyHurdleCharge(s.economy));
  const portraits = getPortraits();

  const askSeller = (e: React.FormEvent) => {
    e.preventDefault();
    actions.askQuestion(questionInput);
    setQuestionInput('');
  };

  // Live sealed bid calculations
  const parsedBid = Number(bidInput);
  const validBid = Number.isFinite(parsedBid) && parsedBid > 0 ? parsedBid : 0;
  const impliedBidHurdle = +(validBid * HURDLE_RATE).toFixed(2);
  const newTotalHurdle = +(dailyHurdle + impliedBidHurdle).toFixed(2);
  const cashAfterBid = +(cash - validBid).toFixed(2);

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="modal-shell is-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-kicker">Acquisition Dossier · Brownstone Corner</div>
            <div className="modal-title">Seller Stand — Due Diligence &amp; Sealed Bid</div>
          </div>
          <button type="button" className="icon-close-btn" onClick={actions.closeModal} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Seller Portrait Badge & Speech Bubble */}
          <div className="seller-intro">
            <div className="seller-avatar">
              <img src={portraits.shiba} alt="Maya the Seller" className="seller-avatar-img pixel-portrait" />
            </div>
            <div className="speech-bubble">
              <div className="speech-bubble-meta">
                <span className="seller-name">Maya · Corner Stand Owner</span>
                <span className="ask-badge game-num">Asking ${SELLER_ASK}</span>
              </div>
              &ldquo;Sales climbed every period—$14, $15, now $16 a day. Lemons held at $5 and rent at $3, so it
              kept $8 a day last period. Prime brownstone corner. I&apos;m asking ${SELLER_ASK}.&rdquo;
            </div>
          </div>

          {/* 3-Period Operating Table */}
          <div>
            <div className="panel-section-label">
              <span>Reported Operating History</span>
              <span>Per Day</span>
            </div>
            <div className="dossier-table-wrap">
              <table className="dossier-table game-num">
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
                  {SELLER_PERIODS.map((r) => (
                    <tr key={r.period}>
                      <td style={{ fontFamily: 'inherit' }}>{r.period}</td>
                      <td>{r.sales}</td>
                      <td>{r.lemons}</td>
                      <td className="clue-zero">{r.manager}</td>
                      <td>{r.rent}</td>
                      <td className="profit-cell">{r.profit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Diligence Q&A */}
          <div>
            <div className="panel-section-label">
              <span>Due Diligence Q&amp;A ({3 - qaLog.length} left)</span>
              <span className="q-pips" aria-label={`${3 - qaLog.length} of 3 questions remaining`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`q-pip ${i < qaLog.length ? 'is-used' : ''}`} />
                ))}
              </span>
            </div>

            {qaLog.length < 3 && dealStatus === 'open' && (
              <div className="chip-row">
                {STARTER_QUESTIONS.map((chip) => {
                  const alreadyAsked = qaLog.some((item) => item.q.toLowerCase() === chip.toLowerCase());
                  return (
                    <button
                      key={chip}
                      type="button"
                      className="diligence-chip"
                      disabled={alreadyAsked || qaLog.length >= 3}
                      onClick={() => actions.askQuestion(chip)}
                    >
                      {alreadyAsked ? `✓ ${chip}` : chip}
                    </button>
                  );
                })}
              </div>
            )}

            {qaLog.length > 0 && (
              <div className="qa-log">
                {qaLog.map((item, idx) => (
                  <div key={idx} className="qa-entry">
                    <div className="qa-q">You: {item.q}</div>
                    <div className="qa-a">Seller: {item.a}</div>
                  </div>
                ))}
              </div>
            )}

            {qaLog.length < 3 && dealStatus === 'open' && (
              <form onSubmit={askSeller} className="input-row">
                <input
                  className="ui-input"
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  onKeyDown={stopInputKeyPropagation}
                  placeholder="Ask a custom diligence question (e.g. staffing, lease, terms)..."
                />
                <button type="submit" className="gbtn">
                  Ask
                </button>
              </form>
            )}
          </div>

          {/* 1-Shot Sealed Bid */}
          <div className="bid-panel">
            <div className="panel-section-label" style={{ marginBottom: 0 }}>
              <span>1-Shot Sealed Bid</span>
              <span className="game-num">Cash: ${cash.toFixed(2)}</span>
            </div>

            {dealStatus === 'open' ? (
              <>
                <div className="input-row">
                  <div className="bid-input-wrap">
                    <span className="bid-dollar-prefix">$</span>
                    <input
                      type="number"
                      min={1}
                      className="ui-input bid-input game-num"
                      value={bidInput}
                      onChange={(e) => setBidInput(e.target.value)}
                      onKeyDown={stopInputKeyPropagation}
                      aria-label="Sealed bid amount"
                    />
                  </div>
                  <button
                    type="button"
                    className="gbtn gbtn-green"
                    style={{ flex: 1 }}
                    onClick={() => actions.submitSealedBid(bidInput)}
                  >
                    Submit Sealed Bid (${validBid || 0})
                  </button>
                  <button type="button" className="gbtn gbtn-slate" onClick={actions.walkAwayFromSeller}>
                    Walk Away
                  </button>
                </div>

                <div className="bid-preview-strip">
                  <div>
                    <div className="bid-metric-label">Implied 5% Charge</div>
                    <div className="bid-metric-val game-num val-amber">+${impliedBidHurdle.toFixed(2)}/day</div>
                  </div>
                  <div>
                    <div className="bid-metric-label">New Total Hurdle</div>
                    <div className="bid-metric-val game-num">-${newTotalHurdle.toFixed(2)}/day</div>
                  </div>
                  <div>
                    <div className="bid-metric-label">Cash After Bid</div>
                    <div className={`bid-metric-val game-num ${cashAfterBid >= 0 ? 'val-pos' : 'val-neg'}`}>
                      {cashAfterBid >= 0 ? `$${cashAfterBid.toFixed(2)}` : `-$${Math.abs(cashAfterBid).toFixed(2)}`}
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {bidMessage && (
              <div className={`bid-outcome ${dealStatus === 'won' ? 'won' : 'rejected'}`}>{bidMessage}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
