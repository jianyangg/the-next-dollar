import * as m from 'motion/react-m';
import { getNeighborhood, type NeighborhoodId } from '../core/neighborhoods';
import { TRAVEL_COVER_MS, TRAVEL_REVEAL_MS, useGameStore } from '../state/gameStore';
import { INPUT_PRIORITY } from '../state/input';
import { useInputLayer } from './kit/useInputLayer';
import './styles/travel.css';

/**
 * SUBWAY RIDE TRANSITION: two subway-car doors slide shut over the old district, a
 * station plate names the stop, the district swaps while the doors are closed, then
 * the doors slide open on the new one.
 *
 * WHO DECIDES WHAT: the store owns the timing (`travel.phase` and the two durations
 * in gameStore.ts); this component only draws the phase it is told. That keeps the
 * district swap a game-state event the tests can drive, not a side effect of an
 * animation finishing.
 *
 * Doors move in 6 hard steps (sprite-like), matching the Paper Trail motion rule. With
 * the OS "reduce motion" setting, MotionConfig in App skips the slide and the doors
 * simply appear and disappear.
 */
const STEPS_6 = (t: number): number => (t >= 1 ? 1 : Math.floor(t * 6) / 6);

export function TravelTransition() {
  const travel = useGameStore((s) => s.travel);
  if (!travel) return null;
  return <TravelDoors to={travel.to} phase={travel.phase} />;
}

function TravelDoors({ to, phase }: { to: NeighborhoodId; phase: 'cover' | 'reveal' }) {
  // Swallow every key (Escape included) during the ride: nothing may move, open or
  // close while the district is being swapped. Highest band, above any window.
  useInputLayer(() => true, { blocking: true, passKeys: [], priority: INPUT_PRIORITY.modal + 50 });

  const closed = phase === 'cover';
  const duration = (closed ? TRAVEL_COVER_MS : TRAVEL_REVEAL_MS) / 1000;
  const transition = { duration, ease: STEPS_6 };
  const name = getNeighborhood(to).shortName;

  return (
    <div className="travel-layer" role="status" aria-live="polite" aria-label={`Riding to ${name}`}>
      <m.div
        className="travel-door is-left"
        initial={{ x: '-100%' }}
        animate={{ x: closed ? '0%' : '-100%' }}
        transition={transition}
      >
        <span className="travel-window" />
      </m.div>
      <m.div
        className="travel-door is-right"
        initial={{ x: '100%' }}
        animate={{ x: closed ? '0%' : '100%' }}
        transition={transition}
      >
        <span className="travel-window" />
      </m.div>
      <m.div
        className="pt-sign travel-plate"
        initial={{ opacity: 0 }}
        animate={{ opacity: closed ? 1 : 0 }}
        transition={{ duration: duration / 2, ease: STEPS_6 }}
      >
        <span className="pt-disp travel-name">{name}</span>
      </m.div>
    </div>
  );
}
