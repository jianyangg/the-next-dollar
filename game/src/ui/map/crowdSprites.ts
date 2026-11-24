import type { DistrictPedestrianKind } from '../../world/pixelArt';
import type { NeighborhoodId } from '../../core/neighborhoods';
import { DISTRICT_PEDESTRIANS } from '../../world/districtCrowds';

/**
 * The pedestrians the map card shows for a district: the scene's own list
 * (world/districtCrowds.ts), so the picture matches what the player meets on arrival.
 * Duplicates are dropped so the card never shows the same person twice.
 */
export function crowdKinds(id: NeighborhoodId): DistrictPedestrianKind[] {
  return [...new Set(DISTRICT_PEDESTRIANS[id])];
}

/** Two walk-cycle frames (data URLs) of one pedestrian, so the card can step-animate. */
export type CrowdFrames = readonly [string, string];

type TextureLike = { image?: unknown };

const cache = new Map<DistrictPedestrianKind, CrowdFrames | null>();

function canvasToUrl(tex: TextureLike): string {
  const canvas = tex.image as { toDataURL?: () => string } | undefined;
  if (!canvas || typeof canvas.toDataURL !== 'function') {
    throw new Error('pedestrian texture has no canvas to export');
  }
  return canvas.toDataURL();
}

/**
 * Render (once, then cache) the two walking frames of a pedestrian as data URLs.
 *
 * `makeTexture` is injected so this stays testable without a real canvas. Returns null,
 * not made-up art, when the canvas is unavailable (jsdom / headless): the card then
 * shows only the crowd's text label, which is always rendered anyway.
 */
export function crowdFrames(
  kind: DistrictPedestrianKind,
  makeTexture: (kind: DistrictPedestrianKind, phase: 0 | 1) => TextureLike
): CrowdFrames | null {
  if (cache.has(kind)) return cache.get(kind) ?? null;
  let frames: CrowdFrames | null = null;
  try {
    frames = [canvasToUrl(makeTexture(kind, 0)), canvasToUrl(makeTexture(kind, 1))];
  } catch {
    frames = null; // no canvas support here; deliberately not cached as a crash
  }
  cache.set(kind, frames);
  return frames;
}

/** Test hook: forget cached frames. */
export function resetCrowdFramesCache(): void {
  cache.clear();
}
