import type { NeighborhoodId } from '../../core/neighborhoods';

/** North to south: the order the subway line runs, and the order arrow keys walk. */
export const SUBWAY_LINE_ORDER: readonly NeighborhoodId[] = [
  'columbia',
  'central-park',
  'fifth-ave',
  'broadway',
  'market',
  'west-village',
  'fidi',
];

/**
 * The stations a train passes through going from `from` to `to`, both ends included, in
 * travel order (so heading north returns the stations reversed).
 *
 * Why this exists: the old route was one straight line between the two dots, which cut
 * across the river and buildings. A train can only follow the track, so the highlighted
 * route is the slice of the ordered line between the two stations.
 *
 * Throws on an id that is not on the line: a silent fallback (e.g. a straight line)
 * would hide a station that was added to the game but forgotten here.
 */
export function routeBetween(
  from: NeighborhoodId,
  to: NeighborhoodId,
  order: readonly NeighborhoodId[] = SUBWAY_LINE_ORDER
): NeighborhoodId[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) {
    throw new Error(`Station not on the subway line: ${a < 0 ? from : to}`);
  }
  const slice = order.slice(Math.min(a, b), Math.max(a, b) + 1);
  return a <= b ? slice : slice.reverse();
}

/** "x,y x,y ..." for an SVG polyline, from stations and a station-to-point lookup. */
export function toPolylinePoints(
  ids: readonly NeighborhoodId[],
  pointOf: (id: NeighborhoodId) => { x: number; y: number }
): string {
  return ids
    .map((id) => {
      const p = pointOf(id);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}
