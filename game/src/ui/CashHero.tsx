import { useGameStore } from '../state/gameStore';
import { getIcons } from './assets';

/**
 * The big coin + cash number shown in both the action dock and the stall workbench.
 *
 * It owns its two store subscriptions (cash and the sale "pulse" counter) so the parent
 * bars do not have to. The `key` on the root element contains the pulse counter: when a
 * sale bumps it, React sees a new key, throws the old element away and builds a fresh
 * one, which restarts the CSS pulse animation.
 */
export function CashHero({ compact = false }: { compact?: boolean }) {
  const cash = useGameStore((s) => s.economy.cash);
  const cashPulseKey = useGameStore((s) => s.cashPulseKey);
  const icons = getIcons();
  const pulse = cashPulseKey > 0 ? 'is-cash-pulse' : '';

  return (
    <div
      key={`${compact ? 'wb-cash' : 'cash'}-${cashPulseKey}`}
      className={compact ? `dock-cash-hero is-compact ${pulse}` : `dock-cash-hero ${pulse}`}
      title="Available Cash"
    >
      <img src={icons.coin} alt="Cash" className="px-icon-hero" />
      <span className="dock-cash-val game-num">${cash.toFixed(2)}</span>
    </div>
  );
}
