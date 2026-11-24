import { useShallow } from 'zustand/react/shallow';
import { getNeighborhood } from '../../core/neighborhoods';
import { selectCampaign, useGameStore } from '../../state/gameStore';
import { type CursorMenuItem, CursorMenu } from '../kit/CursorMenu';
import { awarenessPct } from './awareness';

/**
 * The Advertise sub-panel at the stand: what one marketing campaign in THIS district
 * costs and what it does to awareness.
 *
 * Every number here is a field of `selectCampaign` (state/gameStore.ts), which asks the
 * marketing rules (core/marketing.ts). The panel only turns 0..1 into 0..100 for display
 * and positions the bar marks at those exact fractions, so what the player sees is the
 * rule itself, never a second copy of the maths that could drift from it.
 */


/** A 0..1 fraction as a CSS width/left, kept inside the track. Exact, not rounded. */
const pos = (a: number): string => `${Math.min(100, Math.max(0, a * 100))}%`;

/** "$24.00". */
const usd = (n: number): string => `$${n.toFixed(2)}`;

/** The main-menu value for the Advertise row: the price, or why there is none. */
export function campaignPriceLabel(cost: number | null): string {
  return cost === null ? 'Nobody to reach' : usd(cost);
}

export function AdvertisePanel({ active, onDone }: { active: boolean; onDone: () => void }) {
  const actions = useGameStore((s) => s.actions);
  // selectCampaign builds a fresh object each call; useShallow compares its fields one by
  // one, so the panel re-renders only when one of the numbers actually changes.
  const c = useGameStore(useShallow(selectCampaign));
  const district = getNeighborhood(c.district);

  const now = awarenessPct(c.now);
  const tomorrow = awarenessPct(c.tomorrow);
  const afterBuy = awarenessPct(c.afterBuy);
  const liftPct = Math.round(c.walkerLift * 100);

  const items: CursorMenuItem[] = [
    {
      id: 'buy',
      // With no price (nothing to advertise to) the item says so instead of showing a guess.
      label: c.cost === null ? 'No campaign here' : 'Buy campaign',
      value: c.cost === null ? undefined : usd(c.cost),
      // Disabled = can't happen: no price here, or cash does not cover it. The store also
      // refuses (and plays the reject sound), but a greyed item tells the player first.
      disabled: c.cost === null || !c.canAfford,
      // Buying keeps the panel open on purpose: the bar jumps and the next campaign's
      // smaller step (half the REMAINING gap) is visible straight away.
      onSelect: actions.advertise,
    },
    { id: 'done', label: 'Done', onSelect: onDone },
  ];

  return (
    <div className="stand-sub stand-ad">
      <div className="stand-ad-head">
        <span className="stand-ad-name">
          {district.name} <span className="stand-ad-dim">awareness</span>
        </span>
        <span className="stand-ad-now" aria-label={`Awareness ${now} of 100`}>
          {now}
          <span className="stand-ad-of">/100</span>
        </span>
      </div>

      {/*
        The awareness bar, all marks at the rule's exact fractions:
          solid fill  = awareness now
          pale ghost  = what one more campaign would raise it to (afterBuy)
          dark tick   = where it fades to at tonight's bell if nothing more is bought (tomorrow)
        The ghost sits under the fill so only the extra a campaign adds is visible.
      */}
      <div
        className="stand-ad-bar"
        role="img"
        aria-label={`Awareness ${now}. Tomorrow ${tomorrow} without another campaign. One more campaign: ${afterBuy}.`}
      >
        {c.cost !== null && <i className="stand-ad-ghost" style={{ width: pos(c.afterBuy) }} />}
        <i className="stand-ad-fill" style={{ width: pos(c.now) }} />
        <i className="stand-ad-tick" style={{ left: pos(c.tomorrow) }} />
      </div>

      <ul className="stand-ad-legend">
        <li>
          <i className="stand-ad-key is-tick" />
          Tomorrow: {tomorrow} <span className="stand-ad-dim">(fades at the bell)</span>
        </li>
        {c.cost !== null && (
          <li>
            <i className="stand-ad-key is-ghost" />
            One more campaign: {afterBuy}
          </li>
        )}
      </ul>

      <div className="stand-ad-lift">+{liftPct}% walkers here</div>
      {/* Honest warning: at a stand already selling all one worker can pour, extra
          walkers buy nothing more, whether a worker or the player pours (selectCampaign.cappedStands). */}
      {c.cappedStands > 0 && (
        <div className="stand-ad-warn" role="note">
          {c.cappedStands === 1 ? '1 of your stands here is' : `${c.cappedStands} of your stands here are`} already
          selling every cup it can pour: more walkers there add no sales unless you raise the price.
        </div>
      )}

      <CursorMenu label="Advertise" orientation="row" items={items} active={active} onBack={onDone} />
    </div>
  );
}
