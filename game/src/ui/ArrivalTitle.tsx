import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { getNeighborhood } from '../core/neighborhoods';
import { useGameStore } from '../state/gameStore';
import './styles/travel.css';

/**
 * ARRIVAL TITLE: after a subway ride, the district's name on a sign plate at the top
 * of the screen for a moment (like a location card in an adventure game).
 *
 * Why not a floating note: the name used to be a world note anchored to the stand, so
 * it landed on top of the stand's own "[E] Open" sign and was drawn in the note style
 * for money, over whatever trees or buildings were behind it. A place name is about the
 * SCREEN (where am I?), not about one object, so it gets a fixed spot of its own and
 * the solid sign surface, which reads on any background.
 *
 * The store decides when it shows (`arrival`, set when the doors open and cleared by a
 * timer); this component only draws it. `key={arrival.id}` restarts the animation when
 * the player rides again before the last title faded.
 */
export function ArrivalTitle() {
  const arrival = useGameStore((s) => s.arrival);
  return (
    <AnimatePresence>
      {arrival && (
        <m.div
          key={arrival.id}
          className="pt-sign arrival-title"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
        >
          <span className="pt-disp arrival-name">{getNeighborhood(arrival.district).name}</span>
        </m.div>
      )}
    </AnimatePresence>
  );
}
