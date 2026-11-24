import { useGameStore } from '../state/gameStore';
import { ManhattanMapModal } from './ManhattanMapModal';

/** Connects the (store-agnostic) 2.5D Manhattan map modal to the game store. */
export function MapModalHost() {
  const actions = useGameStore((s) => s.actions);
  const mapOpen = useGameStore((s) => s.mapOpen);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);

  return mapOpen ? (
    <ManhattanMapModal currentId={neighborhoodId} onSelect={actions.selectNeighborhood} onClose={actions.closeMap} />
  ) : null;
}
