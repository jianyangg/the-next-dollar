import { useGameStore } from '../state/gameStore';
import { ActionDock } from './ActionDock';
import { StandWorkbench } from './StandWorkbench';
import './styles/stand.css';

/**
 * Bottom layer: the stand menu when behind the counter, the walking dock otherwise.
 * `dock-root` is a click-through full-screen layer; only the plates inside catch clicks.
 */
export function BottomDock() {
  const workingAtStand = useGameStore((s) => s.workingAtStand);
  return <div className="dock-root">{workingAtStand ? <StandWorkbench /> : <ActionDock />}</div>;
}
