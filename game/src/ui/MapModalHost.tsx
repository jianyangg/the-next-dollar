import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useGameStore } from '../state/gameStore';
import { ManhattanMapModal } from './ManhattanMapModal';
import { EASE_IN } from './motionPresets';

/** Connects the (store-agnostic) 2.5D Manhattan map modal to the game store. */
export function MapModalHost() {
  const actions = useGameStore((s) => s.actions);
  const mapOpen = useGameStore((s) => s.mapOpen);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);

  // The map keeps its own CSS entrance (inside ManhattanMapModal); this wrapper adds the fade-OUT.
  // It animates opacity only: a `transform` on the wrapper would turn it into the containing
  // block of the map's `position: fixed` backdrop and break full-screen layout.
  return (
    <AnimatePresence>
      {mapOpen && (
        <m.div
          key="map"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: 0.14, ease: EASE_IN } }}
        >
          <ManhattanMapModal currentId={neighborhoodId} onSelect={actions.selectNeighborhood} onClose={actions.closeMap} />
        </m.div>
      )}
    </AnimatePresence>
  );
}
