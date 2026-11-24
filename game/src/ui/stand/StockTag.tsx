import { lemonCupsLeft } from '../../core/brewing';
import { useGameStore } from '../../state/gameStore';
import { getIcons } from '../assets';
import { EASE_OUT } from '../motionPresets';
import { usePulse } from '../usePulse';

/**
 * Small PAPER tag with the stock numbers from the engine: lemons not yet brewed (in
 * cups' worth), cups already brewed ("ready"), pitchers, and the customer rating.
 * Brewing moves cups from the lemon pile to Ready; a sale takes one from Ready.
 * Paper (not sign) because these are real figures, not controls.
 *
 * `withKits` adds the stall-kit count (shown while walking, when kits matter).
 */

/** "x3" streak tag. It pops each time the combo goes UP, on the same element. */
function ComboTag({ combo }: { combo: number }) {
  const scope = usePulse<HTMLSpanElement>(
    combo,
    { scale: [0.8, 1.15, 1] },
    { duration: 0.26, times: [0, 0.6, 1], ease: EASE_OUT },
    true
  );
  return (
    <span ref={scope} className="stand-combo" aria-label={`Sale streak ${combo}`}>
      Streak x{combo}
    </span>
  );
}

export function StockTag({ withKits = false, withPrice = false }: { withKits?: boolean; withPrice?: boolean }) {
  const brewedCups = useGameStore((s) => s.brewedCups);
  const lemons = useGameStore((s) => lemonCupsLeft(s.economy.cupsInStock, s.brewedCups));
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const stallKits = useGameStore((s) => s.economy.stallKits);
  const pricePerCup = useGameStore((s) => s.economy.pricePerCup);
  const ratingAvg = useGameStore((s) => s.economy.ratingAvg);
  const reviewCount = useGameStore((s) => s.economy.reviews.length);
  const combo = useGameStore((s) => s.combo);
  const icons = getIcons();

  return (
    <div className="pt-paper stand-tag" aria-label="Stock">
      <div className="stand-tag-row">
        <img src={icons.lemon} alt="Lemons" className="stand-icon" />
        <span className={`stand-num ${lemons === 0 ? 'is-low' : ''}`}>{lemons}</span>
        <span className="stand-tag-label">Ready</span>
        <span className="stand-num">{brewedCups}</span>
      </div>
      <div className="stand-tag-row">
        <img src={icons.pitcher} alt="Pitchers" className="stand-icon" />
        <span className="stand-num">{pitchers}</span>
        {withKits && stallKits > 0 && (
          <>
            <img src={icons.market} alt="Stall kits" className="stand-icon" />
            <span className="stand-num">{stallKits}</span>
          </>
        )}
        {withPrice && <span className="stand-num">${pricePerCup}</span>}
      </div>
      <div className="stand-tag-row">
        <span className="stand-num">
          ★ {ratingAvg.toFixed(1)} ({reviewCount})
        </span>
        {combo >= 2 && <ComboTag combo={combo} />}
      </div>
    </div>
  );
}
