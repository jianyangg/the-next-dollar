import type { NeighborhoodId } from '../core/neighborhoods';
import type { DistrictPedestrianKind } from './pixelArt';

/**
 * Who walks each district's streets. ONE list, read by both the 3D scene (to spawn
 * pedestrians) and the map window (to show the crowd you will meet on arrival), so the
 * two can never drift apart. (The map used to keep its own copy.)
 */
export const DISTRICT_PEDESTRIANS: Record<NeighborhoodId, DistrictPedestrianKind[]> = {
  'central-park': ['park-dog-walker', 'park-jogger'],
  columbia: ['columbia-student'],
  fidi: ['fidi-suit'],
  broadway: ['broadway-theater', 'fidi-suit'],
  'fifth-ave': ['fifth-shopper', 'fidi-suit'],
  'west-village': ['village-artist', 'park-dog-walker', 'columbia-student'],
  market: ['village-artist', 'park-dog-walker', 'columbia-student'],
};
