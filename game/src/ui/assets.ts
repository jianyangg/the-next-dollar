import {
  createMascotPortraitDataUrl,
  createMascotSpriteTexture,
  createUiIconDataUrl,
  FOUNDER_CATALOG,
  type FounderSpecies,
  type UiIconKind,
  type VendorKind,
} from '../world/pixelArt';

/**
 * Pixel-art images used by the UI, drawn once and cached.
 *
 * Each image is a canvas -> data-URL conversion, which is slow enough that we never
 * want to redo it on a re-render. The old App did this in `useMemo(..., [])`; now that
 * the UI is split across many components, a module-level lazy cache lets all of them
 * share one copy. "Lazy" (built on first call, not at import time) matters because the
 * canvas only exists once the browser is running, and tests can swap the pixelArt
 * module out before the first call.
 */

const UI_ICON_KINDS: UiIconKind[] = ['coin', 'lemon', 'pitcher', 'cup', 'book', 'map', 'sun', 'hurdle', 'market'];

let iconCache: Record<UiIconKind, string> | null = null;
let portraitCache: Record<FounderSpecies, string> | null = null;
let spriteCache: Record<FounderSpecies, string> | null = null;

/** 16x16 UI icons keyed by kind. */
export function getIcons(): Record<UiIconKind, string> {
  if (!iconCache) {
    const map = {} as Record<UiIconKind, string>;
    for (const k of UI_ICON_KINDS) {
      map[k] = createUiIconDataUrl(k);
    }
    iconCache = map;
  }
  return iconCache;
}

/** 32x32 mascot portraits keyed by founder species. */
export function getPortraits(): Record<FounderSpecies, string> {
  if (!portraitCache) {
    const map = {} as Record<FounderSpecies, string>;
    for (const f of FOUNDER_CATALOG) {
      map[f.id] = createMascotPortraitDataUrl(f.id);
    }
    portraitCache = map;
  }
  return portraitCache;
}

/** 32x40 full standing sprites (founder picker); falls back to the portrait if the canvas can't export. */
export function getStandingSprites(): Record<FounderSpecies, string> {
  if (!spriteCache) {
    const map = {} as Record<FounderSpecies, string>;
    for (const f of FOUNDER_CATALOG) {
      const tex = createMascotSpriteTexture(f.id, 0, 'down');
      const img = tex.image as HTMLCanvasElement | undefined;
      map[f.id] =
        img && typeof img.toDataURL === 'function' ? img.toDataURL() : createMascotPortraitDataUrl(f.id);
    }
    spriteCache = map;
  }
  return spriteCache;
}

/** The three Union Square market vendors, by the trade id the scene uses for their sprite. */
export type MarketVendorKind = Extract<VendorKind, 'grower' | 'carpenter' | 'glazier'>;

let vendorPortraitCache: Record<MarketVendorKind, string> | null = null;

/**
 * 32x32 portraits of the market vendors: Rocco ('grower', lemons), June ('carpenter',
 * stall kits) and Otis ('glazier', pitchers). The same art as their sprites at the stalls,
 * so the face in the shop window is the person standing behind the counter.
 */
export function getVendorPortraits(): Record<MarketVendorKind, string> {
  if (!vendorPortraitCache) {
    vendorPortraitCache = {
      grower: createMascotPortraitDataUrl('grower'),
      carpenter: createMascotPortraitDataUrl('carpenter'),
      glazier: createMascotPortraitDataUrl('glazier'),
    };
  }
  return vendorPortraitCache;
}

/** 32x32 portrait of Dana Reyes, the stand seller (the 'broker' sprite in the world). */
export function getSellerPortrait(): string {
  return createMascotPortraitDataUrl('broker');
}
