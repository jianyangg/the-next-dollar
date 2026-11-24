import { useGameStore } from '../state/gameStore';
import { ActionDock } from './ActionDock';
import { StandWorkbench } from './StandWorkbench';

/** Bottom area: the stall workbench when behind the counter, the walking dock otherwise. */
export function BottomDock() {
  const workingAtStand = useGameStore((s) => s.workingAtStand);
  return <div className="bottom-dock-wrap">{workingAtStand ? <StandWorkbench /> : <ActionDock />}</div>;
}
