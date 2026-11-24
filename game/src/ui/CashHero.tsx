import { useGameStore } from '../state/gameStore';
import { getIcons } from './assets';
import { EASE_OUT } from './motionPresets';
import { usePulse } from './usePulse';

/**
 * The big coin + cash number shown in both the action dock and the stall workbench.
 *
 * It owns its two store subscriptions (cash and the sale "pulse" counter) so the parent
 * bars do not have to. Each sale bumps `cashPulseKey`; whenever that number goes up,
 * `usePulse` plays a short "swell + green flash" Motion keyframe animation on the same
 * element (0.36 s: scale 1 -> 1.08 -> 1, background flashes green at 35% and fades).
 */
export function CashHero({ compact = false }: { compact?: boolean }) {
  const cash = useGameStore((s) => s.economy.cash);
  const cashPulseKey = useGameStore((s) => s.cashPulseKey);
  const icons = getIcons();

  const scope = usePulse<HTMLDivElement>(
    cashPulseKey,
    {
      scale: [1, 1.08, 1],
      // Same colour at alpha 0 (not the word "transparent") so the fade is a clean alpha ramp.
      backgroundColor: ['rgba(56, 168, 82, 0)', 'rgba(56, 168, 82, 0.35)', 'rgba(56, 168, 82, 0)'],
    },
    { duration: 0.36, times: [0, 0.35, 1], ease: EASE_OUT },
    false
  );

  return (
    <div ref={scope} className={compact ? 'dock-cash-hero is-compact' : 'dock-cash-hero'} title="Available Cash">
      <img src={icons.coin} alt="Cash" className="px-icon-hero" />
      <span className="dock-cash-val game-num">${cash.toFixed(2)}</span>
    </div>
  );
}
