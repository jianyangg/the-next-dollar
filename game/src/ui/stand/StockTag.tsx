import { lemonCupsLeft } from '../../core/brewing';
import { useGameStore } from '../../state/gameStore';
import { getIcons } from '../assets';
import { EASE_OUT } from '../motionPresets';
import { usePulse } from '../usePulse';

/**
 * Small PAPER tag with the stock numbers, in the order lemonade moves through them:
 *
 *   Lemons      lemons not yet brewed, counted in cups' worth
 *   Cups ready  cups already brewed and waiting for a customer
 *
 * Brewing moves cups from Lemons to Cups ready; a sale takes one from Cups ready.
 * Every number has a word next to it (owner, 2026-11-24: "confused by this mini
 * screen, what's pitcher and what's the lemonade made ready"). The old tag showed a
 * pitcher icon with the number of pitchers OWNED, which players read as "lemonade in
 * the pitcher"; pitchers are equipment (they widen the brew sweet spot), so they now
 * appear only in the walking view's equipment row, labelled.
 *
 * `withKits` adds the equipment row (pitchers, stall kits) and `withPrice` the cup
 * price: both shown while walking, when buying and placing matter.
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
        <img src={icons.lemon} alt="" className="stand-icon" />
        <span className="stand-tag-label">Lemons</span>
        <span className={`stand-num ${lemons === 0 ? 'is-low' : ''}`} aria-label={`Lemons for ${lemons} cups`}>
          {lemons}
        </span>
      </div>
      <div className="stand-tag-row">
        <img src={icons.cup} alt="" className="stand-icon" />
        <span className="stand-tag-label">Cups ready</span>
        <span className={`stand-num ${brewedCups === 0 ? 'is-low' : ''}`} aria-label={`${brewedCups} cups ready`}>
          {brewedCups}
        </span>
      </div>
      {(withKits || withPrice) && (
        <div className="stand-tag-row">
          {withKits && (
            <>
              <img src={icons.pitcher} alt="" className="stand-icon" />
              <span className="stand-tag-label">Pitchers</span>
              <span className="stand-num">{pitchers}</span>
            </>
          )}
          {withKits && stallKits > 0 && (
            <>
              <img src={icons.market} alt="" className="stand-icon" />
              <span className="stand-tag-label">Kits</span>
              <span className="stand-num">{stallKits}</span>
            </>
          )}
          {withPrice && <span className="stand-num">${pricePerCup}/cup</span>}
        </div>
      )}
      <div className="stand-tag-row">
        <span className="stand-num" aria-label={`Rating ${ratingAvg.toFixed(1)} from ${reviewCount} reviews`}>
          ★ {ratingAvg.toFixed(1)}
        </span>
        <span className="stand-tag-label">
          {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
        </span>
        {combo >= 2 && <ComboTag combo={combo} />}
      </div>
    </div>
  );
}
